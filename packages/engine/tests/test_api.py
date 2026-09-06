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

"""Tests for the sidecar HTTP API.

The download tests replace the engine's downloader with one whose HTTP client
is backed by a mock transport, so a request is served from memory and nothing
reaches the network.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager

import httpx
import pytest
from fastapi.testclient import TestClient

from bitwright_engine.api.security import TOKEN_HEADER
from bitwright_engine.api.server import bind_socket, create_app
from bitwright_engine.backends import BackendKind
from bitwright_engine.config import Settings
from bitwright_engine.models import ModelDownloader
from bitwright_engine.models.downloader import CHUNK_SIZE
from bitwright_engine.version import __version__
from tests.test_models import (
    MODEL_ID,
    WAIT_S,
    WEIGHTS,
    Handler,
    body,
    partials,
    serve,
    stage_partial,
)

DOWNLOAD_TOKEN = "download-test-token"
"""Token the download tests build their own application with."""


@contextmanager
def download_app(
    settings: Settings,
    handler: Handler,
    *,
    allow_downloads: bool = True,
) -> Iterator[tuple[TestClient, ModelDownloader]]:
    """Serve an application whose downloader cannot reach the network.

    Args:
        settings: Base settings, whose cache directory is inside the test's own
            temporary directory.
        handler: The mock transport handler to serve weights requests with.
        allow_downloads: Value for the download policy setting.

    Yields:
        An authenticated client and the downloader the application is using.
    """
    app = create_app(settings, token=DOWNLOAD_TOKEN)
    downloader = ModelDownloader(
        settings.model_copy(update={"allow_downloads": allow_downloads}),
        client_factory=lambda: httpx.Client(transport=httpx.MockTransport(handler)),
    )

    with TestClient(app) as test_client:
        test_client.headers[TOKEN_HEADER] = DOWNLOAD_TOKEN
        app.state.engine.downloader = downloader
        try:
            yield test_client, downloader
        finally:
            # Never leave a worker thread running past the end of a test.
            downloader.cancel(MODEL_ID)
            downloader.wait(MODEL_ID, timeout=WAIT_S)


def find_model(client: TestClient, model_id: str) -> dict[str, object]:
    """Return one entry from the model list.

    Args:
        client: An authenticated client.
        model_id: Registry identifier to look for.

    Returns:
        That model's entry as the API reports it.
    """
    response = client.get("/v1/models")
    assert response.status_code == 200
    models: list[dict[str, object]] = response.json()["models"]
    return next(entry for entry in models if entry["modelId"] == model_id)


def test_health_reports_the_selected_backend(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200

    body = response.json()
    assert body["status"] == "ok"
    assert body["version"] == __version__
    assert body["backend"] == BackendKind.REMOTE.value
    assert body["backendReady"] is True


def test_backends_lists_every_kind_with_capabilities(client: TestClient) -> None:
    response = client.get("/v1/backends")
    assert response.status_code == 200

    backends = response.json()["backends"]
    assert [entry["kind"] for entry in backends] == ["cuda", "mps", "remote"]
    assert next(entry for entry in backends if entry["selected"])["kind"] == "remote"

    remote = next(entry for entry in backends if entry["kind"] == "remote")
    assert remote["capabilities"] == ["batch"]

    for entry in backends:
        assert entry["available"] or entry["detail"]


def test_selecting_an_unknown_backend_is_rejected(client: TestClient) -> None:
    response = client.post("/v1/backends/quantum/select")
    assert response.status_code == 404
    assert response.json()["detail"] == "backend.unknown_kind"


def test_selecting_an_unavailable_backend_reports_a_reason_code(client: TestClient) -> None:
    listed = client.get("/v1/backends").json()["backends"]
    unavailable = next((entry for entry in listed if not entry["available"]), None)
    if unavailable is None:  # pragma: no cover - a machine with every backend ready
        pytest.skip("every backend is available on this machine")

    response = client.post(f"/v1/backends/{unavailable['kind']}/select")
    assert response.status_code == 409
    assert response.json()["detail"] == unavailable["detail"]


def test_generate_refuses_when_no_provider_is_configured(client: TestClient) -> None:
    # The remote backend reaches a provider now rather than drawing a
    # placeholder, so with nothing configured it refuses instead of answering
    # with an image that was never generated. Answering 200 here is what let a
    # checkerboard reach the canvas and be taken for a broken renderer.
    response = client.post(
        "/v1/generate",
        json={"prompt": "a knight", "width": 16, "height": 16, "seed": 3},
    )
    assert response.status_code == 503
    assert response.json()["code"].startswith("backend.remote.")


def test_generate_rejects_a_batch_the_backend_cannot_serve(client: TestClient) -> None:
    response = client.post("/v1/generate", json={"prompt": "a knight", "batchSize": 99})
    assert response.status_code == 422


def test_generate_rejects_an_empty_prompt(client: TestClient) -> None:
    response = client.post("/v1/generate", json={"prompt": ""})
    assert response.status_code == 422


def test_models_lists_licences_and_cache_state(client: TestClient) -> None:
    response = client.get("/v1/models")
    assert response.status_code == 200

    models = response.json()["models"]
    assert {entry["modelId"] for entry in models} >= {"sd15-base", "sdxl-base"}
    for entry in models:
        assert entry["licenseId"]
        assert entry["licenseUrl"].startswith("https://")
        assert entry["cached"] is False
        assert entry["downloading"] is False
        assert entry["progress"] == 0.0
        assert entry["error"] == ""


def test_download_starts_in_the_background_and_answers_202(settings: Settings) -> None:
    with download_app(settings, serve(chunks=2)) as (client, downloader):
        response = client.post(f"/v1/models/{MODEL_ID}/download")
        assert response.status_code == 202
        assert response.json()["modelId"] == MODEL_ID

        assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True
        entry = find_model(client, MODEL_ID)
        assert entry["cached"] is True
        assert entry["downloading"] is False
        assert entry["error"] == ""
        assert partials(downloader) == []


def test_download_reports_progress_while_it_runs(settings: Settings) -> None:
    reached = threading.Event()
    gate = threading.Event()

    def hold(index: int) -> None:
        if index == 1:
            reached.set()
            gate.wait(WAIT_S)

    with download_app(settings, serve(chunks=4, on_chunk=hold)) as (client, downloader):
        try:
            assert client.post(f"/v1/models/{MODEL_ID}/download").status_code == 202
            assert reached.wait(WAIT_S) is True

            entry = find_model(client, MODEL_ID)
            progress = entry["progress"]
            assert entry["downloading"] is True
            assert isinstance(progress, float)
            assert 0.0 < progress < 1.0
            assert entry["cached"] is False
        finally:
            gate.set()

        assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True
        assert find_model(client, MODEL_ID)["progress"] == 0.0


def test_a_second_download_answers_409(settings: Settings) -> None:
    gate = threading.Event()

    def hold(index: int) -> None:
        if index == 1:
            gate.wait(WAIT_S)

    with download_app(settings, serve(chunks=3, on_chunk=hold)) as (client, downloader):
        try:
            assert client.post(f"/v1/models/{MODEL_ID}/download").status_code == 202

            second = client.post(f"/v1/models/{MODEL_ID}/download")
            assert second.status_code == 409
            assert second.json()["detail"] == "models.already_downloading"
        finally:
            gate.set()

        assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True


def test_downloading_a_cached_model_answers_200(settings: Settings) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise AssertionError("a cached model must not be fetched again")

    with download_app(settings, refuse) as (client, downloader):
        path = downloader.path_for(MODEL_ID)
        path.mkdir(parents=True)
        (path / WEIGHTS).write_bytes(b"already here")

        response = client.post(f"/v1/models/{MODEL_ID}/download")
        assert response.status_code == 200
        assert response.json()["cached"] is True


def test_downloading_an_unknown_model_answers_404(settings: Settings) -> None:
    with download_app(settings, serve()) as (client, _downloader):
        response = client.post("/v1/models/does-not-exist/download")
        assert response.status_code == 404
        assert response.json()["detail"] == "models.unknown"


def test_download_is_refused_when_downloads_are_disabled(settings: Settings) -> None:
    with download_app(settings, serve(), allow_downloads=False) as (client, downloader):
        response = client.post(f"/v1/models/{MODEL_ID}/download")
        assert response.status_code == 409
        assert response.json()["detail"] == "models.downloads_disabled"
        assert find_model(client, MODEL_ID)["downloading"] is False
        assert partials(downloader) == []


def test_cancelling_answers_202_and_leaves_no_partial_file(settings: Settings) -> None:
    reached = threading.Event()
    gate = threading.Event()

    def hold(index: int) -> None:
        if index == 1:
            reached.set()
            gate.wait(WAIT_S)

    with download_app(settings, serve(chunks=6, on_chunk=hold)) as (client, downloader):
        try:
            assert client.post(f"/v1/models/{MODEL_ID}/download").status_code == 202
            assert reached.wait(WAIT_S) is True
            assert client.post(f"/v1/models/{MODEL_ID}/cancel").status_code == 202
        finally:
            gate.set()

        assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True
        entry = find_model(client, MODEL_ID)
        assert entry["cached"] is False
        assert entry["downloading"] is False
        assert entry["error"] == ""
        assert partials(downloader) == []
        assert downloader.path_for(MODEL_ID).exists() is False


def test_cancelling_an_unknown_model_answers_404(settings: Settings) -> None:
    with download_app(settings, serve()) as (client, _downloader):
        response = client.post("/v1/models/does-not-exist/cancel")
        assert response.status_code == 404
        assert response.json()["detail"] == "models.unknown"


def test_pausing_answers_202_and_reports_the_bytes_it_kept(settings: Settings) -> None:
    reached = threading.Event()
    gate = threading.Event()

    def hold(index: int) -> None:
        if index == 1:
            reached.set()
            gate.wait(WAIT_S)

    with download_app(settings, serve(chunks=6, on_chunk=hold)) as (client, downloader):
        try:
            assert client.post(f"/v1/models/{MODEL_ID}/download").status_code == 202
            assert reached.wait(WAIT_S) is True
            assert client.post(f"/v1/models/{MODEL_ID}/pause").status_code == 202
        finally:
            gate.set()

        assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True
        entry = find_model(client, MODEL_ID)
        assert entry["cached"] is False
        assert entry["downloading"] is False
        # Pausing is not a failure, and the bytes it kept are what the row
        # renders as "2.9 GB of 4.0 GB" with no transfer running.
        assert entry["error"] == ""
        assert entry["resumable"] is True
        assert isinstance(entry["downloadedBytes"], int)
        assert entry["downloadedBytes"] > 0
        assert partials(downloader) != []


def test_downloading_again_resumes_a_paused_model(settings: Settings) -> None:
    seen: list[httpx.Request] = []

    with download_app(settings, serve(chunks=3, seen=seen)) as (client, downloader):
        stage_partial(downloader, held=CHUNK_SIZE, total=3 * CHUNK_SIZE)
        assert find_model(client, MODEL_ID)["resumable"] is True

        assert client.post(f"/v1/models/{MODEL_ID}/download").status_code == 202
        assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

        # The same route resumes; there is no second one to get wrong.
        assert seen[0].headers["range"] == f"bytes={CHUNK_SIZE}-"
        entry = find_model(client, MODEL_ID)
        assert entry["cached"] is True
        assert (downloader.path_for(MODEL_ID) / WEIGHTS).read_bytes() == body(3)


def test_pausing_an_unknown_model_answers_404(settings: Settings) -> None:
    with download_app(settings, serve()) as (client, _downloader):
        response = client.post("/v1/models/does-not-exist/pause")
        assert response.status_code == 404
        assert response.json()["detail"] == "models.unknown"


def test_a_failed_download_surfaces_a_reason_code(settings: Settings) -> None:
    with download_app(settings, serve(status_code=503)) as (client, downloader):
        assert client.post(f"/v1/models/{MODEL_ID}/download").status_code == 202
        assert downloader.wait(MODEL_ID, timeout=WAIT_S) is True

        entry = find_model(client, MODEL_ID)
        assert entry["error"] == "models.download_rejected"
        assert entry["cached"] is False
        assert entry["downloading"] is False
        assert partials(downloader) == []


def test_bind_socket_refuses_a_non_loopback_address() -> None:
    # Binding anything else would put generation on the network, where the
    # token would be the only thing between an attacker and this machine's GPU.
    for host in ("0.0.0.0", "::", "192.168.1.10"):
        with pytest.raises(ValueError, match="loopback"):
            bind_socket(host, 0)


def test_bind_socket_allocates_a_free_port() -> None:
    listener = bind_socket("127.0.0.1", 0)
    try:
        assert listener.getsockname()[1] > 0
    finally:
        listener.close()
