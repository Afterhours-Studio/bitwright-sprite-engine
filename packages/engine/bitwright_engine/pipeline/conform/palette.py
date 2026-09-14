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

"""Reducing a sprite to a palette, in a space a viewer would agree with.

Pillow's ``Image.quantize`` is a reasonable default and is not the right final
answer here. It works in sRGB; on an RGBA image it silently falls back to
``FASTOCTREE`` because the better methods do not support an alpha band; and its
best method, ``LIBIMAGEQUANT``, is absent from every published wheel because
libimagequant is GPL-3.0. Reducing a sprite to sixteen colours in sRGB reliably
spends three slots on the highlight and none on the shadow.

So the reduction is done here instead: a weighted median cut in Oklab, refined
by Lloyd's algorithm, and a nearest-entry snap in the same space. The result is
guaranteed to hold at most the requested number of colours plus full
transparency, which is the property the whole operation promises.
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from bitwright_engine.pipeline.conform.dither import DitherMode, snap
from bitwright_engine.utils.color import (
    Bytes,
    Counts,
    build_palette,
    bytes_to_oklab,
    oklab_to_bytes,
)

MAX_PALETTE_SIZE = 256
"""Largest palette the reduction will build."""


def reduce_palette(
    image: Image.Image,
    colors: int,
    dither: DitherMode = "none",
) -> Image.Image:
    """Reduce an image to at most ``colors`` colours, in Oklab.

    Transparent pixels take no part and come back transparent, so a sprite's
    palette is never spent on the colour its background used to be.

    Args:
        image: Source image. Converted to RGBA if it is not already.
        colors: Target palette size, 2 to 256.
        dither: Which dither to apply while snapping.

    Returns:
        A new RGBA image using at most ``colors`` distinct colours.

    Raises:
        ValueError: ``colors`` is outside 2 to 256.
    """
    if not 2 <= colors <= MAX_PALETTE_SIZE:
        raise ValueError(f"colors must be between 2 and {MAX_PALETTE_SIZE}")

    pixels = np.asarray(image.convert("RGBA"), dtype=np.uint8).copy()
    opaque = pixels[:, :, 3] > 0
    if not opaque.any():
        return Image.fromarray(pixels, mode="RGBA")

    distinct, counts = np.unique(pixels[opaque][:, :3], axis=0, return_counts=True)
    if distinct.shape[0] <= colors:
        return Image.fromarray(pixels, mode="RGBA")

    entries = _entries(distinct, counts, colors)
    lab = bytes_to_oklab(pixels[:, :, :3])
    chosen = snap(lab, opaque, bytes_to_oklab(entries), dither)

    pixels[:, :, :3] = np.where(opaque[:, :, None], entries[chosen], pixels[:, :, :3])
    return Image.fromarray(pixels, mode="RGBA")


def _entries(distinct: Bytes, counts: Counts, colors: int) -> Bytes:
    """Derive the palette the image will be snapped onto.

    The entries are rounded to eight bits before anything is measured against
    them, and duplicates are dropped. Two cluster centres a thousandth apart in
    Oklab become the same colour once written to a PNG, and a palette that
    claims two entries where the file holds one would make the reported palette
    disagree with the image.

    Args:
        distinct: Every colour in the image, shaped ``(n, 3)``.
        counts: How many pixels each covers, shaped ``(n,)``.
        colors: Target palette size.

    Returns:
        Palette entries in eight bit sRGB, shaped ``(k, 3)``.
    """
    centres = build_palette(bytes_to_oklab(distinct), counts.astype(np.float64), colors)
    return np.unique(oklab_to_bytes(centres), axis=0)


def report(image: Image.Image, limit: int = MAX_PALETTE_SIZE) -> list[str]:
    """List the colours an image uses, most used first.

    The interface offers these for painting, which is the point of correcting
    the colours in the first place, so they are ordered by how much of the
    sprite they carry rather than by value.

    Args:
        image: The image to read.
        limit: Most colours to report. Above this the image has not been
            reduced to a palette, so nothing is reported: listing its colours
            would be listing a gradient rather than something to paint with.

    Returns:
        Hex values such as ``#1a2b3c``, opaque pixels only, or an empty list
        when there are more than ``limit`` of them.
    """
    pixels = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    opaque = pixels[:, :, 3] > 0
    if not opaque.any():
        return []

    distinct, counts = np.unique(pixels[opaque][:, :3], axis=0, return_counts=True)
    if distinct.shape[0] > limit:
        return []

    order = np.argsort(counts)[::-1]
    return [f"#{red:02x}{green:02x}{blue:02x}" for red, green, blue in distinct[order]]
