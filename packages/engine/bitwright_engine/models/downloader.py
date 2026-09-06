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
"""

from __future__ import annotations

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

CHUNK_SIZE = 1 << 20
"""Bytes read at a time, and therefore how often cancellation is noticed."""

BYTES_PER_MB = 1 << 20
"""Divisor used to turn the registry's megabyte estimate into bytes."""

ESTIMATED_PROGRESS_CEILING = 0.99
"""Highest progress reported while the total size is only an estimate.

A download whose size is guessed must never claim to be finished, because the
interface would show a completed bar for a model that is still arriving.
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


class _CancelledError(Exception):
    """Unwinds a transfer that the user asked to stop.

    Private, and never reported as a failure: a cancellation is an expected
    outcome, so it clears the error code rather than setting one.
    """


@dataclass(frozen=True, slots=True)
class CacheStatus:
    """Whether a model is present locally, and what its download is doing.

    Attributes:
        model_id: Registry identifier.
        cached: True when the model directory exists and is not empty.
        path: Where the model lives, or would live.
        size_mb: Approximate download size, from the registry.
        downloading: True while a transfer for this model is in flight.
        progress: Fraction between 0.0 and 1.0, best effort. 0.0 when no
            transfer is running.
        error: Reason code of the last failure, or an empty string. Cleared
            when a transfer starts, and left empty by a cancellation.
    """

    model_id: str
    cached: bool
    path: Path
    size_mb: int
    downloading: bool = False
    progress: float = 0.0
    error: str = ""


@dataclass(slots=True)
class _DownloadState:
    """Mutable bookkeeping for one model's transfer.

    Every field is read and written under the downloader's lock.

    Attributes:
        cancel: Set to ask the worker to stop. Replaced on each start, so that
            a cancellation cannot carry over into the next attempt.
        thread: The worker, or None when nothing has run yet.
        downloading: True between claiming the slot and the worker finishing.
        progress: Fraction between 0.0 and 1.0.
        error: Reason code of the last failure, or an empty string.
    """

    cancel: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None
    downloading: bool = False
    progress: float = 0.0
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
    does not describe the file that will be written and is ignored.

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
            progress = state.progress if state is not None and state.downloading else 0.0
            error = state.error if state is not None else ""

        return CacheStatus(
            model_id=entry.model_id,
            cached=cached,
            path=path,
            size_mb=entry.size_mb,
            downloading=downloading,
            progress=progress,
            error=error,
        )

    def start(self, model_id: str) -> bool:
        """Begin downloading a model in the background.

        Returns as soon as the worker is running, so that the caller can answer
        the request while gigabytes are still moving.

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
            state.downloading = True
            state.progress = 0.0
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
        """Ask a running download to stop.

        Cancellation is cooperative: the worker notices between chunks and then
        removes its partial file, so nothing half written survives. Cancelling
        a model that is not downloading does nothing.

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
            state.cancel.set()

        logger.info("cancelling the download of %s", entry.model_id)

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
            logger.info("download of %s cancelled, partial file removed", entry.model_id)
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
            state.error = code

    def _transfer(self, entry: ModelEntry, state: _DownloadState) -> None:
        """Fetch a model into the cache, leaving nothing behind on failure.

        Args:
            entry: The registry entry being downloaded.
            state: The bookkeeping slot claimed for it.

        Raises:
            DownloadWriteFailedError: The partial file could not be prepared.
        """
        partial = self._partial_path(entry)
        try:
            partial.parent.mkdir(parents=True, exist_ok=True)
            # A leftover from a process that was killed mid transfer. Resuming
            # would need a validated range request, so it is simply discarded.
            partial.unlink(missing_ok=True)
        except OSError as error:
            raise DownloadWriteFailedError(f"cannot prepare {partial}") from error

        try:
            self._stream(entry, state, partial)
            self._publish(partial, self.path_for(entry.model_id), weights_filename(entry))
        finally:
            # Covers every unhappy path, cancellation included. A published
            # download has already been renamed away, so this removes nothing.
            partial.unlink(missing_ok=True)

    def _stream(self, entry: ModelEntry, state: _DownloadState, partial: Path) -> None:
        """Write the response body to the partial file, tracking progress.

        Args:
            entry: The registry entry being downloaded.
            state: The bookkeeping slot claimed for it.
            partial: The file to write into.

        Raises:
            DownloadRejectedError: The host answered with an error status.
            DownloadUnreachableError: The host could not be reached.
            DownloadIncompleteError: The body ended early, or was empty.
            DownloadWriteFailedError: The partial file could not be written.
        """
        url = download_url(entry)
        logger.info("downloading %s from %s", entry.model_id, url)

        # Identity encoding keeps Content-Length describing the bytes that are
        # written, which is what makes the completeness check meaningful.
        headers = {"accept-encoding": "identity"}

        try:
            with (
                self._client_factory() as client,
                client.stream("GET", url, headers=headers) as response,
            ):
                if response.is_error:
                    raise DownloadRejectedError(f"{url} returned HTTP {response.status_code}")

                declared = _declared_length(response)
                total = declared if declared is not None else entry.size_mb * BYTES_PER_MB
                received = 0

                with partial.open("wb") as handle:
                    for chunk in response.iter_bytes(CHUNK_SIZE):
                        if state.cancel.is_set():
                            raise _CancelledError(entry.model_id)
                        handle.write(chunk)
                        received += len(chunk)
                        self._record(state, received, total, exact=declared is not None)

                if declared is not None and received != declared:
                    raise DownloadIncompleteError(f"{url} sent {received} of {declared} bytes")
                if received == 0:
                    raise DownloadIncompleteError(f"{url} sent an empty body")
        except httpx.HTTPError as error:
            raise DownloadUnreachableError(f"cannot reach {url}") from error
        except OSError as error:
            raise DownloadWriteFailedError(f"cannot write {partial}") from error

    def _record(self, state: _DownloadState, received: int, total: int, *, exact: bool) -> None:
        """Store how far a transfer has got.

        Args:
            state: The bookkeeping slot being updated.
            received: Bytes written so far.
            total: Expected total, either announced or estimated.
            exact: Whether ``total`` came from the host rather than from the
                registry's size estimate.
        """
        if total <= 0:
            return

        ceiling = 1.0 if exact else ESTIMATED_PROGRESS_CEILING
        with self._lock:
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
