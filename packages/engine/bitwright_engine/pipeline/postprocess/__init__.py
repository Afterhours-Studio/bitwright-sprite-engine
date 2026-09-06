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

"""Post-processing steps applied to raw backend output."""

from __future__ import annotations

from dataclasses import dataclass

from PIL import Image

from bitwright_engine.pipeline.postprocess.background import remove_background
from bitwright_engine.pipeline.postprocess.grid import FrameRect, SpriteSheet, pack_grid
from bitwright_engine.pipeline.postprocess.quantize import quantize, snap_to_grid

__all__ = [
    "FrameRect",
    "PostProcessOptions",
    "SpriteSheet",
    "apply",
    "pack_grid",
    "quantize",
    "remove_background",
    "snap_to_grid",
]


@dataclass(frozen=True, slots=True)
class PostProcessOptions:
    """Which post-processing steps to run, and how.

    Attributes:
        remove_background: Clear the background to transparency.
        background_tolerance: Per-channel colour tolerance for the background
            flood fill.
        palette_size: Reduce to this many colours. ``None`` skips quantization.
        dither: Apply dithering during quantization.
        pixel_grid: Snap to a grid of this block size. ``None`` skips snapping.
    """

    remove_background: bool = True
    background_tolerance: int = 12
    palette_size: int | None = 32
    dither: bool = False
    pixel_grid: int | None = None


def apply(image: Image.Image, options: PostProcessOptions) -> Image.Image:
    """Run the enabled post-processing steps in order.

    Order matters. Snapping first fixes the pixel grid, quantizing next reduces
    the colour count on already flat blocks, and background removal runs last so
    that it works on the final colours rather than on colours quantization is
    about to change.

    Args:
        image: Raw backend output.
        options: Which steps to run.

    Returns:
        The processed image. A new image is returned even when every step is
        disabled.
    """
    result = image.convert("RGBA")

    if options.pixel_grid is not None:
        result = snap_to_grid(result, options.pixel_grid)

    if options.palette_size is not None:
        result = quantize(result, colors=options.palette_size, dither=options.dither)

    if options.remove_background:
        result = remove_background(result, tolerance=options.background_tolerance)

    return result
