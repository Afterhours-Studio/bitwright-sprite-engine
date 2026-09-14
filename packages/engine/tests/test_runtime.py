# Bitwright - Sprite Engine
# Copyright (C) 2026 Afterhours Studio
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.

"""Tests for the GPU runtime installer.

Nothing here downloads PyTorch, and nothing here touches the network. Every
install is served by an injected ``httpx`` client backed by a mock transport
handing back wheels built in the test directory, so the real streaming, hashing,
extraction, publication, cancellation and removal paths all run against bytes
this file created.
"""

from __future__ import annotations

import hashlib
import io
import json
import sys
import threading
import zipfile
from collections.abc import Callable, Iterator
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from bitwright_engine.api import server
from bitwright_engine.config import Settings
from bitwright_engine.runtime import activation
from bitwright_engine.runtime.installer import (
    RECORD_NAME,
    RUNTIME_DIRNAME,
    SITE_DIRNAME,
    AlreadyInstalledError,
    AlreadyInstallingError,
    DownloadsDisabledError,
    InsufficientSpaceError,
    NotInstalledError,
    RuntimeInstaller,
    UnknownVariantError,
    UnsupportedTargetError,
    _safe_member,
)
from bitwright_engine.runtime.manifest import MANIFEST, Variant, Wheel, find_variant, recommended

Handler = Callable[[httpx.Request], httpx.Response]

WINDOWS = "win_amd64-cp314"
MACOS = "macosx_arm64-cp314"
LINUX = "linux_x86_64-cp314"

PLATFORM_MARKERS = {
    WINDOWS: ("win_amd64",),
    MACOS: ("macosx",),
    LINUX: ("manylinux",),
}
"""What a compiled wheel's file name has to say to belong to a target.

A wheel tagged for one operating system unpacks perfectly well on another and
then fails to import, because the extension inside it is a ``.pyd`` or a ``.so``
built for somewhere else. The manifest is the only place that can catch it, so
it is checked here rather than discovered by a user four gigabytes later.
"""

PORTABLE_SUFFIX = "none-any.whl"
"""What a wheel's file name ends with when it runs anywhere."""

WAIT_S = 10.0
"""How long a test waits for a worker thread before giving up."""

TARGET = "test_target-cp000"
"""A manifest key no real machine reports, so tests never match a real entry."""


def build_wheel(name: str, files: dict[str, bytes]) -> bytes:
    """Build a wheel in memory.

    Args:
        name: Distribution name, used for the top level package directory.
        files: Member names mapped to their contents.

    Returns:
        The zip bytes.
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        for member, payload in files.items():
            bundle.writestr(member, payload)
        bundle.writestr(f"{name}-1.0.dist-info/METADATA", b"Name: " + name.encode())
    return buffer.getvalue()


def wheel_entry(name: str, payload: bytes, *, url: str | None = None) -> Wheel:
    """Describe a built wheel the way the manifest would.

    Args:
        name: Distribution name.
        payload: The wheel bytes.
        url: URL to pin. Defaults to one derived from the name.

    Returns:
        A manifest entry with the true size and digest of ``payload``.
    """
    with zipfile.ZipFile(io.BytesIO(payload)) as bundle:
        unpacked = sum(member.file_size for member in bundle.infolist())

    return Wheel(
        name=name,
        version="1.0",
        url=url if url is not None else f"https://wheels.invalid/{name}-1.0.whl",
        sha256=hashlib.sha256(payload).hexdigest(),
        size_bytes=len(payload),
        unpacked_bytes=unpacked,
        license_id="MIT",
    )


@pytest.fixture
def wheels() -> dict[str, bytes]:
    """Return two small wheels, keyed by the URL they are served from."""
    torch = build_wheel("torch", {"torch/__init__.py": b"__version__ = '9.9.9'\n"})
    helper = build_wheel("helper", {"helper/__init__.py": b"VALUE = 1\n"})
    return {
        "https://wheels.invalid/torch-1.0.whl": torch,
        "https://wheels.invalid/helper-1.0.whl": helper,
    }


@pytest.fixture
def variant(wheels: dict[str, bytes]) -> Variant:
    """Return a variant made of the two built wheels."""
    return Variant(
        accelerator="cuda",
        torch_version="9.9.9",
        cuda_version="12.6",
        bundles_nvidia=True,
        wheels=(
            wheel_entry("torch", wheels["https://wheels.invalid/torch-1.0.whl"]),
            wheel_entry("helper", wheels["https://wheels.invalid/helper-1.0.whl"]),
        ),
    )


@pytest.fixture
def manifest(
    monkeypatch: pytest.MonkeyPatch, variant: Variant
) -> Iterator[Callable[[Variant], None]]:
    """Point the installer at a manifest of test wheels on a test target.

    Yields a function that replaces the variant, for a test that needs the
    pinned entry to describe a wheel it built for the occasion.
    """
    monkeypatch.setattr("bitwright_engine.runtime.manifest.target_key", lambda: TARGET)
    monkeypatch.setattr("bitwright_engine.runtime.installer.target_key", lambda: TARGET)
    monkeypatch.setattr("bitwright_engine.runtime.activation.target_key", lambda: TARGET)

    def use(replacement: Variant) -> None:
        monkeypatch.setitem(MANIFEST, TARGET, (replacement,))

    use(variant)
    yield use


def serve(
    wheels: dict[str, bytes],
    *,
    on_chunk: Callable[[str], None] | None = None,
    corrupt: str | None = None,
) -> Handler:
    """Build a mock transport handler that serves the built wheels.

    Args:
        wheels: Wheel bytes, keyed by URL.
        on_chunk: Called with each URL before its body is sent, so a test can
            interfere with a transfer in flight.
        corrupt: URL whose body should be altered, to exercise the digest check.

    Returns:
        A handler suitable for :class:`httpx.MockTransport`.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        payload = wheels.get(url)
        if payload is None:
            return httpx.Response(404)
        if on_chunk is not None:
            on_chunk(url)
        if url == corrupt:
            payload = payload[:-1] + bytes([payload[-1] ^ 0xFF])
        return httpx.Response(200, content=payload)

    return handler


def make_installer(
    settings: Settings,
    handler: Handler,
) -> RuntimeInstaller:
    """Return an installer wired to a mock transport.

    Args:
        settings: Configuration pointing at the test directory.
        handler: What to answer each request with.

    Returns:
        An installer that never opens a socket.
    """
    return RuntimeInstaller(
        settings,
        client_factory=lambda: httpx.Client(transport=httpx.MockTransport(handler)),
    )


@pytest.fixture
def downloading_settings(settings: Settings) -> Settings:
    """Return settings with downloads allowed, which the shared fixture turns off."""
    settings.allow_downloads = True
    return settings


def test_reports_nothing_installed_on_a_fresh_root(
    downloading_settings: Settings,
    wheels: dict[str, bytes],
) -> None:
    installer = make_installer(downloading_settings, serve(wheels))

    assert installer.record() is None
    assert installer.used_bytes() == 0
    assert installer.state().installing is False


def test_the_install_target_follows_the_data_root(
    downloading_settings: Settings,
    wheels: dict[str, bytes],
    tmp_path: Path,
) -> None:
    installer = make_installer(downloading_settings, serve(wheels))
    assert installer.root == downloading_settings.data_root / RUNTIME_DIRNAME

    moved = tmp_path / "elsewhere"
    downloading_settings.use_data_root(moved)

    # Read afresh, not captured at construction: moving where downloads live
    # has to move where the runtime is looked for, or the setting would appear
    # to do nothing.
    assert installer.root == moved / RUNTIME_DIRNAME
    assert installer.site_dir == moved / RUNTIME_DIRNAME / SITE_DIRNAME


@pytest.mark.usefixtures("manifest")
def test_installs_and_records_what_it_wrote(
    downloading_settings: Settings,
    wheels: dict[str, bytes],
) -> None:
    installer = make_installer(downloading_settings, serve(wheels))

    installer.start("cuda")
    assert installer.wait(WAIT_S)

    record = installer.record()
    assert record is not None
    assert record.accelerator == "cuda"
    assert record.torch_version == "9.9.9"
    assert record.target == TARGET

    assert (installer.site_dir / "torch" / "__init__.py").is_file()
    assert (installer.site_dir / "helper" / "__init__.py").is_file()
    assert installer.state().error == ""


@pytest.mark.usefixtures("manifest")
def test_refuses_a_second_install_over_one_already_there(
    downloading_settings: Settings,
    wheels: dict[str, bytes],
) -> None:
    installer = make_installer(downloading_settings, serve(wheels))
    installer.start("cuda")
    assert installer.wait(WAIT_S)

    with pytest.raises(AlreadyInstalledError) as failure:
        installer.start("cuda")
    assert failure.value.code == "runtime.already_installed"


@pytest.mark.usefixtures("manifest")
def test_refuses_a_second_install_while_one_is_running(
    downloading_settings: Settings,
    wheels: dict[str, bytes],
) -> None:
    started = threading.Event()
    release = threading.Event()

    def hold(_: str) -> None:
        started.set()
        release.wait(WAIT_S)

    installer = make_installer(downloading_settings, serve(wheels, on_chunk=hold))
    installer.start("cuda")
    assert started.wait(WAIT_S)

    try:
        with pytest.raises(AlreadyInstallingError) as failure:
            installer.start("cuda")
        assert failure.value.code == "runtime.already_installing"
    finally:
        release.set()
        installer.wait(WAIT_S)


@pytest.mark.usefixtures("manifest")
def test_a_failed_install_leaves_nothing_behind(
    downloading_settings: Settings,
    wheels: dict[str, bytes],
) -> None:
    corrupt = "https://wheels.invalid/helper-1.0.whl"
    installer = make_installer(downloading_settings, serve(wheels, corrupt=corrupt))

    installer.start("cuda")
    assert installer.wait(WAIT_S)

    assert installer.state().error == "runtime.checksum_mismatch"
    assert installer.record() is None
    assert not installer.site_dir.exists()
    # Not one byte of the first wheel, which did arrive intact, is left over.
    assert sorted(path.name for path in installer.root.iterdir()) == []


@pytest.mark.usefixtures("manifest")
def test_a_refused_download_is_reported_by_its_code(
    downloading_settings: Settings,
) -> None:
    installer = make_installer(downloading_settings, serve({}))

    installer.start("cuda")
    assert installer.wait(WAIT_S)

    assert installer.state().error == "runtime.download_rejected"
    assert installer.record() is None


@pytest.mark.usefixtures("manifest")
def test_cancellation_stops_the_install_and_reports_no_failure(
    downloading_settings: Settings,
    wheels: dict[str, bytes],
) -> None:
    installer: RuntimeInstaller | None = None
    seen = threading.Event()

    def cancel_on_first(_: str) -> None:
        seen.set()
        assert installer is not None
        installer.cancel()

    installer = make_installer(downloading_settings, serve(wheels, on_chunk=cancel_on_first))
    installer.start("cuda")
    assert seen.wait(WAIT_S)
    assert installer.wait(WAIT_S)

    state = installer.state()
    assert state.installing is False
    # A cancellation is an outcome the user asked for, not a failure to report.
    assert state.error == ""
    assert installer.record() is None
    assert not installer.site_dir.exists()


@pytest.mark.usefixtures("manifest")
def test_removal_reclaims_the_whole_directory(
    downloading_settings: Settings,
    wheels: dict[str, bytes],
) -> None:
    installer = make_installer(downloading_settings, serve(wheels))
    installer.start("cuda")
    assert installer.wait(WAIT_S)
    assert installer.used_bytes() > 0

    installer.remove()

    assert installer.record() is None
    assert not installer.root.exists()
    assert installer.used_bytes() == 0


@pytest.mark.usefixtures("manifest")
def test_removing_nothing_says_so(
    downloading_settings: Settings,
    wheels: dict[str, bytes],
) -> None:
    installer = make_installer(downloading_settings, serve(wheels))

    with pytest.raises(NotInstalledError) as failure:
        installer.remove()
    assert failure.value.code == "runtime.not_installed"


@pytest.mark.usefixtures("manifest")
def test_refuses_to_install_with_downloads_turned_off(
    settings: Settings,
    wheels: dict[str, bytes],
) -> None:
    # The shared fixture turns downloads off, which is exactly the state this
    # covers: a policy that stops model weights has to stop gigabytes of
    # runtime as well.
    installer = make_installer(settings, serve(wheels))

    with pytest.raises(DownloadsDisabledError) as failure:
        installer.start("cuda")
    assert failure.value.code == "runtime.downloads_disabled"


@pytest.mark.usefixtures("manifest")
def test_refuses_to_install_without_room(
    downloading_settings: Settings,
    wheels: dict[str, bytes],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "bitwright_engine.runtime.installer.volume_space",
        lambda _: (1_000, 1),
    )
    installer = make_installer(downloading_settings, serve(wheels))

    with pytest.raises(InsufficientSpaceError) as failure:
        installer.start("cuda")
    assert failure.value.code == "runtime.insufficient_space"


@pytest.mark.usefixtures("manifest")
def test_refuses_a_variant_this_target_does_not_offer(
    downloading_settings: Settings,
    wheels: dict[str, bytes],
) -> None:
    installer = make_installer(downloading_settings, serve(wheels))

    with pytest.raises(UnknownVariantError) as failure:
        installer.plan("mps")
    assert failure.value.code == "runtime.unknown_variant"


def test_refuses_a_target_with_no_pinned_wheels(
    downloading_settings: Settings,
    wheels: dict[str, bytes],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("bitwright_engine.runtime.installer.variants_for", tuple)
    installer = make_installer(downloading_settings, serve(wheels))

    with pytest.raises(UnsupportedTargetError) as failure:
        installer.plan("cuda")
    assert failure.value.code == "runtime.unsupported_platform"


def test_refuses_archive_members_that_escape_their_directory() -> None:
    for name in ["../evil.py", "/etc/passwd", "C:/windows/system32", "a/../../b", ""]:
        assert _safe_member(name) is False
    for name in ["torch/__init__.py", "torch-2.0.dist-info/RECORD"]:
        assert _safe_member(name) is True


def test_an_unsafe_wheel_is_refused_rather_than_unpacked(
    downloading_settings: Settings,
    wheels: dict[str, bytes],
    variant: Variant,
    manifest: Callable[[Variant], None],
) -> None:
    escaping = build_wheel("helper", {"../escaped.py": b"pwned\n"})
    wheels["https://wheels.invalid/helper-1.0.whl"] = escaping

    # The digest is pinned against the bytes actually served, so the archive
    # check is the one that fires rather than the checksum check standing in
    # for it.
    manifest(
        Variant(
            accelerator=variant.accelerator,
            torch_version=variant.torch_version,
            cuda_version=variant.cuda_version,
            bundles_nvidia=variant.bundles_nvidia,
            wheels=(variant.wheels[0], wheel_entry("helper", escaping)),
        )
    )

    installer = make_installer(downloading_settings, serve(wheels))
    installer.start("cuda")
    assert installer.wait(WAIT_S)

    assert installer.state().error == "runtime.unsafe_archive"
    assert not (installer.root / "escaped.py").exists()
    assert not (downloading_settings.data_root / "escaped.py").exists()


@pytest.mark.usefixtures("manifest")
def test_activation_puts_the_installed_runtime_on_the_import_path(
    downloading_settings: Settings,
    wheels: dict[str, bytes],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    installer = make_installer(downloading_settings, serve(wheels))
    installer.start("cuda")
    assert installer.wait(WAIT_S)

    monkeypatch.setattr(sys, "path", list(sys.path))
    added = activation.activate(downloading_settings)

    assert added == installer.site_dir
    assert str(installer.site_dir) in sys.path
    # Appended, never prepended: a downloaded tree must not shadow a package
    # the sidecar already runs on.
    assert sys.path[-1] == str(installer.site_dir)


@pytest.mark.usefixtures("manifest")
def test_activation_refuses_a_runtime_built_for_another_interpreter(
    downloading_settings: Settings,
    wheels: dict[str, bytes],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    installer = make_installer(downloading_settings, serve(wheels))
    installer.start("cuda")
    assert installer.wait(WAIT_S)

    record = json.loads(installer.record_path.read_text(encoding="utf-8"))
    record["target"] = "some_other_platform-cp999"
    installer.record_path.write_text(json.dumps(record), encoding="utf-8")

    monkeypatch.setattr(sys, "path", list(sys.path))
    assert activation.activate(downloading_settings) is None
    assert str(installer.site_dir) not in sys.path


def test_activation_does_nothing_without_an_install(
    downloading_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sys, "path", list(sys.path))
    assert activation.activate(downloading_settings) is None


def test_an_unreadable_record_reads_as_nothing_installed(
    downloading_settings: Settings,
    wheels: dict[str, bytes],
) -> None:
    installer = make_installer(downloading_settings, serve(wheels))
    installer.root.mkdir(parents=True)
    (installer.root / RECORD_NAME).write_text("{not json", encoding="utf-8")

    assert installer.record() is None


def test_probe_reports_torch_missing_when_it_is_not_importable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The engine's own environment has no torch, which is the state every user
    # starts in and the one the settings screen has to describe correctly.
    monkeypatch.setitem(sys.modules, "torch", None)

    result = activation.probe()

    assert result.importable is False
    assert result.detail == "backend.cuda.torch_missing"
    assert result.cuda_available is False


def test_probe_reports_a_torch_that_is_present(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeCuda:
        @staticmethod
        def is_available() -> bool:
            return True

        @staticmethod
        def get_device_name(index: int) -> str:
            assert index == 0
            return "NVIDIA GeForce RTX 3060"

    class FakeTorch:
        __version__ = "9.9.9+cu126"
        cuda = FakeCuda()
        backends = None

    monkeypatch.setitem(sys.modules, "torch", FakeTorch())

    result = activation.probe()

    assert result.importable is True
    assert result.version == "9.9.9+cu126"
    assert result.cuda_available is True
    assert result.device == "NVIDIA GeForce RTX 3060"


@pytest.mark.parametrize("target", sorted(MANIFEST))
def test_every_pinned_wheel_is_built_for_the_target_it_is_listed_under(target: str) -> None:
    markers = PLATFORM_MARKERS[target]

    for entry in MANIFEST[target]:
        for wheel in entry.wheels:
            name = wheel.url.rsplit("/", 1)[-1]
            portable = name.endswith(PORTABLE_SUFFIX)
            assert portable or any(marker in name for marker in markers), (
                f"{target}/{entry.accelerator} pins {name}, which is not built for it"
            )


@pytest.mark.parametrize("target", sorted(MANIFEST))
def test_every_variant_pins_torch_first_and_names_each_package_once(target: str) -> None:
    for entry in MANIFEST[target]:
        names = [wheel.name for wheel in entry.wheels]

        assert names[0] == "torch"
        # The interface counts these as packages, and the installer unpacks them
        # one after another into a single directory. A name listed twice would
        # report a total nobody can reconcile and let the loser overwrite the
        # winner.
        assert len(names) == len(set(names))


@pytest.mark.parametrize("target", sorted(MANIFEST))
def test_every_pinned_wheel_carries_a_digest_and_a_real_size(target: str) -> None:
    for entry in MANIFEST[target]:
        for wheel in entry.wheels:
            assert wheel.url.startswith("https://")
            assert len(wheel.sha256) == 64
            assert wheel.size_bytes > 0
            # An unpacked size below the download would let the space check pass
            # on a volume that cannot hold the result.
            assert wheel.unpacked_bytes >= wheel.size_bytes
        assert entry.required_bytes > entry.installed_bytes


def test_linux_offers_both_a_cuda_and_a_cpu_runtime() -> None:
    accelerators = [entry.accelerator for entry in MANIFEST[LINUX]]

    assert accelerators == ["cuda", "cpu"]
    assert recommended("cuda", LINUX) is find_variant("cuda", LINUX)
    assert recommended("none", LINUX) is find_variant("cpu", LINUX)
    # Linux has no Metal, so the shell reporting one would still have to land
    # somewhere real rather than on None.
    assert recommended("metal", LINUX) is find_variant("cpu", LINUX)


def test_the_linux_cuda_runtime_carries_the_nvidia_wheels_windows_keeps_inside_torch() -> None:
    linux = find_variant("cuda", LINUX)
    windows = find_variant("cuda", WINDOWS)
    assert linux is not None
    assert windows is not None

    nvidia = [wheel for wheel in linux.wheels if wheel.name.startswith("nvidia-")]

    # This is the whole reason a Linux set cannot be resolved from Windows: the
    # CUDA libraries are behind platform_system == "Linux" markers there and
    # inside the torch wheel here.
    assert [wheel.name for wheel in windows.wheels if wheel.name.startswith("nvidia-")] == []
    assert {"nvidia-cublas-cu12", "nvidia-cudnn-cu12", "nvidia-nccl-cu12"} <= {
        wheel.name for wheel in nvidia
    }
    assert all(wheel.license_id == "LicenseRef-NVIDIA-Proprietary" for wheel in nvidia)
    # Which is also why the confirmation has to name NVIDIA's terms on Linux,
    # even though nothing of NVIDIA's is inside the torch wheel there.
    assert linux.bundles_nvidia is True


def test_the_linux_cpu_runtime_takes_none_of_the_nvidia_tree() -> None:
    cpu = find_variant("cpu", LINUX)
    assert cpu is not None

    assert cpu.bundles_nvidia is False
    assert cpu.cuda_version == ""
    assert [wheel.name for wheel in cpu.wheels if wheel.name.startswith("nvidia-")] == []
    assert "triton" not in {wheel.name for wheel in cpu.wheels}


def test_linux_ships_the_same_package_set_as_windows_apart_from_the_gpu_tree() -> None:
    linux = find_variant("cpu", LINUX)
    windows = find_variant("cpu", WINDOWS)
    macos = find_variant("mps", MACOS)
    assert linux is not None
    assert windows is not None
    assert macos is not None

    # A target that quietly dropped a package would ship a runtime that imports
    # and then cannot load a model, which is the failure this set was added to
    # stop. Every target carries the same names; only the files differ.
    assert {wheel.name for wheel in linux.wheels} == {wheel.name for wheel in windows.wheels}
    assert {wheel.name for wheel in macos.wheels} == {wheel.name for wheel in windows.wheels}


def test_an_uncovered_target_offers_nothing_rather_than_something_close() -> None:
    # 32-bit Linux, Linux on ARM, and a free-threaded build are all real and all
    # unpinned. None of them may be handed the x86-64 set.
    for target in ["linux_i686-cp314", "linux_aarch64-cp314", "linux_x86_64-cp314t"]:
        assert MANIFEST.get(target) is None
        assert find_variant("cuda", target) is None
        assert recommended("cuda", target) is None


class FakeScalar:
    def __init__(self, value: float) -> None:
        self.value = value

    def item(self) -> float:
        return self.value


class FakeTensor:
    def __init__(self, values: list[float]) -> None:
        self.values = values

    def __add__(self, other: FakeTensor) -> FakeTensor:
        """Add two tensors element by element."""
        return FakeTensor([a + b for a, b in zip(self.values, other.values, strict=True)])

    def sum(self) -> FakeScalar:
        return FakeScalar(sum(self.values))


class FakeMps:
    def __init__(self, *, available: bool) -> None:
        self._available = available

    def is_available(self) -> bool:
        return self._available


class FakeBackends:
    def __init__(self, *, mps: bool) -> None:
        self.mps = FakeMps(available=mps)


class FakeCudaModule:
    def __init__(self, *, available: bool) -> None:
        self._available = available

    def is_available(self) -> bool:
        return self._available

    def get_device_name(self, index: int) -> str:
        assert index == 0
        return "NVIDIA GeForce RTX 3060"


class FakeTorchModule:
    """Enough of torch for the probe and the compute check to run against."""

    __version__ = "9.9.9+cpu"

    def __init__(
        self,
        *,
        cuda: bool = False,
        mps: bool = False,
        location: str | None = None,
        answer: float = 1.0,
        error: Exception | None = None,
    ) -> None:
        self.cuda = FakeCudaModule(available=cuda)
        self.backends = FakeBackends(mps=mps)
        self.devices: list[str] = []
        self._answer = answer
        self._error = error
        if location is not None:
            self.__file__ = location

    def ones(self, count: int, device: str = "cpu") -> FakeTensor:
        if self._error is not None:
            raise self._error
        self.devices.append(device)
        return FakeTensor([self._answer] * count)


def test_probe_reports_where_the_torch_it_imported_came_from(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    installed = tmp_path / "runtime" / "site" / "torch" / "__init__.py"
    installed.parent.mkdir(parents=True)
    installed.touch()
    monkeypatch.setitem(sys.modules, "torch", FakeTorchModule(location=str(installed)))

    result = activation.probe()

    # Which directory it loaded from is the only thing that distinguishes a
    # runtime the user installed from a torch that was lying around.
    assert result.location == str(installed.parent)


def test_compute_check_says_torch_is_missing_rather_than_broken(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setitem(sys.modules, "torch", None)

    result = activation.compute_check()

    assert result.ok is False
    assert result.detail == "backend.cuda.torch_missing"


def test_compute_check_runs_its_operation_on_the_accelerator_when_there_is_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    torch = FakeTorchModule(cuda=True)
    monkeypatch.setitem(sys.modules, "torch", torch)

    result = activation.compute_check()

    assert result.ok is True
    assert result.device == "cuda"
    assert torch.devices == ["cuda", "cuda"]
    assert result.detail == ""


def test_compute_check_falls_back_to_the_processor_with_no_accelerator(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setitem(sys.modules, "torch", FakeTorchModule())

    result = activation.compute_check()

    assert result.ok is True
    assert result.device == "cpu"


def test_compute_check_reports_a_device_that_says_yes_and_then_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A CUDA build against a driver it does not match reports a device and then
    # dies on the first allocation. Reporting that as available would be a lie
    # the user only finds out about mid-generation.
    monkeypatch.setitem(
        sys.modules,
        "torch",
        FakeTorchModule(cuda=True, error=RuntimeError("CUDA error: no kernel image")),
    )

    result = activation.compute_check()

    assert result.ok is False
    assert result.device == "cuda"
    assert result.detail == "runtime.compute_failed"
    # The code is what a caller branches on; the message is what a person reads.
    assert "no kernel image" in result.message


def test_compute_check_refuses_a_runtime_that_computes_the_wrong_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setitem(sys.modules, "torch", FakeTorchModule(answer=0.5))

    result = activation.compute_check()

    assert result.ok is False
    assert result.detail == "runtime.compute_wrong_answer"


def test_the_runtime_report_prints_one_json_line_and_binds_no_socket(
    settings: Settings,
    capsys: pytest.CaptureFixture[str],
) -> None:
    server.report_runtime(settings)

    lines = [line for line in capsys.readouterr().out.splitlines() if line.strip()]
    report = json.loads(lines[-1])

    assert report["target"] != ""
    assert report["installed"] is False
    assert report["activatedPath"] == ""
    # Nothing is installed under the test root, so the honest answer is that
    # torch could not be reached, not that it is broken.
    assert report["torchImportable"] is False
    assert report["torchLocation"] == ""
    assert report["computeOk"] is False


def test_the_runtime_report_says_where_torch_came_from_when_it_loads(
    downloading_settings: Settings,
    wheels: dict[str, bytes],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    manifest: Callable[[Variant], None],
) -> None:
    del manifest
    installer = make_installer(downloading_settings, serve(wheels))
    installer.start("cuda")
    assert installer.wait(WAIT_S)

    site = installer.site_dir
    monkeypatch.setattr(sys, "path", list(sys.path))
    monkeypatch.setitem(
        sys.modules, "torch", FakeTorchModule(location=str(site / "torch" / "__init__.py"))
    )

    server.report_runtime(downloading_settings)

    report = json.loads([line for line in capsys.readouterr().out.splitlines() if line.strip()][-1])

    assert report["installed"] is True
    assert report["activatedPath"] == str(site)
    # This pairing is what the build check reads: a torch whose location is not
    # under the path activation added did not come from the installed runtime.
    assert report["torchLocation"] == str(site / "torch")
    assert report["computeOk"] is True
    assert report["computeDevice"] == "cpu"


def test_the_runtime_route_reports_the_target_and_the_directory(client: TestClient) -> None:
    payload = client.get("/v1/runtime").json()

    assert payload["installed"] is False
    assert payload["target"] != ""
    assert payload["installDir"].endswith(RUNTIME_DIRNAME)
    assert payload["torchImportable"] is False
    assert payload["restartRequired"] is False


def test_the_runtime_route_refuses_an_install_it_cannot_serve(client: TestClient) -> None:
    # Downloads are off in the shared fixture, so this never reaches a socket
    # whatever the machine running the suite happens to support.
    response = client.post("/v1/runtime/install", json={"accelerator": "cuda", "gpu": "cuda"})

    assert response.status_code in (400, 409)
    assert response.json()["detail"].startswith("runtime.")


def test_the_runtime_route_accepts_a_cancel_with_nothing_running(client: TestClient) -> None:
    response = client.post("/v1/runtime/cancel")

    assert response.status_code == 202
    assert response.json()["installing"] is False
