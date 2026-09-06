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

"""Installing and removing the GPU runtime.

The runtime is PyTorch and the handful of packages it needs, unpacked into a
directory under the data root the user chose in Settings. It goes there, beside
``models``, rather than into the installation directory or a hidden per-user
folder, because it is several gigabytes and because the whole point of the data
root is that the user decides which volume carries the gigabytes. Moving the
root moves this with it, in the sense that the new root has no runtime and can
be given one; nothing is copied behind the user's back, exactly as with weights.

The install is a download and a zip extraction, and nothing else. There is no
``pip`` here, and no subprocess: the shipped sidecar is frozen by PyInstaller
and has neither an interpreter to run nor a package manager to run in it. What
would normally be pip's job, resolving a dependency set, was done ahead of time
and is pinned in :mod:`bitwright_engine.runtime.manifest`.

Nothing half finished is ever visible. Wheels land in ``.partial``, are unpacked
into ``.staging``, and only a complete tree is moved into place; the record file
that marks a runtime as installed is written last, so a process killed at any
point leaves a directory that reads as "not installed" rather than one that
reads as installed and then fails to import.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import shutil
import threading
import zipfile
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from bitwright_engine.config import Settings, get_settings
from bitwright_engine.config.storage import directory_size, volume_space
from bitwright_engine.runtime.manifest import Variant, find_variant, target_key, variants_for
from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)

RUNTIME_DIRNAME = "runtime"
"""Subdirectory of the data root that holds the installed runtime."""

SITE_DIRNAME = "site"
"""Directory inside the runtime that is put on the import path.

Named after what it is: a directory of importable packages. The wheels are
unpacked into it flat, which is what a wheel is laid out for.
"""

RECORD_NAME = "runtime.json"
"""File that records what was installed. Its presence is what "installed" means."""

STAGING_DIRNAME = ".staging"
"""Where an install is assembled before it is published."""

PARTIAL_DIRNAME = ".partial"
"""Where a wheel is written while it is still arriving."""

RECORD_VERSION = 1
"""Schema version of the record file, so a future layout can be recognised."""

CHUNK_SIZE = 1 << 20
"""Bytes read at a time, and therefore how often cancellation is noticed."""

REQUEST_TIMEOUT = httpx.Timeout(connect=30.0, read=60.0, write=60.0, pool=30.0)
"""Timeouts for a wheel request.

The read timeout bounds a single silent socket rather than the whole transfer,
so a two and a half gigabyte wheel may take as long as the connection needs.
"""


class RuntimeInstallError(RuntimeError):
    """Base for every failure this module reports.

    Attributes:
        code: Stable reason code that the user interface translates.
    """

    code: str = "runtime.install_failed"

    def __init__(self, message: str = "", code: str | None = None) -> None:
        """Create the error.

        Args:
            message: English description, for logs. Never shown to the user.
            code: Reason code to carry instead of the class default.
        """
        super().__init__(message)
        if code is not None:
            self.code = code


class UnsupportedTargetError(RuntimeInstallError):
    """Raised when no pinned wheel set exists for this platform and interpreter."""

    code = "runtime.unsupported_platform"


class UnknownVariantError(RuntimeInstallError):
    """Raised when the requested build is not one this target offers."""

    code = "runtime.unknown_variant"


class AlreadyInstallingError(RuntimeInstallError):
    """Raised when an install is asked for while one is already running."""

    code = "runtime.already_installing"


class AlreadyInstalledError(RuntimeInstallError):
    """Raised when an install is asked for and one is already in place."""

    code = "runtime.already_installed"


class NotInstalledError(RuntimeInstallError):
    """Raised when removal is asked for and there is nothing to remove."""

    code = "runtime.not_installed"


class BusyInstallingError(RuntimeInstallError):
    """Raised when removal is asked for while an install is running."""

    code = "runtime.busy_installing"


class DownloadsDisabledError(RuntimeInstallError):
    """Raised when downloads are turned off in settings."""

    code = "runtime.downloads_disabled"


class InsufficientSpaceError(RuntimeInstallError):
    """Raised when the target volume cannot hold the install."""

    code = "runtime.insufficient_space"


class DownloadRejectedError(RuntimeInstallError):
    """Raised when the index answers a wheel request with an error status."""

    code = "runtime.download_rejected"


class DownloadUnreachableError(RuntimeInstallError):
    """Raised when the index cannot be reached or the connection breaks."""

    code = "runtime.download_unreachable"


class DownloadIncompleteError(RuntimeInstallError):
    """Raised when a wheel body ends before the pinned number of bytes."""

    code = "runtime.download_incomplete"


class ChecksumMismatchError(RuntimeInstallError):
    """Raised when a wheel's digest is not the one pinned in the manifest."""

    code = "runtime.checksum_mismatch"


class UnsafeArchiveError(RuntimeInstallError):
    """Raised when a wheel names a member that would be written outside its tree."""

    code = "runtime.unsafe_archive"


class ExtractFailedError(RuntimeInstallError):
    """Raised when a wheel is not a readable zip, or a member cannot be written."""

    code = "runtime.extract_failed"


class WriteFailedError(RuntimeInstallError):
    """Raised when the runtime directory cannot be written, usually a full disk."""

    code = "runtime.write_failed"


class RemoveFailedError(RuntimeInstallError):
    """Raised when the installed runtime could not be deleted."""

    code = "runtime.remove_failed"


class _CancelledError(Exception):
    """Unwinds an install that the user asked to stop.

    Private, and never reported as a failure: a cancellation is an expected
    outcome, so it clears the error code rather than setting one.
    """


@dataclass(frozen=True, slots=True)
class InstalledRecord:
    """What a completed install wrote down about itself.

    Attributes:
        accelerator: The variant that was installed.
        torch_version: Version of torch it holds.
        cuda_version: CUDA version that build targets, or an empty string.
        target: Manifest key the wheels were chosen for. A runtime whose target
            is not this process's must not be imported: the wheels hold
            compiled extensions built for one interpreter ABI, and loading them
            into another does not fail politely.
        installed_bytes: Size the install reported at the time it finished.
    """

    accelerator: str
    torch_version: str
    cuda_version: str
    target: str
    installed_bytes: int


@dataclass(frozen=True, slots=True)
class InstallState:
    """What the installer is doing right now.

    Attributes:
        installing: True while a worker is running.
        phase: ``download``, ``extract``, ``publish``, or an empty string when
            nothing is running.
        progress: Fraction between 0.0 and 1.0, best effort.
        accelerator: Which variant is being installed, or an empty string.
        error: Reason code of the last failure, or an empty string. Cleared
            when an install starts, and left empty by a cancellation.
    """

    installing: bool = False
    phase: str = ""
    progress: float = 0.0
    accelerator: str = ""
    error: str = ""


@dataclass(slots=True)
class _Progress:
    """Mutable bookkeeping for the running install.

    Every field is read and written under the installer's lock.

    Attributes:
        cancel: Set to ask the worker to stop. Replaced on each start, so a
            cancellation cannot carry over into the next attempt.
        thread: The worker, or None when nothing has run yet.
        installing: True between claiming the slot and the worker finishing.
        phase: What the worker is doing.
        done_units: Work units finished. A unit is a byte, downloaded or
            written, which makes the bar proportional to the time it takes
            rather than to the number of packages.
        total_units: Work units the whole install amounts to.
        accelerator: The variant being installed.
        error: Reason code of the last failure, or an empty string.
    """

    cancel: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None
    installing: bool = False
    phase: str = ""
    done_units: int = 0
    total_units: int = 0
    accelerator: str = ""
    error: str = ""


def _default_client() -> httpx.Client:
    """Build the HTTP client used for real downloads.

    Returns:
        A client that follows redirects, because both indexes hand wheels off
        to a content delivery network.
    """
    return httpx.Client(timeout=REQUEST_TIMEOUT, follow_redirects=True)


def _safe_member(name: str) -> bool:
    """Report whether a zip member may be written inside the target directory.

    A wheel is an archive from the network, so its member names are input. A
    name that is absolute, that walks upwards, or that carries a Windows drive
    letter would write outside the tree this installer owns.

    Args:
        name: The member name as the archive declares it.

    Returns:
        True when the member is safe to extract.
    """
    if name == "" or name.startswith(("/", "\\")) or ":" in name:
        return False
    return all(part not in ("..", ".") for part in name.replace("\\", "/").split("/") if part != "")


class RuntimeInstaller:
    """Installs, reports on, and removes the GPU runtime.

    One instance is shared by every request, so all mutable state is guarded by
    a lock. Claiming the install slot and starting the worker happen inside that
    lock, which is what stops two rapid presses becoming two downloads of two
    and a half gigabytes each.
    """

    def __init__(
        self,
        settings: Settings | None = None,
        *,
        client_factory: Callable[[], httpx.Client] | None = None,
    ) -> None:
        """Create the installer.

        Args:
            settings: Configuration to read the data root and the download
                policy from. Defaults to the process wide settings.
            client_factory: Builds the HTTP client each install uses. Injected
                by tests, which must never reach the network and must never
                fetch two and a half gigabytes.
        """
        self._settings = settings if settings is not None else get_settings()
        self._client_factory = client_factory if client_factory is not None else _default_client
        self._lock = threading.RLock()
        self._state = _Progress()

    @property
    def root(self) -> Path:
        """The runtime directory, under whichever data root is in use.

        Read afresh every time rather than captured in the constructor, so that
        moving the data root moves this with it.

        Returns:
            The runtime directory, whether or not it exists.
        """
        return self._settings.data_root / RUNTIME_DIRNAME

    @property
    def site_dir(self) -> Path:
        """The directory of importable packages inside the runtime.

        Returns:
            The site directory, whether or not it exists.
        """
        return self.root / SITE_DIRNAME

    @property
    def record_path(self) -> Path:
        """Where a completed install records what it wrote.

        Returns:
            The record file's path.
        """
        return self.root / RECORD_NAME

    def record(self) -> InstalledRecord | None:
        """Read what is installed, if anything.

        Never raises. An unreadable or unrecognised record means there is no
        runtime this version can use, which is the same answer as none at all.

        Returns:
            The record, or None when nothing usable is installed.
        """
        try:
            raw = json.loads(self.record_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

        if not isinstance(raw, dict) or raw.get("version") != RECORD_VERSION:
            return None

        try:
            return InstalledRecord(
                accelerator=str(raw["accelerator"]),
                torch_version=str(raw["torch_version"]),
                cuda_version=str(raw["cuda_version"]),
                target=str(raw["target"]),
                installed_bytes=int(raw["installed_bytes"]),
            )
        except (KeyError, TypeError, ValueError):
            return None

    def state(self) -> InstallState:
        """Report what the installer is doing.

        Returns:
            The current install state.
        """
        with self._lock:
            total = self._state.total_units
            fraction = min(self._state.done_units / total, 1.0) if total > 0 else 0.0
            return InstallState(
                installing=self._state.installing,
                phase=self._state.phase,
                progress=fraction if self._state.installing else 0.0,
                accelerator=self._state.accelerator if self._state.installing else "",
                error=self._state.error,
            )

    def variants(self) -> tuple[Variant, ...]:
        """List the runtimes installable on this machine.

        Returns:
            The variants for this target, empty when it is not covered.
        """
        return variants_for()

    def used_bytes(self) -> int:
        """Return how much disk the installed runtime occupies.

        Returns:
            Bytes under the runtime directory, or zero when there is none.
        """
        return directory_size(self.root) if self.root.is_dir() else 0

    def free_bytes(self) -> tuple[int, int] | None:
        """Return the size and free space of the volume the runtime lands on.

        Returns:
            A ``(total, free)`` pair, or None when the volume cannot be read.
        """
        return volume_space(self.root)

    def plan(self, accelerator: str) -> Variant:
        """Return the variant an install of this kind would fetch.

        Args:
            accelerator: One of ``cuda``, ``mps`` or ``cpu``.

        Returns:
            The variant, with its wheels, sizes and licences.

        Raises:
            UnsupportedTargetError: This platform has no pinned wheel set.
            UnknownVariantError: The target offers no such build.
        """
        if not self.variants():
            raise UnsupportedTargetError(f"no pinned runtime for {target_key()}")

        variant = find_variant(accelerator)
        if variant is None:
            raise UnknownVariantError(f"{target_key()} has no {accelerator} build")
        return variant

    def start(self, accelerator: str) -> Variant:
        """Begin installing a runtime in the background.

        Returns as soon as the worker is running, so the caller can answer the
        request while gigabytes are still moving.

        Args:
            accelerator: One of ``cuda``, ``mps`` or ``cpu``.

        Returns:
            The variant being installed.

        Raises:
            UnsupportedTargetError: This platform has no pinned wheel set.
            UnknownVariantError: The target offers no such build.
            DownloadsDisabledError: Downloads are turned off in settings.
            AlreadyInstalledError: A runtime is already in place.
            AlreadyInstallingError: An install is already running.
            InsufficientSpaceError: The volume cannot hold the result.
        """
        variant = self.plan(accelerator)

        if not self._settings.allow_downloads:
            raise DownloadsDisabledError("runtime downloads are disabled")

        if self.record() is not None:
            raise AlreadyInstalledError("a runtime is already installed")

        space = self.free_bytes()
        if space is not None and space[1] < variant.required_bytes:
            raise InsufficientSpaceError(
                f"{space[1]} bytes free, {variant.required_bytes} needed",
            )

        with self._lock:
            if self._state.installing:
                raise AlreadyInstallingError("an install is already running")

            self._state.cancel = threading.Event()
            self._state.installing = True
            self._state.phase = "download"
            self._state.done_units = 0
            self._state.total_units = variant.download_bytes + variant.installed_bytes
            self._state.accelerator = variant.accelerator
            self._state.error = ""
            worker = threading.Thread(
                target=self._work,
                args=(variant, self._state),
                name=f"runtime-install-{variant.accelerator}",
                daemon=True,
            )
            self._state.thread = worker

        # Started outside the lock. The slot is already claimed, so a second
        # caller sees the conflict without waiting on the thread starting.
        worker.start()
        return variant

    def cancel(self) -> None:
        """Ask a running install to stop.

        Cancellation is cooperative: the worker notices between chunks and
        between archive members, then removes everything it had written, so a
        cancelled install leaves no gigabytes behind. Cancelling when nothing is
        running does nothing.
        """
        with self._lock:
            if not self._state.installing:
                return
            self._state.cancel.set()

        logger.info("cancelling the runtime install")

    def wait(self, timeout: float | None = None) -> bool:
        """Block until the install has finished.

        Args:
            timeout: Seconds to wait. None waits indefinitely.

        Returns:
            True when no install is running any more.
        """
        with self._lock:
            worker = self._state.thread

        if worker is None:
            return True

        worker.join(timeout)
        return not worker.is_alive()

    def remove(self) -> None:
        """Delete the installed runtime.

        Several gigabytes in a folder the user chose have to be reclaimable, so
        this removes the whole runtime directory, staging and partial files
        included. The record is unlinked first: if the tree deletion then fails
        part way, what is left reads as not installed rather than as a runtime
        that will not import.

        Raises:
            BusyInstallingError: An install is running.
            NotInstalledError: There is nothing installed to remove.
            RemoveFailedError: The directory could not be deleted.
        """
        with self._lock:
            if self._state.installing:
                raise BusyInstallingError("an install is running")

        if self.record() is None and not self.root.exists():
            raise NotInstalledError("no runtime is installed")

        try:
            self.record_path.unlink(missing_ok=True)
            shutil.rmtree(self.root, ignore_errors=False)
        except OSError as error:
            raise RemoveFailedError(f"cannot remove {self.root}") from error

        logger.info("removed the runtime at %s", self.root)

    def _work(self, variant: Variant, state: _Progress) -> None:
        """Run one install and record how it ended.

        Args:
            variant: The runtime being installed.
            state: The bookkeeping slot claimed for it.
        """
        code = ""
        try:
            self._install(variant, state)
            logger.info("installed the %s runtime at %s", variant.accelerator, self.root)
        except _CancelledError:
            logger.info("runtime install cancelled, nothing was left behind")
        except RuntimeInstallError as error:
            code = error.code
            logger.warning("runtime install failed: %s (%s)", error.code, error)
        # A worker thread must never die with an untranslated exception, or the
        # interface would report an install running for ever.
        except Exception:
            code = RuntimeInstallError.code
            logger.exception("unexpected failure installing the runtime")

        with self._lock:
            state.installing = False
            state.phase = ""
            state.done_units = 0
            state.error = code

    def _install(self, variant: Variant, state: _Progress) -> None:
        """Fetch and unpack a runtime, leaving nothing behind on failure.

        Args:
            variant: The runtime being installed.
            state: The bookkeeping slot claimed for it.

        Raises:
            WriteFailedError: The working directories could not be prepared.
        """
        staging = self.root / STAGING_DIRNAME
        partial = self.root / PARTIAL_DIRNAME

        try:
            # Anything left by a process that was killed mid install. Resuming
            # would need a validated range request per wheel, and the pinned
            # digests make a fresh fetch the simpler correct answer.
            for stale in (staging, partial):
                shutil.rmtree(stale, ignore_errors=True)
            (staging / SITE_DIRNAME).mkdir(parents=True, exist_ok=True)
            partial.mkdir(parents=True, exist_ok=True)
        except OSError as error:
            raise WriteFailedError(f"cannot prepare {self.root}") from error

        try:
            for wheel in variant.wheels:
                archive = partial / f"{wheel.name}-{wheel.version}.whl"
                self._fetch(wheel.url, wheel.sha256, wheel.size_bytes, archive, state)
                self._unpack(archive, staging / SITE_DIRNAME, state)
                # Deleted as soon as it is unpacked, so the peak disk usage is
                # the tree plus one wheel rather than the tree plus all of them.
                archive.unlink(missing_ok=True)

            self._publish(variant, staging / SITE_DIRNAME, state)
        finally:
            # Covers every unhappy path, cancellation included. A published
            # install has already been renamed away, so this removes nothing.
            shutil.rmtree(staging, ignore_errors=True)
            shutil.rmtree(partial, ignore_errors=True)

    def _fetch(
        self,
        url: str,
        digest: str,
        expected: int,
        destination: Path,
        state: _Progress,
    ) -> None:
        """Download one wheel and check it against its pinned digest.

        Args:
            url: Absolute URL of the wheel.
            digest: Hex sha256 the file must have.
            expected: Size the manifest pinned, in bytes.
            destination: File to write.
            state: The bookkeeping slot, for progress and cancellation.

        Raises:
            DownloadRejectedError: The index answered with an error status.
            DownloadUnreachableError: The index could not be reached.
            DownloadIncompleteError: The body was not the pinned length.
            ChecksumMismatchError: The bytes are not the pinned ones.
            WriteFailedError: The file could not be written.
        """
        self._phase(state, "download")
        logger.info("fetching %s", url)

        # Identity encoding keeps the bytes on the wire the bytes that are
        # hashed, which is what makes the length check meaningful.
        headers = {"accept-encoding": "identity"}
        hasher = hashlib.sha256()
        received = 0

        try:
            with (
                self._client_factory() as client,
                client.stream("GET", url, headers=headers) as response,
            ):
                if response.is_error:
                    raise DownloadRejectedError(f"{url} returned HTTP {response.status_code}")

                with destination.open("wb") as handle:
                    for chunk in response.iter_bytes(CHUNK_SIZE):
                        self._check_cancelled(state)
                        handle.write(chunk)
                        hasher.update(chunk)
                        received += len(chunk)
                        self._advance(state, len(chunk))
        except httpx.HTTPError as error:
            raise DownloadUnreachableError(f"cannot reach {url}") from error
        except OSError as error:
            raise WriteFailedError(f"cannot write {destination}") from error

        if received != expected:
            raise DownloadIncompleteError(f"{url} sent {received} of {expected} bytes")

        if hasher.hexdigest() != digest:
            raise ChecksumMismatchError(f"{url} does not match its pinned digest")

    def _unpack(self, archive: Path, destination: Path, state: _Progress) -> None:
        """Extract one wheel into the staging tree.

        Args:
            archive: The downloaded wheel.
            destination: The site directory being assembled.
            state: The bookkeeping slot, for progress and cancellation.

        Raises:
            UnsafeArchiveError: A member would be written outside the tree.
            ExtractFailedError: The wheel is not a readable zip, or a member
                could not be written.
        """
        self._phase(state, "extract")

        try:
            with zipfile.ZipFile(archive) as bundle:
                members = bundle.infolist()
                for member in members:
                    if not _safe_member(member.filename):
                        raise UnsafeArchiveError(f"{archive.name} names {member.filename!r}")

                for member in members:
                    self._check_cancelled(state)
                    bundle.extract(member, destination)
                    self._advance(state, member.file_size)
        except UnsafeArchiveError:
            raise
        except (zipfile.BadZipFile, OSError) as error:
            raise ExtractFailedError(f"cannot unpack {archive.name}") from error

    def _publish(self, variant: Variant, staged: Path, state: _Progress) -> None:
        """Move a finished tree into place and record what it is.

        The record is written last and is what "installed" means, so a failure
        anywhere before this point leaves a runtime that reads as absent rather
        than as one that is present and will not import.

        Args:
            variant: The runtime that was installed.
            staged: The assembled site directory.
            state: The bookkeeping slot, for cancellation.

        Raises:
            WriteFailedError: The move or the record could not be written.
        """
        self._phase(state, "publish")
        self._check_cancelled(state)

        try:
            # An earlier tree can only be here if a previous publish was
            # interrupted, since an install refuses to start over a record.
            shutil.rmtree(self.site_dir, ignore_errors=True)
            staged.replace(self.site_dir)

            payload = {
                "version": RECORD_VERSION,
                "accelerator": variant.accelerator,
                "torch_version": variant.torch_version,
                "cuda_version": variant.cuda_version,
                "target": target_key(),
                "installed_bytes": variant.installed_bytes,
            }
            self.record_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        except OSError as error:
            # A tree without a record is a tree nothing will import, but it is
            # still gigabytes, so it goes rather than lingering invisibly.
            with contextlib.suppress(OSError):
                shutil.rmtree(self.site_dir, ignore_errors=True)
            raise WriteFailedError(f"cannot publish into {self.root}") from error

    def _phase(self, state: _Progress, phase: str) -> None:
        """Record what the worker is doing now.

        Args:
            state: The bookkeeping slot being updated.
            phase: The phase name.
        """
        with self._lock:
            state.phase = phase

    def _advance(self, state: _Progress, units: int) -> None:
        """Record that some work was finished.

        Args:
            state: The bookkeeping slot being updated.
            units: Bytes downloaded or written.
        """
        with self._lock:
            state.done_units += units

    def _check_cancelled(self, state: _Progress) -> None:
        """Stop the worker if the user asked it to stop.

        Args:
            state: The bookkeeping slot being read.

        Raises:
            _CancelledError: A cancellation was requested.
        """
        if state.cancel.is_set():
            raise _CancelledError
