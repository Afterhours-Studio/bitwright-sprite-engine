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
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter

from bitwright_engine.api.schemas import GenerateBody, GenerateResponse, SpriteImage
from bitwright_engine.api.state import StateDep
from bitwright_engine.config import get_settings
from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)

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

    saved = _write_sprites(sprites, request.seed)

    images = [
        SpriteImage(
            data=base64.b64encode(png).decode("ascii"),
            width=request.width,
            height=request.height,
            path=str(path),
        )
        for png, path in zip(sprites, saved, strict=True)
    ]

    return GenerateResponse(
        images=images,
        backend=state.generator.backend.kind.value,
        duration_ms=int((time.monotonic() - started) * 1000),
    )


def _write_sprites(sprites: list[bytes], seed: int | None) -> list[Path]:
    """Write each sprite under the data root, and return where they went.

    Beside the weights the user deliberately placed rather than somewhere they
    did not choose. A sprite is small, but it is the thing they came for, and
    an application that produces something and keeps it only in memory has
    produced nothing they can use.

    A failure to write is logged and not raised: the sprite is already in the
    response, and refusing to answer because a copy could not be filed would
    throw away work that succeeded.

    Args:
        sprites: The PNG bytes, in the order they were generated.
        seed: The seed the run was given, or None when it was random.

    Returns:
        One path per sprite. Empty strings become paths only when a write
        succeeded, so a caller can tell.
    """
    stamp = datetime.now(tz=UTC).strftime("%Y%m%d-%H%M%S")
    directory = get_settings().sprites_dir
    written: list[Path] = []

    for index, png in enumerate(sprites):
        name = f"{stamp}-{seed if seed is not None else 'random'}-{index}.png"
        target = directory / name
        try:
            directory.mkdir(parents=True, exist_ok=True)
            target.write_bytes(png)
            written.append(target)
        except OSError:
            logger.warning("cannot write %s", target)
            written.append(Path())

    return written
