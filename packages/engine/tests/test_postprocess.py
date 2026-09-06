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

"""Tests for the post-processing steps."""

from __future__ import annotations

from typing import cast

import pytest
from PIL import Image

from bitwright_engine.pipeline.postprocess import PostProcessOptions, apply, pack_grid
from bitwright_engine.pipeline.postprocess.background import remove_background
from bitwright_engine.pipeline.postprocess.quantize import quantize, snap_to_grid
from bitwright_engine.utils.images import RGBA, new_canvas, pixel_at


def _sprite_on_background() -> Image.Image:
    image = new_canvas(8, 8, (255, 255, 255, 255))
    for y in range(2, 6):
        for x in range(2, 6):
            image.putpixel((x, y), (10, 20, 200, 255))
    return image


def test_remove_background_clears_the_border_only() -> None:
    result = remove_background(_sprite_on_background())
    assert pixel_at(result, 0, 0)[3] == 0
    assert pixel_at(result, 3, 3)[3] == 255


def test_remove_background_rejects_an_out_of_range_tolerance() -> None:
    with pytest.raises(ValueError, match="tolerance"):
        remove_background(_sprite_on_background(), tolerance=300)


def test_quantize_limits_the_palette_and_keeps_alpha() -> None:
    source = _sprite_on_background()
    source.putpixel((0, 0), (255, 255, 255, 0))

    result = quantize(source, colors=4)
    counted = result.getcolors(maxcolors=256)
    assert counted is not None
    assert len({cast(RGBA, pixel)[:3] for _, pixel in counted}) <= 4
    assert pixel_at(result, 0, 0)[3] == 0


def test_quantize_rejects_an_out_of_range_palette() -> None:
    with pytest.raises(ValueError, match="colors"):
        quantize(_sprite_on_background(), colors=1)


def test_snap_to_grid_flattens_blocks() -> None:
    result = snap_to_grid(_sprite_on_background(), factor=2)
    assert result.size == (8, 8)
    assert pixel_at(result, 0, 0) == pixel_at(result, 1, 1)


def test_snap_to_grid_rejects_a_factor_larger_than_the_image() -> None:
    with pytest.raises(ValueError, match="dimensions"):
        snap_to_grid(_sprite_on_background(), factor=16)


def test_apply_runs_every_enabled_step() -> None:
    result = apply(
        _sprite_on_background(),
        PostProcessOptions(remove_background=True, palette_size=4, pixel_grid=2),
    )
    assert result.size == (8, 8)
    assert pixel_at(result, 0, 0)[3] == 0


def test_pack_grid_lays_frames_out_in_order() -> None:
    frames = [new_canvas(4, 4, (index * 40, 0, 0, 255)) for index in range(4)]
    sheet = pack_grid(frames, columns=2, padding=1)

    assert sheet.columns == 2
    assert sheet.rows == 2
    assert sheet.image.size == (9, 9)
    assert [(frame.x, frame.y) for frame in sheet.frames] == [(0, 0), (5, 0), (0, 5), (5, 5)]


def test_pack_grid_rejects_an_empty_sequence() -> None:
    with pytest.raises(ValueError, match="must not be empty"):
        pack_grid([])
