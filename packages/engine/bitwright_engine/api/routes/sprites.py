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
from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from PIL import Image, UnidentifiedImageError

from bitwright_engine.api.schemas.sprites import SavedSprite, SpriteListResponse
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
