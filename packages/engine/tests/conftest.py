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

import pytest
from fastapi.testclient import TestClient

from bitwright_engine.api.security import TOKEN_HEADER
from bitwright_engine.api.server import create_app
from bitwright_engine.backends.base import (
    Availability,
    BackendKind,
    BaseBackend,
    Capability,
    GeneratedImage,
    GenerationRequest,
    GenerationResult,
)
from bitwright_engine.config import Settings
from bitwright_engine.utils.images import placeholder, to_png_bytes


class FakeBackend(BaseBackend):
    """A backend with configurable availability and capabilities.

    Attributes:
        kind: Reported as the CUDA kind, so that responses look realistic.
        calls: Requests seen by :meth:`_run`, for assertions.
    """

    kind = BackendKind.CUDA

    def __init__(
        self,
        *,
        ready: bool = True,
        detail: str = "",
        supported: frozenset[Capability] = frozenset({Capability.BATCH}),
    ) -> None:
        self._ready = ready
        self._detail = detail
        self._supported = supported
        self.calls: list[GenerationRequest] = []

    def available(self) -> Availability:
        return Availability(ready=self._ready, detail=self._detail, device="fake")

    def capabilities(self) -> frozenset[Capability]:
        return self._supported

    def _run(self, request: GenerationRequest) -> GenerationResult:
        self.calls.append(request)
        seed = request.seed if request.seed is not None else 1
        images = [
            GeneratedImage(
                data=to_png_bytes(placeholder(request.width, request.height, seed + index)),
                width=request.width,
                height=request.height,
                seed=seed + index,
            )
            for index in range(request.batch_size)
        ]
        return GenerationResult(images=images, backend=self.kind, duration_ms=1)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    """Return settings that keep every side effect inside the test directory."""
    return Settings(
        host="127.0.0.1",
        port=0,
        backend="remote",
        remote_endpoint="https://example.invalid",
        remote_api_key="test-key",
        cache_dir=tmp_path / "models",
        allow_downloads=False,
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
