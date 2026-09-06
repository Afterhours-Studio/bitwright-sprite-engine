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

"""Request and response models for the generation route."""

from __future__ import annotations

from pydantic import Field

from bitwright_engine.api.schemas.common import CamelModel
from bitwright_engine.backends import GenerationRequest
from bitwright_engine.camera import CAMERA_TERMS, CameraAngle
from bitwright_engine.pipeline import PostProcessOptions
from bitwright_engine.styles import ArtStyle, compose


class PostProcessBody(CamelModel):
    """Post-processing options sent with a generation request.

    Attributes:
        remove_background: Clear the background to transparency.
        background_tolerance: Per-channel colour tolerance for the flood fill.
        palette_size: Reduce to this many colours. ``None`` skips quantization.
        dither: Apply dithering during quantization.
        pixel_grid: Snap to this block size. ``None`` skips snapping.
    """

    remove_background: bool = True
    background_tolerance: int = Field(default=12, ge=0, le=255)
    palette_size: int | None = Field(default=32, ge=2, le=256)
    dither: bool = False
    pixel_grid: int | None = Field(default=None, ge=1, le=64)

    def to_options(self) -> PostProcessOptions:
        """Convert to the pipeline's options type.

        Returns:
            The equivalent :class:`PostProcessOptions`.
        """
        return PostProcessOptions(
            remove_background=self.remove_background,
            background_tolerance=self.background_tolerance,
            palette_size=self.palette_size,
            dither=self.dither,
            pixel_grid=self.pixel_grid,
        )


class GenerateBody(CamelModel):
    """A generation request from the desktop application.

    Attributes:
        prompt: Positive prompt describing the sprite.
        negative_prompt: Terms to steer away from.
        width: Output width in pixels.
        height: Output height in pixels.
        steps: Number of denoising steps.
        guidance_scale: Classifier free guidance strength.
        seed: Seed for reproducible output. ``None`` picks a random seed.
        batch_size: Number of images to produce.
        style: Art style, which contributes terms to both prompts.
        camera: Where the camera sits relative to the character.
        directions: How many directions the character is drawn facing.
        model_id: Registry identifier of the model to use.
        lora_id: Registry identifier of a LoRA adapter, or ``None``.
        postprocess: Post-processing options.
    """

    prompt: str = Field(min_length=1, max_length=2000)
    negative_prompt: str = Field(default="", max_length=2000)
    width: int = Field(default=64, ge=8, le=2048)
    height: int = Field(default=64, ge=8, le=2048)
    steps: int = Field(default=20, ge=1, le=150)
    guidance_scale: float = Field(default=7.0, ge=0.0, le=30.0)
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)
    batch_size: int = Field(default=1, ge=1, le=16)
    style: ArtStyle = ArtStyle.PIXEL
    camera: CameraAngle = CameraAngle.SIDE
    directions: int = Field(default=1, ge=1, le=8)
    model_id: str = "sd15-base"
    lora_id: str | None = None
    postprocess: PostProcessBody = Field(default_factory=PostProcessBody)

    def to_request(self) -> GenerationRequest:
        """Convert to the backend's request type.

        Returns:
            The equivalent :class:`GenerationRequest`.
        """
        # The style's terms are folded in here rather than in the backends,
        # so every backend sees one already composed pair of prompts and
        # cannot disagree with another about what a style means.
        prompt, negative_prompt = compose(self.prompt, self.negative_prompt, self.style)
        # The camera is a term too, folded in beside the style so a backend
        # never has to know how a camera is described to a model.
        prompt = f"{prompt}, {CAMERA_TERMS[self.camera]}"
        return GenerationRequest(
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=self.width,
            height=self.height,
            steps=self.steps,
            guidance_scale=self.guidance_scale,
            seed=self.seed,
            batch_size=self.batch_size,
            model_id=self.model_id,
            lora_id=self.lora_id,
        )


class SpriteImage(CamelModel):
    """One generated sprite.

    Attributes:
        data: PNG bytes, base64 encoded, without a data URL prefix.
        width: Image width in pixels.
        height: Image height in pixels.
    """

    data: str
    width: int
    height: int


class GenerateResponse(CamelModel):
    """The result of a generation request.

    Attributes:
        images: Generated sprites, in request order.
        backend: Kind of backend that produced them.
        duration_ms: Wall clock time spent, in milliseconds.
        warnings: Stable reason codes for non-fatal adjustments.
    """

    images: list[SpriteImage]
    backend: str
    duration_ms: int
    warnings: list[str] = Field(default_factory=list)
