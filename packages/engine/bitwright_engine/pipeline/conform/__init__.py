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

"""Turning an image of pixel art into pixel art.

Most images of pixel art are not pixel art. A screenshot, a scan, an upscaled
JPEG or anything a generative model drew looks right at a glance and measures
wrong: the grid drifts by a pixel or two across the image and starts at a
fractional offset, every block boundary carries a pixel of blend, and a sixteen
colour sprite arrives with tens of thousands of distinct colours that are close
to right rather than right. None of it shows until the sprite is brought into
the editor at its real size, where every drifted cell is a pixel the artist
did not place.

Conform is the importer, and it is one operation that fixes all three:

1. separate the subject from the background,
2. find the cell size and the phase the image was actually drawn on,
3. take the most common colour in each cell,
4. build a palette in Oklab,
5. snap every cell to it.

This is a pipeline of its own rather than a change to
:mod:`bitwright_engine.pipeline.postprocess`, whose steps are cheap defaults
that run over a finished sprite. Conform is the expensive answer, asked for
explicitly, and it measures the image rather than assuming anything about it.

The order differs from the post-processing path's, and deliberately. Background
removal runs **first** here, because a cell that straddles the silhouette must
not let background pixels vote on the subject's colour. Post-processing runs it
last, which is correct for a box filter that averages everything in the cell
regardless, and wrong for a modal vote.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image

from bitwright_engine.pipeline.conform import palette as palette_step
from bitwright_engine.pipeline.conform.dither import DITHER_MODES, DitherMode
from bitwright_engine.pipeline.conform.downsample import (
    MIN_CELL,
    harden_alpha,
    modal_downsample,
)
from bitwright_engine.pipeline.conform.grid import (
    CONFIDENCE_FLOOR,
    AxisFit,
    GridFit,
    detect_grid,
)
from bitwright_engine.pipeline.postprocess.background import remove_background

__all__ = [
    "DITHER_MODES",
    "ConformOptions",
    "ConformResult",
    "DitherMode",
    "GridFit",
    "conform",
]

ALREADY_AT_SIZE = "conform.already_at_size"
"""The source is at or below the target, so there was nothing to resample."""

BACKGROUND_UNCERTAIN = "conform.background_uncertain"
"""The flood fill either found nothing or ate the sprite."""

GRID_ANISOTROPIC = "conform.grid_anisotropic"
"""The two cell sizes disagree, which usually means a non-uniform resize."""

GRID_NOT_FOUND = "conform.grid_not_found"
"""No comb was found in the edge energy, so the phase would have been noise."""

_CLEARED_FLOOR = 0.05
"""Least of a sprite that should be transparent for the fill to be believed."""

_CLEARED_CEILING = 0.95
"""Most of a sprite that should be transparent before the fill is suspect."""


@dataclass(frozen=True, slots=True)
class ConformOptions:
    """What to correct, and how far.

    Attributes:
        width: Cells across to produce. ``None`` asks conform to find the count
            as well as the size.
        height: Cells down to produce, on the same terms.
        remove_background: Clear the background to transparency first.
        background_tolerance: Per-channel colour tolerance for the flood fill.
        palette_size: Reduce to this many colours. ``None`` keeps every colour
            the downsample produced.
        dither: Which dither to apply while snapping to the palette. Ignored
            when there is no palette to snap to.
        alpha_threshold: Coverage a cell needs to come out opaque, 0.05 to
            0.95. There is no soft alpha: a sprite with a soft edge is the
            thing this operation exists to remove.
    """

    width: int | None = None
    height: int | None = None
    remove_background: bool = True
    background_tolerance: int = 12
    palette_size: int | None = 32
    dither: DitherMode = "none"
    alpha_threshold: float = 0.5


@dataclass(frozen=True, slots=True)
class ConformResult:
    """A corrected sprite, and what was measured on the way.

    Attributes:
        image: The sprite, RGBA, with no partial transparency.
        palette: Colours it uses, as hex, most used first. Empty when the
            colours were left alone and there are too many to be a palette.
        grid: The cell size and phase that were found.
        warnings: Stable reason codes for anything the user should know.
    """

    image: Image.Image
    palette: list[str]
    grid: GridFit
    warnings: list[str]


def conform(image: Image.Image, options: ConformOptions) -> ConformResult:
    """Correct one render into a sprite.

    Args:
        image: The render, as the model produced it.
        options: What to correct.

    Returns:
        The sprite, its palette, the grid that was found, and any warnings.

    Raises:
        ValueError: The image has no pixels, a requested cell count is smaller
            than 1, or ``palette_size`` is outside 2 to 256.
    """
    source = image.convert("RGBA")
    warnings: list[str] = []

    if options.remove_background:
        source = remove_background(source, tolerance=options.background_tolerance)
        if not _plausible(source):
            warnings.append(BACKGROUND_UNCERTAIN)

    grid = detect_grid(source, options.width, options.height)
    if grid.confidence < CONFIDENCE_FLOOR:
        warnings.append(GRID_NOT_FOUND)
        # The phase that came back is noise either way, so it goes. What
        # happens to the cell size depends on where it came from: a size the
        # caller named is still the size they want, and only the offset was
        # guessed. A size nothing found and nobody asked for is a guess all the
        # way down, and resampling a sprite onto it would destroy it to no
        # purpose, so the source's own pixels are used as the grid instead.
        asked = options.width is not None and options.height is not None
        grid = _without_phase(grid) if asked else _per_pixel(source, grid)
    if grid.anisotropic:
        warnings.append(GRID_ANISOTROPIC)

    if min(grid.horizontal.size, grid.vertical.size) < MIN_CELL:
        warnings.append(ALREADY_AT_SIZE)
        result = harden_alpha(source, options.alpha_threshold)
    else:
        result = modal_downsample(source, grid.horizontal, grid.vertical, options.alpha_threshold)

    if options.palette_size is not None:
        result = palette_step.reduce_palette(result, options.palette_size, options.dither)

    return ConformResult(
        image=result,
        palette=palette_step.report(result),
        grid=grid,
        warnings=warnings,
    )


def _plausible(cleared: Image.Image) -> bool:
    """Report whether what is left after the fill looks like a subject.

    A sprite with almost no transparency has no background separated from it,
    and one that is almost all transparency has had its subject eaten. Both are
    the signature of a photographic background, which a corner flood fill
    cannot handle and a segmentation model would have to.

    Measured on the result rather than on what the fill itself removed, which
    is the same test on a render that arrived opaque and a better one on a
    sprite that was already transparent: a fill that finds nothing to do on an
    image that already has its background off is not a failure.

    Args:
        cleared: The image with the background removed.

    Returns:
        True when between five and ninety five percent of it is transparent.
    """
    alpha = np.asarray(cleared, dtype=np.uint8)[:, :, 3]
    if alpha.size == 0:
        return False

    share = float(np.count_nonzero(alpha == 0)) / float(alpha.size)
    return _CLEARED_FLOOR <= share <= _CLEARED_CEILING


def _without_phase(grid: GridFit) -> GridFit:
    """Return the same grid with both phases set to zero.

    Args:
        grid: The grid that was measured.

    Returns:
        The grid, with the cell sizes and strengths kept and the offsets
        discarded.
    """
    return GridFit(
        horizontal=_zeroed(grid.horizontal),
        vertical=_zeroed(grid.vertical),
    )


def _per_pixel(image: Image.Image, measured: GridFit) -> GridFit:
    """Return the grid of one cell per source pixel.

    What is used when there was no grid to find and no size to aim for. It
    trips the downsample's own guard, so the sprite keeps its size and only its
    colours and its edge are corrected.

    The strengths are carried over from what was measured, so that the caller
    is told how little was found rather than being shown a zero this fallback
    invented.

    Args:
        image: The render.
        measured: What the detector did find, weak as it was.

    Returns:
        A grid whose cells are one pixel across.
    """
    return GridFit(
        horizontal=AxisFit(
            cells=image.width, size=1.0, phase=0.0, strength=measured.horizontal.strength
        ),
        vertical=AxisFit(
            cells=image.height, size=1.0, phase=0.0, strength=measured.vertical.strength
        ),
    )


def _zeroed(axis: AxisFit) -> AxisFit:
    """Return one axis fit with its phase set to zero.

    Args:
        axis: The fit that was measured.

    Returns:
        The same fit, starting at zero.
    """
    return AxisFit(cells=axis.cells, size=axis.size, phase=0.0, strength=axis.strength)
