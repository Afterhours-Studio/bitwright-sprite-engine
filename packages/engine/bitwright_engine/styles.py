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

"""Art styles a sprite can be asked for.

A style is not a model and not an adapter. It is a set of terms added to both
prompts, so that someone who knows the look they want does not have to know the
vocabulary a diffusion model responds to. "HD-2D" is a real and specific look
with a name most people recognise; "pixel art sprite, crisp edges, limited
palette, no anti-aliasing" is the sentence that actually produces one.

The terms live here rather than in the interface because the interface must not
be in the business of prompt engineering: changing what a style means should
change it for every caller of the API at once, including one that is not this
application.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class ArtStyle(StrEnum):
    """The styles offered."""

    PIXEL = "pixel"
    HD2D = "hd2d"
    HD_2D_MODERN = "modern2d"
    CLASSIC = "classic"
    ISOMETRIC = "isometric"


@dataclass(frozen=True, slots=True)
class StyleTerms:
    """What a style adds to a request.

    Attributes:
        positive: Terms appended to the prompt.
        negative: Terms appended to the negative prompt.
    """

    positive: str
    negative: str


STYLES: dict[ArtStyle, StyleTerms] = {
    # The default, and what the application is for: a true sprite, where every
    # pixel is placed rather than sampled.
    ArtStyle.PIXEL: StyleTerms(
        positive="pixel art sprite, crisp pixel edges, limited palette, no anti-aliasing",
        negative="blurry, anti-aliased, smooth gradients, photographic, 3d render",
    ),
    # Octopath Traveler and its descendants: pixel characters lit and staged as
    # though they were in a three dimensional scene.
    ArtStyle.HD2D: StyleTerms(
        positive=(
            "HD-2D style, pixel art character with modern lighting, "
            "soft rim light, shallow depth of field, diorama staging"
        ),
        negative="flat lighting, photographic, realistic proportions",
    ),
    # High resolution hand drawn two dimensional art. Not pixels at all, which
    # is why it is a separate entry rather than a variant of one.
    ArtStyle.HD_2D_MODERN: StyleTerms(
        positive="high definition 2D game art, clean line art, cel shaded, vibrant flat colours",
        negative="pixelated, low resolution, dithering, photographic",
    ),
    # The constrained look of an era, not merely a small image: a few colours,
    # heavy outlines, readable at a glance on a low resolution display.
    ArtStyle.CLASSIC: StyleTerms(
        positive=(
            "retro 16-bit game sprite, bold black outline, "
            "flat shading, small colour palette, high contrast"
        ),
        negative="realistic, gradient shading, anti-aliased, photographic",
    ),
    # A projection rather than a rendering style, and the one people most often
    # fail to get by describing it in prose.
    ArtStyle.ISOMETRIC: StyleTerms(
        positive="isometric pixel art, 2:1 dimetric projection, clean tile edges",
        negative="perspective distortion, vanishing point, front view, blurry",
    ),
}
"""What each style adds. Every member of :class:`ArtStyle` has an entry."""


def terms(style: ArtStyle) -> StyleTerms:
    """Return the terms a style contributes.

    Args:
        style: The style asked for.

    Returns:
        Its terms.
    """
    return STYLES[style]


def compose(prompt: str, negative: str, style: ArtStyle) -> tuple[str, str]:
    """Fold a style's terms into a pair of prompts.

    The user's own words come first in both, so a style shapes a request rather
    than overriding it.

    Args:
        prompt: What the user typed.
        negative: What the user asked to avoid.
        style: The style asked for.

    Returns:
        The prompt and negative prompt to send to a model.
    """
    added = terms(style)
    joined = f"{prompt.strip()}, {added.positive}" if prompt.strip() else added.positive
    avoided = f"{negative.strip()}, {added.negative}" if negative.strip() else added.negative
    return joined, avoided
