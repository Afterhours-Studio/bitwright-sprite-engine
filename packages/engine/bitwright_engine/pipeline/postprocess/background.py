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

"""Background removal.

Sprites need a transparent background. The scaffold uses a corner flood fill,
which is exact for the flat backgrounds a pixel art prompt usually produces and
costs nothing to run. A segmentation model is the planned replacement for
photographic backgrounds; see MODELS.md for the ``rembg-u2net`` entry.
"""

from __future__ import annotations

from collections import deque
from typing import cast

from PIL import Image

Pixel = tuple[int, int, int, int]


def remove_background(image: Image.Image, tolerance: int = 12) -> Image.Image:
    """Make the background transparent by flood filling from the corners.

    Pixels connected to a corner whose colour is within ``tolerance`` of that
    corner become fully transparent. Interior pixels of the same colour are
    kept, so a sprite that contains the background colour does not develop
    holes.

    Args:
        image: Source image. Converted to RGBA if it is not already.
        tolerance: Maximum per-channel difference, 0 to 255, still treated as
            background.

    Returns:
        A new image with the background cleared.

    Raises:
        ValueError: ``tolerance`` is outside 0 to 255.
    """
    if not 0 <= tolerance <= 255:
        raise ValueError("tolerance must be between 0 and 255")

    result = image.convert("RGBA")
    width, height = result.size
    if width == 0 or height == 0:
        return result

    pixels = result.load()
    if pixels is None:  # pragma: no cover - Pillow always provides an accessor
        return result

    corners = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]
    seen: set[tuple[int, int]] = set()
    queue: deque[tuple[int, int]] = deque()

    for corner in corners:
        reference = cast(Pixel, pixels[corner])
        queue.append(corner)
        while queue:
            x, y = queue.popleft()
            if (x, y) in seen or not (0 <= x < width and 0 <= y < height):
                continue
            seen.add((x, y))

            current = cast(Pixel, pixels[x, y])
            if current[3] == 0 or _within(current, reference, tolerance):
                pixels[x, y] = (current[0], current[1], current[2], 0)
                queue.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])

    return result


def _within(pixel: Pixel, reference: Pixel, tolerance: int) -> bool:
    """Report whether two colours are within a per-channel tolerance.

    Args:
        pixel: Colour to test.
        reference: Colour to compare against.
        tolerance: Maximum per-channel difference.

    Returns:
        True when every red, green, and blue channel is close enough.
    """
    return all(abs(pixel[index] - reference[index]) <= tolerance for index in range(3))
