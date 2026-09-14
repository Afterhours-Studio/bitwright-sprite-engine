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

"""Reducing a render to one pixel per cell.

The output pixel is the most common colour inside the cell, not the average of
it and not a sample of it. That choice is the difference between a sprite and a
small blurry painting, and it is worth stating why the two obvious answers are
both wrong.

**Area average**, which is what Pillow's box filter and the generate path's
``snap_to_grid`` do, is stable against a phase error and invents a colour in
every cell that contains part of an edge. A 64 by 64 character sprite is mostly
edges, so most cells come back as the blend of the two sides: the image goes
soft and the distinct colour count goes up rather than down. The palette step
then has to choose between the real colours and the invented in-between ones,
and it has no way to tell them apart.

**Nearest neighbour** takes one source pixel and is exact if and only if the
phase is exact and the cell is flat. A diffusion image's cells are neither, and
a half pixel phase error puts the sample on a boundary, where the colour it
reads belongs to neither of the two cells it sits between. One wrong sample is
one wrong pixel, which is 0.02 percent of a 64 by 64 sprite and entirely
visible.

**The mode** returns a colour that was in the source and that most of the cell
agrees on, and it keeps a hard edge: a cell that is seventy percent body and
thirty percent outline returns body rather than a blend.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image

from bitwright_engine.pipeline.conform.grid import AxisFit
from bitwright_engine.utils.color import (
    Bytes,
    Floats,
    Indices,
    bytes_to_oklab,
    oklab_to_bytes,
)

Colour = tuple[int, int, int]
"""One eight bit sRGB triple, as a cell's answer rather than as image data."""

PRE_QUANTISE = 128
"""Colours the source is reduced to before any cell is counted.

In a smooth image no two pixels share an exact colour, so the mode over raw
eight bit triples is an arbitrary singleton. This palette is thrown away
immediately; it exists only to make "the most common colour in this cell" a
question with an answer. It is also the one place sRGB quantization is
acceptable, precisely because the result is discarded.
"""

INSET = 0.25
"""How much of each side of a cell is left out of the vote.

The anti-aliased transition between two adjacent cells occupies the outermost
pixel or so of each. Leaving a quarter off every side stops a blend colour ever
winning, and makes the result insensitive to a phase error of up to a quarter
of a cell, which is the difference between a correct result and a result that
is correct over most of the image.
"""

INSET_FLOOR = 4.0
"""Cell size below which the inset is dropped.

Under four pixels the inset leaves fewer than two pixels on an axis, which is
not a vote. The full cell is used instead and the sensitivity to phase is
accepted.
"""

MIN_CELL = 1.5
"""Cell size below which there is nothing to downsample.

The source is already at or under the target size, and resampling it would be
inventing detail rather than removing it.
"""

MODE_SHARE = 0.4
"""Share of a cell the winning colour needs to count as a majority.

Below it the cell has no dominant colour, which is what genuine dithering in
the source looks like, and the answer falls back to the mean. That is what a
viewer sees when they look at a dither anyway.
"""


@dataclass(frozen=True, slots=True)
class _Span:
    """The source pixels one interval touches, and how much of each.

    Attributes:
        first: Index of the first pixel touched.
        last: One past the last pixel touched.
        weights: How much of each of those pixels the interval covers, from 0
            to 1, shaped ``(last - first,)``.
    """

    first: int
    last: int
    weights: Floats


@dataclass(frozen=True, slots=True)
class _Source:
    """The render, in every form a cell's vote needs to read it.

    Attributes:
        rgb: The colours as they arrived, shaped ``(height, width, 3)``.
        coverage: Mask alpha from 0 to 1, shaped ``(height, width)``.
        index: Which throwaway palette entry each pixel fell into.
        table: That palette, in eight bit sRGB, shaped ``(n, 3)``.
        lab_table: The same palette in Oklab, for the no-majority fallback.
    """

    rgb: Bytes
    coverage: Floats
    index: Indices
    table: Bytes
    lab_table: Floats


def modal_downsample(
    image: Image.Image,
    horizontal: AxisFit,
    vertical: AxisFit,
    alpha_threshold: float,
) -> Image.Image:
    """Reduce a render to one pixel per cell of the grid it was drawn on.

    Args:
        image: The render, already background-removed if it is going to be.
        horizontal: The column grid, from :mod:`~bitwright_engine.pipeline.conform.grid`.
        vertical: The row grid.
        alpha_threshold: Coverage a cell needs to come out opaque, 0 to 1.

    Returns:
        An RGBA image ``horizontal.cells`` by ``vertical.cells``, every pixel
        either fully opaque or fully transparent.

    Raises:
        ValueError: A cell count is smaller than 1.
    """
    if horizontal.cells < 1 or vertical.cells < 1:
        raise ValueError("cell counts must be at least 1")

    image_rgba = image.convert("RGBA")
    pixels = np.asarray(image_rgba, dtype=np.uint8)
    index, table = _pre_quantise(image_rgba)
    source = _Source(
        rgb=pixels[:, :, :3],
        coverage=pixels[:, :, 3].astype(np.float64) / 255.0,
        index=index,
        table=table,
        lab_table=bytes_to_oklab(table),
    )

    columns = [_spans(horizontal, cell, image_rgba.width) for cell in range(horizontal.cells)]
    rows = [_spans(vertical, cell, image_rgba.height) for cell in range(vertical.cells)]

    colour = np.zeros((vertical.cells, horizontal.cells, 3), dtype=np.uint8)
    alpha = np.zeros((vertical.cells, horizontal.cells), dtype=np.uint8)

    for row, (full_y, inset_y) in enumerate(rows):
        for column, (full_x, inset_x) in enumerate(columns):
            # The silhouette is defined at the cell boundary, so the alpha is
            # measured over the whole cell. Insetting it too would shrink the
            # sprite by half a pixel on every side.
            if _mean(source.coverage, full_y, full_x) < alpha_threshold:
                continue

            # The inset is the vote that matters. Falling back to the full cell
            # covers the one case it cannot answer: a cell whose middle is
            # entirely background while its edges are not.
            found = _vote(source, inset_y, inset_x)
            if found is None:
                found = _vote(source, full_y, full_x)
            if found is None:
                continue

            alpha[row, column] = 255
            colour[row, column] = found

    return Image.fromarray(np.dstack([colour, alpha]), mode="RGBA")


def harden_alpha(image: Image.Image, alpha_threshold: float) -> Image.Image:
    """Make every pixel either fully opaque or fully transparent.

    The path that skips the downsample still has to make this decision, because
    a soft alpha edge is exactly the thing conform exists to remove.

    Args:
        image: Source image.
        alpha_threshold: Coverage a pixel needs to stay, 0 to 1.

    Returns:
        A new RGBA image with no partial transparency.
    """
    pixels = np.asarray(image.convert("RGBA"), dtype=np.uint8).copy()
    opaque = pixels[:, :, 3] >= round(alpha_threshold * 255)
    pixels[:, :, 3] = np.where(opaque, 255, 0).astype(np.uint8)
    return Image.fromarray(pixels, mode="RGBA")


def _pre_quantise(source: Image.Image) -> tuple[Indices, Bytes]:
    """Reduce the source to a throwaway palette so that a mode exists.

    Args:
        source: The render, in RGBA.

    Returns:
        The palette index of every pixel, shaped ``(height, width)``, and the
        palette itself, shaped ``(n, 3)``.
    """
    reduced = source.convert("RGB").quantize(colors=PRE_QUANTISE, method=Image.Quantize.FASTOCTREE)
    entries = reduced.getpalette("RGB") or []
    table = np.asarray(entries, dtype=np.uint8).reshape(-1, 3)
    return np.asarray(reduced, dtype=np.intp), table


def _spans(axis: AxisFit, cell: int, length: int) -> tuple[_Span, _Span]:
    """Work out which source pixels one cell covers, and how much of each.

    Args:
        axis: The grid this cell belongs to.
        cell: Which cell along that axis.
        length: Size of the source along that axis.

    Returns:
        The full cell and the inset cell, each as a slice and its per-pixel
        coverage.
    """
    start = axis.phase + cell * axis.size
    margin = INSET * axis.size if axis.size >= INSET_FLOOR else 0.0
    return (
        _cover(start, start + axis.size, length),
        _cover(start + margin, start + axis.size - margin, length),
    )


def _cover(start: float, stop: float, length: int) -> _Span:
    """Measure how much of each source pixel an interval covers.

    The cell size is fractional in general, so a cell's first and last pixels
    are shared with its neighbours and count for less than a whole vote.

    Args:
        start: Where the interval begins, in source pixels.
        stop: Where it ends.
        length: Size of the source along this axis.

    Returns:
        The pixels touched and their coverage.
    """
    first = max(0, int(np.floor(start)))
    last = min(length, int(np.ceil(stop)))
    if last <= first:
        return _Span(first, first, np.zeros(0, dtype=np.float64))

    edges = np.arange(first, last, dtype=np.float64)
    covered = np.minimum(stop, edges + 1.0) - np.maximum(start, edges)
    return _Span(first, last, np.clip(covered, 0.0, 1.0))


def _weights(coverage: Floats, rows: _Span, columns: _Span) -> Floats:
    """Build the per-pixel vote weight over one rectangle.

    Args:
        coverage: Mask alpha of the whole image, from 0 to 1.
        rows: The rows the rectangle touches.
        columns: The columns it touches.

    Returns:
        One weight per pixel of the rectangle, shaped
        ``(rows, columns)``.
    """
    window = coverage[rows.first : rows.last, columns.first : columns.last]
    return window * rows.weights[:, None] * columns.weights[None, :]


def _mean(coverage: Floats, rows: _Span, columns: _Span) -> float:
    """Average the mask alpha over one rectangle, weighted by coverage.

    Args:
        coverage: Mask alpha of the whole image, from 0 to 1.
        rows: The rows the rectangle touches.
        columns: The columns it touches.

    Returns:
        The coverage-weighted mean alpha, or 0 for an empty rectangle.
    """
    area = rows.weights[:, None] * columns.weights[None, :]
    total = float(area.sum())
    if total <= 0.0:
        return 0.0
    window = coverage[rows.first : rows.last, columns.first : columns.last]
    return float((window * area).sum() / total)


def _vote(source: _Source, rows: _Span, columns: _Span) -> Colour | None:
    """Pick the colour one rectangle of the source agrees on.

    Args:
        source: The render in the forms the vote reads.
        rows: The rows the rectangle touches.
        columns: The columns it touches.

    Returns:
        The winning colour, or None when nothing in the rectangle carries any
        weight at all and the caller should widen its search.
    """
    weights = _weights(source.coverage, rows, columns)
    total = float(weights.sum())
    if total <= 0.0:
        return None

    window = source.index[rows.first : rows.last, columns.first : columns.last]
    tally = np.bincount(window.ravel(), weights=weights.ravel(), minlength=source.table.shape[0])
    winner = int(np.argmax(tally))

    if tally[winner] / total >= MODE_SHARE:
        # The throwaway palette decided which colour won, and is then asked
        # nothing further: the answer is the colour the source actually holds,
        # not the eight bit approximation the octree replaced it with. Without
        # this the whole pipeline returns colours that are a unit or two off
        # everywhere, which is the defect it exists to remove.
        held = source.rgb[rows.first : rows.last, columns.first : columns.last]
        agreed = window == winner
        return _exact(held[agreed], weights[agreed])

    # No majority, which is what a dither in the source looks like. The mean is
    # the only place in the whole pipeline where a colour that was not in the
    # source is invented, and the palette step quantises it away immediately.
    mean = (source.lab_table * tally[:, None]).sum(axis=0) / total
    blended = oklab_to_bytes(mean)
    return (int(blended[0]), int(blended[1]), int(blended[2]))


def _exact(colours: Bytes, weights: Floats) -> Colour:
    """Return the most common of the colours that fell into the winning entry.

    Args:
        colours: The source colours, shaped ``(n, 3)``.
        weights: Their vote weights, shaped ``(n,)``.

    Returns:
        The colour carrying the most weight.
    """
    # Packed into one integer so that the tally is over a single column. Three
    # channels of eight bits fit in twenty four, with no loss and no rounding.
    packed = (
        colours[:, 0].astype(np.int64) << 16
        | colours[:, 1].astype(np.int64) << 8
        | colours[:, 2].astype(np.int64)
    )
    values, positions = np.unique(packed, return_inverse=True)
    best = int(values[int(np.argmax(np.bincount(positions, weights=weights)))])
    return ((best >> 16) & 0xFF, (best >> 8) & 0xFF, best & 0xFF)
