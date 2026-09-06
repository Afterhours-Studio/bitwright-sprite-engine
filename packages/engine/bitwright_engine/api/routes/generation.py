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

"""Generation route."""

from __future__ import annotations

import base64
import time

from fastapi import APIRouter

from bitwright_engine.api.schemas import GenerateBody, GenerateResponse, SpriteImage
from bitwright_engine.api.state import StateDep

router = APIRouter(prefix="/v1", tags=["generation"])


@router.post("/generate", response_model=GenerateResponse)
def generate(body: GenerateBody, state: StateDep) -> GenerateResponse:
    """Generate one or more sprites.

    Backend failures propagate as :class:`BackendError`, which the application
    turns into an error response carrying a translatable code.

    Args:
        body: The generation request.
        state: The engine state.

    Returns:
        The generated sprites, base64 encoded as PNG.
    """
    started = time.monotonic()
    request = body.to_request()
    sprites = state.generator.generate(request, body.postprocess.to_options())

    images = [
        SpriteImage(
            data=base64.b64encode(png).decode("ascii"),
            width=request.width,
            height=request.height,
        )
        for png in sprites
    ]

    return GenerateResponse(
        images=images,
        backend=state.generator.backend.kind.value,
        duration_ms=int((time.monotonic() - started) * 1000),
    )
