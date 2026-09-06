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

"""Camera angle, and the directions a character is drawn facing.

A game character is not one sprite. It is the same character seen from a set of
directions, and how many there are is decided by the kind of game: two for a
platformer, four for a top-down game, eight for an isometric one. Asking for a
character therefore means asking for a set, and the engine names each member so
the interface can lay them out by where they point rather than by index.

Which counts make sense depends on the camera. A side view has no north, so
offering eight directions there would be offering nonsense.
"""

from __future__ import annotations

from enum import StrEnum


class CameraAngle(StrEnum):
    """Where the camera sits relative to the character."""

    SIDE = "side"
    TOP_DOWN = "top_down"
    ISOMETRIC = "isometric"
    FRONT = "front"


CAMERA_TERMS: dict[CameraAngle, str] = {
    CameraAngle.SIDE: "side view, orthographic side profile",
    CameraAngle.TOP_DOWN: "top-down view, seen from above",
    CameraAngle.ISOMETRIC: "isometric view, 2:1 dimetric projection",
    CameraAngle.FRONT: "front view, facing the viewer",
}
"""What each camera adds to a prompt."""

DIRECTION_COUNTS: dict[CameraAngle, tuple[int, ...]] = {
    # Left and right, and nothing else: a platformer has no depth to turn into.
    CameraAngle.SIDE: (1, 2),
    CameraAngle.TOP_DOWN: (1, 2, 4, 8),
    CameraAngle.ISOMETRIC: (1, 4, 8),
    # A portrait faces the viewer. More than one would not be a direction, it
    # would be a different pose.
    CameraAngle.FRONT: (1,),
}
"""The direction counts each camera can be asked for."""

_SIDE_NAMES: tuple[str, ...] = ("right", "left")

_COMPASS_NAMES: tuple[str, ...] = (
    "south",
    "south_west",
    "west",
    "north_west",
    "north",
    "north_east",
    "east",
    "south_east",
)
"""Compass order, starting at south and turning clockwise.

South first because a character shown once faces the viewer, and clockwise so
that a four direction set is south, west, north, east: the order a 2D engine's
sprite sheet already uses.
"""

_FACING: dict[str, str] = {
    "right": "facing right",
    "left": "facing left",
    "south": "facing towards the viewer",
    "south_west": "facing towards the viewer and to the left",
    "west": "facing left",
    "north_west": "facing away and to the left",
    "north": "facing away from the viewer, seen from behind",
    "north_east": "facing away and to the right",
    "east": "facing right",
    "south_east": "facing towards the viewer and to the right",
}
"""How each direction is described to a model."""


def direction_names(camera: CameraAngle, count: int) -> tuple[str, ...]:
    """Return the direction each image in a set represents, in order.

    Args:
        camera: The camera the set is drawn from.
        count: How many directions were asked for.

    Returns:
        One name per image. A single direction is always the one facing the
        viewer, or facing right for a side view.

    Raises:
        ValueError: The count is not one this camera offers.
    """
    if count not in DIRECTION_COUNTS[camera]:
        raise ValueError(f"{camera.value} does not offer {count} directions")

    if camera is CameraAngle.SIDE:
        return _SIDE_NAMES[:count]
    if count == 1:
        return ("south",)
    # Take every nth compass point, so four directions are the cardinals rather
    # than four adjacent diagonals.
    step = len(_COMPASS_NAMES) // count
    return tuple(_COMPASS_NAMES[index * step] for index in range(count))


def facing_term(name: str) -> str:
    """Return how a direction is described to a model.

    Args:
        name: A direction name from :func:`direction_names`.

    Returns:
        The phrase describing it, or an empty string when the name is unknown.
    """
    return _FACING.get(name, "")
