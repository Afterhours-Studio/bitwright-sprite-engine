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

"""Finding the grid a render was actually drawn on.

A model asked for a 64 by 64 sprite at 512 pixels lays down blocks that are
near enough eight pixels wide to read as a grid and not exactly eight pixels
wide anywhere, starting at a fractional offset rather than at zero. Resampling
on the grid the user typed rather than the one the model drew is what smears
every edge, so the grid is measured instead.

The measurement is one DFT bin of the edge energy. If the image really is an
upscaled grid then the energy is a comb, and a comb of period ``s`` puts almost
all of its weight in the bin at that period: the magnitude of that bin is the
confidence, and its argument is the phase. One complex number carries the
spacing, the offset and a measure of how much to trust them, and it needs
nothing but NumPy.

The published alternatives both cost a dependency for less. Canny plus a
probabilistic Hough transform needs OpenCV; peak finding on the summed adjacent
differences needs SciPy, and taking the median of the peak spacings throws the
phase away so that it has to be recovered separately.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image

from bitwright_engine.utils.color import Floats, Mask, bytes_to_oklab

MIN_CELLS = 8
"""Fewest cells across an axis the sweep will consider.

Below this the comb has too few teeth for its bin to mean anything, and no
sprite is four pixels wide.
"""

CONFIDENCE_FLOOR = 0.15
"""Strength below which the phase is noise rather than a measurement.

An upscaled sprite lands above 0.4 and a photograph below 0.1, so the floor
sits in the gap rather than on either population.
"""

ANISOTROPY_LIMIT = 0.03
"""How far the two cell sizes may differ before the caller is told.

A genuine sprite has square cells. Cells that are three percent from square
usually mean the image was resized on one axis at some point, which the user
would want to know rather than have quietly corrected.
"""

HARMONIC_TOLERANCE = 0.9
"""Share of the best strength a smaller cell count needs to win.

A comb of period ``s`` also has energy at every harmonic, so twice and three
times the true cell count score nearly as well as the truth. Taking the
smallest count that comes within a tenth of the best is what stops the
detector reporting 128 for an image whose grid is 64.
"""


@dataclass(frozen=True, slots=True)
class AxisFit:
    """The grid found along one axis.

    Attributes:
        cells: How many cells the axis was divided into.
        size: Width of one cell in source pixels, which is fractional in
            general and is the whole reason this is measured rather than
            assumed.
        phase: Where the first cell boundary sits, from 0 up to ``size``.
        strength: Share of the axis' edge energy that lines up with a comb of
            this period, from 0 to 1.
    """

    cells: int
    size: float
    phase: float
    strength: float


@dataclass(frozen=True, slots=True)
class GridFit:
    """The grid found across both axes.

    Attributes:
        horizontal: Columns, measured across the width.
        vertical: Rows, measured down the height.
    """

    horizontal: AxisFit
    vertical: AxisFit

    @property
    def confidence(self) -> float:
        """Return how much the whole fit can be trusted.

        The weaker axis decides. A grid that was only found in one direction
        has not been found, and reporting the average of a certainty and a
        guess would read as a half certainty rather than as the guess it is.

        Returns:
            The smaller of the two axis strengths.
        """
        return min(self.horizontal.strength, self.vertical.strength)

    @property
    def anisotropic(self) -> bool:
        """Report whether the two cell sizes disagree.

        Returns:
            True when they differ by more than :data:`ANISOTROPY_LIMIT`.
        """
        widest = max(self.horizontal.size, self.vertical.size)
        if widest <= 0.0:
            return False
        return abs(self.horizontal.size - self.vertical.size) / widest > ANISOTROPY_LIMIT


def edge_energy(lab: Floats, opaque: Mask) -> Floats:
    """Sum the colour change across every column boundary.

    A pair where either side is background contributes nothing. The silhouette
    is an edge too, and a strong one, but it sits wherever the subject happens
    to end rather than on the grid, so letting it vote would drag the fit onto
    the shape of the sprite.

    Args:
        lab: The image in Oklab, shaped ``(height, width, 3)``.
        opaque: Which pixels are subject rather than background, shaped
            ``(height, width)``.

    Returns:
        Energy per column boundary, shaped ``(width,)``, with the first entry
        zero because there is nothing to the left of column zero.
    """
    step = lab[:, 1:, :] - lab[:, :-1, :]
    distance = np.sqrt(np.einsum("hwc,hwc->hw", step, step))
    both = opaque[:, 1:] & opaque[:, :-1]

    energy = np.zeros(lab.shape[1], dtype=np.float64)
    energy[1:] = np.where(both, distance, 0.0).sum(axis=0)
    return energy


def fit_axis(energy: Floats, cells: int) -> AxisFit:
    """Measure the comb of a given period against one axis' edge energy.

    Args:
        energy: Edge energy per boundary, shaped ``(length,)``.
        cells: How many cells the axis is assumed to hold.

    Returns:
        The cell size, the phase, and how much of the energy lined up.

    Raises:
        ValueError: ``cells`` is smaller than 1.
    """
    if cells < 1:
        raise ValueError("cells must be at least 1")

    length = energy.shape[0]
    size = length / cells
    total = float(energy.sum())
    if total <= 0.0:
        return AxisFit(cells=cells, size=size, phase=0.0, strength=0.0)

    positions = np.arange(length, dtype=np.float64)
    bin_value = complex(np.sum(energy * np.exp(-2j * np.pi * positions * cells / length)))

    # A comb at phi + k*s lands at exp(-2i*pi*phi/s) in this bin, so the phase
    # is the negated argument. The sign is the one thing here that is easy to
    # get backwards, which is why a test scales a known image by a known offset
    # and reads the offset back rather than trusting this comment.
    phase = float((-np.angle(bin_value) / (2 * np.pi)) * size % size)
    return AxisFit(cells=cells, size=size, phase=phase, strength=abs(bin_value) / total)


def detect_axis(energy: Floats, limit: int) -> AxisFit:
    """Find the cell count that best explains one axis.

    Args:
        energy: Edge energy per boundary, shaped ``(length,)``.
        limit: Largest cell count to consider.

    Returns:
        The fit for the smallest cell count within
        :data:`HARMONIC_TOLERANCE` of the best one found.
    """
    ceiling = max(limit, MIN_CELLS)
    fits = [fit_axis(energy, cells) for cells in range(MIN_CELLS, ceiling + 1)]
    best = max(fit.strength for fit in fits)
    return next(fit for fit in fits if fit.strength >= HARMONIC_TOLERANCE * best)


def detect_grid(
    image: Image.Image,
    cells_across: int | None = None,
    cells_down: int | None = None,
) -> GridFit:
    """Measure the cell size and phase of a render.

    Args:
        image: The render, already background-removed if it is going to be.
        cells_across: Columns the caller wants, or None to find the count too.
        cells_down: Rows the caller wants, or None to find the count too.

    Returns:
        The grid found on both axes.

    Raises:
        ValueError: A requested cell count is smaller than 1, or the image has
            no pixels.
    """
    source = image.convert("RGBA")
    if source.width == 0 or source.height == 0:
        raise ValueError("image must have pixels")

    pixels = np.asarray(source, dtype=np.uint8)
    lab = bytes_to_oklab(pixels[:, :, :3])
    opaque = pixels[:, :, 3] > 0

    # Transposed rather than written twice: the vertical measurement is the
    # horizontal one on an image turned on its side.
    across = edge_energy(lab, opaque)
    down = edge_energy(np.swapaxes(lab, 0, 1), opaque.T)

    limit = max(min(source.width, source.height) // 2, MIN_CELLS)
    return GridFit(
        horizontal=(
            fit_axis(across, cells_across)
            if cells_across is not None
            else detect_axis(across, limit)
        ),
        vertical=(
            fit_axis(down, cells_down) if cells_down is not None else detect_axis(down, limit)
        ),
    )
