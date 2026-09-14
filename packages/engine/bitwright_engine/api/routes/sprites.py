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

"""Sprites that have already been generated.

The gallery is a view of a directory, not a list the interface keeps in
memory. Anything else means a sprite exists in two places that disagree the
moment one of them changes, and it means closing the window loses the record
of work that is still sitting on disk.
"""

from __future__ import annotations

import base64
import io
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from PIL import Image, UnidentifiedImageError

from bitwright_engine.api.schemas.sprites import (
    SavedSprite,
    SpriteEditBody,
    SpriteListResponse,
)
from bitwright_engine.config import get_settings
from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/v1/sprites", tags=["sprites"])

LIST_LIMIT = 200
"""Most sprites returned at once.

Each one carries its own bytes, and a sprite is a few kilobytes, so a few
hundred is a response worth sending. Beyond that the gallery is a file browser
and should be built as one rather than by making this answer larger.
"""

UNKNOWN_SPRITE = "sprites.unknown"
"""Reason code for a name that is not a sprite in this directory."""

BAD_IMAGE = "sprites.bad_image"
"""Reason code for a payload that is not a readable PNG."""

CROWDED = "sprites.too_many_edits"
"""Reason code for a sprite that already has as many edits as it may have."""

EDIT_SUFFIX = "-edit"
"""What marks a sprite as an edit of another one.

An edit is written beside the sprite it came from rather than over it. A
generated sprite is the only record of what the model produced, and a stroke
that destroyed it would be an undo the application cannot offer: closing the
window is the end of the buffer that holds the earlier state.
"""

EDIT_LIMIT = 99
"""How many edits one sprite may have.

Editing an edit writes over it, so the count only grows when a generated sprite
is painted on in a fresh session. A limit exists so that a loop calling this
cannot fill a disk one file at a time; it is far above what a person reaches.
"""

EDIT_NAME = re.compile(r"-edit(?:-\d+)?$")
"""What an edit's own name ends with, so that editing one writes over it."""


@router.get("", response_model=SpriteListResponse)
def list_sprites() -> SpriteListResponse:
    """List the sprites on disk, newest first.

    A file that cannot be read is skipped rather than failing the request: one
    truncated PNG should not hide every other sprite in the directory.

    Returns:
        The sprites, newest first.
    """
    directory = get_settings().sprites_dir
    if not directory.is_dir():
        return SpriteListResponse(sprites=[])

    files = sorted(
        (path for path in directory.glob("*.png") if path.is_file()),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )[:LIST_LIMIT]

    sprites: list[SavedSprite] = []
    for path in files:
        try:
            with Image.open(path) as image:
                width, height = image.size
            data = base64.b64encode(path.read_bytes()).decode("ascii")
        except (OSError, UnidentifiedImageError):
            logger.warning("skipping unreadable sprite %s", path.name)
            continue

        sprites.append(
            SavedSprite(
                name=path.name,
                path=str(path),
                width=width,
                height=height,
                data=data,
                modified_at=path.stat().st_mtime,
            )
        )

    return SpriteListResponse(sprites=sprites)


@router.post("/{name}/remove", status_code=status.HTTP_204_NO_CONTENT)
def remove_sprite(name: str) -> None:
    """Delete one sprite from disk.

    The name is resolved against the sprites directory and refused if it lands
    anywhere else, so a crafted name cannot reach a file the gallery does not
    own.

    Args:
        name: File name, as the listing reported it.

    Raises:
        HTTPException: The name does not identify a sprite in the directory.
    """
    directory = get_settings().sprites_dir
    target = (directory / name).resolve()

    if target.parent != directory.resolve() or not target.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=UNKNOWN_SPRITE,
        )

    try:
        Path(target).unlink()
    except OSError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=UNKNOWN_SPRITE,
        ) from error


@router.post("/{name}/edit", response_model=SavedSprite)
def save_edit(name: str, body: SpriteEditBody) -> SavedSprite:
    """Write a painted sprite beside the one it was painted from.

    The name is resolved against the sprites directory and refused if it lands
    anywhere else, exactly as deleting one is. The file that gets written is
    then derived from that resolved path rather than taken from the caller, so
    the only place this can write is beside a sprite the gallery already owns.

    Painting on an edit writes over it, so a session of painting leaves one
    extra file rather than one per stroke.

    Args:
        name: File name of the sprite that was painted on, as the listing
            reported it.
        body: The painted sprite.

    Returns:
        The file that was written.

    Raises:
        HTTPException: The name does not identify a sprite in the directory,
            the payload is not a readable PNG, the sprite has too many edits
            already, or the file could not be written.
    """
    directory = get_settings().sprites_dir
    source = (directory / name).resolve()

    if source.parent != directory.resolve() or not source.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=UNKNOWN_SPRITE,
        )

    # Decoded in full before anything is written. A truncated payload that
    # failed halfway through a write would leave a sprite on disk that no
    # longer opens, which is worse than refusing it.
    try:
        raw = base64.b64decode(body.image, validate=True)
        with Image.open(io.BytesIO(raw)) as image:
            if image.format != "PNG":
                raise ValueError(f"not a PNG: {image.format}")
            image.load()
            width, height = image.size
    except (ValueError, OSError, UnidentifiedImageError) as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=BAD_IMAGE,
        ) from error

    target = _edit_target(source)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=CROWDED,
        )

    try:
        directory.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    except OSError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=UNKNOWN_SPRITE,
        ) from error

    return SavedSprite(
        name=target.name,
        path=str(target),
        width=width,
        height=height,
        data=base64.b64encode(raw).decode("ascii"),
        modified_at=target.stat().st_mtime,
    )


def _edit_target(source: Path) -> Path | None:
    """Return the file an edit of ``source`` is written to.

    Args:
        source: The sprite that was painted on, already resolved.

    Returns:
        The file to write, or None when this sprite has as many edits as it is
        allowed.
    """
    if EDIT_NAME.search(source.stem):
        return source

    first = source.with_name(f"{source.stem}{EDIT_SUFFIX}.png")
    if not first.exists():
        return first

    # A second session painting on the same generated sprite gets its own file
    # rather than writing over what the first one made.
    for index in range(2, EDIT_LIMIT + 1):
        candidate = source.with_name(f"{source.stem}{EDIT_SUFFIX}-{index}.png")
        if not candidate.exists():
            return candidate

    return None
