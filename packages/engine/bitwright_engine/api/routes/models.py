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

"""Model registry and download routes.

Every response carries the licence of the weights, because the user has to see
those terms before anything is downloaded. Weights are not covered by this
program's licence; see MODELS.md.

Downloads are only ever started for the identifier the caller named. The route
returns as soon as the transfer is running, so the interface can poll the list
for progress instead of holding a request open for gigabytes.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response, status

from bitwright_engine.api.schemas import ModelInfo, ModelListResponse
from bitwright_engine.api.state import EngineState, StateDep
from bitwright_engine.models import list_models
from bitwright_engine.models.downloader import CacheStatus, DownloadError
from bitwright_engine.models.registry import ModelEntry, get

router = APIRouter(prefix="/v1/models", tags=["models"])

UNKNOWN_MODEL = "models.unknown"
"""Reason code for an identifier that is not in the registry."""


def _to_info(entry: ModelEntry, cache: CacheStatus) -> ModelInfo:
    """Build the wire representation of one model.

    Args:
        entry: The registry entry.
        cache: That model's cache and download state.

    Returns:
        The entry as the interface sees it.
    """
    return ModelInfo(
        model_id=entry.model_id,
        name=entry.name,
        kind=entry.kind.value,
        license_id=entry.license_id,
        license_url=entry.license_url,
        commercial_use=entry.commercial_use,
        size_mb=entry.size_mb,
        cached=cache.cached,
        downloading=cache.downloading,
        progress=cache.progress,
        downloaded_bytes=cache.downloaded_bytes,
        total_bytes=cache.total_bytes,
        resumable=cache.resumable,
        error=cache.error,
    )


def _current(model_id: str, state: EngineState) -> ModelInfo:
    """Return one model's entry as it stands right now.

    Args:
        model_id: Registry identifier.
        state: The engine state.

    Returns:
        The refreshed entry.

    Raises:
        HTTPException: The identifier is not registered.
    """
    try:
        entry = get(model_id)
        cache = state.downloader.status(model_id)
    except KeyError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=UNKNOWN_MODEL,
        ) from error

    return _to_info(entry, cache)


@router.get("", response_model=ModelListResponse)
def list_all(state: StateDep) -> ModelListResponse:
    """List registered models, their licences, and their cache state.

    Args:
        state: The engine state.

    Returns:
        One entry per registered model.
    """
    entries = [_to_info(entry, state.downloader.status(entry.model_id)) for entry in list_models()]
    return ModelListResponse(models=entries)


@router.post(
    "/{model_id}/download",
    response_model=ModelInfo,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_download(model_id: str, state: StateDep, response: Response) -> ModelInfo:
    """Start or continue downloading one model in the background.

    Answers immediately with the model's current entry. A model that is already
    on this machine answers 200 and nothing is fetched, which keeps a repeated
    click cheap. A transfer that is already running answers 409 rather than
    starting a second one.

    This is also the route that resumes. A model with a validated partial on
    disk is continued from that offset, and one without is fetched from the
    start. There is no separate resume route because there is no separate
    request to make: the caller is asking for the weights either way, and
    whether some of them are already here is a fact about the cache. A second
    route would have to answer the same question and would let the caller ask
    for the wrong one.

    Args:
        model_id: Registry identifier.
        state: The engine state.
        response: The outgoing response, so the status code can say whether
            anything was actually started.

    Returns:
        The model's entry, with its download state.

    Raises:
        HTTPException: The identifier is unknown, downloads are turned off, or
            a transfer for this model is already in flight.
    """
    try:
        started = state.downloader.start(model_id)
    except KeyError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=UNKNOWN_MODEL,
        ) from error
    except DownloadError as error:
        # Covers models.downloads_disabled and models.already_downloading.
        # Both mean the request cannot proceed in the current state.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=error.code,
        ) from error

    if not started:
        response.status_code = status.HTTP_200_OK

    return _current(model_id, state)


@router.post(
    "/{model_id}/cancel",
    response_model=ModelInfo,
    status_code=status.HTTP_202_ACCEPTED,
)
def cancel_download(model_id: str, state: StateDep) -> ModelInfo:
    """Stop a download and throw away the bytes it had.

    The worker stops between chunks and removes its partial file and the record
    beside it, so nothing half written is left in the cache. Called on a model
    that is not downloading, this discards a partial left by an earlier
    attempt, which is what the interface's Discard does to a paused model.

    Args:
        model_id: Registry identifier.
        state: The engine state.

    Returns:
        The model's entry, which may still report the transfer as running
        until the worker notices.

    Raises:
        HTTPException: The identifier is not registered.
    """
    try:
        state.downloader.cancel(model_id)
    except KeyError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=UNKNOWN_MODEL,
        ) from error

    return _current(model_id, state)


@router.post(
    "/{model_id}/pause",
    response_model=ModelInfo,
    status_code=status.HTTP_202_ACCEPTED,
)
def pause_download(model_id: str, state: StateDep) -> ModelInfo:
    """Stop a download and keep the bytes it had.

    The difference from cancelling is the only thing this route exists for: the
    partial file and its record stay on disk, so a later download of the same
    model continues from where this one stopped rather than fetching gigabytes
    again. Pausing a model that is not downloading is accepted and does
    nothing, since that is already the state pausing produces.

    Args:
        model_id: Registry identifier.
        state: The engine state.

    Returns:
        The model's entry, which may still report the transfer as running
        until the worker notices.

    Raises:
        HTTPException: The identifier is not registered.
    """
    try:
        state.downloader.pause(model_id)
    except KeyError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=UNKNOWN_MODEL,
        ) from error

    return _current(model_id, state)
