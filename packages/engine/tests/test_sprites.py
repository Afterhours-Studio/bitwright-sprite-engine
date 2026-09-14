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

"""The sprites directory, and writing a painted sprite back into it.

The routes read the process wide settings rather than the ones the test client
was built from, so the module's reader is pointed at the test's own directory.
Without that these tests would write into the real user data folder.
"""

from __future__ import annotations

import base64
import io
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from bitwright_engine.api.routes import sprites
from bitwright_engine.api.schemas.sprites import SpriteEditBody
from bitwright_engine.config import Settings

RED = (255, 0, 0, 255)
BLUE = (0, 0, 255, 255)


def png(colour: tuple[int, int, int, int], size: int = 4) -> bytes:
    """Return a flat PNG of one colour."""
    buffer = io.BytesIO()
    Image.new("RGBA", (size, size), colour).save(buffer, format="PNG")
    return buffer.getvalue()


def encoded(colour: tuple[int, int, int, int], size: int = 4) -> str:
    """Return a flat PNG of one colour, as the wire carries it."""
    return base64.b64encode(png(colour, size)).decode("ascii")


@pytest.fixture
def directory(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> Path:
    """Return an empty sprites directory the routes will actually use."""
    monkeypatch.setattr(sprites, "get_settings", lambda: settings)
    settings.sprites_dir.mkdir(parents=True, exist_ok=True)
    return settings.sprites_dir


def test_listing_reports_the_sprites_on_disk(client: TestClient, directory: Path) -> None:
    (directory / "one.png").write_bytes(png(RED))

    response = client.get("/v1/sprites")

    assert response.status_code == 200
    listed = response.json()["sprites"]
    assert [sprite["name"] for sprite in listed] == ["one.png"]
    assert listed[0]["width"] == 4


def test_an_edit_is_written_beside_the_sprite_it_came_from(
    client: TestClient, directory: Path
) -> None:
    original = directory / "20260101-120000-random-0.png"
    original.write_bytes(png(RED))

    response = client.post(
        "/v1/sprites/20260101-120000-random-0.png/edit",
        json={"image": encoded(BLUE)},
    )

    assert response.status_code == 200
    assert response.json()["name"] == "20260101-120000-random-0-edit.png"
    # The generated sprite is the only record of what the model produced, so a
    # stroke must not be able to destroy it.
    assert original.read_bytes() == png(RED)
    assert (directory / "20260101-120000-random-0-edit.png").read_bytes() == png(BLUE)


def test_painting_on_an_edit_writes_over_it(client: TestClient, directory: Path) -> None:
    (directory / "sprite.png").write_bytes(png(RED))
    first = client.post("/v1/sprites/sprite.png/edit", json={"image": encoded(BLUE)})
    name = first.json()["name"]

    second = client.post(f"/v1/sprites/{name}/edit", json={"image": encoded(RED, size=8)})

    assert second.json()["name"] == name
    # One file per session of painting, not one per stroke.
    written = sorted(path.name for path in directory.glob("*.png"))
    assert written == ["sprite-edit.png", "sprite.png"]
    assert second.json()["width"] == 8


def test_a_second_session_on_the_same_sprite_gets_its_own_file(
    client: TestClient, directory: Path
) -> None:
    (directory / "sprite.png").write_bytes(png(RED))
    (directory / "sprite-edit.png").write_bytes(png(BLUE))

    response = client.post("/v1/sprites/sprite.png/edit", json={"image": encoded(RED, size=8)})

    assert response.json()["name"] == "sprite-edit-2.png"
    assert (directory / "sprite-edit.png").read_bytes() == png(BLUE)


def test_editing_a_sprite_that_is_not_there_is_refused(client: TestClient, directory: Path) -> None:
    response = client.post("/v1/sprites/missing.png/edit", json={"image": encoded(RED)})

    assert response.status_code == 404
    assert response.json()["detail"] == sprites.UNKNOWN_SPRITE
    assert list(directory.glob("*.png")) == []


def test_a_name_that_leaves_the_directory_is_refused(directory: Path) -> None:
    outside = directory.parent / "escape.png"
    outside.write_bytes(png(RED))

    # Called directly rather than through the client, because an HTTP client is
    # entitled to normalise the path before it is sent and the check under test
    # is the one that runs after it arrives.
    with pytest.raises(HTTPException) as raised:
        sprites.save_edit("../escape.png", SpriteEditBody(image=encoded(BLUE)))

    assert raised.value.detail == sprites.UNKNOWN_SPRITE
    assert outside.read_bytes() == png(RED)
    assert list(directory.parent.glob("escape-edit*.png")) == []


def test_a_payload_that_is_not_an_image_is_refused(client: TestClient, directory: Path) -> None:
    (directory / "sprite.png").write_bytes(png(RED))

    response = client.post(
        "/v1/sprites/sprite.png/edit",
        json={"image": base64.b64encode(b"not an image at all").decode("ascii")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == sprites.BAD_IMAGE
    # Nothing half written is left behind.
    assert sorted(path.name for path in directory.glob("*.png")) == ["sprite.png"]


def test_an_edit_appears_in_the_listing(client: TestClient, directory: Path) -> None:
    (directory / "sprite.png").write_bytes(png(RED))
    client.post("/v1/sprites/sprite.png/edit", json={"image": encoded(BLUE)})

    listed = client.get("/v1/sprites").json()["sprites"]

    assert sorted(sprite["name"] for sprite in listed) == ["sprite-edit.png", "sprite.png"]


def test_removing_a_sprite_takes_it_off_disk(client: TestClient, directory: Path) -> None:
    (directory / "sprite.png").write_bytes(png(RED))

    response = client.post("/v1/sprites/sprite.png/remove")

    assert response.status_code == 204
    assert list(directory.glob("*.png")) == []
