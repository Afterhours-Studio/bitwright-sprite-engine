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

"""Tests for the generation pipeline."""

from __future__ import annotations

from bitwright_engine.backends import Capability, GenerationRequest
from bitwright_engine.pipeline import PostProcessOptions, SpriteGenerator
from tests.conftest import FakeBackend

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def test_generate_returns_one_png_per_batch_item() -> None:
    generator = SpriteGenerator(FakeBackend())
    sprites = generator.generate(
        GenerationRequest(prompt="a knight", width=16, height=16, batch_size=2, seed=5)
    )

    assert len(sprites) == 2
    assert all(png.startswith(PNG_MAGIC) for png in sprites)


def test_supports_reflects_the_backend_capabilities() -> None:
    generator = SpriteGenerator(FakeBackend(supported=frozenset({Capability.BATCH})))

    assert generator.supports(GenerationRequest(prompt="a knight", batch_size=4))
    assert not generator.supports(GenerationRequest(prompt="a knight", lora_id="pixel-art-lora"))


def test_capabilities_are_forwarded() -> None:
    supported = frozenset({Capability.BATCH, Capability.CONTROLNET})
    assert SpriteGenerator(FakeBackend(supported=supported)).capabilities() == supported


def test_generate_sheet_packs_every_frame() -> None:
    generator = SpriteGenerator(FakeBackend())
    sheet = generator.generate_sheet(
        GenerationRequest(prompt="a knight", width=16, height=16, batch_size=4, seed=1),
        postprocess=PostProcessOptions(remove_background=False, palette_size=None),
        columns=2,
    )

    assert sheet.columns == 2
    assert sheet.rows == 2
    assert len(sheet.frames) == 4
    assert sheet.image.size == (32, 32)
