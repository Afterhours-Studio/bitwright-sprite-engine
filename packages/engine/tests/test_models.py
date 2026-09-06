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
streaming, progress, cancellation and cache handling code paths.
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

CHUNK = b"x" * CHUNK_SIZE
"""One chunk of body, sized so the downloader yields it on its own."""

WAIT_S = 10.0
"""How long a test waits for a worker thread before giving up."""


def serve(
    *,
    chunks: int = 3,
    status_code: int = 200,
    declared: int | None = -1,
    on_chunk: Callable[[int], None] | None = None,
) -> Handler:
    """Build a mock transport handler that streams a body.

    Args:
        chunks: How many chunks of :data:`CHUNK` to send.
        status_code: Status to answer with.
        declared: Value for the ``Content-Length`` header. ``-1`` announces the
            true body length, ``None`` sends no header at all, and any other
            number announces that number of bytes.
        on_chunk: Called with the chunk index before each chunk is yielded, so
            a test can observe or interfere with a transfer in flight.

    Returns:
        A handler suitable for :class:`httpx.MockTransport`.
    """

    def body() -> Iterator[bytes]:
        for index in range(chunks):
            if on_chunk is not None:
                on_chunk(index)
            yield CHUNK

    def handle(request: httpx.Request) -> httpx.Response:
        headers: dict[str, str] = {}
        if declared is not None:
            length = chunks * CHUNK_SIZE if declared < 0 else declared
            headers["content-length"] = str(length)
        return httpx.Response(status_code, headers=headers, content=body())

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


def partials(downloader: ModelDownloader) -> list[Path]:
    """List every half written file left in the cache.

    Args:
        downloader: The downloader whose cache is inspected.

    Returns:
        Any partial files still on disk. Should always be empty once a
        transfer has finished, however it ended.
    """
    if not downloader.cache_dir.exists():
        return []
    return sorted(downloader.cache_dir.rglob(f"*{PARTIAL_SUFFIX}"))


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
    assert status.error == ""


def test_a_successful_download_marks_the_model_cached(settings: Settings) -> None:
    downloader = build(settings, serve(chunks=3))

    assert downloader.start(MODEL_ID) is True
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    status = downloader.status(MODEL_ID)
    assert status.cached is True
    assert status.downloading is False
    assert status.progress == 0.0
    assert status.error == ""
    assert (status.path / WEIGHTS).stat().st_size == 3 * CHUNK_SIZE
    assert partials(downloader) == []


def test_a_rejected_download_records_a_code_and_leaves_nothing(settings: Settings) -> None:
    downloader = build(settings, serve(status_code=404))

    downloader.start(MODEL_ID)
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    status = downloader.status(MODEL_ID)
    assert status.error == "models.download_rejected"
    assert status.cached is False
    assert status.downloading is False
    assert status.path.exists() is False
    assert partials(downloader) == []


def test_an_unreachable_host_records_a_code(settings: Settings) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to host", request=request)

    downloader = build(settings, refuse)
    downloader.start(MODEL_ID)
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    status = downloader.status(MODEL_ID)
    assert status.error == "models.download_unreachable"
    assert status.cached is False
    assert partials(downloader) == []


def test_a_truncated_body_is_discarded(settings: Settings) -> None:
    # The host announces more than it sends, which is what a connection dropped
    # mid transfer looks like. The bytes that did arrive must not be published.
    downloader = build(settings, serve(chunks=2, declared=3 * CHUNK_SIZE))

    downloader.start(MODEL_ID)
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    status = downloader.status(MODEL_ID)
    assert status.error == "models.download_incomplete"
    assert status.cached is False
    assert status.path.exists() is False
    assert partials(downloader) == []


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
    assert partials(downloader) == []


def test_cancelling_removes_the_partial_file(settings: Settings) -> None:
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
    # A cancellation is what the user asked for, not a failure to report.
    assert status.error == ""
    assert status.path.exists() is False
    assert partials(downloader) == []


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


def stage_partial(
    downloader: ModelDownloader,
    body: bytes,
    *,
    url: str | None = None,
    validator: str = '"v1"',
) -> Path:
    """Leave a partial file on disk as a killed process would have.

    Args:
        downloader: The downloader whose cache directory to write into.
        body: Bytes already fetched.
        url: URL to record as their source. Defaults to the entry's real one.
        validator: Validator to record, or an empty string for none.

    Returns:
        The partial file that was written.
    """
    entry = get(MODEL_ID)
    partial = downloader.cache_dir / PARTIAL_DIRNAME / f"{entry.kind.value}-{MODEL_ID}"
    partial = partial.with_name(partial.name + PARTIAL_SUFFIX)
    partial.parent.mkdir(parents=True, exist_ok=True)
    partial.write_bytes(body)
    partial.with_name(partial.name + RESUME_SUFFIX).write_text(
        json.dumps(
            {"url": url if url is not None else download_url(entry), "validator": validator}
        ),
        encoding="utf-8",
    )
    return partial


def test_a_partial_left_by_a_kill_is_resumed(settings: Settings) -> None:
    seen: dict[str, str] = {}

    def handle(request: httpx.Request) -> httpx.Response:
        seen.update(request.headers)
        return httpx.Response(
            206,
            headers={"content-length": str(CHUNK_SIZE), "etag": '"v1"'},
            content=CHUNK,
        )

    downloader = build(settings, handle)
    stage_partial(downloader, CHUNK)

    assert downloader.start(MODEL_ID) is True
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    status = downloader.status(MODEL_ID)
    assert status.cached is True
    assert status.error == ""
    # The bytes already on disk plus the ones the range answered with, rather
    # than the range alone.
    assert (status.path / WEIGHTS).stat().st_size == 2 * CHUNK_SIZE
    assert seen["range"] == f"bytes={CHUNK_SIZE}-"
    assert seen["if-range"] == '"v1"'
    assert partials(downloader) == []


def test_a_host_that_ignores_the_range_starts_the_file_over(settings: Settings) -> None:
    # A 200 to a ranged request means the whole file is coming. Appending it to
    # what is already there would produce a file of the right length only by
    # accident, and the wrong contents always.
    downloader = build(settings, serve(chunks=2))
    stage_partial(downloader, CHUNK)

    assert downloader.start(MODEL_ID) is True
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    status = downloader.status(MODEL_ID)
    assert status.cached is True
    assert (status.path / WEIGHTS).stat().st_size == 2 * CHUNK_SIZE


def test_a_partial_from_another_url_is_discarded(settings: Settings) -> None:
    seen: dict[str, str] = {}

    def handle(request: httpx.Request) -> httpx.Response:
        seen.update(request.headers)
        return httpx.Response(200, headers={"content-length": str(CHUNK_SIZE)}, content=CHUNK)

    downloader = build(settings, handle)
    stage_partial(downloader, CHUNK, url="https://elsewhere.invalid/other.safetensors")

    assert downloader.start(MODEL_ID) is True
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    assert "range" not in seen
    assert (downloader.status(MODEL_ID).path / WEIGHTS).stat().st_size == CHUNK_SIZE


def test_a_partial_with_no_validator_is_resumed_without_if_range(settings: Settings) -> None:
    seen: dict[str, str] = {}

    def handle(request: httpx.Request) -> httpx.Response:
        seen.update(request.headers)
        return httpx.Response(206, headers={"content-length": str(CHUNK_SIZE)}, content=CHUNK)

    downloader = build(settings, handle)
    stage_partial(downloader, CHUNK, validator="")

    assert downloader.start(MODEL_ID) is True
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    assert seen["range"] == f"bytes={CHUNK_SIZE}-"
    assert "if-range" not in seen


def test_a_range_the_host_rejects_discards_the_partial(settings: Settings) -> None:
    downloader = build(settings, serve(chunks=1, status_code=416))
    stage_partial(downloader, CHUNK)

    assert downloader.start(MODEL_ID) is True
    assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

    status = downloader.status(MODEL_ID)
    assert status.cached is False
    assert status.error == "models.download_incomplete"
    # Left in place it would be retried forever against a host that has already
    # said these bytes are not part of its file.
    assert partials(downloader) == []
