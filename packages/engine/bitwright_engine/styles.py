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
    # A model asked for "pixel art" draws its own grid, and that grid does not
    # line up with the one the sprite is reduced onto. The two interfere and
    # leave stripes across the result - which is what they did. So the style
    # asks for art that reduces cleanly instead: flat shading, a bold outline,
    # a plain background, the whole character in frame. The pixels come from
    # the reduction and the palette, which are the only things that can place
    # them on the grid the sprite actually has.
    ArtStyle.PIXEL: StyleTerms(
        positive=(
            "game character sprite, full body, centred, flat shading, "
            "bold clean outline, plain flat background, high contrast"
        ),
        negative=(
            "photograph, realistic, blurry, close-up, cropped, "
            "busy background, text, watermark, drop shadow"
        ),
    ),
    # Octopath Traveler and its descendants: a character lit and staged as
    # though in a three dimensional scene.
    ArtStyle.HD2D: StyleTerms(
        positive=(
            "HD-2D game character, full body, centred, soft rim light, "
            "diorama staging, plain background"
        ),
        negative="flat lighting, photograph, close-up, cropped, busy background, text",
    ),
    # High resolution hand drawn art. Not pixels at all, which is why it is a
    # separate entry rather than a variant of one.
    ArtStyle.HD_2D_MODERN: StyleTerms(
        positive=(
            "high definition 2D game art, full body, centred, clean line art, "
            "cel shaded, vibrant flat colours, plain background"
        ),
        negative="photograph, low resolution, close-up, cropped, busy background, text",
    ),
    # The constrained look of an era: few colours, heavy outlines, readable at
    # a glance.
    ArtStyle.CLASSIC: StyleTerms(
        positive=(
            "retro 16-bit game character, full body, centred, bold black outline, "
            "flat shading, small colour palette, plain background"
        ),
        negative="realistic, gradient shading, photograph, close-up, cropped, text",
    ),
    # A projection rather than a rendering style, and the one people most often
    # fail to get by describing it in prose.
    ArtStyle.ISOMETRIC: StyleTerms(
        positive=(
            "isometric game asset, 2:1 dimetric projection, full object in frame, "
            "flat shading, plain background"
        ),
        negative="perspective distortion, vanishing point, front view, photograph, text",
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
