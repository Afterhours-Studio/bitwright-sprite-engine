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

"""Wire types for sprites already on disk."""

from __future__ import annotations

from pydantic import Field

from bitwright_engine.api.schemas.common import CamelModel


class SavedSprite(CamelModel):
    """One sprite in the sprites directory.

    Attributes:
        name: File name, which is also its identifier.
        path: Full path, for showing where it lives.
        width: Width in pixels.
        height: Height in pixels.
        data: PNG bytes, base64 encoded, without a data URL prefix.
        modified_at: When it was written, as a Unix timestamp.
    """

    name: str
    path: str
    width: int
    height: int
    data: str
    modified_at: float


class SpriteListResponse(CamelModel):
    """Every sprite on disk, newest first.

    Attributes:
        sprites: The sprites.
    """

    sprites: list[SavedSprite]


class SpriteEditBody(CamelModel):
    """A painted sprite, to be written beside the one it was painted from.

    The file to write is not named here. It is derived from the sprite in the
    path, which the route has already resolved against the sprites directory,
    so a caller cannot choose where the bytes land.

    Attributes:
        image: The painted sprite, base64 encoded PNG, without a data URL
            prefix.
    """

    image: str = Field(min_length=1)
