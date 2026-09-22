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

"""Shared test fixtures."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from bitwright_engine.api.security import TOKEN_HEADER
from bitwright_engine.api.server import create_app
from bitwright_engine.api.state import EngineState
from bitwright_engine.config import Settings


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    """Return settings that keep every side effect inside the test directory."""
    return Settings(
        host="127.0.0.1",
        port=0,
        data_root=tmp_path,
    )


TEST_TOKEN = "test-token"


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    """Return an authenticated test client for an app built from ``settings``."""
    with TestClient(create_app(settings, token=TEST_TOKEN)) as test_client:
        test_client.headers[TOKEN_HEADER] = TEST_TOKEN
        yield test_client


@pytest.fixture
def anonymous_client(settings: Settings) -> Iterator[TestClient]:
    """Return a client that presents no token."""
    with TestClient(create_app(settings, token=TEST_TOKEN)) as test_client:
        yield test_client


@pytest.fixture
def engine_state(client: TestClient) -> EngineState:
    """Return the state the running test application built.

    Starlette types ``TestClient.app`` as a bare ASGI callable, so the cast is
    what lets a test reach the engine state without turning off type checking.
    """
    return cast(EngineState, cast(FastAPI, client.app).state.engine)
