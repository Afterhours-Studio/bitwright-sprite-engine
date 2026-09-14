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

"""Trading a colour that is not in the palette for two that are.

Dithering runs here, after the downsample and at the target resolution, rather
than inside the palette reduction as the generate path does it. A dither is by
construction a pattern with no local majority, so a modal vote over the source
destroys one completely and what survives is noise. There is nothing to dither
until the sprite is the size it will be looked at.

Ordered is the mode to reach for on sprite work, and the reason is mechanical
rather than aesthetic: error diffusion is content dependent, so two frames of a
walk cycle that differ by three pixels dither differently across the whole
sprite and the flat areas crawl during playback. A threshold matrix is keyed to
the pixel grid and is identical in every frame.
"""

from __future__ import annotations

from typing import Final, Literal, get_args

import numpy as np

from bitwright_engine.utils.color import Floats, Indices, Mask, nearest_entry

DitherMode = Literal["none", "bayer2", "bayer4", "bayer8", "floyd_steinberg"]
"""How to break up a band the palette cannot render smoothly."""

DITHER_MODES: Final[tuple[DitherMode, ...]] = get_args(DitherMode)
"""Every dither mode, in the order an interface should offer them."""

_BAYER_SIDES: Final[dict[str, int]] = {"bayer2": 2, "bayer4": 4, "bayer8": 8}
"""Side length of the threshold matrix each ordered mode uses."""

# Floyd and Steinberg's weights, as offsets from the pixel being placed. The
# denominator is 16.
_DIFFUSION: Final[tuple[tuple[int, int, float], ...]] = (
    (1, 0, 7 / 16),
    (-1, 1, 3 / 16),
    (0, 1, 5 / 16),
    (1, 1, 1 / 16),
)


def bayer_matrix(side: int) -> Floats:
    """Build an ordered dithering threshold matrix.

    Args:
        side: Side length, which must be a power of two.

    Returns:
        Thresholds from 0 up to 1, shaped ``(side, side)``.

    Raises:
        ValueError: ``side`` is not a power of two of at least 1.
    """
    if side < 1 or side & (side - 1) != 0:
        raise ValueError("side must be a power of two")

    matrix = np.zeros((1, 1), dtype=np.float64)
    while matrix.shape[0] < side:
        matrix = np.block(
            [
                [4 * matrix, 4 * matrix + 2],
                [4 * matrix + 3, 4 * matrix + 1],
            ]
        )
    return matrix / matrix.size


def palette_spread(entries: Floats) -> float:
    """Measure how far apart the palette's entries sit.

    This is what a dither's threshold is scaled by. Perturbing a colour by less
    than the gap between two entries changes nothing, and perturbing it by more
    reaches an entry that is not one of the two the pixel sits between, so the
    useful magnitude is the gap itself.

    Args:
        entries: Palette entries in Oklab, shaped ``(k, 3)``.

    Returns:
        The mean distance from an entry to its nearest neighbour, or 0 when
        there is only one entry.
    """
    if entries.shape[0] < 2:
        return 0.0

    spread = entries[:, None, :] - entries[None, :, :]
    distance = np.sqrt(np.einsum("ijc,ijc->ij", spread, spread))
    np.fill_diagonal(distance, np.inf)
    return float(distance.min(axis=1).mean())


def snap(lab: Floats, opaque: Mask, entries: Floats, mode: DitherMode) -> Indices:
    """Choose a palette entry for every pixel.

    Args:
        lab: The image in Oklab, shaped ``(height, width, 3)``.
        opaque: Which pixels carry a colour at all, shaped ``(height, width)``.
        entries: Palette entries in Oklab, shaped ``(k, 3)``.
        mode: Which dither to apply, if any.

    Returns:
        One index into ``entries`` per pixel, shaped ``(height, width)``.
        Positions that are not opaque hold an arbitrary index.
    """
    if mode == "floyd_steinberg":
        return _diffuse(lab, opaque, entries)

    height, width, _ = lab.shape
    shifted = lab
    side = _BAYER_SIDES.get(mode)
    if side is not None:
        tiled = np.tile(bayer_matrix(side), (height // side + 1, width // side + 1))
        offset = (tiled[:height, :width] - 0.5) * palette_spread(entries)
        shifted = lab + offset[:, :, None]

    return nearest_entry(shifted.reshape(-1, 3), entries).reshape(height, width)


def _diffuse(lab: Floats, opaque: Mask, entries: Floats) -> Indices:
    """Place every pixel and push its error onto the neighbours not yet placed.

    Args:
        lab: The image in Oklab, shaped ``(height, width, 3)``.
        opaque: Which pixels carry a colour at all.
        entries: Palette entries in Oklab, shaped ``(k, 3)``.

    Returns:
        One index into ``entries`` per pixel.
    """
    height, width, _ = lab.shape
    work = lab.astype(np.float64, copy=True)
    chosen = np.zeros((height, width), dtype=np.intp)

    for y in range(height):
        for x in range(width):
            if not opaque[y, x]:
                continue
            gap = entries - work[y, x]
            index = int(np.argmin(np.einsum("kc,kc->k", gap, gap)))
            chosen[y, x] = index
            error = work[y, x] - entries[index]
            for dx, dy, share in _DIFFUSION:
                # Transparent neighbours are skipped rather than given the
                # error. A pixel outside the silhouette is never drawn, so
                # anything pushed onto it is error the sprite never pays back.
                nx, ny = x + dx, y + dy
                if 0 <= nx < width and 0 <= ny < height and opaque[ny, nx]:
                    work[ny, nx] += error * share

    return chosen
