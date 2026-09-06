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

"""Tests for the sidecar HTTP API."""

from __future__ import annotations

import base64

import pytest
from fastapi.testclient import TestClient

from bitwright_engine.api.server import bind_socket
from bitwright_engine.backends import BackendKind
from bitwright_engine.version import __version__


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


def test_generate_returns_png_data(client: TestClient) -> None:
    response = client.post(
        "/v1/generate",
        json={"prompt": "a knight", "width": 16, "height": 16, "seed": 3},
    )
    assert response.status_code == 200

    body = response.json()
    assert body["backend"] == "remote"
    assert len(body["images"]) == 1
    assert base64.b64decode(body["images"][0]["data"])[:8] == b"\x89PNG\r\n\x1a\n"


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
