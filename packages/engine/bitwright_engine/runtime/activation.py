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

"""Making an installed runtime importable, and reporting whether it worked.

Installing PyTorch into a directory is half the job. The other half is that the
sidecar has to find it, and a frozen bundle will not: PyInstaller fixes
``sys.path`` to its own archive, and nothing outside the bundle is on it.

So the path is extended here, once, from :func:`bitwright_engine.api.server.main`
before anything imports torch. It is **appended**, not prepended, on purpose.
The runtime carries its own copies of packages the sidecar already ships, such
as ``typing_extensions`` and ``setuptools``, and letting a downloaded tree
shadow what the engine is already running on would turn a generation feature
into a process that no longer starts. Appending means the installed runtime can
only add names, never replace them; torch pins its dependencies with lower
bounds, which the shipped versions satisfy.

Activation happens at startup and nowhere else, so **an install takes effect on
the next launch**. Doing it live would mean importing torch into a process that
has already answered requests without it, and Python has no way to unimport the
partly initialised module left behind if that fails. The interface says a
restart is needed rather than pretending otherwise.

:func:`probe` reports what torch says about itself, which is what the settings
screen shows. :func:`compute_check` goes one step further and runs an operation
on a device. It is not part of startup; it is there so that the shipped binary
can be asked, from outside, whether the runtime it found actually works - see
``scripts/build-sidecar.py``.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

from bitwright_engine.config import Settings, get_settings
from bitwright_engine.runtime.installer import RuntimeInstaller
from bitwright_engine.runtime.manifest import target_key
from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)

_activated: Path | None = None
"""The directory this process put on the import path, or None."""


@dataclass(frozen=True, slots=True)
class TorchProbe:
    """What ``import torch`` does in this process, right now.

    Attributes:
        importable: True when torch imported successfully.
        version: Version string torch reports, or an empty string.
        cuda_available: True when torch reports a usable CUDA device. Only this
            answers whether the GPU actually works; a runtime being installed
            does not.
        mps_available: True when torch reports a usable Metal device.
        device: Name of the first device, or an empty string.
        detail: Stable reason code when torch is present but unusable, or an
            empty string.
        location: Directory the imported ``torch`` package was loaded from, or
            an empty string. This is what tells an installed runtime apart from
            a torch that happened to be importable for some other reason, which
            matters when the question being asked is whether the shipped bundle
            can reach the runtime the user installed.
    """

    importable: bool = False
    version: str = ""
    cuda_available: bool = False
    mps_available: bool = False
    device: str = ""
    detail: str = ""
    location: str = ""


def _torch_is_absent(error: ImportError) -> bool:
    """Tell "there is no torch here" apart from "torch would not load".

    Both arrive as :class:`ImportError`, and the difference is the whole
    difference between a user who has not installed the runtime and a user whose
    runtime is broken. On Windows a failed DLL load is an ``ImportError`` too,
    and a module torch needs that the frozen bundle lacks is a
    ``ModuleNotFoundError`` naming *that* module rather than torch. Reporting
    either of those as "not installed" sends the user to install what they
    already have.

    Args:
        error: The exception raised by ``import torch``.

    Returns:
        True only when torch itself is the module that could not be found.
    """
    return isinstance(error, ModuleNotFoundError) and error.name == "torch"


def activated_path() -> Path | None:
    """Return the directory this process added to the import path.

    Returns:
        The site directory in use, or None when none was added.
    """
    return _activated


def activate(settings: Settings | None = None) -> Path | None:
    """Put an installed runtime on the import path.

    Never raises. A runtime that cannot be used is not an error at startup: the
    engine runs without one, and the settings screen is where the user is told
    why.

    Args:
        settings: Configuration to read the data root from. Defaults to the
            process wide settings.

    Returns:
        The directory that was added, or None when there was nothing usable.
    """
    global _activated

    installer = RuntimeInstaller(settings if settings is not None else get_settings())
    record = installer.record()
    if record is None:
        return None

    current = target_key()
    if record.target != current:
        # Compiled extensions are built against one interpreter ABI. Importing a
        # runtime installed for another does not fail politely, so it is refused
        # here and reported as something the user can fix by reinstalling.
        logger.warning(
            "the installed runtime targets %s, this engine is %s",
            record.target,
            current,
        )
        return None

    site = installer.site_dir
    if not site.is_dir():
        logger.warning("the runtime record at %s has no site directory", installer.record_path)
        return None

    path = str(site)
    if path not in sys.path:
        sys.path.append(path)

    _activated = site
    logger.info("runtime on the import path: %s (%s)", site, record.accelerator)
    return site


def probe() -> TorchProbe:
    """Report whether torch imports here, and what it can see.

    This is the only honest answer to "is the GPU usable": a runtime on disk
    proves that bytes were downloaded, not that they load. The import is not
    cheap, but the engine already pays for it while selecting a backend, so
    asking again costs nothing after the first time.

    Returns:
        What torch reports, or why it could not be asked.
    """
    try:
        import torch
    except ImportError as error:
        if _torch_is_absent(error):
            return TorchProbe(detail="backend.cuda.torch_missing")
        logger.exception("the installed runtime could not be imported")
        return TorchProbe(detail="runtime.import_failed")
    # A torch that is present but unloadable in some other way, such as one
    # built for another ABI, raises something that is not an ImportError at all.
    except Exception:
        logger.exception("the installed runtime could not be imported")
        return TorchProbe(detail="runtime.import_failed")

    cuda = False
    mps = False
    device = ""
    try:
        cuda = torch.cuda.is_available()
        if cuda:
            device = torch.cuda.get_device_name(0)
        mps = bool(getattr(torch.backends, "mps", None)) and torch.backends.mps.is_available()
    # Asking a broken driver for a device list can raise. Reporting torch as
    # imported with no device is truthful; failing the request is not.
    except Exception:
        logger.exception("torch imported but could not describe its devices")

    return TorchProbe(
        importable=True,
        version=str(getattr(torch, "__version__", "")),
        cuda_available=cuda,
        mps_available=mps,
        device=device,
        location=_package_dir(torch),
    )


def _package_dir(module: object) -> str:
    """Return the directory a module was imported from.

    Args:
        module: The imported module.

    Returns:
        The absolute directory, or an empty string when the module has no file,
        which is what a namespace package or a stubbed test double looks like.
    """
    path = getattr(module, "__file__", None)
    if not isinstance(path, str) or not path:
        return ""
    return str(Path(path).resolve().parent)


@dataclass(frozen=True, slots=True)
class ComputeCheck:
    """Whether torch can actually compute on a device, not merely describe one.

    :func:`probe` answers what torch *reports*. That is the right answer for the
    settings screen and it is not proof: a CUDA build with a mismatched driver
    reports a device and then fails on the first allocation. This runs the
    smallest operation that touches the device.

    Attributes:
        ok: True when the operation ran and gave the expected answer.
        device: Device the operation ran on, such as ``cuda`` or ``cpu``.
        detail: Stable reason code when it did not run, or an empty string.
        message: What the underlying failure said, or an empty string. Kept
            apart from ``detail`` so that the code stays something callers can
            branch on while the text stays something a person can read.
    """

    ok: bool = False
    device: str = ""
    detail: str = ""
    message: str = ""


def compute_check() -> ComputeCheck:
    """Run one tensor operation on the best device torch offers.

    Not called during normal startup. It exists so that a build, or a developer
    holding a machine the test suite cannot reach, can ask the shipped binary
    the only question that matters about an installed runtime: does it compute.

    Returns:
        What happened, including which device was used.
    """
    try:
        import torch
    except ImportError as error:
        if _torch_is_absent(error):
            return ComputeCheck(detail="backend.cuda.torch_missing")
        logger.exception("the installed runtime could not be imported")
        return ComputeCheck(detail="runtime.import_failed")
    except Exception:
        logger.exception("the installed runtime could not be imported")
        return ComputeCheck(detail="runtime.import_failed")

    device = "cpu"
    try:
        if torch.cuda.is_available():
            device = "cuda"
        elif bool(getattr(torch.backends, "mps", None)) and torch.backends.mps.is_available():
            device = "mps"

        # Small enough to be free on any device, and checked rather than merely
        # executed: a runtime that allocates and returns nonsense is worse than
        # one that refuses.
        values = torch.ones(8, device=device) + torch.ones(8, device=device)
        ok = bool(float(values.sum().item()) == 16.0)
    # Every interesting failure here is a native one - a driver that will not
    # load, a kernel that will not launch - and none of them is an ImportError.
    except Exception as error:
        logger.exception("torch imported but could not compute on %s", device)
        return ComputeCheck(device=device, detail="runtime.compute_failed", message=str(error))

    return ComputeCheck(ok=ok, device=device, detail="" if ok else "runtime.compute_wrong_answer")
