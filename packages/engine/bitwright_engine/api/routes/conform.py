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

It is a route of its own rather than an option on generation, because coupling
it to ``POST /v1/generate`` would mean re-running the model to change a
palette.
"""

from __future__ import annotations

import base64
import io
import time

from fastapi import APIRouter, HTTPException, status
from PIL import Image

from bitwright_engine.api.schemas.conform import (
    ConformBody,
    ConformResponse,
    DetectedGrid,
)
from bitwright_engine.pipeline.conform import conform as run_conform
from bitwright_engine.utils.images import to_png_bytes

router = APIRouter(prefix="/v1/conform", tags=["conform"])

BAD_IMAGE = "conform.bad_image"
"""Reason code for a payload that is not a readable image."""


@router.post("", response_model=ConformResponse)
def conform(body: ConformBody) -> ConformResponse:
    """Correct one sprite and return it.

    Args:
        body: The image and which corrections to apply.

    Returns:
        The corrected sprite, the palette it ended up with, and the grid the
        render turned out to be drawn on.

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

    started = time.monotonic()
    result = run_conform(image, body.to_options())
    elapsed = time.monotonic() - started

    return ConformResponse(
        image=base64.b64encode(to_png_bytes(result.image)).decode("ascii"),
        width=result.image.width,
        height=result.image.height,
        palette=result.palette,
        detected=DetectedGrid.of(result.grid),
        duration_ms=int(elapsed * 1000),
        warnings=result.warnings,
    )
