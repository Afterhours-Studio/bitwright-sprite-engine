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

"""Correcting a sprite that already exists.

A diffusion model produces an image that looks like pixel art without being
it: the cells are not aligned to a grid, the edges are anti-aliased, and there
are far more colours than a palette. This route applies the corrections to a
sprite that has already been generated, so the same image can be adjusted
repeatedly without paying for generation again.

Every step is one the engine already performs during generation. What is new
is being able to ask for them afterwards, one at a time, and see the result.
"""

from __future__ import annotations

import base64
import io
from typing import cast

from fastapi import APIRouter, HTTPException, status
from PIL import Image

from bitwright_engine.api.schemas.conform import ConformBody, ConformResponse
from bitwright_engine.pipeline.postprocess.background import remove_background
from bitwright_engine.pipeline.postprocess.quantize import quantize, snap_to_grid
from bitwright_engine.utils.images import to_png_bytes

router = APIRouter(prefix="/v1/conform", tags=["conform"])

BAD_IMAGE = "conform.bad_image"
"""Reason code for a payload that is not a readable image."""

PALETTE_LIMIT = 256
"""Most colours a palette is reported for.

Above this the image has not been reduced to a palette, so listing its
colours would be listing a gradient rather than a palette a person could
paint with.
"""


@router.post("", response_model=ConformResponse)
def conform(body: ConformBody) -> ConformResponse:
    """Correct one sprite and return it.

    Args:
        body: The image and which corrections to apply.

    Returns:
        The corrected sprite, and the palette it ended up with.

    Raises:
        HTTPException: The payload could not be read as an image.
    """
    try:
        raw = base64.b64decode(body.image, validate=True)
        image = Image.open(io.BytesIO(raw)).convert("RGBA")
    except (ValueError, OSError) as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=BAD_IMAGE,
        ) from error

    if body.remove_background:
        image = remove_background(image, body.background_tolerance)

    # Snapping before quantising, because snapping averages within a cell and
    # would otherwise reintroduce colours the palette had just removed.
    if body.snap_to > 1:
        image = snap_to_grid(image, body.snap_to)

    if body.palette_size is not None:
        image = quantize(image, body.palette_size, dither=body.dither)

    # The palette is reported so the interface can offer it for painting, which
    # is the point of correcting the colours in the first place.
    # `getcolors` rather than walking the pixels: it is implemented in C and
    # answers None above its limit, which is the signal that this image has
    # more colours than a palette rather than a fact worth reporting.
    counted = cast(
        "list[tuple[int, tuple[int, int, int, int]]] | None",
        image.getcolors(maxcolors=PALETTE_LIMIT),
    )
    # Most used first, so the interface can offer the colours that carry the
    # sprite before the ones that appear a handful of times.
    palette = [
        f"#{pixel[0]:02x}{pixel[1]:02x}{pixel[2]:02x}"
        for _, pixel in sorted(counted or [], key=lambda entry: entry[0], reverse=True)
        if pixel[3] > 0
    ]

    return ConformResponse(
        image=base64.b64encode(to_png_bytes(image)).decode("ascii"),
        width=image.width,
        height=image.height,
        palette=palette[:256],
    )
