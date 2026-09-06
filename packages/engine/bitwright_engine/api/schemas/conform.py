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

"""Wire types for correcting an existing sprite."""

from __future__ import annotations

from pydantic import Field

from bitwright_engine.api.schemas.common import CamelModel


class ConformBody(CamelModel):
    """A request to correct one sprite.

    Attributes:
        image: The sprite, base64 encoded PNG, without a data URL prefix.
        remove_background: Whether to make the background transparent.
        background_tolerance: How close a pixel must be to the corner colour to
            count as background.
        snap_to: Cell size to resample onto, or 1 to leave the grid alone.
        palette_size: Colours to reduce to, or null to leave them alone.
        dither: Whether to dither while reducing.
    """

    image: str = Field(min_length=1)
    remove_background: bool = False
    background_tolerance: int = Field(default=12, ge=0, le=255)
    snap_to: int = Field(default=1, ge=1, le=64)
    palette_size: int | None = Field(default=None, ge=2, le=256)
    dither: bool = False


class ConformResponse(CamelModel):
    """A corrected sprite.

    Attributes:
        image: The result, base64 encoded PNG.
        width: Result width in pixels.
        height: Result height in pixels.
        palette: Every colour the result uses, as hex, opaque pixels only.
    """

    image: str
    width: int
    height: int
    palette: list[str]
