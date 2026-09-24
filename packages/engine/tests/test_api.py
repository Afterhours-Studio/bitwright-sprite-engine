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

What is left here is the shape of the process itself: the unauthenticated
health probe the shell polls before it has parsed the handshake, and the socket
bind that must never leave loopback. Route behaviour is covered beside each
route, in test_conform and test_storage.
"""

from __future__ import annotations

from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from bitwright_engine.api.server import bind_socket
from bitwright_engine.version import __version__


def test_health_reports_liveness_and_the_build(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200

    body = response.json()
    assert body["status"] == "ok"
    assert body["version"] == __version__


def test_health_answers_before_the_engine_state_is_read(client: TestClient) -> None:
    # The shell polls this while the process is still starting, so the route
    # must not depend on anything built during startup.
    del cast(FastAPI, client.app).state.engine

    assert client.get("/health").status_code == 200


def test_bind_socket_refuses_a_non_loopback_address() -> None:
    # Binding anything else would put this API on the network, where the token
    # would be the only thing between an attacker and this machine's files.
    for host in ("0.0.0.0", "::", "192.168.1.10"):
        with pytest.raises(ValueError, match="loopback"):
            bind_socket(host, 0)


def test_bind_socket_allocates_a_free_port() -> None:
    listener = bind_socket("127.0.0.1", 0)
    try:
        assert listener.getsockname()[1] > 0
    finally:
        listener.close()


def test_shutdown_with_valid_token_and_server_sets_should_exit(
    client: TestClient,
) -> None:
    """POST /shutdown with a valid token and server attached returns 202 and sets should_exit."""
    app = cast(FastAPI, client.app)

    # Attach a stub server with should_exit = False
    class StubServer:
        should_exit = False

    app.state.server = StubServer()

    response = client.post("/shutdown")

    assert response.status_code == 202
    assert app.state.server.should_exit is True


def test_shutdown_with_valid_token_and_no_server_logs_warning(
    client: TestClient,
    caplog,
) -> None:
    """POST /shutdown without a server attached logs a warning and returns 202."""
    app = cast(FastAPI, client.app)

    # Ensure no server is attached
    if hasattr(app.state, "server"):
        delattr(app.state, "server")

    response = client.post("/shutdown")

    assert response.status_code == 202
    assert "shutdown requested but no server is attached" in caplog.text
