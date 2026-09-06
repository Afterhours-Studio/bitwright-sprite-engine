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

"""Where downloaded data is kept.

The default root is under the user's profile, which on Windows means the system
drive. Weights are gigabytes each, so a full system drive has to be answerable
by pointing this somewhere with room, and that is what these routes do.

A candidate is validated before it is accepted, and the validation writes and
deletes a real file rather than reading a permission bit. Changing the root
never moves what is already downloaded: the response says what stayed at the
old location, and the interface tells the user.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, status

from bitwright_engine.api.schemas import StorageChangeResponse, StorageInfo, StorageRootBody
from bitwright_engine.api.state import EngineState, StateDep
from bitwright_engine.config.settings import default_data_root
from bitwright_engine.config.storage import StorageError, StorageLocation, describe, validate_root
from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/v1/storage", tags=["storage"])

BUSY_DOWNLOADING = "storage.busy_downloading"
"""Reason code for a change asked for while a transfer is in flight.

Moving the root under a running download would publish the finished file into
one directory and leave its partial file in another, so the change is refused
until the transfer finishes or is cancelled.
"""


def _to_info(location: StorageLocation) -> StorageInfo:
    """Build the wire representation of one data root.

    Args:
        location: The described root.

    Returns:
        That root as the interface sees it.
    """
    return StorageInfo(
        root=str(location.root),
        models_dir=str(location.models_dir),
        default_root=str(default_data_root()),
        is_default=location.is_default,
        free_bytes=location.free_bytes,
        total_bytes=location.total_bytes,
        used_bytes=location.used_bytes,
        existing_models=list(location.existing_models),
    )


def _describe(root: Path) -> StorageInfo:
    """Describe a root against the per-user default.

    Args:
        root: The directory to describe.

    Returns:
        That root as the interface sees it.
    """
    return _to_info(describe(root, default_root=default_data_root()))


def _accept(raw: str) -> Path:
    """Validate a candidate directory, or refuse the request.

    Args:
        raw: The path as it arrived from the interface.

    Returns:
        The validated, absolute directory.

    Raises:
        HTTPException: The directory cannot hold the application's data. The
            detail is the stable reason code.
    """
    try:
        return validate_root(raw)
    except StorageError as error:
        logger.warning("storage location refused: %s (%s)", error.code, error)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error.code,
        ) from error


def _switch(state: EngineState, root: Path) -> StorageChangeResponse:
    """Repoint the process at a root, and report what stayed behind.

    Args:
        state: The engine state.
        root: The validated directory to use from now on.

    Returns:
        The new location, and the old one with whatever it still holds.

    Raises:
        HTTPException: A download is in flight.
    """
    active = state.downloader.active()
    if active:
        logger.info("refusing to move the data root while %s is downloading", ", ".join(active))
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=BUSY_DOWNLOADING)

    previous = state.settings.data_root
    state.settings.use_data_root(root)
    logger.info("data root moved from %s to %s", previous, root)

    return StorageChangeResponse(
        current=_describe(root),
        previous=_describe(previous),
        data_moved=False,
    )


@router.get("", response_model=StorageInfo)
def current(state: StateDep) -> StorageInfo:
    """Report the data root in use, its free space, and what it holds.

    Args:
        state: The engine state.

    Returns:
        The current location.
    """
    return _describe(state.settings.data_root)


@router.post("/validate", response_model=StorageInfo)
def validate(body: StorageRootBody) -> StorageInfo:
    """Check a candidate directory without adopting it.

    The interface calls this after the user picks a folder, so that a refusal
    and the free space are both shown before anything is confirmed. The
    directory is created if it is missing, because that is what accepting it
    would do and the check has to prove the same thing.

    Args:
        body: The chosen path.

    Returns:
        The candidate as the interface sees it.

    Raises:
        HTTPException: The directory cannot hold the application's data.
    """
    # No engine state is needed: nothing is adopted here. The route still sits
    # in the authenticated router, so the token is required as everywhere else.
    return _describe(_accept(body.path))


@router.post("", response_model=StorageChangeResponse)
def change(body: StorageRootBody, state: StateDep) -> StorageChangeResponse:
    """Adopt a new data root for this process.

    Nothing is moved. Weights already on disk stay at the old location, and are
    fetched again if they are needed at the new one, which is why the previous
    location is described in the response rather than quietly forgotten.

    The choice lives only in this process. The sidecar is spawned fresh on each
    launch, so the shell writes the same path into its own preferences and
    passes it back through ``BITWRIGHT_DATA_ROOT``.

    Args:
        body: The chosen path.
        state: The engine state.

    Returns:
        The new location, and the old one with whatever it still holds.

    Raises:
        HTTPException: The directory cannot hold the data, or a download is in
            flight.
    """
    return _switch(state, _accept(body.path))


@router.post("/default", response_model=StorageChangeResponse)
def reset(state: StateDep) -> StorageChangeResponse:
    """Go back to the per-user default location.

    The default is validated like any other candidate, because a profile
    directory can be full or read-only too.

    Args:
        state: The engine state.

    Returns:
        The default location, and the one that was in use.

    Raises:
        HTTPException: The default cannot hold the data, or a download is in
            flight.
    """
    return _switch(state, _accept(str(default_data_root())))
