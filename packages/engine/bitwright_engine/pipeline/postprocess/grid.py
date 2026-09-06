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

"""Sprite sheet assembly.

Game engines consume a sheet plus frame coordinates, not a folder of files.
This module packs generated frames into a fixed pitch grid and reports where
each frame landed.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import ceil

from PIL import Image

from bitwright_engine.utils.images import new_canvas


@dataclass(frozen=True, slots=True)
class FrameRect:
    """Where one frame sits in the assembled sheet.

    Attributes:
        index: Position of the frame in the input sequence.
        x: Left edge in pixels.
        y: Top edge in pixels.
        width: Frame width in pixels.
        height: Frame height in pixels.
    """

    index: int
    x: int
    y: int
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class SpriteSheet:
    """An assembled sheet and its frame layout.

    Attributes:
        image: The packed sheet.
        frames: One rectangle per input frame, in input order.
        columns: Number of columns in the grid.
        rows: Number of rows in the grid.
    """

    image: Image.Image
    frames: list[FrameRect]
    columns: int
    rows: int


def pack_grid(
    images: list[Image.Image],
    columns: int | None = None,
    padding: int = 0,
) -> SpriteSheet:
    """Pack frames into a uniform grid.

    Every cell is sized to the largest input frame, so that a consumer can
    address frame ``n`` by arithmetic rather than by reading per frame offsets.
    Smaller frames are centred in their cell.

    Args:
        images: Frames to pack, in order. Must not be empty.
        columns: Number of columns. Defaults to a near square layout.
        padding: Transparent gap between cells, in pixels.

    Returns:
        The packed sheet and the position of every frame.

    Raises:
        ValueError: ``images`` is empty, ``columns`` is below 1, or ``padding``
            is negative.
    """
    if not images:
        raise ValueError("images must not be empty")
    if columns is not None and columns < 1:
        raise ValueError("columns must be at least 1")
    if padding < 0:
        raise ValueError("padding must not be negative")

    cell_width = max(image.width for image in images)
    cell_height = max(image.height for image in images)

    column_count = columns if columns is not None else ceil(len(images) ** 0.5)
    row_count = ceil(len(images) / column_count)

    sheet_width = column_count * cell_width + (column_count - 1) * padding
    sheet_height = row_count * cell_height + (row_count - 1) * padding
    sheet = new_canvas(sheet_width, sheet_height)

    frames: list[FrameRect] = []
    for index, frame in enumerate(images):
        column = index % column_count
        row = index // column_count
        cell_x = column * (cell_width + padding)
        cell_y = row * (cell_height + padding)
        x = cell_x + (cell_width - frame.width) // 2
        y = cell_y + (cell_height - frame.height) // 2

        sheet.paste(frame.convert("RGBA"), (x, y))
        frames.append(FrameRect(index=index, x=x, y=y, width=frame.width, height=frame.height))

    return SpriteSheet(image=sheet, frames=frames, columns=column_count, rows=row_count)
