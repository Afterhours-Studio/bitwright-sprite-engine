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

"""Image helpers shared by the pipeline and the routes."""

from __future__ import annotations

import io
from typing import cast

from PIL import Image

RGBA = tuple[int, int, int, int]


def new_canvas(width: int, height: int, color: RGBA = (0, 0, 0, 0)) -> Image.Image:
    """Create a blank RGBA image.

    Args:
        width: Canvas width in pixels.
        height: Canvas height in pixels.
        color: Fill colour as red, green, blue, alpha.

    Returns:
        A new RGBA image filled with ``color``.
    """
    return Image.new("RGBA", (width, height), color)


def to_png_bytes(image: Image.Image) -> bytes:
    """Encode an image as PNG.

    Args:
        image: The image to encode.

    Returns:
        The PNG encoded bytes.
    """
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def from_png_bytes(data: bytes) -> Image.Image:
    """Decode PNG bytes into an RGBA image.

    Args:
        data: PNG encoded bytes.

    Returns:
        The decoded image, converted to RGBA.
    """
    with Image.open(io.BytesIO(data)) as image:
        return image.convert("RGBA")


def pixel_at(image: Image.Image, x: int, y: int) -> RGBA:
    """Read one pixel from an RGBA image.

    Pillow types a pixel as a union covering every image mode. Callers here
    always work in RGBA, so the narrowing happens once, in this helper, rather
    than at every read.

    Args:
        image: An RGBA image.
        x: Column, from the left.
        y: Row, from the top.

    Returns:
        The pixel as red, green, blue, alpha.
    """
    return cast(RGBA, image.convert("RGBA").getpixel((x, y)))
