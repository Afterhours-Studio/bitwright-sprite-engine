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

"""Tests for the model registry and the downloader.

Nothing here touches the network. Every transfer is served by an injected
``httpx`` client backed by a mock transport, so the tests exercise the real
streaming, progress, pausing, stopping, resuming and cache handling code paths.

The mock host honours ``Range`` the way a real static host does, and the body
it serves is made of chunks that differ from each other. That is deliberate: a
resume that spliced the wrong bytes together would produce a file of exactly
the right length, so a body of identical chunks would let the bug through.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Callable, Iterator
from pathlib import Path

import httpx
import pytest

from bitwright_engine.config import Settings
from bitwright_engine.models import (
    REGISTRY,
    DownloadError,
    DownloadsDisabledError,
    ModelDownloader,
    ModelKind,
    get,
    list_models,
)
from bitwright_engine.models.downloader import (
    CHUNK_SIZE,
    PARTIAL_DIRNAME,
    PARTIAL_SUFFIX,
    RESUME_SUFFIX,
    AlreadyDownloadingError,
    download_url,
    weights_filename,
)

Handler = Callable[[httpx.Request], httpx.Response]

MODEL_ID = "rembg-u2net"
WEIGHTS = weights_filename(get(MODEL_ID))
"""The file that entry publishes, which is per entry rather than fixed."""
"""A small registry entry, used for every download test."""

ETAG = '"weights-v1"'
"""Validator the mock host offers, and the one a resume must replay."""

WAIT_S = 10.0
"""How long a test waits for a worker thread before giving up."""


def chunk(index: int) -> bytes:
    """Build one chunk of body, distinguishable from its neighbours.

    Args:
        index: Position of the chunk in the file.

    Returns:
        A chunk of :data:`CHUNK_SIZE` bytes, all the same letter, with a
        different letter per position.
    """
    return bytes((ord("a") + index % 26,)) * CHUNK_SIZE


def body(chunks: int) -> bytes:
    """Build the whole file the mock host serves.

    Args:
        chunks: How many chunks the file is made of.

    Returns:
        The complete body.
    """
    return b"".join(chunk(index) for index in range(chunks))


def serve(
    *,
    chunks: int = 3,
    status_code: int = 200,
    declared: int | None = -1,
    on_chunk: Callable[[int], None] | None = None,
    etag: str = ETAG,
    honour_range: bool = True,
    drop_at: int | None = None,
    seen: list[httpx.Request] | None = None,
) -> Handler:
    """Build a mock transport handler that streams a body.

    Args:
        chunks: How many chunks of the file to serve.
        status_code: Status to answer a whole-file request with.
        declared: Value for the ``Content-Length`` header. ``-1`` announces the
            true length of what is being sent, ``None`` sends no header at all,
            and any other number announces that number of bytes.
        on_chunk: Called with the chunk index before each chunk is yielded, so
            a test can observe or interfere with a transfer in flight.
        etag: Validator to offer. An empty string offers none, which is what
            makes a transfer unresumable.
        honour_range: Whether a ``Range`` request is answered with 206. False
            answers 200 with the whole file, which is what a host does when
            ``If-Range`` no longer matches because the file changed.
        drop_at: Chunk index at which the connection breaks, standing in for a
            socket that died part way through a multi gigabyte transfer.
        seen: Collects every request, so a test can assert on the headers a
            resume sent.

    Returns:
        A handler suitable for :class:`httpx.MockTransport`.
    """
    payload = body(chunks)

    def handle(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)

        headers: dict[str, str] = {}
        if etag != "":
            headers["etag"] = etag

        start = 0
        code = status_code
        wanted = request.headers.get("range")
        if wanted is not None and honour_range and status_code == 200:
            start = int(wanted.removeprefix("bytes=").partition("-")[0])
            if start >= len(payload):
                return httpx.Response(416, headers=headers)
            code = 206
            headers["content-range"] = f"bytes {start}-{len(payload) - 1}/{len(payload)}"

        sent = payload[start:]
        if declared is not None:
            headers["content-length"] = str(len(sent) if declared < 0 else declared)

        def stream() -> Iterator[bytes]:
            for offset in range(0, len(sent), CHUNK_SIZE):
                index = offset // CHUNK_SIZE
                if drop_at is not None and index == drop_at:
                    raise httpx.ReadError("the connection went away", request=request)
                if on_chunk is not None:
                    on_chunk(index)
                yield sent[offset : offset + CHUNK_SIZE]

        return httpx.Response(code, headers=headers, content=stream())

    return handle


def build(settings: Settings, handler: Handler, *, allow_downloads: bool = True) -> ModelDownloader:
    """Build a downloader whose HTTP client can only reach the mock transport.

    Args:
        settings: Base settings, whose cache directory is inside the test's own
            temporary directory.
        handler: The mock transport handler to serve requests with.
        allow_downloads: Value for the download policy setting.

    Returns:
        A downloader that never reaches the network.
    """
    return ModelDownloader(
        settings.model_copy(update={"allow_downloads": allow_downloads}),
        client_factory=lambda: httpx.Client(transport=httpx.MockTransport(handler)),
    )


def partial_path(downloader: ModelDownloader, model_id: str = MODEL_ID) -> Path:
    """Return where a model's half written file lives.

    Built from the published constants rather than by reaching into the
    downloader, so the test names the same contract the interface does.

    Args:
        downloader: The downloader whose cache is being inspected.
        model_id: Registry identifier.

    Returns:
        The partial file's path, whether or not it exists.
    """
    entry = get(model_id)
    name = f"{entry.kind.value}-{entry.model_id}{PARTIAL_SUFFIX}"
    return downloader.cache_dir / PARTIAL_DIRNAME / name


def record_path(downloader: ModelDownloader, model_id: str = MODEL_ID) -> Path:
    """Return where a model's resume record lives.

    Args:
        downloader: The downloader whose cache is being inspected.
        model_id: Registry identifier.

    Returns:
        The record's path, whether or not it exists.
    """
    target = partial_path(downloader, model_id)
    return target.with_name(target.name + RESUME_SUFFIX)


def stage_partial(
    downloader: ModelDownloader,
    *,
    held: int,
    total: int = 3 * CHUNK_SIZE,
    url: str | None = None,
    validator: str = ETAG,
    with_record: bool = True,
) -> Path:
    """Put a half finished download on disk, as a killed process would leave it.

    Args:
        downloader: The downloader whose cache is being seeded.
        held: How many bytes of the file are already here. They are the real
            leading bytes, so a resume that appends correctly produces the
            whole file and one that does not is caught.
        total: Full length to record for the file.
        url: URL to record the bytes against. Defaults to the entry's own.
        validator: Validator to record.
        with_record: False writes the bytes with no record beside them, which
            is the state a partial cannot be continued from.

    Returns:
        The partial file that was written.
    """
    target = partial_path(downloader)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body(total // CHUNK_SIZE + 1)[:held])

    if with_record:
        payload = {
            "url": url if url is not None else download_url(get(MODEL_ID)),
            "validator": validator,
            "total": total,
        }
        record_path(downloader).write_text(json.dumps(payload), encoding="utf-8")

    return target


def partials(downloader: ModelDownloader) -> list[Path]:
    """List every half written file left in the cache.

    Args:
        downloader: The downloader whose cache is inspected.

    Returns:
        Any partial files still on disk.
    """
    if not downloader.cache_dir.exists():
        return []
    return sorted(downloader.cache_dir.rglob(f"*{PARTIAL_SUFFIX}"))


def records(downloader: ModelDownloader) -> list[Path]:
    """List every resume record left in the cache.

    A record must never outlive the partial it describes, so tests assert on
    this alongside :func:`partials` rather than instead of it.

    Args:
        downloader: The downloader whose cache is inspected.

    Returns:
        Any resume records still on disk.
    """
    if not downloader.cache_dir.exists():
        return []
    return sorted(downloader.cache_dir.rglob(f"*{RESUME_SUFFIX}"))


def test_every_entry_declares_a_licence() -> None:
    for entry in REGISTRY.values():
        assert entry.license_id
        assert entry.license_url.startswith("https://")
        assert entry.size_mb > 0


def test_registry_keys_match_their_entries() -> None:
    for model_id, entry in REGISTRY.items():
        assert entry.model_id == model_id


def test_list_models_filters_by_kind() -> None:
    assert all(entry.kind is ModelKind.LORA for entry in list_models(ModelKind.LORA))
    assert len(list_models()) == len(REGISTRY)


def test_get_raises_for_an_unknown_model() -> None:
    with pytest.raises(KeyError, match="unknown model"):
        get("does-not-exist")


def test_download_url_pins_the_revision() -> None:
    entry = get(MODEL_ID)
    url = download_url(entry)
    assert url.startswith("https://")
    assert entry.repo in url
    assert f"/{entry.revision}/" in url


def test_status_reports_a_missing_model(settings: Settings) -> None:
    status = ModelDownloader(settings).status("sd15-base")
    assert status.cached is False
    assert status.path.name == "sd15-base"
    assert status.downloading is False
    assert status.progress == 0.0
    assert status.downloaded_bytes == 0
    assert status.total_bytes == 0
    assert status.resumable is False
    assert status.error == ""


def test_a_successful_download_marks_the_model_cached(settings: Settings) -> None:
    downloader = build(settings, serve(chunks=3))

    assert downloader.start(MODEL_ID) is True
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    status = downloader.status(MODEL_ID)
    assert status.cached is True
    assert status.downloading is False
    assert status.progress == 0.0
    assert status.resumable is False
    assert status.error == ""
    assert (status.path / WEIGHTS).read_bytes() == body(3)
    assert partials(downloader) == []
    assert records(downloader) == []


def test_a_rejected_download_records_a_code_and_leaves_nothing(settings: Settings) -> None:
    downloader = build(settings, serve(status_code=404))

    downloader.start(MODEL_ID)
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    status = downloader.status(MODEL_ID)
    assert status.error == "models.download_rejected"
    assert status.cached is False
    assert status.downloading is False
    assert status.path.exists() is False
    # A 4xx that is not 416 says these bytes lead nowhere, so they go.
    assert partials(downloader) == []
    assert records(downloader) == []


def test_a_rejection_discards_bytes_that_were_already_here(settings: Settings) -> None:
    downloader = build(settings, serve(status_code=403))
    stage_partial(downloader, held=CHUNK_SIZE)

    downloader.start(MODEL_ID)
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    assert downloader.status(MODEL_ID).error == "models.download_rejected"
    assert partials(downloader) == []
    assert records(downloader) == []


def test_an_unreachable_host_records_a_code(settings: Settings) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to host", request=request)

    downloader = build(settings, refuse)
    downloader.start(MODEL_ID)
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    status = downloader.status(MODEL_ID)
    assert status.error == "models.download_unreachable"
    assert status.cached is False
    # Nothing ever arrived, so there is nothing to keep. An empty partial and a
    # record for it would only be litter for the next attempt to clear.
    assert partials(downloader) == []
    assert records(downloader) == []


def test_a_dropped_connection_keeps_the_bytes_that_did_arrive(settings: Settings) -> None:
    # The case the user actually hits: gigabytes land, then the socket dies.
    # Throwing those bytes away is what made every retry start from zero.
    downloader = build(settings, serve(chunks=4, drop_at=2))

    downloader.start(MODEL_ID)
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    status = downloader.status(MODEL_ID)
    assert status.error == "models.download_unreachable"
    assert status.cached is False
    assert status.resumable is True
    assert status.downloaded_bytes == 2 * CHUNK_SIZE
    assert partial_path(downloader).read_bytes() == body(2)
    assert record_path(downloader).exists() is True


def test_a_truncated_body_is_kept_for_resuming(settings: Settings) -> None:
    # The host announces more than it sends, which is what a connection dropped
    # mid transfer looks like. The bytes that did arrive must not be published,
    # and must not be deleted either: the next attempt continues from them.
    downloader = build(settings, serve(chunks=2, declared=3 * CHUNK_SIZE))

    downloader.start(MODEL_ID)
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    status = downloader.status(MODEL_ID)
    assert status.error == "models.download_incomplete"
    assert status.cached is False
    assert status.path.exists() is False
    assert status.resumable is True
    assert status.downloaded_bytes == 2 * CHUNK_SIZE
    assert partial_path(downloader).read_bytes() == body(2)


def test_a_cache_that_cannot_be_written_reports_a_code(settings: Settings) -> None:
    downloader = build(settings, serve(chunks=1))
    # Occupy the kind directory with a file, so publishing the model directory
    # fails the way a full or read only disk would.
    blocker = downloader.path_for(MODEL_ID).parent
    blocker.parent.mkdir(parents=True, exist_ok=True)
    blocker.write_bytes(b"not a directory")

    downloader.start(MODEL_ID)
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    status = downloader.status(MODEL_ID)
    assert status.error == "models.download_write_failed"
    assert status.cached is False
    # The disk is what failed. A complete file that can never be published
    # helps nobody, so it goes rather than sitting there for ever.
    assert partials(downloader) == []
    assert records(downloader) == []


def test_stopping_removes_the_partial_file_and_its_record(settings: Settings) -> None:
    downloader: ModelDownloader | None = None

    def interrupt(index: int) -> None:
        assert downloader is not None
        if index == 1:
            downloader.cancel(MODEL_ID)

    downloader = build(settings, serve(chunks=4, on_chunk=interrupt))
    downloader.start(MODEL_ID)
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    status = downloader.status(MODEL_ID)
    assert status.cached is False
    assert status.downloading is False
    assert status.progress == 0.0
    assert status.resumable is False
    assert status.downloaded_bytes == 0
    # Stopping is what the user asked for, not a failure to report.
    assert status.error == ""
    assert status.path.exists() is False
    assert partials(downloader) == []
    assert records(downloader) == []


def test_pausing_keeps_the_partial_file_and_its_record(settings: Settings) -> None:
    downloader: ModelDownloader | None = None

    def interrupt(index: int) -> None:
        assert downloader is not None
        if index == 1:
            downloader.pause(MODEL_ID)

    downloader = build(settings, serve(chunks=4, on_chunk=interrupt))
    downloader.start(MODEL_ID)
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    status = downloader.status(MODEL_ID)
    assert status.cached is False
    assert status.downloading is False
    # Pausing is what the user asked for, so it is not a failure either.
    assert status.error == ""
    assert partial_path(downloader).read_bytes() == body(1)
    assert record_path(downloader).exists() is True


def test_a_paused_model_reports_its_bytes_with_no_worker_running(settings: Settings) -> None:
    # Exactly the state a restarted application finds: bytes on disk, a record
    # beside them, and a downloader that has never run a transfer.
    downloader = build(settings, serve(chunks=3))
    stage_partial(downloader, held=2 * CHUNK_SIZE, total=3 * CHUNK_SIZE)

    status = downloader.status(MODEL_ID)
    assert status.downloading is False
    assert status.cached is False
    assert status.resumable is True
    assert status.downloaded_bytes == 2 * CHUNK_SIZE
    assert status.total_bytes == 3 * CHUNK_SIZE
    assert status.progress == pytest.approx(2 / 3)
    assert status.error == ""


def test_resuming_asks_for_the_bytes_it_does_not_have(settings: Settings) -> None:
    seen: list[httpx.Request] = []
    downloader = build(settings, serve(chunks=3, seen=seen))
    stage_partial(downloader, held=CHUNK_SIZE, total=3 * CHUNK_SIZE)

    assert downloader.start(MODEL_ID) is True
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    assert len(seen) == 1
    assert seen[0].headers["range"] == f"bytes={CHUNK_SIZE}-"
    # Without If-Range the host would happily continue a file that has since
    # changed, and the two halves would splice into a plausible, wrong file.
    assert seen[0].headers["if-range"] == ETAG

    status = downloader.status(MODEL_ID)
    assert status.cached is True
    assert (status.path / WEIGHTS).read_bytes() == body(3)
    assert partials(downloader) == []
    assert records(downloader) == []


def test_pausing_and_resuming_twice_still_lands_the_whole_file(settings: Settings) -> None:
    # Three separate downloaders against one cache directory, because that is
    # what pausing, closing the application and reopening it actually looks
    # like: the bytes carry the state, not the process.
    holder: dict[str, ModelDownloader] = {}

    def pause_after_one(index: int) -> None:
        if index == 1:
            holder["downloader"].pause(MODEL_ID)

    for _ in range(2):
        stage = build(settings, serve(chunks=4, on_chunk=pause_after_one))
        holder["downloader"] = stage
        assert stage.start(MODEL_ID) is True
        assert stage.wait(MODEL_ID, timeout=WAIT_S) is True
        assert stage.status(MODEL_ID).resumable is True

    assert partial_path(build(settings, serve())).stat().st_size == 2 * CHUNK_SIZE

    final = build(settings, serve(chunks=4))
    assert final.start(MODEL_ID) is True
    assert final.wait(MODEL_ID, timeout=WAIT_S) is True

    status = final.status(MODEL_ID)
    assert status.cached is True
    assert (status.path / WEIGHTS).read_bytes() == body(4)
    assert partials(final) == []
    assert records(final) == []


def test_a_partial_recorded_against_another_url_is_discarded(settings: Settings) -> None:
    seen: list[httpx.Request] = []
    downloader = build(settings, serve(chunks=2, seen=seen))
    stage_partial(downloader, held=CHUNK_SIZE, url="https://example.invalid/other.safetensors")

    assert downloader.status(MODEL_ID).resumable is False

    downloader.start(MODEL_ID)
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    # The bytes went before the request, so no range was ever asked for.
    assert "range" not in seen[0].headers
    assert (downloader.path_for(MODEL_ID) / WEIGHTS).read_bytes() == body(2)


def test_a_partial_with_no_record_is_discarded(settings: Settings) -> None:
    seen: list[httpx.Request] = []
    downloader = build(settings, serve(chunks=2, seen=seen))
    stage_partial(downloader, held=CHUNK_SIZE, with_record=False)

    assert downloader.status(MODEL_ID).resumable is False

    downloader.start(MODEL_ID)
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    assert "range" not in seen[0].headers
    assert (downloader.path_for(MODEL_ID) / WEIGHTS).read_bytes() == body(2)


def test_a_host_that_answers_200_to_a_range_starts_the_file_again(settings: Settings) -> None:
    # If-Range no longer matches, so the host sends the whole file. Appending it
    # to what is here would produce a file of the wrong length made of two
    # different representations, so the bytes on disk are dropped instead.
    downloader = build(settings, serve(chunks=2, honour_range=False))
    stage_partial(downloader, held=CHUNK_SIZE)

    downloader.start(MODEL_ID)
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    status = downloader.status(MODEL_ID)
    assert status.cached is True
    assert (status.path / WEIGHTS).read_bytes() == body(2)


def test_a_refused_range_discards_the_partial(settings: Settings) -> None:
    # The partial reaches past the end of the file the host now serves. Asking
    # again would put the same impossible question for ever.
    downloader = build(settings, serve(chunks=2))
    stage_partial(downloader, held=4 * CHUNK_SIZE, total=4 * CHUNK_SIZE)

    downloader.start(MODEL_ID)
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    status = downloader.status(MODEL_ID)
    assert status.error == "models.download_range_refused"
    assert status.cached is False
    assert status.resumable is False
    assert partials(downloader) == []
    assert records(downloader) == []


def test_a_host_that_offers_no_validator_leaves_nothing_resumable(settings: Settings) -> None:
    # Without an ETag or a Last-Modified there is nothing to replay as
    # If-Range, so the bytes are kept but must not claim to be continuable.
    downloader = build(settings, serve(chunks=4, etag="", drop_at=2))

    downloader.start(MODEL_ID)
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    status = downloader.status(MODEL_ID)
    assert status.error == "models.download_unreachable"
    assert status.resumable is False
    assert status.downloaded_bytes == 0
    assert records(downloader) == []


def test_discarding_a_paused_model_removes_its_bytes(settings: Settings) -> None:
    downloader = build(settings, serve(chunks=3))
    stage_partial(downloader, held=2 * CHUNK_SIZE)
    assert downloader.status(MODEL_ID).resumable is True

    downloader.cancel(MODEL_ID)

    status = downloader.status(MODEL_ID)
    assert status.resumable is False
    assert status.downloaded_bytes == 0
    assert partials(downloader) == []
    assert records(downloader) == []


def test_shutting_down_pauses_running_transfers_and_keeps_their_bytes(
    settings: Settings,
) -> None:
    reached = threading.Event()
    gate = threading.Event()

    def hold(index: int) -> None:
        if index == 1:
            reached.set()
            gate.wait(WAIT_S)

    downloader = build(settings, serve(chunks=6, on_chunk=hold))
    downloader.start(MODEL_ID)
    assert reached.wait(WAIT_S) is True
    gate.set()

    assert downloader.pause_all() == (MODEL_ID,)
    assert downloader.active() == ()
    assert downloader.status(MODEL_ID).resumable is True
    assert partial_path(downloader).stat().st_size > 0


def test_pausing_a_model_that_is_idle_does_nothing(settings: Settings) -> None:
    downloader = build(settings, serve(chunks=1))
    downloader.pause(MODEL_ID)
    assert downloader.status(MODEL_ID).downloading is False


def test_cancelling_a_model_that_is_idle_does_nothing(settings: Settings) -> None:
    downloader = build(settings, serve(chunks=1))
    downloader.cancel(MODEL_ID)
    assert downloader.status(MODEL_ID).downloading is False


def test_a_second_start_is_refused_while_one_is_running(settings: Settings) -> None:
    gate = threading.Event()

    def hold(index: int) -> None:
        if index == 1:
            gate.wait(WAIT_S)

    downloader = build(settings, serve(chunks=3, on_chunk=hold))
    try:
        assert downloader.start(MODEL_ID) is True
        assert downloader.status(MODEL_ID).downloading is True

        with pytest.raises(AlreadyDownloadingError) as raised:
            downloader.start(MODEL_ID)
        assert raised.value.code == "models.already_downloading"
    finally:
        gate.set()

    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True
    assert downloader.status(MODEL_ID).cached is True


def test_progress_moves_between_zero_and_one(settings: Settings) -> None:
    downloader: ModelDownloader | None = None
    samples: list[float] = []

    def sample(index: int) -> None:
        assert downloader is not None
        samples.append(downloader.status(MODEL_ID).progress)

    downloader = build(settings, serve(chunks=4, on_chunk=sample))
    downloader.start(MODEL_ID)
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    assert samples[0] == 0.0
    observed = samples[1:]
    assert observed == [0.25, 0.5, 0.75]
    assert all(0.0 < value < 1.0 for value in observed)
    assert observed == sorted(observed)
    # Progress belongs to a running transfer, so it resets once one ends.
    assert downloader.status(MODEL_ID).progress == 0.0


def test_progress_counts_the_bytes_a_resume_started_from(settings: Settings) -> None:
    downloader: ModelDownloader | None = None
    samples: list[float] = []

    def sample(index: int) -> None:
        assert downloader is not None
        samples.append(downloader.status(MODEL_ID).progress)

    downloader = build(settings, serve(chunks=4, on_chunk=sample))
    stage_partial(downloader, held=2 * CHUNK_SIZE, total=4 * CHUNK_SIZE)
    downloader.start(MODEL_ID)
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    # A resumed transfer that reported 0% would tell the user their four
    # gigabytes had been thrown away, which is the thing being fixed.
    assert samples[0] == 0.5
    assert samples[1] == 0.75


def test_progress_is_estimated_when_no_length_is_announced(settings: Settings) -> None:
    downloader: ModelDownloader | None = None
    samples: list[float] = []

    def sample(index: int) -> None:
        assert downloader is not None
        samples.append(downloader.status(MODEL_ID).progress)

    downloader = build(settings, serve(chunks=3, declared=None, on_chunk=sample))
    downloader.start(MODEL_ID)
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    observed = samples[1:]
    assert all(0.0 < value < 1.0 for value in observed)
    assert observed == sorted(observed)
    # A guessed total must not stop the download from completing.
    assert downloader.status(MODEL_ID).cached is True


def test_starting_a_cached_model_downloads_nothing(settings: Settings) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise AssertionError("a cached model must not be fetched again")

    downloader = build(settings, refuse)
    path = downloader.path_for(MODEL_ID)
    path.mkdir(parents=True)
    (path / WEIGHTS).write_bytes(b"already here")

    assert downloader.start(MODEL_ID) is False
    assert downloader.status(MODEL_ID).cached is True


def test_start_refuses_when_downloads_are_disabled(settings: Settings) -> None:
    downloader = build(settings, serve(), allow_downloads=False)
    with pytest.raises(DownloadsDisabledError) as raised:
        downloader.start(MODEL_ID)

    assert raised.value.code == "models.downloads_disabled"
    assert downloader.status(MODEL_ID).downloading is False
    assert partials(downloader) == []


def test_start_raises_for_an_unknown_model(settings: Settings) -> None:
    downloader = build(settings, serve())
    with pytest.raises(KeyError):
        downloader.start("does-not-exist")


def test_cancel_raises_for_an_unknown_model(settings: Settings) -> None:
    downloader = build(settings, serve())
    with pytest.raises(KeyError):
        downloader.cancel("does-not-exist")


def test_pause_raises_for_an_unknown_model(settings: Settings) -> None:
    downloader = build(settings, serve())
    with pytest.raises(KeyError):
        downloader.pause("does-not-exist")


def test_ensure_refuses_when_downloads_are_disabled(settings: Settings) -> None:
    with pytest.raises(DownloadsDisabledError):
        ModelDownloader(settings).ensure("sd15-base")


def test_ensure_returns_a_cached_model(settings: Settings) -> None:
    downloader = ModelDownloader(settings)
    path = downloader.path_for("sd15-base")
    path.mkdir(parents=True)
    (path / "model.safetensors").write_bytes(b"not a real model")

    assert downloader.ensure("sd15-base") == path


def test_ensure_downloads_a_missing_model(settings: Settings) -> None:
    downloader = build(settings, serve(chunks=1))
    path = downloader.ensure(MODEL_ID)

    assert path == downloader.path_for(MODEL_ID)
    assert (path / WEIGHTS).stat().st_size == CHUNK_SIZE


def test_ensure_reports_the_reason_a_download_failed(settings: Settings) -> None:
    downloader = build(settings, serve(status_code=500))
    with pytest.raises(DownloadError) as raised:
        downloader.ensure(MODEL_ID)

    assert raised.value.code == "models.download_rejected"
    assert partials(downloader) == []
