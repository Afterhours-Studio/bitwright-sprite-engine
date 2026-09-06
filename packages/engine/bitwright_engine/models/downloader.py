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

"""Model download and local cache management.

Downloads land in the per-user cache directory, never in the repository or the
application bundle. Nothing is fetched unless it was asked for by identifier:
there is no crawl of a repository and no speculative prefetch, because the user
has to be shown the licence of a specific model before its weights arrive. See
MODELS.md.

A transfer runs on its own daemon thread so that the event loop stays free
while gigabytes move. Bytes are written to a partial file that lives outside
the model directory, and only the final rename publishes the model, so an
interrupted download can never be mistaken for a cached one.

A partial file is kept whenever keeping it is worth something. Four gigabytes
that arrived before the connection dropped are four gigabytes nobody should
have to fetch twice, so a recoverable failure - a dropped socket, a body that
ended early, the process being shut down, or an explicit pause - leaves the
partial and a ``.resume`` record beside it, and the next attempt continues from
that offset. Everything else discards both: an explicit stop, a rejection from
the host, a range the host refuses, and a failure to write, where the disk is
the thing that broke.

Continuing is only ever done when the host agrees the bytes belong together.
The record stores the URL and the validator the host gave for the file, and the
next request carries ``Range`` together with ``If-Range``; a 200 rather than a
206 means the file changed, and whatever is on disk is thrown away. Splicing
the head of one file onto the tail of another produces a file that passes every
length check and is silently wrong, which is the failure this guards against.

There is no stored "paused" flag. A model is paused exactly when a partial with
a usable record is on disk and no worker is running for it, which is a fact
about the filesystem rather than a fact somebody has to remember to write down.
A flag would have to be cleared on every exit path, including the ones taken by
a process that is being killed, and a flag that survives the file it describes
is worse than no flag at all.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from bitwright_engine.config import Settings, get_settings
from bitwright_engine.models.registry import ModelEntry, get
from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)

MODEL_HOST = "https://huggingface.co"
"""Host that serves every repository named in the registry."""

"""Name the weights take inside the model directory.

Taken from the registry entry rather than fixed here. Guessing one name for
every repository is what made every download fail: no repository holds a file
called `model.safetensors`, so the host answered 404 and the interface reported
that the file had moved. One consolidated file per entry is still the
assumption; a model that needs several should record them in the registry
rather than have this module guess.
"""

PARTIAL_DIRNAME = ".partial"
"""Directory inside the cache that holds half written downloads.

It sits beside the model directories rather than inside them, so that a partial
file never makes :meth:`ModelDownloader.status` report a model as cached.
"""

PARTIAL_SUFFIX = ".part"
"""Extension given to a download that is still in flight."""

RESUME_SUFFIX = ".resume"
"""Extension of the record that says what a partial file is part of.

Written beside the partial and removed with it, never independently. A partial
with no record cannot be proved to belong to the file being fetched, so it is
discarded and the download starts again; a record with no partial is litter.
"""

CHUNK_SIZE = 1 << 20
"""Bytes read at a time, and therefore how often a stop is noticed."""

BYTES_PER_MB = 1 << 20
"""Divisor used to turn the registry's megabyte estimate into bytes."""

ESTIMATED_PROGRESS_CEILING = 0.99
"""Highest progress reported while the total size is only an estimate.

A download whose size is guessed must never claim to be finished, because the
interface would show a completed bar for a model that is still arriving.
"""

RANGE_NOT_SATISFIABLE = 416
"""Status meaning the offset asked for is past the end of the file.

Answered when a partial has grown longer than the file the host now serves.
Asking again would put the same impossible question for ever, so the partial is
thrown away instead of retried.
"""

PARTIAL_CONTENT = 206
"""Status confirming the host is continuing from the offset that was asked for.

Anything else, a plain 200 in particular, means the host is sending the file
from its beginning, and whatever is already on disk must not be appended to.
"""

SHUTDOWN_GRACE_S = 5.0
"""How long a shutdown waits for each transfer to put its bytes down.

Long enough for a worker to notice between chunks and close its file, short
enough that the sidecar still exits promptly. Waiting is what makes the bytes
on disk resumable, rather than a file of unknown length left by a process that
was killed part way through a write.
"""

REQUEST_TIMEOUT = httpx.Timeout(connect=30.0, read=60.0, write=60.0, pool=30.0)
"""Timeouts for a weights request.

The read timeout bounds a single silent socket, not the whole transfer, so a
multi gigabyte download is free to take as long as the connection needs.
"""


class DownloadError(RuntimeError):
    """Raised when a model cannot be fetched or verified.

    Attributes:
        code: Stable reason code that the user interface translates.
    """

    code: str = "models.download_failed"

    def __init__(self, message: str = "", code: str | None = None) -> None:
        """Create the error.

        Args:
            message: English description, for logs. Never shown to the user.
            code: Reason code to carry instead of the class default. Used when
                a failure is reported second hand, such as by a worker thread.
        """
        super().__init__(message)
        if code is not None:
            self.code = code


class DownloadsDisabledError(DownloadError):
    """Raised when a model is missing and downloads are turned off."""

    code = "models.downloads_disabled"


class AlreadyDownloadingError(DownloadError):
    """Raised when a download is asked for while one is already in flight."""

    code = "models.already_downloading"


class DownloadRejectedError(DownloadError):
    """Raised when the host answers a weights request with an error status."""

    code = "models.download_rejected"


class DownloadUnreachableError(DownloadError):
    """Raised when the host cannot be reached or the connection breaks."""

    code = "models.download_unreachable"


class DownloadIncompleteError(DownloadError):
    """Raised when the body ends before the announced number of bytes."""

    code = "models.download_incomplete"


class DownloadWriteFailedError(DownloadError):
    """Raised when the cache cannot be written, usually a full disk."""

    code = "models.download_write_failed"


class DownloadRangeRefusedError(DownloadError):
    """Raised when the host refuses to continue from the offset on disk.

    A 416 says the bytes already here reach past the end of the file the host
    is serving, which no number of retries will change. The partial is
    discarded with the failure, so downloading again starts cleanly.
    """

    code = "models.download_range_refused"


class _CancelledError(Exception):
    """Unwinds a transfer that the user asked to stop and throw away.

    Private, and never reported as a failure: a cancellation is an expected
    outcome, so it clears the error code rather than setting one.
    """


class _PausedError(Exception):
    """Unwinds a transfer that the user asked to stop but keep.

    Private, and never reported as a failure. It is the unwind that must not
    reach the discard path: the bytes already written are the whole point of
    pausing rather than stopping.
    """


@dataclass(frozen=True, slots=True)
class ResumeRecord:
    """What a partial file on disk is part of.

    Written beside the partial while bytes are arriving, so that a process
    which never gets to run any cleanup still leaves enough behind for the next
    one to continue safely.

    Attributes:
        url: The URL the bytes came from. A partial whose record names a
            different URL belongs to a different file and is discarded before
            the request goes out.
        validator: The ``ETag`` or ``Last-Modified`` the host gave for that
            file, replayed as ``If-Range``. Empty is not written: without a
            validator the host cannot be asked to prove the file is unchanged,
            so there is nothing safe to continue from.
        total: Full length of the file in bytes, or 0 when the host never
            announced one. Lets a paused model report how far it got without a
            worker having to be running.
    """

    url: str
    validator: str
    total: int


@dataclass(frozen=True, slots=True)
class CacheStatus:
    """Whether a model is present locally, and what its download is doing.

    A model that is neither cached nor downloading may still have bytes on
    disk. That is the paused state, and it is derived rather than stored: it is
    ``resumable`` being true, which means a partial file and a usable record
    are both present and no worker is running.

    Attributes:
        model_id: Registry identifier.
        cached: True when the model directory exists and is not empty.
        path: Where the model lives, or would live.
        size_mb: Approximate download size, from the registry.
        downloading: True while a transfer for this model is in flight.
        progress: Fraction between 0.0 and 1.0, best effort. Reported for a
            paused model too, so a restarted application can draw the bar.
        downloaded_bytes: Bytes on disk for this model's transfer. Taken from
            the running worker while one is running, and from the partial file
            otherwise. 0 when nothing has arrived.
        total_bytes: Full length of the download in bytes when it is known, and
            0 when it is not. The registry's ``size_mb`` is an estimate and is
            deliberately not substituted here.
        resumable: True when a paused or interrupted transfer can be continued
            rather than started again.
        error: Reason code of the last failure, or an empty string. Cleared
            when a transfer starts, and left empty by a pause or a stop.
    """

    model_id: str
    cached: bool
    path: Path
    size_mb: int
    downloading: bool = False
    progress: float = 0.0
    downloaded_bytes: int = 0
    total_bytes: int = 0
    resumable: bool = False
    error: str = ""


@dataclass(slots=True)
class _DownloadState:
    """Mutable bookkeeping for one model's transfer.

    Every field is read and written under the downloader's lock.

    Attributes:
        cancel: Set to ask the worker to stop and discard. Replaced on each
            start, so that a stop cannot carry over into the next attempt.
        pause: Set to ask the worker to stop and keep what it has. Replaced on
            each start for the same reason.
        thread: The worker, or None when nothing has run yet.
        downloading: True between claiming the slot and the worker finishing.
        progress: Fraction between 0.0 and 1.0.
        received: Bytes on disk for this transfer, including any that were
            already there when it resumed.
        total: Full length in bytes when the host announced one, else 0.
        error: Reason code of the last failure, or an empty string.
    """

    cancel: threading.Event = field(default_factory=threading.Event)
    pause: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None
    downloading: bool = False
    progress: float = 0.0
    received: int = 0
    total: int = 0
    error: str = ""


def download_url(entry: ModelEntry) -> str:
    """Return the URL a model's weights are fetched from.

    An entry carrying an absolute URL is taken as it stands, which is how a
    model published somewhere other than the model host is reached. Otherwise
    the repository, the revision and the file name are joined: the revision is
    pinned by the registry rather than resolved at download time, so that two
    machines fetching the same entry get the same bytes.

    Args:
        entry: The registry entry to download.

    Returns:
        An absolute URL for that entry's weights file.
    """
    if entry.url != "":
        return entry.url
    return f"{MODEL_HOST}/{entry.repo}/resolve/{entry.revision}/{entry.filename}"


def weights_filename(entry: ModelEntry) -> str:
    """Return the name the weights take inside the model directory.

    Args:
        entry: The registry entry being downloaded.

    Returns:
        The entry's file name, or the last segment of its URL when it carries
        one instead.
    """
    if entry.filename != "":
        return entry.filename
    return download_url(entry).rsplit("/", 1)[-1]


def _default_client() -> httpx.Client:
    """Build the HTTP client used for real downloads.

    Returns:
        A client that follows redirects, since hosts hand weights off to a
        content delivery network.
    """
    return httpx.Client(timeout=REQUEST_TIMEOUT, follow_redirects=True)


def _declared_length(response: httpx.Response) -> int | None:
    """Return the body length the host announced, when it can be trusted.

    A compressed body is measured before decoding, so its ``Content-Length``
    does not describe the file that will be written and is ignored. On a
    partial response this describes the remainder being sent, not the whole
    file, which is why callers add the offset they resumed from.

    Args:
        response: The streaming response whose headers are being read.

    Returns:
        The announced byte count, or None when there is no usable one.
    """
    if "content-encoding" in response.headers:
        return None

    raw = response.headers.get("content-length")
    if raw is None:
        return None

    try:
        declared = int(raw)
    except ValueError:
        return None

    return declared if declared > 0 else None


def _validator(response: httpx.Response) -> str:
    """Return the token that proves a later request is fetching the same file.

    ``ETag`` is preferred because it identifies the exact representation.
    ``Last-Modified`` is the fallback that most static hosts do send, and is
    what ``If-Range`` was specified to accept when there is no entity tag.

    Args:
        response: The response the file is arriving in.

    Returns:
        The validator, or an empty string when the host offered neither. An
        empty validator means the transfer must not be recorded as resumable.
    """
    etag = str(response.headers.get("etag", "")).strip()
    if etag != "":
        return etag
    return str(response.headers.get("last-modified", "")).strip()


class ModelDownloader:
    """Downloads models into the local cache and reports their state.

    One instance is shared by every request, so all state is guarded by a lock.
    Claiming a model's download slot and starting its worker happen inside that
    lock, which is what stops two rapid clicks becoming two transfers.
    """

    def __init__(
        self,
        settings: Settings | None = None,
        *,
        client_factory: Callable[[], httpx.Client] | None = None,
    ) -> None:
        """Create the downloader.

        Args:
            settings: Configuration to read the cache directory and the
                download policy from. Defaults to the process wide settings.
            client_factory: Builds the HTTP client each transfer uses. Injected
                by tests, which must never reach the network.
        """
        self._settings = settings if settings is not None else get_settings()
        self._client_factory = client_factory if client_factory is not None else _default_client
        self._lock = threading.RLock()
        self._downloads: dict[str, _DownloadState] = {}

    @property
    def cache_dir(self) -> Path:
        """The directory that holds downloaded weights.

        Returns:
            The configured cache directory.
        """
        return self._settings.cache_dir

    def active(self) -> tuple[str, ...]:
        """List the models whose transfer is in flight right now.

        The cache directory is read afresh by every transfer, so moving it
        while bytes are landing would publish a download into one root and
        leave its partial file in another. Callers that change the location ask
        this first and refuse while anything is running.

        Returns:
            The identifiers currently downloading, sorted.
        """
        with self._lock:
            return tuple(
                sorted(model_id for model_id, state in self._downloads.items() if state.downloading)
            )

    def path_for(self, model_id: str) -> Path:
        """Return where a model lives in the cache.

        Args:
            model_id: Registry identifier.

        Returns:
            The model directory, whether or not it exists.

        Raises:
            KeyError: The identifier is not registered.
        """
        entry = get(model_id)
        return self.cache_dir / entry.kind.value / entry.model_id

    def status(self, model_id: str) -> CacheStatus:
        """Report whether a model is cached, and what its download is doing.

        Called with no worker running as often as with one, which is the case
        that matters after a restart: the bytes already on disk and the record
        beside them are read from the filesystem, so a paused download can be
        described by a process that has never downloaded anything.

        Args:
            model_id: Registry identifier.

        Returns:
            The cache and transfer status for that model.

        Raises:
            KeyError: The identifier is not registered.
        """
        entry = get(model_id)
        path = self.path_for(model_id)
        cached = path.is_dir() and any(path.iterdir())

        with self._lock:
            state = self._downloads.get(model_id)
            downloading = state.downloading if state is not None else False
            error = state.error if state is not None else ""
            live_received = state.received if state is not None and downloading else 0
            live_total = state.total if state is not None and downloading else 0
            live_progress = state.progress if state is not None and downloading else 0.0

        if downloading:
            return CacheStatus(
                model_id=entry.model_id,
                cached=cached,
                path=path,
                size_mb=entry.size_mb,
                downloading=True,
                progress=live_progress,
                downloaded_bytes=live_received,
                total_bytes=live_total,
                error=error,
            )

        held, record = self._on_disk(entry)
        # Resumable means the next request can carry a validated Range. Bytes
        # with no record, or a record naming another URL, cannot be proved to
        # belong to this file and are treated as absent rather than continued.
        resumable = held > 0 and record is not None and record.url == download_url(entry)
        total = record.total if record is not None and resumable else 0
        progress = min(held / total, 1.0) if resumable and total > 0 else 0.0

        return CacheStatus(
            model_id=entry.model_id,
            cached=cached,
            path=path,
            size_mb=entry.size_mb,
            downloading=False,
            progress=progress,
            downloaded_bytes=held if resumable else 0,
            total_bytes=total,
            resumable=resumable,
            error=error,
        )

    def start(self, model_id: str) -> bool:
        """Begin or continue downloading a model in the background.

        Returns as soon as the worker is running, so that the caller can answer
        the request while gigabytes are still moving. A model with a resumable
        partial on disk is continued from that offset rather than started
        again; there is no separate call for it, because whether bytes are
        already here is a fact about the disk and not about the request.

        Args:
            model_id: Registry identifier.

        Returns:
            True when a transfer was started, False when the model was already
            cached and nothing needed fetching.

        Raises:
            KeyError: The identifier is not registered.
            DownloadsDisabledError: Downloads are turned off in settings.
            AlreadyDownloadingError: A transfer for this model is in flight.
        """
        entry = get(model_id)
        if self.status(model_id).cached:
            return False

        if not self._settings.allow_downloads:
            raise DownloadsDisabledError(f"downloads are disabled: {entry.model_id}")

        with self._lock:
            state = self._downloads.setdefault(model_id, _DownloadState())
            if state.downloading:
                raise AlreadyDownloadingError(f"already downloading: {entry.model_id}")

            state.cancel = threading.Event()
            state.pause = threading.Event()
            state.downloading = True
            state.progress = 0.0
            state.received = 0
            state.total = 0
            state.error = ""
            worker = threading.Thread(
                target=self._work,
                args=(entry, state),
                name=f"model-download-{entry.model_id}",
                daemon=True,
            )
            state.thread = worker

        # Started outside the lock. The slot is already claimed, so a second
        # caller sees the conflict without waiting on the thread starting.
        worker.start()
        return True

    def cancel(self, model_id: str) -> None:
        """Ask a running download to stop, and throw away what it has.

        Stopping is cooperative: the worker notices between chunks and then
        removes its partial file and the record beside it, so nothing half
        written survives. Stopping a model that is not downloading still clears
        any partial left by an earlier attempt, which is what the interface's
        Discard does to a paused model.

        Args:
            model_id: Registry identifier.

        Raises:
            KeyError: The identifier is not registered.
        """
        entry = get(model_id)
        with self._lock:
            state = self._downloads.get(model_id)
            running = state is not None and state.downloading
            if state is not None:
                state.cancel.set()

        if running:
            logger.info("stopping the download of %s", entry.model_id)
            return

        # Nothing is running, so no worker will reach the discard path. The
        # bytes on disk are this call's responsibility.
        self._discard(self._partial_path(entry))
        logger.info("discarded the partial download of %s", entry.model_id)

    def pause(self, model_id: str) -> None:
        """Ask a running download to stop, and keep what it has.

        The worker notices between chunks, closes the file it was writing, and
        leaves it beside its record so the next start continues from there.
        Pausing a model that is not downloading does nothing: it is already in
        the state pausing produces.

        Args:
            model_id: Registry identifier.

        Raises:
            KeyError: The identifier is not registered.
        """
        entry = get(model_id)
        with self._lock:
            state = self._downloads.get(model_id)
            if state is None or not state.downloading:
                return
            state.pause.set()

        logger.info("pausing the download of %s", entry.model_id)

    def pause_all(self, timeout: float = SHUTDOWN_GRACE_S) -> tuple[str, ...]:
        """Pause every running transfer and wait for the bytes to be flushed.

        Called when the sidecar is shutting down. Racing the teardown loses the
        transfer: the socket dies as the process goes away, and without this
        the file left behind is whatever the operating system happened to have
        written. Asking each worker to stop and waiting for it to close its
        file is what makes the next launch able to continue.

        Args:
            timeout: Seconds to wait for each worker.

        Returns:
            The identifiers that were paused, sorted.
        """
        paused = self.active()
        for model_id in paused:
            self.pause(model_id)
        for model_id in paused:
            self.wait(model_id, timeout=timeout)
        return paused

    def wait(self, model_id: str, timeout: float | None = None) -> bool:
        """Block until a model's transfer has finished.

        Args:
            model_id: Registry identifier.
            timeout: Seconds to wait. None waits indefinitely.

        Returns:
            True when no transfer is running any more.

        Raises:
            KeyError: The identifier is not registered.
        """
        get(model_id)
        with self._lock:
            state = self._downloads.get(model_id)
            worker = state.thread if state is not None else None

        if worker is None:
            return True

        worker.join(timeout)
        return not worker.is_alive()

    def ensure(self, model_id: str) -> Path:
        """Return a model's path, downloading it if it is missing.

        This is the blocking path, for callers such as the pipeline that cannot
        proceed without the weights. Interactive callers use :meth:`start`.

        Args:
            model_id: Registry identifier.

        Returns:
            The path to the cached model.

        Raises:
            KeyError: The identifier is not registered.
            DownloadsDisabledError: The model is missing and downloads are off.
            DownloadError: The download did not produce a usable model.
        """
        entry = get(model_id)
        current = self.status(model_id)
        if current.cached:
            return current.path

        try:
            self.start(model_id)
        except AlreadyDownloadingError:
            logger.info("waiting for the download of %s already in flight", entry.model_id)

        self.wait(model_id)
        final = self.status(model_id)
        if final.cached:
            return final.path

        raise DownloadError(f"could not download {entry.model_id}", code=final.error or None)

    def license_notice(self, model_id: str) -> ModelEntry:
        """Return the registry entry to show before a download starts.

        The user must see the licence, and whether commercial use is permitted,
        before any weights are fetched.

        Args:
            model_id: Registry identifier.

        Returns:
            The registry entry for that model.

        Raises:
            KeyError: The identifier is not registered.
        """
        return get(model_id)

    def _partial_path(self, entry: ModelEntry) -> Path:
        """Return the file a transfer writes into before it is published.

        Args:
            entry: The registry entry being downloaded.

        Returns:
            A path inside the cache directory but outside any model directory.
        """
        name = f"{entry.kind.value}-{entry.model_id}{PARTIAL_SUFFIX}"
        return self.cache_dir / PARTIAL_DIRNAME / name

    def _resume_path(self, partial: Path) -> Path:
        """Return the record that describes a partial file.

        Args:
            partial: The partial file it belongs to.

        Returns:
            The record's path, beside the partial.
        """
        return partial.with_name(partial.name + RESUME_SUFFIX)

    def _read_resume(self, partial: Path) -> ResumeRecord | None:
        """Read the record beside a partial file.

        Args:
            partial: The partial file whose record is wanted.

        Returns:
            The record, or None when there is none or it cannot be read. A
            record that is corrupt is treated as absent rather than as an
            error: the worst that follows is a download starting again.
        """
        try:
            raw = json.loads(self._resume_path(partial).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

        if not isinstance(raw, dict):
            return None

        url = raw.get("url")
        validator = raw.get("validator")
        total = raw.get("total")
        if not isinstance(url, str) or not isinstance(validator, str) or not isinstance(total, int):
            return None
        if url == "" or validator == "":
            return None

        return ResumeRecord(url=url, validator=validator, total=max(total, 0))

    def _write_resume(self, partial: Path, record: ResumeRecord) -> None:
        """Write the record that lets a partial file be continued.

        Written once, as soon as the host's headers are known, rather than as
        the transfer ends: the process may not get to run anything at the end,
        and that is precisely the case resuming exists for.

        Args:
            partial: The partial file being written.
            record: What that file is part of.

        Raises:
            DownloadWriteFailedError: The record could not be written. It
                shares a disk with the download, so a failure here is the same
                failure the download is about to hit.
        """
        payload = {"url": record.url, "validator": record.validator, "total": record.total}
        try:
            self._resume_path(partial).write_text(json.dumps(payload), encoding="utf-8")
        except OSError as error:
            raise DownloadWriteFailedError(f"cannot write {self._resume_path(partial)}") from error

    def _discard(self, partial: Path) -> None:
        """Remove a partial file and its record together.

        The two are always removed as a pair. A record left behind would claim
        bytes that are not there, and bytes left behind with no record cannot
        be continued and would only be discarded later anyway.

        Args:
            partial: The partial file to remove.
        """
        for path in (partial, self._resume_path(partial)):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                # Removing leftovers is best effort. The next attempt reads the
                # pair again and starts over if it cannot use them, so failing
                # to delete must not turn into a download failure.
                logger.warning("could not remove %s", path)

    def _on_disk(self, entry: ModelEntry) -> tuple[int, ResumeRecord | None]:
        """Report what a model's interrupted transfer left behind.

        Args:
            entry: The registry entry being inspected.

        Returns:
            The size of the partial file, 0 when there is none, and the record
            beside it when there is one.
        """
        partial = self._partial_path(entry)
        try:
            held = partial.stat().st_size
        except OSError:
            return 0, None

        return held, self._read_resume(partial)

    def _work(self, entry: ModelEntry, state: _DownloadState) -> None:
        """Run one transfer and record how it ended.

        Args:
            entry: The registry entry being downloaded.
            state: The bookkeeping slot claimed for it.
        """
        code = ""
        try:
            self._transfer(entry, state)
            logger.info("downloaded %s", entry.model_id)
        except _CancelledError:
            logger.info("download of %s stopped, partial file removed", entry.model_id)
        except _PausedError:
            logger.info("download of %s paused, partial file kept", entry.model_id)
        except DownloadError as error:
            code = error.code
            logger.warning("download of %s failed: %s (%s)", entry.model_id, error.code, error)
        # A worker thread must never die with an untranslated exception, or the
        # model would be stuck reporting itself as downloading for ever.
        except Exception:
            code = DownloadError.code
            logger.exception("unexpected failure downloading %s", entry.model_id)

        with self._lock:
            state.downloading = False
            state.progress = 0.0
            state.received = 0
            state.total = 0
            state.error = code

    def _transfer(self, entry: ModelEntry, state: _DownloadState) -> None:
        """Fetch a model into the cache, keeping only what is worth keeping.

        The unwind is the whole design of this method. A pause, a dropped
        connection and a body that ended early all leave the partial and its
        record in place, because those bytes are correct as far as they go and
        the next attempt continues from them. A stop, a rejection, a refused
        range and a failure to write all remove both.

        Args:
            entry: The registry entry being downloaded.
            state: The bookkeeping slot claimed for it.

        Raises:
            DownloadWriteFailedError: The partial directory could not be made.
        """
        partial = self._partial_path(entry)
        try:
            partial.parent.mkdir(parents=True, exist_ok=True)
        except OSError as error:
            raise DownloadWriteFailedError(f"cannot prepare {partial}") from error

        try:
            self._stream(entry, state, partial)
        except (_PausedError, DownloadUnreachableError, DownloadIncompleteError):
            # Recoverable. Keep the bytes, unless none arrived at all, in which
            # case an empty file and a record for it are just litter.
            self._discard_if_empty(partial)
            raise
        except BaseException:
            self._discard(partial)
            raise

        try:
            self._publish(partial, self.path_for(entry.model_id), weights_filename(entry))
        except BaseException:
            # The file is complete but has nowhere to go, which means the cache
            # is unwritable. Keeping it would leave bytes no later attempt can
            # publish either.
            self._discard(partial)
            raise

        # Published by rename, so only the record is left to clear.
        self._discard(partial)

    def _discard_if_empty(self, partial: Path) -> None:
        """Remove a partial that has nothing in it, and keep one that has.

        Args:
            partial: The partial file to consider.
        """
        try:
            held = partial.stat().st_size
        except OSError:
            held = 0

        if held == 0:
            self._discard(partial)

    def _stream(self, entry: ModelEntry, state: _DownloadState, partial: Path) -> None:
        """Write the response body to the partial file, tracking progress.

        Continues from the bytes already on disk when the record beside them
        proves they belong to this URL and the host confirms the file has not
        changed since. Anything less certain starts from zero.

        Args:
            entry: The registry entry being downloaded.
            state: The bookkeeping slot claimed for it.
            partial: The file to write into.

        Raises:
            DownloadRejectedError: The host answered with an error status.
            DownloadRangeRefusedError: The host refused the offset asked for.
            DownloadUnreachableError: The host could not be reached.
            DownloadIncompleteError: The body ended early, or was empty.
            DownloadWriteFailedError: The partial file could not be written.
        """
        url = download_url(entry)
        offset, record = self._resume_from(entry, partial, url)

        # Identity encoding keeps Content-Length describing the bytes that are
        # written, which is what makes the completeness check meaningful.
        headers = {"accept-encoding": "identity"}
        if offset > 0 and record is not None:
            headers["range"] = f"bytes={offset}-"
            headers["if-range"] = record.validator
            logger.info("resuming %s from byte %d of %s", entry.model_id, offset, url)
        else:
            offset = 0
            logger.info("downloading %s from %s", entry.model_id, url)

        try:
            with (
                self._client_factory() as client,
                client.stream("GET", url, headers=headers) as response,
            ):
                if response.status_code == RANGE_NOT_SATISFIABLE:
                    raise DownloadRangeRefusedError(f"{url} refused a range from byte {offset}")
                if response.is_error:
                    raise DownloadRejectedError(f"{url} returned HTTP {response.status_code}")

                # A host that answers 200 to a conditional range is sending the
                # whole file because it is no longer the file on disk. Appending
                # would splice two representations into one plausible, wrong
                # file, so the offset is dropped and the write starts over.
                resuming = offset > 0 and response.status_code == PARTIAL_CONTENT
                if offset > 0 and not resuming:
                    logger.info("%s changed on the host, restarting %s", url, entry.model_id)
                start = offset if resuming else 0

                declared = _declared_length(response)
                total = start + declared if declared is not None else entry.size_mb * BYTES_PER_MB
                validator = _validator(response)
                if validator != "":
                    self._write_resume(
                        partial,
                        ResumeRecord(
                            url=url,
                            validator=validator,
                            total=start + declared if declared is not None else 0,
                        ),
                    )
                else:
                    # Nothing to prove the file with later, so make sure no
                    # stale record survives to claim these bytes are resumable.
                    self._resume_path(partial).unlink(missing_ok=True)

                received = start
                self._record(state, received, total, exact=declared is not None)

                with partial.open("ab" if resuming else "wb") as handle:
                    for chunk in response.iter_bytes(CHUNK_SIZE):
                        if state.cancel.is_set():
                            raise _CancelledError(entry.model_id)
                        if state.pause.is_set():
                            raise _PausedError(entry.model_id)
                        handle.write(chunk)
                        received += len(chunk)
                        self._record(state, received, total, exact=declared is not None)
                    # Paused or not, the bytes counted have to be the bytes a
                    # later Range request will ask to continue after.
                    handle.flush()

                if declared is not None and received != start + declared:
                    raise DownloadIncompleteError(
                        f"{url} sent {received - start} of {declared} bytes"
                    )
                if received == 0:
                    raise DownloadIncompleteError(f"{url} sent an empty body")
        except httpx.HTTPError as error:
            raise DownloadUnreachableError(f"cannot reach {url}") from error
        except OSError as error:
            raise DownloadWriteFailedError(f"cannot write {partial}") from error

    def _resume_from(
        self, entry: ModelEntry, partial: Path, url: str
    ) -> tuple[int, ResumeRecord | None]:
        """Return the byte to continue from, discarding what cannot be used.

        Args:
            entry: The registry entry being downloaded.
            partial: The partial file being considered.
            url: The URL about to be requested.

        Returns:
            The offset to ask the host to continue from with the record that
            justifies it, or ``(0, None)`` to start again. Bytes that cannot be
            continued are removed here rather than left to confuse the next
            attempt.
        """
        held, record = self._on_disk(entry)
        if held == 0:
            # A record with no bytes claims a transfer that is not there.
            self._discard(partial)
            return 0, None

        if record is None:
            logger.info("discarding %d unrecorded bytes for %s", held, entry.model_id)
            self._discard(partial)
            return 0, None

        if record.url != url:
            # The registry moved the entry, or its revision was repinned. These
            # bytes belong to a file nobody is asking for any more.
            logger.info("discarding bytes for %s left from %s", entry.model_id, record.url)
            self._discard(partial)
            return 0, None

        return held, record

    def _record(self, state: _DownloadState, received: int, total: int, *, exact: bool) -> None:
        """Store how far a transfer has got.

        Args:
            state: The bookkeeping slot being updated.
            received: Bytes written so far, counting any it resumed from.
            total: Expected total, either announced or estimated.
            exact: Whether ``total`` came from the host rather than from the
                registry's size estimate.
        """
        if total <= 0:
            return

        ceiling = 1.0 if exact else ESTIMATED_PROGRESS_CEILING
        with self._lock:
            state.received = received
            state.total = total if exact else 0
            state.progress = min(received / total, ceiling)

    def _publish(self, partial: Path, destination: Path, filename: str) -> None:
        """Move a finished download into its model directory.

        The directory is created empty and the file renamed into it, so the
        model reads as cached only once its weights are entirely there.

        Args:
            partial: The completed partial file.
            destination: The model directory to publish into.
            filename: The name the weights take inside that directory.

        Raises:
            DownloadWriteFailedError: The move could not be completed.
        """
        try:
            destination.mkdir(parents=True, exist_ok=True)
            partial.replace(destination / filename)
        except OSError as error:
            raise DownloadWriteFailedError(f"cannot publish into {destination}") from error
