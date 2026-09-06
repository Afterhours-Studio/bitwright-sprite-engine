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

"""Palette quantization and pixel snapping.

Diffusion output is smooth. Pixel art is not. These steps cut the colour count
and align the image to a pixel grid, which is what makes the result read as a
sprite rather than as a small blurry painting.
"""

from __future__ import annotations

from PIL import Image

MAX_PALETTE_SIZE = 256


def quantize(image: Image.Image, colors: int = 32, dither: bool = False) -> Image.Image:
    """Reduce an image to a limited palette.

    Alpha is preserved by quantizing only the colour channels, then restoring
    the original alpha band. Pillow's palette mode carries at most one
    transparent index, which would otherwise turn soft edges opaque.

    Args:
        image: Source image. Converted to RGBA if it is not already.
        colors: Target palette size, 2 to 256.
        dither: Whether to apply Floyd-Steinberg dithering. Off by default,
            because dithering reads as noise at sprite sizes.

    Returns:
        A new RGBA image using at most ``colors`` distinct colours.

    Raises:
        ValueError: ``colors`` is outside 2 to 256.
    """
    if not 2 <= colors <= MAX_PALETTE_SIZE:
        raise ValueError(f"colors must be between 2 and {MAX_PALETTE_SIZE}")

    source = image.convert("RGBA")
    alpha = source.getchannel("A")

    dither_mode = Image.Dither.FLOYDSTEINBERG if dither else Image.Dither.NONE
    reduced = source.convert("RGB").quantize(colors=colors, dither=dither_mode)

    result = reduced.convert("RGBA")
    result.putalpha(alpha)
    return result


def snap_to_grid(image: Image.Image, factor: int) -> Image.Image:
    """Align an image to a coarser pixel grid.

    The image is downscaled by ``factor`` with a box filter, which averages
    each block into one pixel, then scaled back with nearest neighbour so that
    each block is a single flat colour.

    Args:
        image: Source image.
        factor: Block size in pixels. A factor of 1 returns a copy.

    Returns:
        A new image whose pixels sit on a ``factor`` sized grid.

    Raises:
        ValueError: ``factor`` is smaller than 1, or larger than the image.
    """
    if factor < 1:
        raise ValueError("factor must be at least 1")

    width, height = image.size
    if factor == 1:
        return image.copy()
    if factor > width or factor > height:
        raise ValueError("factor must not exceed the image dimensions")

    small = image.resize((width // factor, height // factor), Image.Resampling.BOX)
    return small.resize((width, height), Image.Resampling.NEAREST)
