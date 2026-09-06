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

r"""The exact wheels that make up a GPU runtime, pinned per target.

The sidecar ships frozen by PyInstaller. A frozen bundle has no ``pip`` and no
interpreter to hand one, so an installer that shells out to ``python -m pip``
works in development and does nothing at all in a release. What a frozen bundle
*can* do is fetch a file and unpack a zip, and a wheel is a zip.

That leaves dependency resolution, which is the part nobody should write by
hand. It is not written here either: it is done once, ahead of time, by pip
itself, and the answer is pinned into this file the same way
:mod:`bitwright_engine.models.registry` pins a model revision. Two machines
installing the same variant therefore get the same bytes, and every one of them
is checked against a hash recorded here rather than trusted because it arrived
over TLS.

Regenerating an entry, from a machine of the target platform::

    python -m pip install --dry-run --ignore-installed --only-binary :all: \\
        --python-version 3.14 --abi cp314 --platform win_amd64 \\
        --target /tmp/unused --report report.json \\
        --index-url https://download.pytorch.org/whl/cu126 \\
        --extra-index-url https://pypi.org/simple "torch==2.14.0+cu126"

``--platform`` does not change how environment markers are evaluated, so a set
must be resolved on the operating system it is for. That is why there is no
Linux entry: PyTorch's Linux CUDA build pulls a separate tree of NVIDIA wheels
behind ``platform_system == "Linux"`` markers, and a set resolved for it from
Windows silently comes back without them. Guessing those pins would be worse
than declining, so Linux reports ``runtime.unsupported_platform`` until the set
is generated on Linux.

CUDA 12.6 is the version targeted on Windows. CUDA's minor version
compatibility means a 12.6 build runs on any 525 or newer driver, which is the
widest reach of the 12.x line, and it covers every architecture from Turing
through Blackwell, the RTX 3060 that prompted this work included.
"""

from __future__ import annotations

import sys
import sysconfig
from dataclasses import dataclass

TORCH_LICENSE_URL = "https://github.com/pytorch/pytorch/blob/main/LICENSE"
"""Where PyTorch's own licence is published."""

CUDA_LICENSE_URL = "https://docs.nvidia.com/cuda/eula/index.html"
"""Where the NVIDIA CUDA end user licence agreement is published.

A CUDA build of PyTorch carries NVIDIA's redistributable runtime libraries
inside its wheel. They are not under PyTorch's licence, and they are not under
this program's. The user is shown this before the download starts, exactly as
MODELS.md requires for weights.
"""


@dataclass(frozen=True, slots=True)
class Wheel:
    """One wheel to fetch and unpack.

    Attributes:
        name: Distribution name, as the index publishes it.
        version: Exact pinned version.
        url: Absolute URL of the wheel. Canonical host, not a redirect target,
            because a content delivery network hostname is not stable enough to
            pin.
        sha256: Hex digest of the file, checked before anything is unpacked.
        size_bytes: Size of the wheel, as the index reported it. Used for the
            download total and for the progress fraction.
        unpacked_bytes: Size of the wheel's contents once extracted, read from
            its zip directory. Used for the space check.
        license_id: SPDX expression the distribution declares.
    """

    name: str
    version: str
    url: str
    sha256: str
    size_bytes: int
    unpacked_bytes: int
    license_id: str


@dataclass(frozen=True, slots=True)
class Variant:
    """One installable runtime: a torch build and everything it needs.

    Attributes:
        accelerator: What this build can use, one of ``cuda``, ``mps`` or
            ``cpu``. Named after the hardware rather than after the index it
            came from, because ``cpu`` is what a user reads as "slow" and the
            macOS wheel is not slow.
        torch_version: Version of torch, without its local build tag.
        cuda_version: CUDA version the build targets, or an empty string.
        bundles_nvidia: True when the wheels carry NVIDIA's redistributable
            CUDA libraries, which have their own licence terms.
        wheels: Every wheel, torch first.
    """

    accelerator: str
    torch_version: str
    cuda_version: str
    bundles_nvidia: bool
    wheels: tuple[Wheel, ...]

    @property
    def download_bytes(self) -> int:
        """Total bytes fetched over the network.

        Returns:
            The sum of every wheel's size.
        """
        return sum(wheel.size_bytes for wheel in self.wheels)

    @property
    def installed_bytes(self) -> int:
        """Total bytes the installed runtime occupies.

        Returns:
            The sum of every wheel's unpacked size.
        """
        return sum(wheel.unpacked_bytes for wheel in self.wheels)

    @property
    def required_bytes(self) -> int:
        """Free space an install needs at its peak.

        Each wheel is deleted as soon as it is unpacked, so the peak is the
        whole unpacked tree plus the single largest wheel still on disk. This
        is the number the interface warns against, because reporting only the
        download size would let an install start on a volume that cannot hold
        the result.

        Returns:
            Bytes of free space required.
        """
        largest = max((wheel.size_bytes for wheel in self.wheels), default=0)
        return self.installed_bytes + largest


def python_tag() -> str:
    """Return the interpreter tag the wheels have to match.

    A wheel carrying a compiled extension is built against one CPython ABI. The
    frozen sidecar embeds whichever interpreter it was built with, so the tag is
    read from the running process rather than configured.

    Returns:
        A tag such as ``cp314``, or ``cp314t`` for a free-threaded build, whose
        ABI is a different one again.
    """
    tag = f"cp{sys.version_info.major}{sys.version_info.minor}"
    if sysconfig.get_config_var("Py_GIL_DISABLED"):
        return f"{tag}t"
    return tag


def platform_tag() -> str:
    """Return the platform the wheels have to match.

    Returns:
        One of ``win_amd64``, ``macosx_arm64``, ``macosx_x86_64``, or the
        normalised output of :func:`sysconfig.get_platform` for anything else,
        which will simply not be in the manifest.
    """
    raw = sysconfig.get_platform()
    if raw.startswith("win-amd64") or (raw == "win32" and sys.maxsize > 2**32):
        return "win_amd64"
    if raw.startswith("macosx"):
        # macosx-14.0-arm64: the deployment target in the middle is not part of
        # what decides which wheel runs here, only the architecture is.
        return f"macosx_{raw.rsplit('-', 1)[-1]}"
    return raw.replace("-", "_").replace(".", "_")


def target_key() -> str:
    """Return the manifest key for this machine.

    Returns:
        A key such as ``win_amd64-cp314``.
    """
    return f"{platform_tag()}-{python_tag()}"


def _pypi(path: str) -> str:
    """Expand a PyPI file path into an absolute URL.

    Args:
        path: The path under ``files.pythonhosted.org/packages``.

    Returns:
        The absolute URL.
    """
    return f"https://files.pythonhosted.org/packages/{path}"


# The wheels every variant shares. torch's own dependency set is small and
# identical across the targets below, so it is written once.
_FSSPEC = Wheel(
    name="fsspec",
    version="2026.7.0",
    url=_pypi(
        "fd/3c/6a2bf344106328fd04963664a60b9bb6496fc25df8e962fcdc1367285fb9/fsspec-2026.7.0-py3-none-any.whl"
    ),
    sha256="b57ddbafedfaef7018c1ecab32aa200a9d7ca26b77965f64e48b70061249d279",
    size_bytes=206583,
    unpacked_bytes=752431,
    license_id="BSD-3-Clause",
)

_NETWORKX = Wheel(
    name="networkx",
    version="3.6.1",
    url=_pypi(
        "9e/c9/b2622292ea83fbb4ec318f5b9ab867d0a28ab43c5717bb85b0a5f6b3b0a4/networkx-3.6.1-py3-none-any.whl"
    ),
    sha256="d47fbf302e7d9cbbb9e2555a0d267983d2aa476bac30e90dfbe5669bd57f3762",
    size_bytes=2068504,
    unpacked_bytes=7038619,
    license_id="BSD-3-Clause",
)

_SETUPTOOLS = Wheel(
    name="setuptools",
    version="84.0.0",
    url=_pypi(
        "95/9c/c510029fc6ef33a6275cd2c5d3cecd6613dfd6aa401d57c54f1c18852ccf/setuptools-84.0.0-py3-none-any.whl"
    ),
    sha256="51a52592b3b99e102b609654876bd65f19f999935166d1352678931132b0c670",
    size_bytes=818216,
    unpacked_bytes=2773629,
    license_id="MIT",
)

_SYMPY = Wheel(
    name="sympy",
    version="1.14.0",
    url=_pypi(
        "a2/09/77d55d46fd61b4a135c444fc97158ef34a095e5681d0a6c10b75bf356191/sympy-1.14.0-py3-none-any.whl"
    ),
    sha256="e091cc3e99d2141a0ba2847328f5479b05d94a6635cb96148ccb3f34671bd8f5",
    size_bytes=6299353,
    unpacked_bytes=26841861,
    license_id="BSD-3-Clause",
)

_MPMATH = Wheel(
    name="mpmath",
    version="1.3.0",
    url=_pypi(
        "43/e3/7d92a15f894aa0c9c4b49b8ee9ac9850d6e63b03c9c32c0367a13ae62209/mpmath-1.3.0-py3-none-any.whl"
    ),
    sha256="a0b2b9fe80bbcd81a6647ff13108738cfb482d481d826cc0e02f5b35e5c88d2c",
    size_bytes=536198,
    unpacked_bytes=1950197,
    license_id="BSD-3-Clause",
)

_TYPING_EXTENSIONS = Wheel(
    name="typing_extensions",
    version="4.16.0",
    url=_pypi(
        "49/d3/b8441a820a491ddfc024b0b0cf0393375b75ea13866d9c66727e54c2fc80/typing_extensions-4.16.0-py3-none-any.whl"
    ),
    sha256="481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8",
    size_bytes=45571,
    unpacked_bytes=182767,
    license_id="PSF-2.0",
)

_FILELOCK = Wheel(
    name="filelock",
    version="3.32.5",
    url=_pypi(
        "36/d2/b70a31e13d04456d28493f31d2aa087e99eeb2767ef0293b2625727ccb8c/filelock-3.32.5-py3-none-any.whl"
    ),
    sha256="142cd9fa77a872c5e78c62329a0d15278fadc686eb89e760017968961a4fd6b2",
    size_bytes=100003,
    unpacked_bytes=354810,
    license_id="MIT",
)

_JINJA2 = Wheel(
    name="jinja2",
    version="3.1.6",
    url=_pypi(
        "62/a1/3d680cbfd5f4b8f15abc1d571870c5fc3e594bb582bc3b64ea099db13e56/jinja2-3.1.6-py3-none-any.whl"
    ),
    sha256="85ece4451f492d0c13c5dd7c13a64681a86afae63a5f347908daf103ce6d2f67",
    size_bytes=134899,
    unpacked_bytes=496892,
    license_id="BSD-3-Clause",
)

_MARKUPSAFE_WIN = Wheel(
    name="markupsafe",
    version="3.0.3",
    url=_pypi(
        "28/52/182836104b33b444e400b14f797212f720cbc9ed6ba34c800639d154e821/markupsafe-3.0.3-cp314-cp314-win_amd64.whl"
    ),
    sha256="bdc919ead48f234740ad807933cdf545180bfbe9342c2bb451556db2ed958581",
    size_bytes=15341,
    unpacked_bytes=37023,
    license_id="BSD-3-Clause",
)

_MARKUPSAFE_MACOS_ARM64 = Wheel(
    name="markupsafe",
    version="3.0.3",
    url=_pypi(
        "b5/64/7660f8a4a8e53c924d0fa05dc3a55c9cee10bbd82b11c5afb27d44b096ce/markupsafe-3.0.3-cp314-cp314-macosx_11_0_arm64.whl"
    ),
    sha256="c47a551199eb8eb2121d4f0f15ae0f923d31350ab9280078d1e5f12b249e0026",
    size_bytes=12029,
    unpacked_bytes=73708,
    license_id="BSD-3-Clause",
)

_TORCH_LICENSE = "Apache-2.0 AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND MIT"
"""The expression torch declares, with its LLVM exception folded into Apache-2.0.

It is not the plain BSD-3-Clause the project's own notes assumed. None of the
parts is copyleft, so none of it reaches this program's licence, but the record
should say what the metadata says.
"""


def _common(markupsafe: Wheel) -> tuple[Wheel, ...]:
    """Return the dependency wheels every variant shares.

    Args:
        markupsafe: The compiled MarkupSafe wheel for this target.

    Returns:
        The dependencies, in the order pip resolved them.
    """
    return (
        _FSSPEC,
        _NETWORKX,
        _SETUPTOOLS,
        _SYMPY,
        _MPMATH,
        _TYPING_EXTENSIONS,
        _FILELOCK,
        _JINJA2,
        markupsafe,
    )


MANIFEST: dict[str, tuple[Variant, ...]] = {
    "win_amd64-cp314": (
        Variant(
            accelerator="cuda",
            torch_version="2.14.0",
            cuda_version="12.6",
            bundles_nvidia=True,
            wheels=(
                Wheel(
                    name="torch",
                    version="2.14.0+cu126",
                    url=(
                        "https://download.pytorch.org/whl/cu126/"
                        "torch-2.14.0%2Bcu126-cp314-cp314-win_amd64.whl"
                    ),
                    sha256="a46969ff0b46955ae4adc6edc07f98ef5ac5913d11263849c0bb4ada099d4c7f",
                    size_bytes=2623172057,
                    unpacked_bytes=4191940016,
                    license_id=_TORCH_LICENSE,
                ),
                *_common(_MARKUPSAFE_WIN),
            ),
        ),
        Variant(
            accelerator="cpu",
            torch_version="2.14.0",
            cuda_version="",
            bundles_nvidia=False,
            wheels=(
                Wheel(
                    name="torch",
                    version="2.14.0+cpu",
                    url=(
                        "https://download.pytorch.org/whl/cpu/"
                        "torch-2.14.0%2Bcpu-cp314-cp314-win_amd64.whl"
                    ),
                    sha256="ca9b3c2c652587f7b26c86d30be3648f553bd07fb3cf9b3edb645e7eafe295a3",
                    size_bytes=125949601,
                    unpacked_bytes=475950288,
                    license_id=_TORCH_LICENSE,
                ),
                *_common(_MARKUPSAFE_WIN),
            ),
        ),
    ),
    "macosx_arm64-cp314": (
        Variant(
            accelerator="mps",
            torch_version="2.14.0",
            cuda_version="",
            bundles_nvidia=False,
            wheels=(
                Wheel(
                    name="torch",
                    version="2.14.0",
                    url=_pypi(
                        "ee/90/1241e7db5ccc2455f8735bd6b1becfad39916206ad18001c4c0014d139e2/"
                        "torch-2.14.0-cp314-cp314-macosx_14_0_arm64.whl"
                    ),
                    sha256="860423e970f2ce02c4476e8e2d1350131b1c5c5a5e4912180e78b50b53241efa",
                    size_bytes=127321431,
                    unpacked_bytes=524099129,
                    license_id=_TORCH_LICENSE,
                ),
                *_common(_MARKUPSAFE_MACOS_ARM64),
            ),
        ),
    ),
}
"""Every runtime this version knows how to install, keyed by target.

A target that is absent is not a bug to be worked around at run time. It means
nobody has generated and checked a pinned set for it, and installing unpinned
wheels of unknown provenance is not something a settings screen may do.
"""


def variants_for(target: str | None = None) -> tuple[Variant, ...]:
    """Return the variants installable on a target.

    Args:
        target: Manifest key. Defaults to this machine's.

    Returns:
        The variants, or an empty tuple when the target is not covered.
    """
    return MANIFEST.get(target if target is not None else target_key(), ())


def find_variant(accelerator: str, target: str | None = None) -> Variant | None:
    """Return one variant by the hardware it drives.

    Args:
        accelerator: One of ``cuda``, ``mps`` or ``cpu``.
        target: Manifest key. Defaults to this machine's.

    Returns:
        The matching variant, or None when the target does not offer one.
    """
    return next(
        (item for item in variants_for(target) if item.accelerator == accelerator),
        None,
    )


def recommended(gpu_kind: str, target: str | None = None) -> Variant | None:
    """Return the variant that suits the GPU the shell probed for.

    The shell's probe is the authority on what hardware is present: it runs
    ``nvidia-smi`` and knows about Metal, and it does so without loading any
    machine learning framework. This translates that answer into a build,
    falling back to the plain CPU build rather than refusing, because a CPU
    build generates sprites slowly and a missing runtime generates none.

    Args:
        gpu_kind: ``cuda``, ``metal``, or ``none``, as the shell reports it.
        target: Manifest key. Defaults to this machine's.

    Returns:
        The recommended variant, or None when the target is not covered.
    """
    wanted = {"cuda": "cuda", "metal": "mps"}.get(gpu_kind, "cpu")
    return find_variant(wanted, target) or find_variant("cpu", target)
