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

"""Tests for the conform pipeline."""

from __future__ import annotations

import base64
import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageFilter

from bitwright_engine.pipeline.conform import ConformOptions, conform
from bitwright_engine.pipeline.conform.dither import (
    DITHER_MODES,
    DitherMode,
    bayer_matrix,
)
from bitwright_engine.pipeline.conform.downsample import modal_downsample
from bitwright_engine.pipeline.conform.grid import AxisFit, detect_grid, fit_axis
from bitwright_engine.pipeline.conform.palette import reduce_palette, report
from bitwright_engine.pipeline.postprocess.quantize import quantize
from bitwright_engine.utils.color import (
    bytes_to_oklab,
    median_cut,
    nearest_entry,
    oklab_to_bytes,
)
from bitwright_engine.utils.images import to_png_bytes

PALETTE = [
    (20, 20, 30),
    (200, 40, 40),
    (40, 160, 90),
    (230, 210, 120),
    (90, 110, 220),
]

# Verified by hand against Pillow: quantizing these four in sRGB spends one
# entry on the green and the pink together, which no viewer would accept, and
# keeps the two blues apart. Oklab makes the opposite trade.
GREEN = (78, 204, 64)
BLUE = (34, 16, 250)
PINK = (233, 32, 103)
PURPLE = (122, 13, 204)


def _sprite(cells: int, seed: int) -> Image.Image:
    """Return a sprite of random cells drawn from PALETTE."""
    generator = np.random.default_rng(seed)
    table = np.array(PALETTE, dtype=np.uint8)
    picked = table[generator.integers(0, len(PALETTE), size=(cells, cells))]
    opaque = np.full((cells, cells), 255, dtype=np.uint8)
    return Image.fromarray(np.dstack([picked, opaque]), mode="RGBA")


def _render(sprite: Image.Image, factor: int, offset: int, blur: float = 0.8) -> Image.Image:
    """Upscale a sprite the way a model would have drawn it.

    Rolled rather than cropped, so that the grid keeps its exact period right
    across the image and the expected phase is known to the pixel.
    """
    side = sprite.width * factor
    scaled = np.asarray(sprite.resize((side, side), Image.Resampling.NEAREST))
    rolled = np.roll(np.roll(scaled, offset, axis=1), offset, axis=0)
    blurred = Image.fromarray(rolled, mode="RGBA")
    return blurred.filter(ImageFilter.GaussianBlur(blur)) if blur > 0 else blurred


def _bands(colours: list[tuple[int, int, int]], block: int = 8) -> Image.Image:
    """Return an image of equal vertical bands, one per colour."""
    data = np.zeros((block, block * len(colours), 4), dtype=np.uint8)
    data[:, :, 3] = 255
    for index, rgb in enumerate(colours):
        data[:, index * block : (index + 1) * block, :3] = rgb
    return Image.fromarray(data, mode="RGBA")


def _band_colour(image: Image.Image, index: int, block: int = 8) -> tuple[int, ...]:
    """Read the colour one band of a `_bands` image came out as."""
    pixels = np.asarray(image.convert("RGBA"))
    return tuple(int(value) for value in pixels[block // 2, index * block + block // 2, :3])


def _distinct(image: Image.Image) -> set[tuple[int, ...]]:
    """Return the opaque colours an image uses."""
    pixels = np.asarray(image.convert("RGBA"))
    opaque = pixels[:, :, 3] > 0
    return {tuple(int(value) for value in pixel) for pixel in pixels[opaque][:, :3]}


def test_oklab_round_trips_within_one_eight_bit_unit() -> None:
    generator = np.random.default_rng(3)
    colours = generator.integers(0, 256, size=(4096, 3), dtype=np.uint8)

    recovered = oklab_to_bytes(bytes_to_oklab(colours))

    assert np.abs(recovered.astype(int) - colours.astype(int)).max() <= 1


def test_oklab_lightness_orders_greys() -> None:
    lightness = bytes_to_oklab(np.array([[0, 0, 0], [64, 64, 64], [255, 255, 255]], np.uint8))

    assert lightness[0, 0] == pytest.approx(0.0, abs=1e-6)
    assert lightness[2, 0] == pytest.approx(1.0, abs=1e-6)
    assert lightness[0, 0] < lightness[1, 0] < lightness[2, 0]


def test_median_cut_recovers_the_colours_it_was_given() -> None:
    colours = bytes_to_oklab(np.array(PALETTE[:4], dtype=np.uint8))
    weights = np.array([100.0, 100.0, 100.0, 100.0])

    recovered = oklab_to_bytes(median_cut(colours, weights, 4))

    assert {tuple(int(v) for v in entry) for entry in recovered} == set(PALETTE[:4])


def test_nearest_entry_picks_the_closest_palette_slot() -> None:
    palette = bytes_to_oklab(np.array([(0, 0, 0), (255, 255, 255)], dtype=np.uint8))
    colours = bytes_to_oklab(np.array([(10, 10, 10), (240, 240, 240)], dtype=np.uint8))

    assert nearest_entry(colours, palette).tolist() == [0, 1]


def test_grid_detection_finds_a_known_cell_size_and_phase() -> None:
    render = _render(_sprite(8, 4), factor=7, offset=3)

    grid = detect_grid(render)

    assert grid.horizontal.cells == 8
    assert grid.horizontal.size == pytest.approx(7.0)
    assert grid.horizontal.phase == pytest.approx(3.0, abs=0.25)
    assert grid.vertical.phase == pytest.approx(3.0, abs=0.25)
    assert grid.confidence > 0.4


def test_grid_detection_finds_a_fractional_cell_size() -> None:
    # 16 cells across 133 pixels is 8.3125 each, which no integer factor can
    # express and which is what a model asked for 64 at 512 actually draws.
    sprite = _sprite(16, 9)
    render = sprite.resize((133, 133), Image.Resampling.NEAREST).filter(
        ImageFilter.GaussianBlur(0.8)
    )

    grid = detect_grid(render)

    assert grid.horizontal.cells == 16
    assert grid.horizontal.size == pytest.approx(133 / 16)
    assert grid.confidence > 0.4


def test_grid_detection_reports_the_grid_rather_than_its_harmonic() -> None:
    # A comb of period s has energy at 2s and 3s as well, so the naive argmax
    # answers 32 for an image whose grid is 16.
    render = _render(_sprite(16, 5), factor=8, offset=0)

    grid = detect_grid(render)

    assert grid.horizontal.cells == 16
    assert grid.vertical.cells == 16


def test_grid_detection_has_no_confidence_in_a_flat_image() -> None:
    flat = Image.new("RGBA", (64, 64), (120, 90, 60, 255))

    grid = detect_grid(flat, 16, 16)

    assert grid.confidence == 0.0
    assert grid.horizontal.phase == 0.0


def test_fit_axis_rejects_a_cell_count_below_one() -> None:
    with pytest.raises(ValueError, match="cells"):
        fit_axis(np.ones(32), 0)


def test_modal_downsample_returns_the_colours_the_source_held() -> None:
    sprite = _sprite(16, 7)
    render = _render(sprite, factor=8, offset=3)
    grid = detect_grid(render, 16, 16)

    result = modal_downsample(render, grid.horizontal, grid.vertical, 0.5)

    assert result.size == (16, 16)
    assert np.array_equal(np.asarray(result)[:, :, :3], np.asarray(sprite)[:, :, :3])


def test_modal_downsample_leaves_no_partial_alpha() -> None:
    sprite = _sprite(16, 2)
    faded = np.asarray(sprite).copy()
    faded[:, :, 3] = 120
    render = _render(Image.fromarray(faded, mode="RGBA"), factor=8, offset=0)
    grid = detect_grid(render, 16, 16)

    result = modal_downsample(render, grid.horizontal, grid.vertical, 0.5)

    assert set(np.asarray(result)[:, :, 3].ravel().tolist()) <= {0, 255}


def test_modal_downsample_rejects_an_empty_grid() -> None:
    grid = detect_grid(_sprite(8, 1), 8, 8)
    empty = AxisFit(cells=0, size=8.0, phase=0.0, strength=0.0)

    with pytest.raises(ValueError, match="cell counts"):
        modal_downsample(_sprite(8, 1), grid.horizontal, empty, 0.5)


def test_oklab_keeps_apart_two_colours_srgb_quantization_merges() -> None:
    source = _bands([GREEN, BLUE, PINK, PURPLE])

    in_srgb = quantize(source, colors=3)
    in_oklab = reduce_palette(source, 3)

    assert _band_colour(in_srgb, 0) == _band_colour(in_srgb, 2)
    assert _band_colour(in_oklab, 0) != _band_colour(in_oklab, 2)
    assert _band_colour(in_oklab, 0) == GREEN
    assert _band_colour(in_oklab, 2) == PINK


def test_reduce_palette_keeps_the_count_it_promised() -> None:
    generator = np.random.default_rng(13)
    noise = generator.integers(0, 256, size=(48, 48, 3), dtype=np.uint8)
    opaque = np.full((48, 48, 1), 255, dtype=np.uint8)
    source = Image.fromarray(np.concatenate([noise, opaque], axis=2), mode="RGBA")

    result = reduce_palette(source, 16)

    assert len(_distinct(result)) <= 16


def test_reduce_palette_leaves_transparent_pixels_alone() -> None:
    source = _bands([GREEN, BLUE, PINK, PURPLE])
    hollow = np.asarray(source).copy()
    hollow[:, :8, 3] = 0

    result = reduce_palette(Image.fromarray(hollow, mode="RGBA"), 2)

    assert np.asarray(result)[0, 0, 3] == 0
    assert GREEN not in _distinct(result)


def test_reduce_palette_rejects_a_size_outside_the_range() -> None:
    with pytest.raises(ValueError, match="colors"):
        reduce_palette(_bands([GREEN, BLUE]), 1)


def test_report_says_nothing_when_there_are_too_many_colours() -> None:
    generator = np.random.default_rng(21)
    noise = generator.integers(0, 256, size=(32, 32, 3), dtype=np.uint8)
    opaque = np.full((32, 32, 1), 255, dtype=np.uint8)
    source = Image.fromarray(np.concatenate([noise, opaque], axis=2), mode="RGBA")

    assert report(source, limit=16) == []


def test_report_orders_by_how_much_of_the_sprite_a_colour_carries() -> None:
    data = np.zeros((4, 4, 4), dtype=np.uint8)
    data[:, :, 3] = 255
    data[:, :, :3] = GREEN
    data[0, 0, :3] = PINK

    palette = report(Image.fromarray(data, mode="RGBA"))

    assert palette == ["#4ecc40", "#e92067"]


def test_bayer_matrix_is_the_published_two_by_two() -> None:
    assert bayer_matrix(2).tolist() == [[0.0, 0.5], [0.75, 0.25]]


def test_bayer_matrix_rejects_a_side_that_is_not_a_power_of_two() -> None:
    with pytest.raises(ValueError, match="power of two"):
        bayer_matrix(3)


@pytest.mark.parametrize("mode", [mode for mode in DITHER_MODES if mode != "none"])
def test_dithering_breaks_up_a_band_the_palette_cannot_hold(mode: DitherMode) -> None:
    # Two dominant extremes with a band of the midpoint between them. Without a
    # dither the band is one flat colour; with one it has to be both.
    data = np.zeros((24, 16, 4), dtype=np.uint8)
    data[:, :, 3] = 255
    data[8:16, :, :3] = 128
    data[16:24, :, :3] = 255
    source = Image.fromarray(data, mode="RGBA")

    flat = np.asarray(reduce_palette(source, 2, "none"))[8:16, :, 0]
    broken = np.asarray(reduce_palette(source, 2, mode))[8:16, :, 0]

    assert len(set(flat.ravel().tolist())) == 1
    assert len(set(broken.ravel().tolist())) == 2


def test_conform_produces_the_size_asked_for_on_the_palette_asked_for() -> None:
    render = _render(_sprite(16, 7), factor=8, offset=3)

    result = conform(
        render,
        ConformOptions(width=16, height=16, remove_background=False, palette_size=5),
    )

    assert result.image.size == (16, 16)
    assert set(result.palette) == {f"#{r:02x}{g:02x}{b:02x}" for r, g, b in PALETTE}
    assert result.grid.horizontal.size == pytest.approx(8.0)
    assert result.warnings == []


def test_conform_finds_the_target_size_when_it_is_not_given() -> None:
    render = _render(_sprite(16, 7), factor=8, offset=3)

    result = conform(render, ConformOptions(remove_background=False, palette_size=8))

    assert result.image.size == (16, 16)


def test_conform_says_when_the_sprite_is_already_at_size() -> None:
    sprite = _sprite(16, 7)

    result = conform(
        sprite,
        ConformOptions(width=16, height=16, remove_background=False, palette_size=5),
    )

    assert "conform.already_at_size" in result.warnings
    assert result.image.size == (16, 16)


def test_conform_warns_when_the_background_fill_found_nothing() -> None:
    render = _render(_sprite(16, 7), factor=8, offset=3)

    result = conform(render, ConformOptions(width=16, height=16, remove_background=True))

    assert "conform.background_uncertain" in result.warnings


def test_conform_warns_when_no_grid_is_there_to_find() -> None:
    generator = np.random.default_rng(5)
    noise = generator.integers(0, 256, size=(64, 64, 3), dtype=np.uint8)
    opaque = np.full((64, 64, 1), 255, dtype=np.uint8)
    source = Image.fromarray(np.concatenate([noise, opaque], axis=2), mode="RGBA")

    result = conform(
        source,
        ConformOptions(width=16, height=16, remove_background=False, palette_size=8),
    )

    assert "conform.grid_not_found" in result.warnings
    assert result.grid.horizontal.phase == 0.0


def test_conform_keeps_the_size_when_no_grid_and_no_target_were_given() -> None:
    # Nothing found and nothing asked for. Resampling onto the cell count the
    # detector guessed would destroy a sprite to no purpose.
    generator = np.random.default_rng(8)
    noise = generator.integers(0, 256, size=(48, 48, 3), dtype=np.uint8)
    opaque = np.full((48, 48, 1), 255, dtype=np.uint8)
    source = Image.fromarray(np.concatenate([noise, opaque], axis=2), mode="RGBA")

    result = conform(source, ConformOptions(remove_background=False, palette_size=8))

    assert result.image.size == (48, 48)
    assert "conform.grid_not_found" in result.warnings
    assert "conform.already_at_size" in result.warnings


def test_conform_clears_the_background_before_it_votes() -> None:
    sprite = _sprite(16, 7)
    framed = Image.new("RGBA", (32, 32), (255, 255, 255, 255))
    framed.paste(sprite, (8, 8))
    render = _render(framed, factor=8, offset=0)

    result = conform(
        render,
        ConformOptions(width=32, height=32, remove_background=True, palette_size=8),
    )

    corner = np.asarray(result.image)[0, 0]
    assert corner[3] == 0


def test_conform_route_reports_the_grid_and_the_palette(client: TestClient) -> None:
    render = _render(_sprite(16, 7), factor=8, offset=3)
    payload = base64.b64encode(to_png_bytes(render)).decode("ascii")

    response = client.post(
        "/v1/conform",
        json={
            "image": payload,
            "width": 16,
            "height": 16,
            "removeBackground": False,
            "paletteSize": 5,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["width"] == 16
    assert body["height"] == 16
    assert len(body["palette"]) == 5
    assert body["detected"]["cellWidth"] == pytest.approx(8.0)
    assert body["detected"]["phaseX"] == pytest.approx(3.0, abs=0.25)
    assert body["detected"]["confidence"] > 0.4
    assert body["warnings"] == []

    decoded = Image.open(io.BytesIO(base64.b64decode(body["image"])))
    assert decoded.size == (16, 16)


def test_conform_route_detects_the_size_when_none_is_given(client: TestClient) -> None:
    render = _render(_sprite(16, 7), factor=8, offset=3)
    payload = base64.b64encode(to_png_bytes(render)).decode("ascii")

    response = client.post("/v1/conform", json={"image": payload, "removeBackground": False})

    assert response.status_code == 200
    assert response.json()["width"] == 16


def test_conform_route_rejects_something_that_is_not_an_image(client: TestClient) -> None:
    response = client.post("/v1/conform", json={"image": base64.b64encode(b"nope").decode()})

    assert response.status_code == 400
    assert response.json()["detail"] == "conform.bad_image"


def test_conform_route_rejects_an_unknown_dither(client: TestClient) -> None:
    render = _render(_sprite(8, 1), factor=8, offset=0)
    payload = base64.b64encode(to_png_bytes(render)).decode("ascii")

    response = client.post("/v1/conform", json={"image": payload, "dither": "swirl"})

    assert response.status_code == 422
