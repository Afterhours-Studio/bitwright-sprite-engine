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

"""Backend discovery and selection routes.

The settings screen reads this to render every engine option with its
availability and its capabilities, so that unsupported controls can be disabled
before the user tries to use them.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from bitwright_engine.api.schemas import BackendInfo, BackendListResponse
from bitwright_engine.api.state import StateDep
from bitwright_engine.backends import BackendKind, list_backends

router = APIRouter(prefix="/v1/backends", tags=["backends"])


@router.get("", response_model=BackendListResponse)
def list_all(state: StateDep) -> BackendListResponse:
    """List every backend with its current availability and capabilities.

    Args:
        state: The engine state.

    Returns:
        One entry per backend, in preference order.
    """
    selected = state.generator.backend.kind
    entries: list[BackendInfo] = []

    for backend in list_backends(state.settings):
        availability = backend.available()
        entries.append(
            BackendInfo(
                kind=backend.kind.value,
                available=availability.ready,
                detail=availability.detail,
                device=availability.device,
                capabilities=sorted(capability.value for capability in backend.capabilities()),
                selected=backend.kind is selected,
            )
        )

    return BackendListResponse(backends=entries)


@router.post("/{kind}/select", response_model=BackendListResponse)
def select(kind: str, state: StateDep) -> BackendListResponse:
    """Switch the backend that serves generation requests.

    Selecting an unavailable backend is rejected here rather than at generation
    time, so the settings screen can report the problem where the user made the
    choice.

    Args:
        kind: Backend identifier, one of ``cuda``, ``mps``, or ``remote``.
        state: The engine state.

    Returns:
        The refreshed backend list, with the new selection marked.

    Raises:
        HTTPException: The identifier is unknown, or the backend cannot run.
    """
    try:
        requested = BackendKind(kind)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="backend.unknown_kind",
        ) from error

    candidate = next(item for item in list_backends(state.settings) if item.kind is requested)
    availability = candidate.available()
    if not availability.ready:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=availability.detail or "backend.unavailable",
        )

    state.select(requested)
    return list_all(state)
