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

``--platform`` selects wheel tags and nothing else: pip evaluates environment
markers against the interpreter it is running on, so a set for another
operating system has to come either from that operating system or from a
resolver that can be told which platform to resolve for. The Linux entries were
produced with the second, ``uv pip compile --python-platform
x86_64-unknown-linux-gnu --python-version 3.14``, and the difference is not
cosmetic: PyTorch's Linux CUDA build pulls a separate tree of NVIDIA wheels
behind ``platform_system == "Linux"`` markers, which a resolution run from
Windows silently comes back without.

Only 64-bit x86 glibc Linux is pinned. Any other Linux reports
``runtime.unsupported_platform``, which is the honest answer rather than a
guess: nobody has generated and checked a set for it.

CUDA 12.6 is the version targeted on Windows and Linux alike. CUDA's minor
version compatibility means a 12.6 build runs on any 525 or newer driver, which
is the widest reach of the 12.x line, and it covers every architecture from
Turing through Blackwell, the RTX 3060 that prompted this work included.
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

    Linux needs no branch of its own: :func:`sysconfig.get_platform` already
    answers ``linux-x86_64`` there, which normalises to the key the manifest
    uses. It does not distinguish glibc from musl, and it does not have to: the
    sidecar is frozen against glibc, so a musl system cannot run the process
    that would ask this question.

    Returns:
        One of ``win_amd64``, ``macosx_arm64``, ``macosx_x86_64``,
        ``linux_x86_64``, or the normalised output of
        :func:`sysconfig.get_platform` for anything else, which will simply not
        be in the manifest.
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
#
# Where a distribution ships a compiled extension it is pinned once per target
# instead, because such a wheel loads only on the operating system and
# interpreter ABI it was built for. Handing a Linux install a ``win_amd64``
# wheel is not a slow path, it is a ``.pyd`` that nothing on that machine can
# open, and the failure lands at the first import rather than at the download.
_NUMPY_WINDOWS = Wheel(
    name="numpy",
    version="2.5.3",
    url=_pypi(
        "a4/73/d2c08231e4fde7e415501fd02c715d96e98599b2d8384445933944152984/numpy-2.5.3-cp314-cp314-win_amd64.whl"
    ),
    sha256="2c25dfa72943e4336ddb6b0ee4277b47a0c85bede0807530ec68103bf58e2c10",
    size_bytes=12698179,
    unpacked_bytes=40000000,
    license_id="BSD-3-Clause",
)

_NUMPY_MACOS = Wheel(
    name="numpy",
    version="2.5.3",
    url=_pypi(
        "94/75/4640d2d6e4b64a049e48425a82728a41ef4adb61332d2cba68055774878b/numpy-2.5.3-cp314-cp314-macosx_14_0_arm64.whl"
    ),
    sha256="adc1ada2662f8a5f960b8a10d9986897e7499ef07e06d4cfe7197f8cce923c07",
    size_bytes=5449793,
    unpacked_bytes=20000000,
    license_id="BSD-3-Clause",
)

_NUMPY_LINUX = Wheel(
    name="numpy",
    version="2.5.3",
    url=_pypi(
        "45/8f/9beacf79ca7c650688ad0baa80931adb988fe6e6e5d5903c23cc3dbd70eb/numpy-2.5.3-cp314-cp314-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl"
    ),
    sha256="b0521d0f4aebb6e06189451025fa17a913287b13c03d5fe05c017333b654ea5b",
    size_bytes=16711928,
    unpacked_bytes=56364671,
    license_id="BSD-3-Clause",
)

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

_MARKUPSAFE_WINDOWS = Wheel(
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

_MARKUPSAFE_MACOS = Wheel(
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

_MARKUPSAFE_LINUX = Wheel(
    name="markupsafe",
    version="3.0.3",
    url=_pypi(
        "41/3c/a36c2450754618e62008bf7435ccb0f88053e07592e6028a34776213d877/markupsafe-3.0.3-cp314-cp314-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl"
    ),
    sha256="457a69a9577064c05a97c41f4e65148652db078a3a509039e64d3467b9e7ef97",
    size_bytes=23005,
    unpacked_bytes=67284,
    license_id="BSD-3-Clause",
)

_TORCH_LICENSE = "Apache-2.0 AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND MIT"
"""The expression torch declares, with its LLVM exception folded into Apache-2.0.

It is not the plain BSD-3-Clause the project's own notes assumed. None of the
parts is copyleft, so none of it reaches this program's licence, but the record
should say what the metadata says.
"""

_NVIDIA_LICENSE = "LicenseRef-NVIDIA-Proprietary"
"""NVIDIA's own end user licence agreement, which is not an open source one.

The CUDA redistributables spell this differently in every wheel that carries
them - ``NVIDIA Proprietary Software``, ``LicenseRef-NVIDIA-Proprietary``,
``LicenseRef-NVIDIA-SOFTWARE-LICENSE``, and in two cases nothing at all - and
not one of those is an SPDX identifier. They are recorded under a single
``LicenseRef`` rather than reproduced, because the terms the user is agreeing to
are the ones at :data:`CUDA_LICENSE_URL` and the confirmation links there.

On Windows these libraries ride inside the torch wheel. On Linux they arrive as
the separate ``nvidia-*`` wheels below, which changes where they come from and
not what they are.
"""


# Everything diffusers needs on top of torch.
#
# Without these the local backends can load a GPU but not a model, which is the
# state the application shipped in: generation ran, returned a placeholder in
# two milliseconds, and looked for all the world like a broken renderer.
#
# `unpacked_bytes` here is three times the download rather than a measured
# figure. It feeds the free-space check and the progress bar, and over
# estimating a thirty five megabyte set is cheaper than a range request per
# wheel at build time. The torch entries above are measured, because those are
# the gigabytes that decide whether an install fits at all.

_PYYAML_WINDOWS = Wheel(
    name="PyYAML",
    version="6.0.3",
    url=_pypi(
        "23/20/bb6982b26a40bb43951265ba29d4c246ef0ff59c9fdcdf0ed04e0687de4d/pyyaml-6.0.3-cp314-cp314-win_amd64.whl"
    ),
    sha256="4a2e8cebe2ff6ab7d1050ecd59c25d4c8bd7e6f400f5f82b96557ac0abafd0ac",
    size_bytes=156429,
    unpacked_bytes=469287,
    license_id="UNKNOWN",
)

_PYYAML_MACOS = Wheel(
    name="PyYAML",
    version="6.0.3",
    url=_pypi(
        "bd/9c/4d95bb87eb2063d20db7b60faa3840c1b18025517ae857371c4dd55a6b3a/pyyaml-6.0.3-cp314-cp314-macosx_11_0_arm64.whl"
    ),
    sha256="34d5fcd24b8445fadc33f9cf348c1047101756fd760b4dacb5c3e99755703310",
    size_bytes=173809,
    unpacked_bytes=521427,
    license_id="UNKNOWN",
)

_PYYAML_LINUX = Wheel(
    name="PyYAML",
    version="6.0.3",
    url=_pypi(
        "88/f9/16491d7ed2a919954993e48aa941b200f38040928474c9e85ea9e64222c3/pyyaml-6.0.3-cp314-cp314-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl"
    ),
    sha256="c458b6d084f9b935061bc36216e8a69a7e293a2f1e68bf956dcd9e6cbcd143f5",
    size_bytes=794175,
    unpacked_bytes=2382525,
    license_id="UNKNOWN",
)

_PYGMENTS = Wheel(
    name="Pygments",
    version="2.21.0",
    url=_pypi(
        "71/46/17f022dd3e953bf20a04a028a21ec746d942f8d2af30fa0f124fa0e6a684/pygments-2.21.0-py3-none-any.whl"
    ),
    sha256="2363c69b61c4a97c838da3b130dcd6468f4848992b21a82f2a63ec34377137d9",
    size_bytes=1250147,
    unpacked_bytes=3750441,
    license_id="BSD-2-Clause",
)

_ACCELERATE = Wheel(
    name="accelerate",
    version="1.14.0",
    url=_pypi(
        "a8/db/253133d7e7cb40d3af384bb2f5c0b4a2b7fdcffbc95c688cc67a20a3c103/accelerate-1.14.0-py3-none-any.whl"
    ),
    sha256="e94390c2863b873be18f623f9df48a0d8fe5eff13ea7f1a00092b0a7904888c6",
    size_bytes=389246,
    unpacked_bytes=1167738,
    license_id="UNKNOWN",
)

_ANNOTATED_DOC = Wheel(
    name="annotated-doc",
    version="0.0.5",
    url=_pypi(
        "3e/30/e900b21425a860e195f32e37657aa1f7c7f2b1bfb26f03ca209b90933c06/annotated_doc-0.0.5-py3-none-any.whl"
    ),
    sha256="117bac03a25ede5df5440e855b32d556049ca169ead221505badf432fed4b101",
    size_bytes=5302,
    unpacked_bytes=15906,
    license_id="MIT",
)

_ANYIO = Wheel(
    name="anyio",
    version="4.15.1",
    url=_pypi(
        "12/b8/4bd346e22b28902df4d651910f5242c28d84e4a5c2435ca5c3f797ed7e2e/anyio-4.15.1-py3-none-any.whl"
    ),
    sha256="6152fdbbf9a77fdec97731721bebf7c4c44f7c29b424b0065826173efc7ed101",
    size_bytes=132079,
    unpacked_bytes=396237,
    license_id="MIT",
)

_CERTIFI = Wheel(
    name="certifi",
    version="2026.7.22",
    url=_pypi(
        "0b/a7/71ac2cff56fec219ed242bb11b8efb69fcc4bec75db06fb7bfe35de520e6/certifi-2026.7.22-py3-none-any.whl"
    ),
    sha256="62f22742b58a1a33014a2b6b706588a8d7e2a88ae7bd1a6ebe8c992928483775",
    size_bytes=136983,
    unpacked_bytes=410949,
    license_id="UNKNOWN",
)

_CHARSET_NORMALIZER_WINDOWS = Wheel(
    name="charset-normalizer",
    version="3.5.1",
    url=_pypi(
        "7a/7c/4938c329b6a9d446f6a59aa2092ff7118f274209b5ed0e26893d1d30a63c/charset_normalizer-3.5.1-cp314-cp314-win_amd64.whl"
    ),
    sha256="c658c50ac0c98cd755a2dd50b7977d3bca7df401dcc47fbdfa87db53ef7d4e8b",
    size_bytes=204175,
    unpacked_bytes=612525,
    license_id="UNKNOWN",
)

_CHARSET_NORMALIZER_MACOS = Wheel(
    name="charset-normalizer",
    version="3.5.1",
    url=_pypi(
        "e9/40/095ce62fa078483cccc1fa2b36e6bc9580b85422a20ee9f925341c50e44f/charset_normalizer-3.5.1-cp314-cp314-macosx_10_15_universal2.whl"
    ),
    sha256="c428c6c31eb5f4277d7f8eccaf767fbd548ddd5ce3c8b4f4cbbfab3d96b5904c",
    size_bytes=341823,
    unpacked_bytes=1025469,
    license_id="UNKNOWN",
)

_CHARSET_NORMALIZER_LINUX = Wheel(
    name="charset-normalizer",
    version="3.5.1",
    url=_pypi(
        "e0/91/39c3af510b0aa32bbda03374259200f28430febfd1bf5e511fe765282ce5/charset_normalizer-3.5.1-cp314-cp314-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl"
    ),
    sha256="15f024313246a4ed976c60f440bb8d257815513a681d212ff74fd46f7d715a90",
    size_bytes=251240,
    unpacked_bytes=753720,
    license_id="UNKNOWN",
)

_CLICK = Wheel(
    name="click",
    version="8.5.0",
    url=_pypi(
        "58/50/6c0d534c5f134586a8e1ba4e330569e32f057e33372ae556463212fb4cd3/click-8.5.0-py3-none-any.whl"
    ),
    sha256="255bc9599cf7748b4b1a446ccc735421bd08a2ae529a8b88597d3de5664ee360",
    size_bytes=125251,
    unpacked_bytes=375753,
    license_id="BSD-3-Clause",
)

_COLORAMA = Wheel(
    name="colorama",
    version="0.4.6",
    url=_pypi(
        "d1/d6/3965ed04c63042e047cb6a3e6ed1a63a35087b6a609aa3a15ed8ac56c221/colorama-0.4.6-py2.py3-none-any.whl"
    ),
    sha256="4f1d9991f5acc0ca119f9d443620b77f9d6b33703e51011c16baf57afb285fc6",
    size_bytes=25335,
    unpacked_bytes=76005,
    license_id="UNKNOWN",
)

_DIFFUSERS = Wheel(
    name="diffusers",
    version="0.40.0",
    url=_pypi(
        "db/df/ffb593ebed2a068d2d6be44261283f39a6b809c0fcdfdcafbd448cbeec77/diffusers-0.40.0-py3-none-any.whl"
    ),
    sha256="5b5da7c3ddb62152fa4afc577f02e050af688c797375c34fb2d01006da3f3541",
    size_bytes=5911654,
    unpacked_bytes=17734962,
    license_id="UNKNOWN",
)

_H11 = Wheel(
    name="h11",
    version="0.16.0",
    url=_pypi(
        "04/4b/29cac41a4d98d144bf5f6d33995617b185d14b22401f75ca86f384e87ff1/h11-0.16.0-py3-none-any.whl"
    ),
    sha256="63cf8bbe7522de3bf65932fda1d9c2772064ffb3dae62d55932da54b31cb6c86",
    size_bytes=37515,
    unpacked_bytes=112545,
    license_id="UNKNOWN",
)

_HF_XET_WINDOWS = Wheel(
    name="hf-xet",
    version="1.6.0",
    url=_pypi(
        "98/b7/8c59a66d15205024662f1d66968136f13893f96df1ddc5087e2e281fc95f/hf_xet-1.6.0-cp38-abi3-win_amd64.whl"
    ),
    sha256="fb4fadde1b2b70bf4c0c14a6dccbe7194b1c28947fefd5bbe3fed9d940676c3b",
    size_bytes=4033128,
    unpacked_bytes=12099384,
    license_id="Apache-2.0",
)

_HF_XET_MACOS = Wheel(
    name="hf-xet",
    version="1.6.0",
    url=_pypi(
        "4b/69/55b8dcf636142ae660fec1869fcac14c4da2e8412e14d6eee1523be77e9f/hf_xet-1.6.0-cp38-abi3-macosx_11_0_arm64.whl"
    ),
    sha256="f0906082d9932ae0c0057fa194041c22b4e2cdb46b2592ef3b91f020d62a081a",
    size_bytes=3876287,
    unpacked_bytes=11628861,
    license_id="Apache-2.0",
)

_HF_XET_LINUX = Wheel(
    name="hf-xet",
    version="1.6.0",
    url=_pypi(
        "67/4e/a28359bf1c1ecf11eba22123168c138698f7cb576ac678f5a2e16cd5da08/hf_xet-1.6.0-cp38-abi3-manylinux2014_x86_64.manylinux_2_17_x86_64.whl"
    ),
    sha256="d62671bb130879cef0ee4c9ebe47a14af6c66ec53e6d84dc15936e5ffdfac82f",
    size_bytes=4464663,
    unpacked_bytes=13393989,
    license_id="Apache-2.0",
)

_HTTPCORE = Wheel(
    name="httpcore",
    version="1.0.9",
    url=_pypi(
        "7e/f5/f66802a942d491edb555dd61e3a9961140fd64c90bce1eafd741609d334d/httpcore-1.0.9-py3-none-any.whl"
    ),
    sha256="2d400746a40668fc9dec9810239072b40b4484b640a8c38fd654a024c7a1bf55",
    size_bytes=78784,
    unpacked_bytes=236352,
    license_id="BSD-3-Clause",
)

_HTTPX = Wheel(
    name="httpx",
    version="0.28.1",
    url=_pypi(
        "2a/39/e50c7c3a983047577ee07d2a9e53faf5a69493943ec3f6a384bdc792deb2/httpx-0.28.1-py3-none-any.whl"
    ),
    sha256="d909fcccc110f8c7faf814ca82a9a4d816bc5a6dbfea25d6591d6985b8ba59ad",
    size_bytes=73517,
    unpacked_bytes=220551,
    license_id="UNKNOWN",
)

_HUGGINGFACE_HUB = Wheel(
    name="huggingface_hub",
    version="1.30.0",
    url=_pypi(
        "c3/0e/3e45bbe0dd48f4e56b1d46649d342de853cd1c7e815323472ab62687f153/huggingface_hub-1.30.0-py3-none-any.whl"
    ),
    sha256="96ae0a8e99a234374a6fe43e989ebd21c04640b91ab2927e7e5773ba1131ca59",
    size_bytes=796795,
    unpacked_bytes=2390385,
    license_id="UNKNOWN",
)

_IDNA = Wheel(
    name="idna",
    version="3.19",
    url=_pypi(
        "57/b0/0e52c878c53f245edd3a11020f20979b3f490f245af532c7cae3027754b5/idna-3.19-py3-none-any.whl"
    ),
    sha256="815e7be7a7806d54abb586dc943addc79e8b2ee16915059658cbeff4b1b43bf4",
    size_bytes=68550,
    unpacked_bytes=205650,
    license_id="BSD-3-Clause",
)

_IMPORTLIB_METADATA = Wheel(
    name="importlib_metadata",
    version="9.0.1",
    url=_pypi(
        "b3/55/ecca97ae19075f1fac62def77731e7f535e6c1fb8f92ff08160c5e6dade8/importlib_metadata-9.0.1-py3-none-any.whl"
    ),
    sha256="bba5600596a7e21f3eef53281cf28d6a5195634d2f2b78ff9501a3272c6eaab0",
    size_bytes=27920,
    unpacked_bytes=83760,
    license_id="Apache-2.0",
)

_MARKDOWN_IT_PY = Wheel(
    name="markdown-it-py",
    version="4.2.0",
    url=_pypi(
        "b3/81/4da04ced5a082363ecfa159c010d200ecbd959ae410c10c0264a38cac0f5/markdown_it_py-4.2.0-py3-none-any.whl"
    ),
    sha256="9f7ebbcd14fe59494226453aed97c1070d83f8d24b6fc3a3bcf9a38092641c4a",
    size_bytes=91687,
    unpacked_bytes=275061,
    license_id="UNKNOWN",
)

_MDURL = Wheel(
    name="mdurl",
    version="0.1.2",
    url=_pypi(
        "b3/38/89ba8ad64ae25be8de66a6d463314cf1eb366222074cfda9ee839c56a4b4/mdurl-0.1.2-py3-none-any.whl"
    ),
    sha256="84008a41e51615a49fc9966191ff91509e3c40b939176e643fd50a5c2196b8f8",
    size_bytes=9979,
    unpacked_bytes=29937,
    license_id="UNKNOWN",
)

_PACKAGING = Wheel(
    name="packaging",
    version="26.3",
    url=_pypi(
        "63/34/ba1c580383c9eada3711951fef0795c80b829a078d72188184bcab9dd527/packaging-26.3-py3-none-any.whl"
    ),
    sha256="d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c",
    size_bytes=129956,
    unpacked_bytes=389868,
    license_id="Apache-2.0 OR BSD-2-Clause",
)

_PILLOW_WINDOWS = Wheel(
    name="pillow",
    version="12.3.0",
    url=_pypi(
        "f1/e0/492879f69d94f91f60fc8cd05ba03650e9520afebb2fb7aa12777d7c7f38/pillow-12.3.0-cp314-cp314-win_amd64.whl"
    ),
    sha256="fdafc9cce40277e0f7a0feabce0ee50dd2fa1800f3b38015e51296b5e814048d",
    size_bytes=7237707,
    unpacked_bytes=21713121,
    license_id="MIT-CMU",
)

_PILLOW_MACOS = Wheel(
    name="pillow",
    version="12.3.0",
    url=_pypi(
        "c7/da/32c752228ae345f489e3a42499d817b6c3996da7e8a3bc7a04fc806b243b/pillow-12.3.0-cp314-cp314-macosx_11_0_arm64.whl"
    ),
    sha256="e158cb00350dc278f3b91551101aa7d12415a66ebf2c91d8d5ac14e56ddd3ad0",
    size_bytes=4780131,
    unpacked_bytes=14340393,
    license_id="MIT-CMU",
)

_PILLOW_LINUX = Wheel(
    name="pillow",
    version="12.3.0",
    url=_pypi(
        "5c/44/c85361f65dbe00eea8576ee467c768d25129989efb76e94f205e9ca9bb46/pillow-12.3.0-cp314-cp314-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl"
    ),
    sha256="251bf95b67017e27b13d82f5b326234ca62d70f9cf4c2b9032de2358a3b12c7b",
    size_bytes=6936962,
    unpacked_bytes=20810886,
    license_id="MIT-CMU",
)

_PSUTIL_WINDOWS = Wheel(
    name="psutil",
    version="7.2.2",
    url=_pypi(
        "b4/90/e2159492b5426be0c1fef7acba807a03511f97c5f86b3caeda6ad92351a7/psutil-7.2.2-cp37-abi3-win_amd64.whl"
    ),
    sha256="eb7e81434c8d223ec4a219b5fc1c47d0417b12be7ea866e24fb5ad6e84b3d988",
    size_bytes=137737,
    unpacked_bytes=413211,
    license_id="UNKNOWN",
)

_PSUTIL_MACOS = Wheel(
    name="psutil",
    version="7.2.2",
    url=_pypi(
        "80/c4/f5af4c1ca8c1eeb2e92ccca14ce8effdeec651d5ab6053c589b074eda6e1/psutil-7.2.2-cp36-abi3-macosx_11_0_arm64.whl"
    ),
    sha256="1a7b04c10f32cc88ab39cbf606e117fd74721c831c98a27dc04578deb0c16979",
    size_bytes=129859,
    unpacked_bytes=389577,
    license_id="UNKNOWN",
)

_PSUTIL_LINUX = Wheel(
    name="psutil",
    version="7.2.2",
    url=_pypi(
        "b5/70/5d8df3b09e25bce090399cf48e452d25c935ab72dad19406c77f4e828045/psutil-7.2.2-cp36-abi3-manylinux2010_x86_64.manylinux_2_12_x86_64.manylinux_2_28_x86_64.whl"
    ),
    sha256="076a2d2f923fd4821644f5ba89f059523da90dc9014e85f8e45a5774ca5bc6f9",
    size_bytes=155560,
    unpacked_bytes=466680,
    license_id="UNKNOWN",
)

_REGEX_WINDOWS = Wheel(
    name="regex",
    version="2026.9.3",
    url=_pypi(
        "d0/fe/ecb15616ae7aa4892299b9ca7c20ef0dd6e5c833643b7ed46e27ff5fcccd/regex-2026.9.3-cp314-cp314-win_amd64.whl"
    ),
    sha256="445623b1337e971ccc571d3642aeb3f2fec77e60b6ee193dd7688168471d1846",
    size_bytes=280812,
    unpacked_bytes=842436,
    license_id="Apache-2.0 AND CNRI-Python",
)

_REGEX_MACOS = Wheel(
    name="regex",
    version="2026.9.3",
    url=_pypi(
        "27/8f/64b8bbd0316baaede047dbdbf2bcc96f10a4eeddec2e9cbf289e855e636f/regex-2026.9.3-cp314-cp314-macosx_11_0_arm64.whl"
    ),
    sha256="647983d2609be6155c748249e770ab7e75e15e386cbf15469569f3eaf165bbb7",
    size_bytes=292008,
    unpacked_bytes=876024,
    license_id="Apache-2.0 AND CNRI-Python",
)

_REGEX_LINUX = Wheel(
    name="regex",
    version="2026.9.3",
    url=_pypi(
        "89/e3/f6bcb26472873b9308df329f507d9c6cb526e3f9aed847498f153f2b7539/regex-2026.9.3-cp314-cp314-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl"
    ),
    sha256="6f64c66b3b13758b4f8f56f17972cd0ce5d0033d19d7332ed32e2dbdbce94dec",
    size_bytes=801375,
    unpacked_bytes=2404125,
    license_id="Apache-2.0 AND CNRI-Python",
)

_REQUESTS = Wheel(
    name="requests",
    version="2.34.2",
    url=_pypi(
        "a0/f4/c67b0b3f1b9245e8d266f0f112c500d50e5b4e83cb6f3b71b6528104182a/requests-2.34.2-py3-none-any.whl"
    ),
    sha256="2a0d60c172f83ac6ab31e4554906c0f3b3588d37b5cb939b1c061f4907e278e0",
    size_bytes=73075,
    unpacked_bytes=219225,
    license_id="UNKNOWN",
)

_RICH = Wheel(
    name="rich",
    version="15.0.0",
    url=_pypi(
        "82/3b/64d4899d73f91ba49a8c18a8ff3f0ea8f1c1d75481760df8c68ef5235bf5/rich-15.0.0-py3-none-any.whl"
    ),
    sha256="33bd4ef74232fb73fe9279a257718407f169c09b78a87ad3d296f548e27de0bb",
    size_bytes=310654,
    unpacked_bytes=931962,
    license_id="UNKNOWN",
)

_SAFETENSORS_WINDOWS = Wheel(
    name="safetensors",
    version="0.8.0",
    url=_pypi(
        "1b/6d/3fba214c1e5e0f69991677ec3bc17023f0421776975e1de0c682dca475e2/safetensors-0.8.0-cp310-abi3-win_amd64.whl"
    ),
    sha256="096ec1a98435df7beb08853bb5aa9081a84f23d0adc67ed1a0a10550f608373f",
    size_bytes=355540,
    unpacked_bytes=1066620,
    license_id="UNKNOWN",
)

_SAFETENSORS_MACOS = Wheel(
    name="safetensors",
    version="0.8.0",
    url=_pypi(
        "f5/b1/fa7c600e7dceae12e9606c7578cbc9ff1e1ed55844883ee5c92205e86226/safetensors-0.8.0-cp310-abi3-macosx_11_0_arm64.whl"
    ),
    sha256="c80201d22cbf405b80647a60ada77bba06c8fba2da2743ba1e89cdcc39a81f25",
    size_bytes=484562,
    unpacked_bytes=1453686,
    license_id="UNKNOWN",
)

_SAFETENSORS_LINUX = Wheel(
    name="safetensors",
    version="0.8.0",
    url=_pypi(
        "28/50/f203ff3a3ddfe19308efc83c5a3a29ed02bf786732ec35e68bf9162f3365/safetensors-0.8.0-cp310-abi3-manylinux_2_17_x86_64.manylinux2014_x86_64.whl"
    ),
    sha256="fd6f3f93c9a0a7cc2788ee63fb763353d4bd2e89b0751bc78fcf7dda00bea774",
    size_bytes=516040,
    unpacked_bytes=1548120,
    license_id="UNKNOWN",
)

_SHELLINGHAM = Wheel(
    name="shellingham",
    version="1.5.4",
    url=_pypi(
        "e0/f9/0595336914c5619e5f28a1fb793285925a8cd4b432c9da0a987836c7f822/shellingham-1.5.4-py2.py3-none-any.whl"
    ),
    sha256="7ecfff8f2fd72616f7481040475a65b2bf8af90a56c89140852d1120324e8686",
    size_bytes=9755,
    unpacked_bytes=29265,
    license_id="UNKNOWN",
)

_TOKENIZERS_WINDOWS = Wheel(
    name="tokenizers",
    version="0.23.2",
    url=_pypi(
        "db/f7/0a69ac6b82dbccf3f71add938a161c497952749294b8dd6dfe03a819dc40/tokenizers-0.23.2-cp310-abi3-win_amd64.whl"
    ),
    sha256="2e96f5699d5249c9c64aa8412e044f727aae3a4098cf830f9901ec1afc361cde",
    size_bytes=2863236,
    unpacked_bytes=8589708,
    license_id="UNKNOWN",
)

_TOKENIZERS_MACOS = Wheel(
    name="tokenizers",
    version="0.23.2",
    url=_pypi(
        "67/49/22da045a91732384d3a3771816bf188dc5a1f702c32e635afa7c679c0bef/tokenizers-0.23.2-cp310-abi3-macosx_11_0_arm64.whl"
    ),
    sha256="986670e43691469dcee610ea0f846f91a8f84e91fc6f7a48d4c064414c0ec2bf",
    size_bytes=3101593,
    unpacked_bytes=9304779,
    license_id="UNKNOWN",
)

_TOKENIZERS_LINUX = Wheel(
    name="tokenizers",
    version="0.23.2",
    url=_pypi(
        "2c/ca/ca6b93c7820df123b2662a9469e8facc826ccc94e98fdd0d615f6431e73a/tokenizers-0.23.2-cp310-abi3-manylinux_2_17_x86_64.manylinux2014_x86_64.whl"
    ),
    sha256="41c2f84d172449b4dadb9cdc508e3e364076613c35b16e76ecfe47a60d1e3305",
    size_bytes=3386843,
    unpacked_bytes=10160529,
    license_id="UNKNOWN",
)

_TQDM = Wheel(
    name="tqdm",
    version="4.70.0",
    url=_pypi(
        "f9/1c/01bfd571a64e7f270e6bab5e33777debe0edc56759233ce84f27dec92d14/tqdm-4.70.0-py3-none-any.whl"
    ),
    sha256="7f585706bfddbdebf89daac705b2dfcc16890130727d3197ca62c732b4310953",
    size_bytes=80184,
    unpacked_bytes=240552,
    license_id="UNKNOWN",
)

_TRANSFORMERS = Wheel(
    name="transformers",
    version="5.16.1",
    url=_pypi(
        "0d/4d/ee3728674c0bbc637bb4af88ccf0be697f92e4e90b55f5dc110c44d61b61/transformers-5.16.1-py3-none-any.whl"
    ),
    sha256="2f2d5b98a5ad3718713653734298fa620754ed683702a635ebb587df3ed29c7e",
    size_bytes=12080592,
    unpacked_bytes=36241776,
    license_id="UNKNOWN",
)

_TYPER = Wheel(
    name="typer",
    version="0.27.2",
    url=_pypi(
        "dc/bf/205d0004930ede8f542fb58f601526fccf4ae7626075ca1e6c4de5d3d652/typer-0.27.2-py3-none-any.whl"
    ),
    sha256="b3a5fc4342d5fc8fda8fc3010b1cf117e9249aab7fae800c2eff62fd3842d97d",
    size_bytes=123130,
    unpacked_bytes=369390,
    license_id="MIT",
)

_URLLIB3 = Wheel(
    name="urllib3",
    version="2.7.0",
    url=_pypi(
        "7f/3e/5db95bcf282c52709639744ca2a8b149baccf648e39c8cc87553df9eae0c/urllib3-2.7.0-py3-none-any.whl"
    ),
    sha256="9fb4c81ebbb1ce9531cce37674bbc6f1360472bc18ca9a553ede278ef7276897",
    size_bytes=131087,
    unpacked_bytes=393261,
    license_id="MIT",
)

_ZIPP = Wheel(
    name="zipp",
    version="4.1.0",
    url=_pypi(
        "3a/13/547360d81e6d88d58492968ffda9f9542854f11310ee556fef14260cc886/zipp-4.1.0-py3-none-any.whl"
    ),
    sha256="25ad4e16390cd314347dd8f1de67a2ac538ae658ed4ab9db16029c07c188e97f",
    size_bytes=10238,
    unpacked_bytes=30714,
    license_id="MIT",
)

_PEFT = Wheel(
    name="peft",
    version="0.20.0",
    url=_pypi(
        "28/79/13bcabb8048126422d5c4b880575d40886c726f354db88cfeed4325525bb/peft-0.20.0-py3-none-any.whl"
    ),
    sha256="0fbba16ffebfad3de96e06f2da6860fd860292324b85b6141909fa1e26ea9233",
    size_bytes=775777,
    unpacked_bytes=2327331,
    license_id="Apache-2.0",
)


def _diffusion_set(
    *,
    pyyaml: Wheel,
    charset_normalizer: Wheel,
    hf_xet: Wheel,
    pillow: Wheel,
    psutil: Wheel,
    regex: Wheel,
    safetensors: Wheel,
    tokenizers: Wheel,
) -> tuple[Wheel, ...]:
    """Return everything diffusers needs on top of torch, for one target.

    Most of the set is pure Python and the same file serves every machine. The
    eight taken as arguments carry compiled extensions, so each target needs the
    wheel built for it.

    Args:
        pyyaml: The compiled PyYAML wheel for this target.
        charset_normalizer: The compiled charset-normalizer wheel.
        hf_xet: The compiled hf-xet wheel.
        pillow: The compiled Pillow wheel.
        psutil: The compiled psutil wheel.
        regex: The compiled regex wheel.
        safetensors: The compiled safetensors wheel.
        tokenizers: The compiled tokenizers wheel.

    Returns:
        The wheels, in the order pip resolved them.
    """
    return (
        # Fusing a style adapter goes through peft. Without it diffusers refuses
        # the call outright, which is how choosing an adapter came to fail at
        # generation time with a message about a backend nobody had heard of.
        _PEFT,
        pyyaml,
        _PYGMENTS,
        _ACCELERATE,
        _ANNOTATED_DOC,
        _ANYIO,
        _CERTIFI,
        charset_normalizer,
        _CLICK,
        _COLORAMA,
        _DIFFUSERS,
        _H11,
        hf_xet,
        _HTTPCORE,
        _HTTPX,
        _HUGGINGFACE_HUB,
        _IDNA,
        _IMPORTLIB_METADATA,
        _MARKDOWN_IT_PY,
        _MDURL,
        _PACKAGING,
        pillow,
        psutil,
        regex,
        _REQUESTS,
        _RICH,
        safetensors,
        _SHELLINGHAM,
        tokenizers,
        _TQDM,
        _TRANSFORMERS,
        _TYPER,
        _URLLIB3,
        _ZIPP,
    )


def _common(markupsafe: Wheel, numpy: Wheel, diffusion: tuple[Wheel, ...]) -> tuple[Wheel, ...]:
    """Return the dependency wheels every variant shares.

    NumPy is not a torch dependency, and torch runs without it. It is here
    because torch says so itself on first import - "Failed to initialize NumPy"
    - and because every path that turns a tensor into an image goes through it.
    Leaving it out shipped a runtime that imported and then failed at the point
    of use, which is the worst place to find out.

    Args:
        markupsafe: The compiled MarkupSafe wheel for this target.
        numpy: The compiled NumPy wheel for this target.
        diffusion: This target's set from :func:`_diffusion_set`.

    Returns:
        The dependencies, in the order pip resolved them.
    """
    return (
        numpy,
        *diffusion,
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


_WINDOWS_DEPENDENCIES = _common(
    _MARKUPSAFE_WINDOWS,
    _NUMPY_WINDOWS,
    _diffusion_set(
        pyyaml=_PYYAML_WINDOWS,
        charset_normalizer=_CHARSET_NORMALIZER_WINDOWS,
        hf_xet=_HF_XET_WINDOWS,
        pillow=_PILLOW_WINDOWS,
        psutil=_PSUTIL_WINDOWS,
        regex=_REGEX_WINDOWS,
        safetensors=_SAFETENSORS_WINDOWS,
        tokenizers=_TOKENIZERS_WINDOWS,
    ),
)
"""Everything but torch itself, for 64-bit Windows."""

_MACOS_ARM64_DEPENDENCIES = _common(
    _MARKUPSAFE_MACOS,
    _NUMPY_MACOS,
    _diffusion_set(
        pyyaml=_PYYAML_MACOS,
        charset_normalizer=_CHARSET_NORMALIZER_MACOS,
        hf_xet=_HF_XET_MACOS,
        pillow=_PILLOW_MACOS,
        psutil=_PSUTIL_MACOS,
        regex=_REGEX_MACOS,
        safetensors=_SAFETENSORS_MACOS,
        tokenizers=_TOKENIZERS_MACOS,
    ),
)
"""Everything but torch itself, for Apple silicon."""

_LINUX_X86_64_DEPENDENCIES = _common(
    _MARKUPSAFE_LINUX,
    _NUMPY_LINUX,
    _diffusion_set(
        pyyaml=_PYYAML_LINUX,
        charset_normalizer=_CHARSET_NORMALIZER_LINUX,
        hf_xet=_HF_XET_LINUX,
        pillow=_PILLOW_LINUX,
        psutil=_PSUTIL_LINUX,
        regex=_REGEX_LINUX,
        safetensors=_SAFETENSORS_LINUX,
        tokenizers=_TOKENIZERS_LINUX,
    ),
)
"""Everything but torch itself, for 64-bit x86 glibc Linux."""


# The NVIDIA tree, which only Linux carries.
#
# The Windows CUDA wheel embeds cuBLAS, cuDNN and the rest inside itself. The
# Linux one does not: it declares them as separate requirements behind
# ``platform_system == "Linux"`` markers, so they are pinned here one by one.
# Nothing in this block is fetched on any other target, and none of it is open
# source - see :data:`_NVIDIA_LICENSE`.
#
# ``unpacked_bytes`` is read from each wheel's zip directory rather than
# estimated. Together these come to close to five gigabytes unpacked, which is
# the number that decides whether an install fits at all.

_CUDA_BINDINGS = Wheel(
    name="cuda-bindings",
    version="12.9.7",
    url=_pypi(
        "ec/cd/3289c810a4d45e5364a3387a74b4c9b6f6f57ee96ae0e5b537cc61dec242/cuda_bindings-12.9.7-cp314-cp314-manylinux_2_24_x86_64.manylinux_2_28_x86_64.whl"
    ),
    sha256="3c47ec1a7a441d91aab32339951df7a1be53451121a12c094bba51467717a35a",
    size_bytes=7504419,
    unpacked_bytes=36111557,
    license_id=_NVIDIA_LICENSE,
)

_CUDA_PATHFINDER = Wheel(
    name="cuda-pathfinder",
    version="1.8.1",
    url=_pypi(
        "9d/e6/22df83f82f9bc26cb1c42265cf14d34d4908dba2a0f261bd7b28244acb00/cuda_pathfinder-1.8.1-py3-none-any.whl"
    ),
    sha256="ae0137ff9e56ea97499bcbf54f5f2778ec25f3266715ac86da192a795af982a8",
    size_bytes=62552,
    unpacked_bytes=187822,
    license_id="Apache-2.0",
)

_CUDA_TOOLKIT = Wheel(
    name="cuda-toolkit",
    version="12.6.3",
    url=_pypi(
        "ad/88/2dbc37975fffb874418b14380418a1b99cb36f2101fd1d08c54e06ee8c95/cuda_toolkit-12.6.3-py2.py3-none-any.whl"
    ),
    sha256="79d8605baeb6c2f695761e0efb54bc62dbc3c9e32eb0742df7669c07befaa8f7",
    size_bytes=2288,
    unpacked_bytes=8912,
    license_id=_NVIDIA_LICENSE,
)

_NVIDIA_CUBLAS_CU12 = Wheel(
    name="nvidia-cublas-cu12",
    version="12.6.4.1",
    url=_pypi(
        "af/eb/ff4b8c503fa1f1796679dce648854d58751982426e4e4b37d6fce49d259c/nvidia_cublas_cu12-12.6.4.1-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl"
    ),
    sha256="08ed2686e9875d01b58e3cb379c6896df8e76c75e0d4a7f7dace3d7b6d9ef8eb",
    size_bytes=393138322,
    unpacked_bytes=600763634,
    license_id=_NVIDIA_LICENSE,
)

_NVIDIA_CUDA_CUPTI_CU12 = Wheel(
    name="nvidia-cuda-cupti-cu12",
    version="12.6.80",
    url=_pypi(
        "49/60/7b6497946d74bcf1de852a21824d63baad12cd417db4195fc1bfe59db953/nvidia_cuda_cupti_cu12-12.6.80-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl"
    ),
    sha256="6768bad6cab4f19e8292125e5f1ac8aa7d1718704012a0e3272a6f61c4bce132",
    size_bytes=8917980,
    unpacked_bytes=34855781,
    license_id=_NVIDIA_LICENSE,
)

_NVIDIA_CUDA_NVRTC_CU12 = Wheel(
    name="nvidia-cuda-nvrtc-cu12",
    version="12.6.85",
    url=_pypi(
        "f5/31/ffb400c5ae99daf09687aa6c42831c5d824f71c4851363ed2a4a1ac52bab/nvidia_cuda_nvrtc_cu12-12.6.85-py3-none-manylinux2010_x86_64.manylinux_2_12_x86_64.whl"
    ),
    sha256="800927308ccc5dd6246d3f61f7fcef2ed7ec4e59e199090d360d3293f78bd5a2",
    size_bytes=23649944,
    unpacked_bytes=64147690,
    license_id=_NVIDIA_LICENSE,
)

_NVIDIA_CUDA_RUNTIME_CU12 = Wheel(
    name="nvidia-cuda-runtime-cu12",
    version="12.6.77",
    url=_pypi(
        "e1/23/e717c5ac26d26cf39a27fbc076240fad2e3b817e5889d671b67f4f9f49c5/nvidia_cuda_runtime_cu12-12.6.77-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl"
    ),
    sha256="ba3b56a4f896141e25e19ab287cd71e52a6a0f4b29d0d31609f60e3b4d5219b7",
    size_bytes=897690,
    unpacked_bytes=4666930,
    license_id=_NVIDIA_LICENSE,
)

_NVIDIA_CUDNN_CU12 = Wheel(
    name="nvidia-cudnn-cu12",
    version="9.10.2.21",
    url=_pypi(
        "ba/51/e123d997aa098c61d029f76663dedbfb9bc8dcf8c60cbd6adbe42f76d049/nvidia_cudnn_cu12-9.10.2.21-py3-none-manylinux_2_27_x86_64.whl"
    ),
    sha256="949452be657fa16687d0930933f032835951ef0892b37d2d53824d1a84dc97a8",
    size_bytes=706758467,
    unpacked_bytes=1053624755,
    license_id=_NVIDIA_LICENSE,
)

_NVIDIA_CUFFT_CU12 = Wheel(
    name="nvidia-cufft-cu12",
    version="11.3.0.4",
    url=_pypi(
        "8f/16/73727675941ab8e6ffd86ca3a4b7b47065edcca7a997920b831f8147c99d/nvidia_cufft_cu12-11.3.0.4-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl"
    ),
    sha256="ccba62eb9cef5559abd5e0d54ceed2d9934030f51163df018532142a8ec533e5",
    size_bytes=200221632,
    unpacked_bytes=281139021,
    license_id=_NVIDIA_LICENSE,
)

_NVIDIA_CUFILE_CU12 = Wheel(
    name="nvidia-cufile-cu12",
    version="1.11.1.6",
    url=_pypi(
        "b2/66/cc9876340ac68ae71b15c743ddb13f8b30d5244af344ec8322b449e35426/nvidia_cufile_cu12-1.11.1.6-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl"
    ),
    sha256="cc23469d1c7e52ce6c1d55253273d32c565dd22068647f3aa59b3c6b005bf159",
    size_bytes=1142103,
    unpacked_bytes=3179200,
    license_id=_NVIDIA_LICENSE,
)

_NVIDIA_CURAND_CU12 = Wheel(
    name="nvidia-curand-cu12",
    version="10.3.7.77",
    url=_pypi(
        "73/1b/44a01c4e70933637c93e6e1a8063d1e998b50213a6b65ac5a9169c47e98e/nvidia_curand_cu12-10.3.7.77-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl"
    ),
    sha256="a42cd1344297f70b9e39a1e4f467a4e1c10f1da54ff7a85c12197f6c652c8bdf",
    size_bytes=56279010,
    unpacked_bytes=98640598,
    license_id=_NVIDIA_LICENSE,
)

_NVIDIA_CUSOLVER_CU12 = Wheel(
    name="nvidia-cusolver-cu12",
    version="11.7.1.2",
    url=_pypi(
        "f0/6e/c2cf12c9ff8b872e92b4a5740701e51ff17689c4d726fca91875b07f655d/nvidia_cusolver_cu12-11.7.1.2-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl"
    ),
    sha256="e9e49843a7707e42022babb9bcfa33c29857a93b88020c4e4434656a655b698c",
    size_bytes=158229790,
    unpacked_bytes=243636553,
    license_id=_NVIDIA_LICENSE,
)

_NVIDIA_CUSPARSE_CU12 = Wheel(
    name="nvidia-cusparse-cu12",
    version="12.5.4.2",
    url=_pypi(
        "06/1e/b8b7c2f4099a37b96af5c9bb158632ea9e5d9d27d7391d7eb8fc45236674/nvidia_cusparse_cu12-12.5.4.2-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl"
    ),
    sha256="7556d9eca156e18184b94947ade0fba5bb47d69cec46bf8660fd2c71a4b48b73",
    size_bytes=216561367,
    unpacked_bytes=293978233,
    license_id=_NVIDIA_LICENSE,
)

_NVIDIA_CUSPARSELT_CU12 = Wheel(
    name="nvidia-cusparselt-cu12",
    version="0.7.1",
    url=_pypi(
        "56/79/12978b96bd44274fe38b5dde5cfb660b1d114f70a65ef962bcbbed99b549/nvidia_cusparselt_cu12-0.7.1-py3-none-manylinux2014_x86_64.whl"
    ),
    sha256="f1bb701d6b930d5a7cea44c19ceb973311500847f81b634d802b7b539dc55623",
    size_bytes=287193691,
    unpacked_bytes=452024081,
    license_id=_NVIDIA_LICENSE,
)

_NVIDIA_NCCL_CU12 = Wheel(
    name="nvidia-nccl-cu12",
    version="2.29.3",
    url=_pypi(
        "31/5a/cac7d231f322b66caa16fd4b136ebc8e4b18b2805811c2d58dc47210cdea/nvidia_nccl_cu12-2.29.3-py3-none-manylinux_2_18_x86_64.whl"
    ),
    sha256="35ad42e7d5d722a83c36a3a478e281c20a5646383deaf1b9ed1a9ab7d61bed53",
    size_bytes=289760316,
    unpacked_bytes=394915332,
    license_id=_NVIDIA_LICENSE,
)

_NVIDIA_NVJITLINK_CU12 = Wheel(
    name="nvidia-nvjitlink-cu12",
    version="12.9.86",
    url=_pypi(
        "46/0c/c75bbfb967457a0b7670b8ad267bfc4fffdf341c074e0a80db06c24ccfd4/nvidia_nvjitlink_cu12-12.9.86-py3-none-manylinux2010_x86_64.manylinux_2_12_x86_64.whl"
    ),
    sha256="e3f1171dbdc83c5932a45f0f4c99180a70de9bd2718c1ab77d14104f6d7147f9",
    size_bytes=39748338,
    unpacked_bytes=96014630,
    license_id=_NVIDIA_LICENSE,
)

_NVIDIA_NVSHMEM_CU12 = Wheel(
    name="nvidia-nvshmem-cu12",
    version="3.4.5",
    url=_pypi(
        "b5/09/6ea3ea725f82e1e76684f0708bbedd871fc96da89945adeba65c3835a64c/nvidia_nvshmem_cu12-3.4.5-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl"
    ),
    sha256="042f2500f24c021db8a06c5eec2539027d57460e1c1a762055a6554f72c369bd",
    size_bytes=139103095,
    unpacked_bytes=204181279,
    license_id=_NVIDIA_LICENSE,
)

_NVIDIA_NVTX_CU12 = Wheel(
    name="nvidia-nvtx-cu12",
    version="12.6.77",
    url=_pypi(
        "56/9a/fff8376f8e3d084cd1530e1ef7b879bb7d6d265620c95c1b322725c694f4/nvidia_nvtx_cu12-12.6.77-py3-none-manylinux2014_x86_64.manylinux_2_17_x86_64.whl"
    ),
    sha256="b90bed3df379fa79afbd21be8e04a0314336b8ae16768b58f2d34cb1d04cd7d2",
    size_bytes=89276,
    unpacked_bytes=369610,
    license_id=_NVIDIA_LICENSE,
)

_TRITON = Wheel(
    name="triton",
    version="3.8.0",
    url=_pypi(
        "93/d9/08c75f3459f19ad00425b564058e40efa4bcd79b816064cf27499303ea42/triton-3.8.0-cp314-cp314-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl"
    ),
    sha256="387dae4cb0089a7b6ba1a428ae0782b65c4c58f57d94617cb22ca8593d8ccbca",
    size_bytes=247972313,
    unpacked_bytes=936110323,
    license_id="MIT",
)

_CUDA_LINUX_SET: tuple[Wheel, ...] = (
    _CUDA_BINDINGS,
    _CUDA_PATHFINDER,
    _CUDA_TOOLKIT,
    _NVIDIA_CUBLAS_CU12,
    _NVIDIA_CUDA_CUPTI_CU12,
    _NVIDIA_CUDA_NVRTC_CU12,
    _NVIDIA_CUDA_RUNTIME_CU12,
    _NVIDIA_CUDNN_CU12,
    _NVIDIA_CUFFT_CU12,
    _NVIDIA_CUFILE_CU12,
    _NVIDIA_CURAND_CU12,
    _NVIDIA_CUSOLVER_CU12,
    _NVIDIA_CUSPARSE_CU12,
    _NVIDIA_CUSPARSELT_CU12,
    _NVIDIA_NCCL_CU12,
    _NVIDIA_NVJITLINK_CU12,
    _NVIDIA_NVSHMEM_CU12,
    _NVIDIA_NVTX_CU12,
    _TRITON,
)
"""The CUDA libraries and the compiler that torch needs on Linux.

Pinned to the versions the ``+cu126`` build declares, rather than to the newest
release of each, so that the set matches the torch above it.
"""


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
                *_WINDOWS_DEPENDENCIES,
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
                *_WINDOWS_DEPENDENCIES,
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
                *_MACOS_ARM64_DEPENDENCIES,
            ),
        ),
    ),
    "linux_x86_64-cp314": (
        Variant(
            accelerator="cuda",
            torch_version="2.14.0",
            cuda_version="12.6",
            # The libraries are NVIDIA's either way. Linux simply takes delivery
            # of them as their own wheels rather than inside torch's.
            bundles_nvidia=True,
            wheels=(
                Wheel(
                    name="torch",
                    version="2.14.0+cu126",
                    url=(
                        "https://download.pytorch.org/whl/cu126/"
                        "torch-2.14.0%2Bcu126-cp314-cp314-manylinux_2_28_x86_64.whl"
                    ),
                    sha256="b15e1e62ab842d099ae9b19312374f62579668171efed8b676108b60fa75e5b0",
                    size_bytes=869180118,
                    unpacked_bytes=1719333573,
                    license_id=_TORCH_LICENSE,
                ),
                *_CUDA_LINUX_SET,
                *_LINUX_X86_64_DEPENDENCIES,
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
                        "torch-2.14.0%2Bcpu-cp314-cp314-manylinux_2_28_x86_64.whl"
                    ),
                    sha256="f152f41dc5dc462afe0de780e451ebb47ea8b4451f8f919f9537aa8e2cbe1d7e",
                    size_bytes=196260719,
                    unpacked_bytes=715547861,
                    license_id=_TORCH_LICENSE,
                ),
                *_LINUX_X86_64_DEPENDENCIES,
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
