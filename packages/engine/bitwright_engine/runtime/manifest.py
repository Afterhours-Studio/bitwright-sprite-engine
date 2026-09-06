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

_PYYAML = Wheel(
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

_CHARSET_NORMALIZER = Wheel(
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

_HF_XET = Wheel(
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

_PILLOW = Wheel(
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

_PSUTIL = Wheel(
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

_REGEX = Wheel(
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

_SAFETENSORS = Wheel(
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

_TOKENIZERS = Wheel(
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

_DIFFUSION_SET: tuple[Wheel, ...] = (
    _PYYAML,
    _PYGMENTS,
    _ACCELERATE,
    _ANNOTATED_DOC,
    _ANYIO,
    _CERTIFI,
    _CHARSET_NORMALIZER,
    _CLICK,
    _COLORAMA,
    _DIFFUSERS,
    _H11,
    _HF_XET,
    _HTTPCORE,
    _HTTPX,
    _HUGGINGFACE_HUB,
    _IDNA,
    _IMPORTLIB_METADATA,
    _MARKDOWN_IT_PY,
    _MDURL,
    _PACKAGING,
    _PILLOW,
    _PSUTIL,
    _REGEX,
    _REQUESTS,
    _RICH,
    _SAFETENSORS,
    _SHELLINGHAM,
    _TOKENIZERS,
    _TQDM,
    _TRANSFORMERS,
    _TYPER,
    _URLLIB3,
    _ZIPP,
)


def _common(markupsafe: Wheel, numpy: Wheel) -> tuple[Wheel, ...]:
    """Return the dependency wheels every variant shares.

    NumPy is not a torch dependency, and torch runs without it. It is here
    because torch says so itself on first import - "Failed to initialize NumPy"
    - and because every path that turns a tensor into an image goes through it.
    Leaving it out shipped a runtime that imported and then failed at the point
    of use, which is the worst place to find out.

    Args:
        markupsafe: The compiled MarkupSafe wheel for this target.
        numpy: The compiled NumPy wheel for this target.

    Returns:
        The dependencies, in the order pip resolved them.
    """
    return (
        numpy,
        *_DIFFUSION_SET,
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
                *_common(_MARKUPSAFE_WIN, _NUMPY_WINDOWS),
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
                *_common(_MARKUPSAFE_WIN, _NUMPY_WINDOWS),
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
                *_common(_MARKUPSAFE_MACOS_ARM64, _NUMPY_MACOS),
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
