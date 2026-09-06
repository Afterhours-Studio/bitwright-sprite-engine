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

"""Where downloaded data lives, and whether a chosen directory can hold it.

Model weights are several gigabytes each, so the directory that holds them
cannot be nailed to whichever volume the application was installed on. A user
whose system drive is full has to be able to point this somewhere else.

A candidate directory is proven writable by writing a file and removing it
again, never by reading a permission bit. A network share, a synchronised
folder, and a read-only mount all report permissions that a write then refuses,
and that failure would otherwise arrive four gigabytes into a download.

Nothing here moves data. Changing the root leaves what has already been
downloaded where it is, and the caller is told what stayed behind, because
silently moving gigabytes is not a side effect a settings screen may have.
"""

from __future__ import annotations

import contextlib
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)

MODELS_DIRNAME = "models"

SPRITES_DIRNAME = "sprites"
"""Directory under the data root that generated sprites are written to."""
"""Subdirectory of the data root that holds downloaded weights."""

PROBE_PREFIX = ".bitwright-write-probe-"
"""Prefix of the file written to prove a directory is writable.

Dotted and uniquely suffixed, so that a probe left behind by a process that was
killed mid check is neither mistaken for user data nor collided with by a
second check running at the same time.
"""

PROBE_BYTES = b"bitwright"
"""Content of the probe file.

Small, but not empty: some filesystems accept the creation of a zero length
file and only refuse once bytes are actually written.
"""


class StorageError(RuntimeError):
    """Raised when a directory cannot hold the application's data.

    Attributes:
        code: Stable reason code that the user interface translates.
    """

    code: str = "storage.invalid_path"

    def __init__(self, message: str = "", code: str | None = None) -> None:
        """Create the error.

        Args:
            message: English description, for logs. Never shown to the user.
            code: Reason code to carry instead of the class default.
        """
        super().__init__(message)
        if code is not None:
            self.code = code


class StoragePathEmptyError(StorageError):
    """Raised when the candidate path is blank."""

    code = "storage.path_empty"


class StoragePathNotAbsoluteError(StorageError):
    """Raised when the candidate path is relative.

    A relative path resolves against the working directory of whichever process
    spawned the sidecar, which is not something the user can see or predict.
    """

    code = "storage.path_not_absolute"


class StorageNotADirectoryError(StorageError):
    """Raised when the candidate path exists but is not a directory."""

    code = "storage.not_a_directory"


class StorageCreateFailedError(StorageError):
    """Raised when the candidate directory is missing and cannot be created."""

    code = "storage.create_failed"


class StorageNotWritableError(StorageError):
    """Raised when the write and delete probe fails."""

    code = "storage.not_writable"


class StorageInsideInstallationError(StorageError):
    """Raised when the candidate sits inside the application's installation.

    Data written there is lost on the next update, which replaces the
    installation directory, and on several platforms that directory is not
    writable by the user in the first place.
    """

    code = "storage.inside_installation"


@dataclass(frozen=True, slots=True)
class StorageLocation:
    """A data root, the room left on its volume, and what is already in it.

    Attributes:
        root: The directory that holds everything this application downloads.
        models_dir: Where weights live inside that root.
        is_default: Whether this is the per-user default location.
        free_bytes: Free space on the volume behind the root, or None when the
            volume could not be read, such as a share that has gone away.
        total_bytes: Size of that volume, or None for the same reason.
        used_bytes: Bytes already taken by downloaded models under this root.
        existing_models: Identifiers of the models found under this root, in
            order. Used to tell the user what stays behind when the root moves.
    """

    root: Path
    models_dir: Path
    is_default: bool
    free_bytes: int | None
    total_bytes: int | None
    used_bytes: int
    existing_models: tuple[str, ...]


def installation_root() -> Path:
    """Return the directory the application itself was installed into.

    Frozen by PyInstaller, that is the directory holding the executable. From a
    source checkout it is the engine package root, which is the closest
    equivalent and keeps the check meaningful during development.

    Returns:
        The installation directory, resolved.
    """
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def normalise(raw: str | Path) -> Path:
    """Turn a path the user chose into an absolute, normalised one.

    Args:
        raw: The path as it arrived from the interface.

    Returns:
        The resolved absolute path. It need not exist.

    Raises:
        StoragePathEmptyError: The path is blank.
        StoragePathNotAbsoluteError: The path is relative.
    """
    text = str(raw).strip()
    if text == "":
        raise StoragePathEmptyError("the storage path is empty")

    candidate = Path(text).expanduser()
    if not candidate.is_absolute():
        raise StoragePathNotAbsoluteError(f"the storage path is relative: {text}")

    # Not strict: a directory that does not exist yet still has to normalise.
    return candidate.resolve()


def is_inside(candidate: Path, parent: Path) -> bool:
    """Report whether one path is the same as, or below, another.

    Args:
        candidate: The path being checked.
        parent: The directory it may sit inside.

    Returns:
        True when ``candidate`` is ``parent`` or is contained by it.
    """
    return candidate == parent or parent in candidate.parents


def volume_space(path: Path) -> tuple[int, int] | None:
    """Return the size and the free space of the volume holding a path.

    The nearest existing ancestor is measured, so a directory that has not been
    created yet still reports the volume it would land on.

    Args:
        path: The directory of interest. It need not exist.

    Returns:
        A ``(total_bytes, free_bytes)`` pair, or None when the volume cannot be
        read, which is what an unplugged drive or a dead share looks like.
    """
    probe = path
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent

    try:
        usage = shutil.disk_usage(probe)
    except OSError:
        logger.warning("cannot read the volume holding %s", path)
        return None

    return usage.total, usage.free


def probe_writable(directory: Path) -> None:
    """Prove that a directory can be written to, and deleted from.

    Args:
        directory: An existing directory.

    Raises:
        StorageNotWritableError: The probe file could not be written, or could
            not be removed again.
    """
    probe = directory / f"{PROBE_PREFIX}{uuid4().hex}"
    try:
        probe.write_bytes(PROBE_BYTES)
        probe.unlink()
    except OSError as error:
        # A probe that was written but could not be removed still counts as a
        # failure, and must not be left behind on the user's disk.
        with contextlib.suppress(OSError):
            probe.unlink(missing_ok=True)
        raise StorageNotWritableError(f"cannot write inside {directory}") from error


def validate_root(raw: str | Path, *, install_root: Path | None = None) -> Path:
    """Check that a chosen directory can hold downloaded data.

    A missing directory is created, because a user who typed or picked a new
    folder expects it to be used rather than reported as an error.

    Args:
        raw: The path as it arrived from the interface.
        install_root: The application's installation directory. Defaults to
            :func:`installation_root`. Injected by tests.

    Returns:
        The validated, absolute directory.

    Raises:
        StoragePathEmptyError: The path is blank.
        StoragePathNotAbsoluteError: The path is relative.
        StorageInsideInstallationError: The path sits inside the installation.
        StorageNotADirectoryError: The path exists and is not a directory.
        StorageCreateFailedError: The directory could not be created.
        StorageNotWritableError: The directory refused the write probe.
    """
    root = normalise(raw)

    installation = (install_root if install_root is not None else installation_root()).resolve()
    # Checked before anything is created, so that a refused candidate never
    # leaves a directory behind inside the installation.
    if is_inside(root, installation):
        raise StorageInsideInstallationError(f"{root} is inside the installation {installation}")

    if root.exists() and not root.is_dir():
        raise StorageNotADirectoryError(f"{root} is not a directory")

    try:
        root.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise StorageCreateFailedError(f"cannot create {root}") from error

    probe_writable(root)
    return root


def directory_size(directory: Path) -> int:
    """Return the total size of the files under a directory.

    Args:
        directory: The directory to measure.

    Returns:
        Bytes used, counting regular files only. Zero when the directory cannot
        be read: a size is informational, and must never fail a request.
    """
    total = 0
    try:
        for entry in directory.rglob("*"):
            # Symlinks are not followed. A link back into the same tree would
            # be counted twice, and a link out of it is not this root's data.
            if entry.is_file() and not entry.is_symlink():
                total += entry.stat().st_size
    except OSError:
        logger.warning("cannot measure %s", directory)
        return 0

    return total


def scan_models(models_dir: Path) -> tuple[tuple[str, ...], int]:
    """List the models already downloaded under a root, and their size.

    The layout is ``<models>/<kind>/<model id>``, which is what the downloader
    writes. The registry is deliberately not consulted: this reports what is on
    the disk, including entries from an older registry, and those are exactly
    the gigabytes a user would be upset to lose track of.

    Args:
        models_dir: The models directory, which need not exist.

    Returns:
        The model identifiers found, sorted, and the bytes they occupy.
    """
    if not models_dir.is_dir():
        return (), 0

    names: list[str] = []
    total = 0
    try:
        for kind_dir in sorted(models_dir.iterdir()):
            # Skips the downloader's .partial directory, which holds transfers
            # that were interrupted and are not models.
            if not kind_dir.is_dir() or kind_dir.name.startswith("."):
                continue
            for model_dir in sorted(kind_dir.iterdir()):
                if not model_dir.is_dir():
                    continue
                names.append(model_dir.name)
                total += directory_size(model_dir)
    except OSError:
        logger.warning("cannot list the models under %s", models_dir)
        return (), 0

    return tuple(names), total


def describe(root: Path, *, default_root: Path) -> StorageLocation:
    """Report on a data root: its room, and what is already stored in it.

    Never raises. A location that cannot be read reports unknown free space
    rather than failing the request, so the settings screen can still show the
    user which path is configured.

    Args:
        root: The data root to describe.
        default_root: The per-user default, which decides ``is_default``.

    Returns:
        The description of that root.
    """
    models_dir = root / MODELS_DIRNAME
    space = volume_space(root)
    existing, used = scan_models(models_dir)

    return StorageLocation(
        root=root,
        models_dir=models_dir,
        is_default=root == default_root,
        free_bytes=None if space is None else space[1],
        total_bytes=None if space is None else space[0],
        used_bytes=used,
        existing_models=existing,
    )
