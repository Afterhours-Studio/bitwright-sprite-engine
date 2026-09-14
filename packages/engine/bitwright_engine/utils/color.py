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

"""Colour arithmetic in a perceptually uniform space.

Every decision this engine makes about colour is a decision about whether two
colours look the same, and sRGB cannot answer that. Two greens a viewer cannot
separate are far apart in sRGB and get a palette slot each; a dark blue and a
dark purple that are obviously different sit close together and get merged.
Oklab's lightness is perceived lightness and its two chroma axes are hue
uniform, so a distance in it is a distance a viewer would agree with. The
interface already reasons this way about its own colours, per ADR 0005; this is
the same argument applied to image data.

Oklab is two three by three matrices with a cube root between them, which is
why there is no colour library in the dependency list.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, TypeAlias

import numpy as np

# These four are documentation rather than checks. numpy's stubs cannot be
# parsed while mypy targets 3.11, so the engine treats the whole package as
# untyped and `npt.NDArray[np.float64]` would not be a usable annotation here;
# see the override in pyproject.toml. Naming the four kinds of array this
# module passes around still says which is which at every signature, which is
# the part a reader needs. Shapes are stated in the docstrings.
Floats: TypeAlias = Any
"""Floating point image or colour data, in whatever shape the caller holds."""

Bytes: TypeAlias = Any
"""Eight bit colour channels, as they are stored in a PNG."""

Indices: TypeAlias = Any
"""Positions into a palette, one per colour."""

Counts: TypeAlias = Any
"""Whole number tallies, such as how many pixels each distinct colour covers."""

Mask: TypeAlias = Any
"""A yes or no per pixel, such as which pixels are subject and which are not."""

# Ottosson's matrices, linear sRGB to the cone response the cube root is taken
# of, and that cube root to Oklab. Transposed on use, because colours here are
# rows rather than columns.
_LMS_FROM_LINEAR = np.array(
    [
        [0.4122214708, 0.5363325363, 0.0514459929],
        [0.2119034982, 0.6806995451, 0.1073969566],
        [0.0883024619, 0.2817188376, 0.6299787005],
    ],
    dtype=np.float64,
)

_OKLAB_FROM_ROOT = np.array(
    [
        [0.2104542553, 0.7936177850, -0.0040720468],
        [1.9779984951, -2.4285922050, 0.4505937099],
        [0.0259040371, 0.7827717662, -0.8086757660],
    ],
    dtype=np.float64,
)

_ROOT_FROM_OKLAB = np.linalg.inv(_OKLAB_FROM_ROOT)
_LINEAR_FROM_LMS = np.linalg.inv(_LMS_FROM_LINEAR)

_TRANSFER_KNEE = 0.04045
"""Where the sRGB transfer function stops being a straight line."""

_TRANSFER_KNEE_LINEAR = 0.0031308
"""The same knee, on the linear side."""

REFINEMENT_PASSES = 16
"""Lloyd iterations run after median cut.

Ten to twenty closes most of the gap between plain median cut and a good
quantiser, and at a few thousand distinct colours each pass is milliseconds.
"""

_DISTANCE_BLOCK = 4096
"""Colours compared against the palette at once.

The distance matrix is one float per colour per entry, so a whole 512 by 512
image against a 256 entry palette would be half a gigabyte. Blocking keeps it
at a few megabytes and costs nothing measurable.
"""


def srgb_to_linear(channels: Floats) -> Floats:
    """Undo the sRGB transfer function.

    Args:
        channels: Channel values from 0 to 1, in any shape.

    Returns:
        The same shape, light-linear.
    """
    return np.where(
        channels <= _TRANSFER_KNEE,
        channels / 12.92,
        ((channels + 0.055) / 1.055) ** 2.4,
    )


def linear_to_srgb(channels: Floats) -> Floats:
    """Apply the sRGB transfer function.

    Args:
        channels: Light-linear channel values from 0 to 1, in any shape.

    Returns:
        The same shape, encoded.
    """
    return np.where(
        channels <= _TRANSFER_KNEE_LINEAR,
        channels * 12.92,
        1.055 * np.maximum(channels, 0.0) ** (1 / 2.4) - 0.055,
    )


def srgb_to_oklab(rgb: Floats) -> Floats:
    """Convert encoded sRGB to Oklab.

    Args:
        rgb: Red, green and blue from 0 to 1, shaped ``(..., 3)``.

    Returns:
        Lightness and the two chroma axes, in the same shape.
    """
    lms = srgb_to_linear(rgb) @ _LMS_FROM_LINEAR.T
    return np.cbrt(lms) @ _OKLAB_FROM_ROOT.T


def oklab_to_srgb(lab: Floats) -> Floats:
    """Convert Oklab back to encoded sRGB.

    Values outside the sRGB gamut are clipped rather than mapped, because every
    caller here is converting a mean of colours that were in gamut and so lands
    at most a rounding step outside it.

    Args:
        lab: Lightness and the two chroma axes, shaped ``(..., 3)``.

    Returns:
        Red, green and blue from 0 to 1, in the same shape.
    """
    root = lab @ _ROOT_FROM_OKLAB.T
    linear = (root**3) @ _LINEAR_FROM_LMS.T
    return np.clip(linear_to_srgb(linear), 0.0, 1.0)


def bytes_to_oklab(rgb: Bytes) -> Floats:
    """Convert eight bit sRGB to Oklab.

    Args:
        rgb: Channels from 0 to 255, shaped ``(..., 3)``.

    Returns:
        Oklab, shaped ``(..., 3)``.
    """
    return srgb_to_oklab(rgb.astype(np.float64) / 255.0)


def oklab_to_bytes(lab: Floats) -> Bytes:
    """Convert Oklab to eight bit sRGB.

    Args:
        lab: Oklab, shaped ``(..., 3)``.

    Returns:
        Channels from 0 to 255, shaped ``(..., 3)``.
    """
    rounded = np.rint(oklab_to_srgb(lab) * 255.0)
    return np.clip(rounded, 0, 255).astype(np.uint8)


def nearest_entry(colours: Floats, palette: Floats) -> Indices:
    """Find the closest palette entry for every colour.

    Args:
        colours: Oklab colours, shaped ``(n, 3)``.
        palette: Oklab palette entries, shaped ``(k, 3)``.

    Returns:
        One index into ``palette`` per colour, shaped ``(n,)``.

    Raises:
        ValueError: The palette is empty.
    """
    if palette.shape[0] == 0:
        raise ValueError("palette must have at least one entry")

    found = np.empty(colours.shape[0], dtype=np.intp)
    for start in range(0, colours.shape[0], _DISTANCE_BLOCK):
        block = colours[start : start + _DISTANCE_BLOCK]
        spread = block[:, None, :] - palette[None, :, :]
        found[start : start + _DISTANCE_BLOCK] = np.argmin(
            np.einsum("nkc,nkc->nk", spread, spread), axis=1
        )
    return found


@dataclass(frozen=True, slots=True)
class _Box:
    """One partition of the colour space, part way through a median cut.

    Attributes:
        members: Positions of the colours this box holds.
        error: Weighted sum of squared error against the box's own mean, over
            all three axes and not normalised by the weight.
        axis: Which axis carries the most of that error, and so the axis to cut
            along if this box is chosen.
    """

    members: Indices
    error: float
    axis: int


def _measure(colours: Floats, weights: Floats, members: Indices) -> _Box:
    """Describe one box by its error and its widest axis.

    The error is deliberately not divided by the box's weight. The objective is
    to minimise error over the whole image, so a partition holding a handful of
    pixels must not compete on equal terms with one holding a third of them.

    Args:
        colours: Every distinct colour, in Oklab, shaped ``(n, 3)``.
        weights: Pixel count per colour, shaped ``(n,)``.
        members: Positions this box holds.

    Returns:
        The box, measured.
    """
    held = colours[members]
    share = weights[members]
    total = float(share.sum())
    if total <= 0.0:
        return _Box(members=members, error=0.0, axis=0)

    centre = (held * share[:, None]).sum(axis=0) / total
    spread = held - centre
    per_axis = (spread * spread * share[:, None]).sum(axis=0)
    return _Box(members=members, error=float(per_axis.sum()), axis=int(np.argmax(per_axis)))


def _split(colours: Floats, weights: Floats, box: _Box) -> tuple[Indices, Indices] | None:
    """Cut a box in two at the weighted median of its widest axis.

    Args:
        colours: Every distinct colour, in Oklab.
        weights: Pixel count per colour.
        box: The box to cut.

    Returns:
        The two halves, or None when the box holds a single colour and there is
        nothing to cut.
    """
    if box.members.shape[0] < 2:
        return None

    ordered = box.members[np.argsort(colours[box.members, box.axis], kind="stable")]
    running = np.cumsum(weights[ordered])
    # Searching for the half weight point rather than the half count point: the
    # box represents pixels, not distinct colours, and one colour covering a
    # third of the sprite should sit on its own side of the cut.
    midpoint = int(np.searchsorted(running, running[-1] / 2.0, side="left")) + 1
    cut = min(max(midpoint, 1), ordered.shape[0] - 1)
    return ordered[:cut], ordered[cut:]


def median_cut(colours: Floats, weights: Floats, size: int) -> Floats:
    """Reduce distinct colours to at most ``size`` representatives.

    Weighted median cut, with three departures from the textbook version, all
    of them from Boesch's survey of the heuristics: the box that is cut is the
    one with the largest non-normalised error rather than the longest axis, the
    axis cut is the one carrying the most error, and a box is represented by
    the frequency-weighted mean of its members rather than by its centre.

    Args:
        colours: Every distinct colour, in Oklab, shaped ``(n, 3)``.
        weights: Pixel count per colour, shaped ``(n,)``.
        size: How many representatives to produce.

    Returns:
        Representative colours in Oklab, shaped ``(k, 3)`` with ``k`` at most
        ``size`` and at most the number of distinct colours given.

    Raises:
        ValueError: ``size`` is smaller than 1, or the inputs disagree in
            length.
    """
    if size < 1:
        raise ValueError("size must be at least 1")
    if colours.shape[0] != weights.shape[0]:
        raise ValueError("colours and weights must be the same length")
    if colours.shape[0] == 0:
        return np.zeros((0, 3), dtype=np.float64)

    everything = np.arange(colours.shape[0], dtype=np.intp)
    boxes = [_measure(colours, weights, everything)]

    while len(boxes) < size:
        chosen = max(range(len(boxes)), key=lambda index: boxes[index].error)
        if boxes[chosen].error <= 0.0:
            break
        halves = _split(colours, weights, boxes[chosen])
        if halves is None:
            break
        boxes[chosen] = _measure(colours, weights, halves[0])
        boxes.append(_measure(colours, weights, halves[1]))

    return np.stack([_representative(colours, weights, box.members) for box in boxes])


def _representative(colours: Floats, weights: Floats, members: Indices) -> Floats:
    """Return the frequency-weighted mean colour of one box.

    Args:
        colours: Every distinct colour, in Oklab.
        weights: Pixel count per colour.
        members: Positions the box holds.

    Returns:
        One Oklab colour, shaped ``(3,)``.
    """
    share = weights[members]
    total = float(share.sum())
    if total <= 0.0:
        return colours[members].mean(axis=0)
    return (colours[members] * share[:, None]).sum(axis=0) / total


def refine(colours: Floats, weights: Floats, palette: Floats) -> Floats:
    """Move palette entries onto the weighted centres of what they cover.

    Lloyd's algorithm, seeded from the median cut rather than from random
    points, which is what makes a fixed and small iteration count enough.

    Args:
        colours: Every distinct colour, in Oklab, shaped ``(n, 3)``.
        weights: Pixel count per colour, shaped ``(n,)``.
        palette: Starting entries, in Oklab, shaped ``(k, 3)``.

    Returns:
        The entries, moved, in the same shape.
    """
    entries = palette.shape[0]
    if entries == 0 or colours.shape[0] == 0:
        return palette

    current = palette
    for _ in range(REFINEMENT_PASSES):
        owner = nearest_entry(colours, current)
        covered = np.bincount(owner, weights=weights, minlength=entries)
        moved = np.stack(
            [
                np.bincount(owner, weights=weights * colours[:, axis], minlength=entries)
                for axis in range(3)
            ],
            axis=1,
        )
        # An entry nothing chose keeps its place. Moving it to the origin would
        # put it at black, where it would then win pixels it has no claim to.
        held = covered > 0
        nudged = current.copy()
        nudged[held] = moved[held] / covered[held, None]
        if np.allclose(nudged, current):
            return nudged
        current = nudged

    return current


def build_palette(colours: Floats, weights: Floats, size: int) -> Floats:
    """Derive a palette of at most ``size`` colours.

    Args:
        colours: Every distinct colour, in Oklab, shaped ``(n, 3)``.
        weights: Pixel count per colour, shaped ``(n,)``.
        size: How many entries to produce.

    Returns:
        Palette entries in Oklab, shaped ``(k, 3)``.

    Raises:
        ValueError: ``size`` is smaller than 1.
    """
    return refine(colours, weights, median_cut(colours, weights, size))
