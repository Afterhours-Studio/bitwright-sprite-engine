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

"""Wire types for correcting an existing sprite."""

from __future__ import annotations

from pydantic import Field

from bitwright_engine.api.schemas.common import CamelModel
from bitwright_engine.pipeline.conform import ConformOptions, DitherMode, GridFit

MAX_CELLS = 1024
"""Largest target a sprite may be conformed to.

Well above anything anyone draws by hand, and low enough that a request cannot
ask the engine to allocate a cell grid larger than the render it came from.
"""


class ConformBody(CamelModel):
    """A request to correct one sprite.

    Attributes:
        image: The sprite, base64 encoded PNG, without a data URL prefix.
        width: Cells across to produce, or null to detect the count as well as
            the size.
        height: Cells down to produce, on the same terms.
        remove_background: Whether to make the background transparent.
        background_tolerance: How close a pixel must be to the corner colour to
            count as background.
        palette_size: Colours to reduce to, or null to leave them alone.
        dither: Which dither to apply while snapping to the palette.
        alpha_threshold: How much of a cell has to be subject for that cell to
            come out opaque.
    """

    image: str = Field(min_length=1)
    width: int | None = Field(default=None, ge=1, le=MAX_CELLS)
    height: int | None = Field(default=None, ge=1, le=MAX_CELLS)
    remove_background: bool = True
    background_tolerance: int = Field(default=12, ge=0, le=255)
    palette_size: int | None = Field(default=32, ge=2, le=256)
    dither: DitherMode = "none"
    alpha_threshold: float = Field(default=0.5, ge=0.05, le=0.95)

    def to_options(self) -> ConformOptions:
        """Convert to the pipeline's options type.

        Returns:
            The equivalent :class:`ConformOptions`.
        """
        return ConformOptions(
            width=self.width,
            height=self.height,
            remove_background=self.remove_background,
            background_tolerance=self.background_tolerance,
            palette_size=self.palette_size,
            dither=self.dither,
            alpha_threshold=self.alpha_threshold,
        )


class DetectedGrid(CamelModel):
    """The grid conform found in the render.

    Reported because it is the one number that says whether the result can be
    trusted. A cell size that is nothing like the one the user expected, or a
    confidence near zero, means the image was not an upscaled sprite and the
    result is a resize rather than a correction.

    Attributes:
        cell_width: Source pixels per cell across, which is fractional in
            general.
        cell_height: Source pixels per cell down.
        phase_x: Where the first column boundary sat, in source pixels.
        phase_y: Where the first row boundary sat.
        confidence: Share of the edge energy that lined up with the grid, 0 to
            1, taken from whichever axis was weaker.
    """

    cell_width: float
    cell_height: float
    phase_x: float
    phase_y: float
    confidence: float

    @classmethod
    def of(cls, grid: GridFit) -> DetectedGrid:
        """Build the wire form of a measured grid.

        Args:
            grid: What the detector found.

        Returns:
            The same numbers, flattened for the wire.
        """
        return cls(
            cell_width=grid.horizontal.size,
            cell_height=grid.vertical.size,
            phase_x=grid.horizontal.phase,
            phase_y=grid.vertical.phase,
            confidence=grid.confidence,
        )


class ConformResponse(CamelModel):
    """A corrected sprite.

    Attributes:
        image: The result, base64 encoded PNG.
        width: Result width in pixels.
        height: Result height in pixels.
        palette: Every colour the result uses, as hex, opaque pixels only,
            most used first. Empty when the result has more colours than a
            palette could hold.
        detected: The grid the render turned out to be drawn on.
        duration_ms: How long the correction took.
        warnings: Stable reason codes for anything the user should know.
    """

    image: str
    width: int
    height: int
    palette: list[str]
    detected: DetectedGrid
    duration_ms: int
    warnings: list[str]
