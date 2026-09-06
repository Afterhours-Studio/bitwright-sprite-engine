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

"""Backend implementations and selection."""

from __future__ import annotations

from bitwright_engine.backends.base import (
    Availability,
    Backend,
    BackendError,
    BackendKind,
    BackendUnavailableError,
    BaseBackend,
    Capability,
    GeneratedImage,
    GenerationRequest,
    GenerationResult,
    UnsupportedCapabilityError,
    required_capabilities,
)
from bitwright_engine.backends.cuda import CudaBackend
from bitwright_engine.backends.mps import MpsBackend
from bitwright_engine.backends.remote import RemoteBackend
from bitwright_engine.config import Settings

__all__ = [
    "Availability",
    "Backend",
    "BackendError",
    "BackendKind",
    "BackendUnavailableError",
    "BaseBackend",
    "Capability",
    "CudaBackend",
    "GeneratedImage",
    "GenerationRequest",
    "GenerationResult",
    "MpsBackend",
    "RemoteBackend",
    "UnsupportedCapabilityError",
    "build_backend",
    "list_backends",
    "required_capabilities",
    "select_backend",
]

# Preference order used when the configured backend is "auto". Local GPUs come
# first, because they cost nothing per image and keep prompts on the machine.
PREFERENCE: tuple[BackendKind, ...] = (
    BackendKind.CUDA,
    BackendKind.MPS,
    BackendKind.REMOTE,
)


def build_backend(kind: BackendKind, settings: Settings | None = None) -> Backend:
    """Construct a backend by kind.

    Args:
        kind: Which implementation to construct.
        settings: Configuration the backend reads. Defaults to the process wide
            settings. Only the remote backend uses it, but it is accepted for
            every kind so callers do not have to special case one.

    Returns:
        A new backend instance. Construction does not touch the GPU or the
        network, so it is cheap and always succeeds.
    """
    match kind:
        case BackendKind.CUDA:
            return CudaBackend()
        case BackendKind.MPS:
            return MpsBackend()
        case BackendKind.REMOTE:
            return RemoteBackend(settings)


def list_backends(settings: Settings | None = None) -> list[Backend]:
    """Construct one instance of every backend, in preference order.

    The settings screen calls this to show each option with its availability,
    so the user can see why an option is not selectable.

    Args:
        settings: Configuration the backends read.

    Returns:
        One backend per kind.
    """
    return [build_backend(kind, settings) for kind in PREFERENCE]


def select_backend(preferred: str = "auto", settings: Settings | None = None) -> Backend:
    """Choose the backend to serve requests.

    Args:
        preferred: A backend kind value, or ``"auto"`` to take the first
            available one in :data:`PREFERENCE` order.
        settings: Configuration the backends read.

    Returns:
        The selected backend. It may be unavailable when named explicitly; the
        caller decides whether that is an error.

    Raises:
        BackendUnavailableError: ``preferred`` is ``"auto"`` and no backend is
            available.
        ValueError: ``preferred`` is not a known backend kind.
    """
    if preferred != "auto":
        return build_backend(BackendKind(preferred), settings)

    for backend in list_backends(settings):
        if backend.available().ready:
            return backend

    raise BackendUnavailableError("backend.none_available")
