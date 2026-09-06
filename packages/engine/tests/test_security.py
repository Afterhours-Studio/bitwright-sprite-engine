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

"""Tests for the sidecar's authentication.

Loopback binding keeps the API off the network. It does not keep it away from
other processes on the same machine, which is what these tests are about.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from bitwright_engine.api.security import TOKEN_HEADER, generate_token, reject_browser_origin
from tests.conftest import TEST_TOKEN

PROTECTED = [
    ("get", "/v1/backends"),
    ("get", "/v1/models"),
    ("post", "/v1/backends/remote/select"),
    ("post", "/shutdown"),
]


def test_generated_tokens_are_unique_and_long() -> None:
    tokens = {generate_token() for _ in range(64)}
    assert len(tokens) == 64
    assert all(len(token) >= 40 for token in tokens)


def test_health_needs_no_token(anonymous_client: TestClient) -> None:
    # The shell probes health before it has parsed the handshake, so this route
    # has to be reachable without the token it has not read yet.
    response = anonymous_client.get("/health")
    assert response.status_code == 200


def test_health_reveals_nothing_beyond_liveness(anonymous_client: TestClient) -> None:
    body = anonymous_client.get("/health").json()
    assert set(body) == {"status", "version", "backend", "backendReady"}


def test_a_missing_token_is_rejected(anonymous_client: TestClient) -> None:
    for method, path in PROTECTED:
        response = getattr(anonymous_client, method)(path)
        assert response.status_code == 401, path
        assert response.json()["detail"] == "auth.invalid_token"


def test_a_wrong_token_is_rejected(anonymous_client: TestClient) -> None:
    for method, path in PROTECTED:
        response = getattr(anonymous_client, method)(path, headers={TOKEN_HEADER: "wrong"})
        assert response.status_code == 401, path


def test_a_token_prefix_is_rejected(anonymous_client: TestClient) -> None:
    # A prefix must fail like any other wrong value. Comparing with == would
    # return sooner for a longer shared prefix, which leaks the token one
    # character at a time to a caller that measures the difference.
    response = anonymous_client.get("/v1/backends", headers={TOKEN_HEADER: TEST_TOKEN[:-1]})
    assert response.status_code == 401


def test_generate_is_rejected_without_a_token(anonymous_client: TestClient) -> None:
    response = anonymous_client.post("/v1/generate", json={"prompt": "a knight"})
    assert response.status_code == 401


def test_a_request_with_an_origin_is_refused(client: TestClient) -> None:
    # A browser always sends Origin, and the only legitimate caller is the Rust
    # shell. A request that carries one came from a web page, which is the
    # shape a DNS rebinding attack takes.
    response = client.get("/health", headers={"Origin": "https://evil.example"})
    assert response.status_code == 403
    assert response.json()["code"] == "auth.origin_not_allowed"


def test_an_origin_is_refused_even_with_a_valid_token(client: TestClient) -> None:
    response = client.get("/v1/backends", headers={"Origin": "http://localhost:1420"})
    assert response.status_code == 403


def test_a_tauri_origin_is_refused_too(client: TestClient) -> None:
    # The webview is not a client of this API. It goes through shell commands,
    # so its origin gets no exception.
    response = client.get("/v1/backends", headers={"Origin": "tauri://localhost"})
    assert response.status_code == 403


def test_no_cors_headers_are_returned(client: TestClient) -> None:
    response = client.get("/health")
    assert "access-control-allow-origin" not in {key.lower() for key in response.headers}


def test_reject_browser_origin_only_fires_on_a_header() -> None:
    assert reject_browser_origin("https://example.com") is True
    assert reject_browser_origin("") is True
    assert reject_browser_origin(None) is False
