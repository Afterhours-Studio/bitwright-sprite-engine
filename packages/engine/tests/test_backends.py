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

"""Tests for the backend abstraction."""

from __future__ import annotations

import pytest

from bitwright_engine.backends import (
    Backend,
    BackendKind,
    BackendUnavailableError,
    Capability,
    CudaBackend,
    GenerationRequest,
    MpsBackend,
    RemoteBackend,
    UnsupportedCapabilityError,
    build_backend,
    list_backends,
    required_capabilities,
)
from bitwright_engine.config import Settings
from tests.conftest import FakeBackend


def test_every_backend_satisfies_the_protocol() -> None:
    for backend in list_backends():
        assert isinstance(backend, Backend)


def test_build_backend_returns_the_requested_kind() -> None:
    for kind in BackendKind:
        assert build_backend(kind).kind is kind


def test_availability_never_raises() -> None:
    for backend in (CudaBackend(), MpsBackend(), RemoteBackend()):
        availability = backend.available()
        assert availability.ready or availability.detail


def test_remote_reports_missing_configuration() -> None:
    backend = RemoteBackend(Settings(remote_endpoint="", remote_api_key=""))
    assert backend.available().detail == "backend.remote.endpoint_missing"

    backend = RemoteBackend(Settings(remote_endpoint="https://example.invalid", remote_api_key=""))
    assert backend.available().detail == "backend.remote.api_key_missing"


def test_remote_is_available_when_configured() -> None:
    backend = RemoteBackend(
        Settings(remote_endpoint="https://example.invalid", remote_api_key="key")
    )
    assert backend.available().ready


def test_required_capabilities_tracks_the_request() -> None:
    assert required_capabilities(GenerationRequest(prompt="a knight")) == frozenset()
    assert required_capabilities(GenerationRequest(prompt="a knight", batch_size=4)) == frozenset(
        {Capability.BATCH}
    )
    assert required_capabilities(
        GenerationRequest(prompt="a knight", lora_id="pixel-art-lora")
    ) == frozenset({Capability.LORA_HOTSWAP})


def test_generate_rejects_an_unsupported_capability() -> None:
    backend = FakeBackend(supported=frozenset())
    with pytest.raises(UnsupportedCapabilityError):
        backend.generate(GenerationRequest(prompt="a knight", batch_size=2))
    assert backend.calls == []


def test_generate_rejects_an_unavailable_backend() -> None:
    backend = FakeBackend(ready=False, detail="backend.cuda.driver_missing")
    with pytest.raises(BackendUnavailableError):
        backend.generate(GenerationRequest(prompt="a knight"))


def test_generate_returns_one_image_per_batch_item() -> None:
    backend = FakeBackend()
    result = backend.generate(GenerationRequest(prompt="a knight", batch_size=3, seed=7))
    assert [image.seed for image in result.images] == [7, 8, 9]
    assert result.backend is BackendKind.CUDA
