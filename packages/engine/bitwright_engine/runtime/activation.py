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
    """

    importable: bool = False
    version: str = ""
    cuda_available: bool = False
    mps_available: bool = False
    device: str = ""
    detail: str = ""


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
    except ImportError:
        return TorchProbe(detail="backend.cuda.torch_missing")
    # A torch that is present but unloadable, such as one built for another ABI
    # or missing a native library, raises something other than ImportError. The
    # settings screen has to say so rather than claim torch is absent.
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
    )
