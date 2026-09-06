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

"""Running a diffusion model.

Shared by every local backend, because what differs between them is the device
the work runs on and not how a model is loaded or how a request becomes an
image.

The pipeline is held for as long as the model and the device stay the same. A
diffusion model is gigabytes and takes seconds to move onto a device, so
loading one per request would spend more time loading than generating. It is
released before a different one is built, so two are never on the device at
once: the second would not fit beside the first on most cards.

Nothing here imports torch or diffusers at module scope. They live in the
runtime the user installs into their own data folder, which may not be there,
and an import at module scope would take the whole engine down with it rather
than leaving one backend unavailable.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from bitwright_engine.backends.base import BackendError
from bitwright_engine.utils.logging import get_logger

if TYPE_CHECKING:
    from PIL import Image

logger = get_logger(__name__)


class AdapterUnsupportedError(BackendError):
    """Raised when a style adapter cannot be fused into the pipeline."""

    code = "backend.adapter_unsupported"


MIN_DIMENSION = 512
"""Shortest edge a request is generated at, before it is scaled back down.

A diffusion model trained at 512 produces mush when asked for 64. It is asked
for something it can draw, and the result is reduced afterwards.
"""


@dataclass(frozen=True, slots=True)
class LoadedPipeline:
    """A pipeline, and what it was loaded for.

    Attributes:
        pipeline: The diffusers pipeline.
        model_id: Registry identifier it was loaded from.
        lora_id: Adapter fused into it, or an empty string.
        device: Device it lives on.
    """

    pipeline: Any
    model_id: str
    lora_id: str
    device: str


class PipelineCache:
    """Holds one loaded pipeline, and reloads when the request changes."""

    def __init__(self) -> None:
        """Create an empty cache."""
        self._lock = threading.RLock()
        self._loaded: LoadedPipeline | None = None

    def get(
        self,
        weights: Path,
        model_id: str,
        lora: Path | None,
        lora_id: str,
        device: str,
    ) -> Any:  # noqa: ANN401
        """Return a pipeline for these weights, loading it if need be.

        Args:
            weights: Directory or file the model was downloaded to.
            model_id: Registry identifier, for the cache key.
            lora: Adapter weights to fuse, or None.
            lora_id: Adapter identifier, for the cache key.
            device: Device to move the pipeline onto.

        Returns:
            The pipeline, already on the device.
        """
        with self._lock:
            current = self._loaded
            if (
                current is not None
                and current.model_id == model_id
                and current.lora_id == lora_id
                and current.device == device
            ):
                return current.pipeline

            self._loaded = None
            pipeline = load(weights, lora, device)
            self._loaded = LoadedPipeline(pipeline, model_id, lora_id, device)
            return pipeline

    def release(self) -> None:
        """Drop the loaded pipeline, freeing the device memory it holds."""
        with self._lock:
            self._loaded = None


def load(weights: Path, lora: Path | None, device: str) -> Any:  # noqa: ANN401
    """Load a pipeline from downloaded weights.

    Args:
        weights: A single file checkpoint, or a directory holding one.
        lora: Adapter weights to fuse, or None.
        device: Device to move it onto.

    Returns:
        The pipeline, on the device.
    """
    import torch
    from diffusers import StableDiffusionPipeline

    # Half precision on a GPU and full on the processor: half is roughly twice
    # as fast and half the memory, and unsupported on most processors.
    dtype = torch.float16 if device != "cpu" else torch.float32

    checkpoint = weights if weights.is_file() else single_file(weights)
    logger.info("loading %s onto %s", checkpoint.name, device)

    pipeline = StableDiffusionPipeline.from_single_file(
        str(checkpoint),
        torch_dtype=dtype,
        # Nothing is fetched here. The weights are on disk already, downloaded
        # under a licence the user accepted, and reaching out mid generation
        # would be a surprise.
        local_files_only=True,
        safety_checker=None,
    )

    if lora is not None:
        try:
            pipeline.load_lora_weights(str(lora))
        except (ValueError, ImportError) as error:
            # Fusing an adapter goes through peft, which is part of the runtime
            # rather than of diffusers. Without it the library refuses the call
            # with a message about a backend the user has never heard of, so
            # the remedy is named here instead.
            raise AdapterUnsupportedError(str(error)) from error

    return pipeline.to(device)


def single_file(directory: Path) -> Path:
    """Return the weights file inside a model directory.

    Args:
        directory: The model directory.

    Returns:
        The first safetensors file, or the first file of any kind.

    Raises:
        FileNotFoundError: The directory holds nothing.
    """
    files = sorted(path for path in directory.iterdir() if path.is_file())
    for path in files:
        if path.suffix == ".safetensors":
            return path
    if files:
        return files[0]
    raise FileNotFoundError(f"no weights in {directory}")


def run_pipeline(
    pipeline: Any,  # noqa: ANN401
    *,
    prompt: str,
    negative_prompt: str,
    width: int,
    height: int,
    steps: int,
    guidance_scale: float,
    seed: int,
    device: str,
) -> Image.Image:
    """Produce one image at the requested size.

    The size asked for is what the sprite ends up as, not what the model is
    asked for.

    The reduction averages over each cell rather than sampling one pixel from
    it. Nearest neighbour is right for scaling pixel art up, and wrong here:
    taking one pixel in every eight from a detailed render throws away seven
    eighths of the shape and returns speckle, which is exactly what it did.
    Averaging keeps the shape; the palette reduction that follows is what makes
    the result read as pixel art rather than as a small photograph.

    Args:
        pipeline: A loaded pipeline.
        prompt: What to draw.
        negative_prompt: What to avoid.
        width: Final width in pixels.
        height: Final height in pixels.
        steps: Denoising steps.
        guidance_scale: How closely to follow the prompt.
        seed: Seed for this image.
        device: Device the pipeline is on.

    Returns:
        The image, at the requested size.
    """
    import torch
    from PIL import Image

    scale = max(MIN_DIMENSION / max(width, height), 1.0)
    # Rounded to a multiple of eight, which is what the latent space requires.
    draw_width = round(width * scale / 8) * 8
    draw_height = round(height * scale / 8) * 8

    generator = torch.Generator(device=device).manual_seed(seed)
    result = pipeline(
        prompt=prompt,
        negative_prompt=negative_prompt or None,
        width=draw_width,
        height=draw_height,
        num_inference_steps=steps,
        guidance_scale=guidance_scale,
        generator=generator,
    )

    image: Image.Image = result.images[0]
    if (image.width, image.height) != (width, height):
        image = image.resize((width, height), Image.Resampling.BOX)
    return image
