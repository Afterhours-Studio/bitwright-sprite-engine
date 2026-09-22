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

"""Tests for the configurable data root.

Everything here works on real directories inside the test's own temporary
directory. The one exception is the unwritable case: a directory that refuses a
write cannot be produced portably, since a chmod on Windows does not stop the
owner writing, so the write itself is made to fail instead. That still
exercises the code path that matters, which is the probe deciding a location is
unusable rather than a permission bit being believed.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from bitwright_engine.api.routes import storage as storage_route
from bitwright_engine.config import Settings
from bitwright_engine.config.storage import (
    PROBE_PREFIX,
    SPRITES_DIRNAME,
    StorageCreateFailedError,
    StorageInsideInstallationError,
    StorageNotADirectoryError,
    StorageNotWritableError,
    StoragePathEmptyError,
    StoragePathNotAbsoluteError,
    describe,
    installation_root,
    validate_root,
)


def make_sprite(root: Path, name: str, size: int = 8) -> Path:
    """Write a sprite under a data root.

    Args:
        root: The data root.
        name: File name of the sprite.
        size: Bytes to write into it.

    Returns:
        The sprite file.
    """
    directory = root / SPRITES_DIRNAME
    directory.mkdir(parents=True, exist_ok=True)
    sprite = directory / name
    sprite.write_bytes(b"p" * size)
    return sprite


def test_accepts_a_directory_that_exists(tmp_path: Path) -> None:
    target = tmp_path / "data"
    target.mkdir()

    assert validate_root(target, install_root=tmp_path / "app") == target.resolve()


def test_creates_a_directory_that_is_missing(tmp_path: Path) -> None:
    target = tmp_path / "somewhere" / "new"

    assert validate_root(target, install_root=tmp_path / "app") == target.resolve()
    assert target.is_dir()


def test_leaves_no_probe_file_behind(tmp_path: Path) -> None:
    target = tmp_path / "data"

    validate_root(target, install_root=tmp_path / "app")

    assert [entry.name for entry in target.iterdir() if entry.name.startswith(PROBE_PREFIX)] == []


def test_refuses_an_empty_path(tmp_path: Path) -> None:
    with pytest.raises(StoragePathEmptyError) as raised:
        validate_root("   ", install_root=tmp_path / "app")

    assert raised.value.code == "storage.path_empty"


def test_refuses_a_relative_path(tmp_path: Path) -> None:
    with pytest.raises(StoragePathNotAbsoluteError) as raised:
        validate_root("sprites", install_root=tmp_path / "app")

    assert raised.value.code == "storage.path_not_absolute"


def test_refuses_a_path_that_is_a_file(tmp_path: Path) -> None:
    target = tmp_path / "data"
    target.write_bytes(b"not a directory")

    with pytest.raises(StorageNotADirectoryError) as raised:
        validate_root(target, install_root=tmp_path / "app")

    assert raised.value.code == "storage.not_a_directory"


def test_refuses_a_directory_that_cannot_be_created(tmp_path: Path) -> None:
    blocker = tmp_path / "blocker"
    blocker.write_bytes(b"a file where a directory would have to be")

    with pytest.raises(StorageCreateFailedError) as raised:
        validate_root(blocker / "data", install_root=tmp_path / "app")

    assert raised.value.code == "storage.create_failed"


def test_refuses_a_directory_that_cannot_be_written_to(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = tmp_path / "data"
    target.mkdir()

    def refuse(self: Path, data: bytes) -> int:
        raise PermissionError(f"denied: {self!s} {len(data)}")

    # A share or a synchronised folder accepts the directory and then refuses
    # the write, which is the case a permission bit would have got wrong.
    monkeypatch.setattr(Path, "write_bytes", refuse)

    with pytest.raises(StorageNotWritableError) as raised:
        validate_root(target, install_root=tmp_path / "app")

    assert raised.value.code == "storage.not_writable"


@pytest.mark.skipif(sys.platform == "win32", reason="a read-only bit does not stop the owner")
def test_refuses_a_read_only_directory(tmp_path: Path) -> None:
    target = tmp_path / "readonly"
    target.mkdir(mode=0o500)

    try:
        with pytest.raises(StorageNotWritableError) as raised:
            validate_root(target, install_root=tmp_path / "app")
    finally:
        # Restored, or the temporary directory cannot be cleaned up.
        target.chmod(0o700)

    assert raised.value.code == "storage.not_writable"


def test_refuses_a_path_inside_the_installation(tmp_path: Path) -> None:
    install = tmp_path / "app"
    install.mkdir()

    with pytest.raises(StorageInsideInstallationError) as raised:
        validate_root(install / "data", install_root=install)

    assert raised.value.code == "storage.inside_installation"
    # Refused before anything was created, so the installation is untouched.
    assert list(install.iterdir()) == []


def test_refuses_the_installation_itself(tmp_path: Path) -> None:
    install = tmp_path / "app"
    install.mkdir()

    with pytest.raises(StorageInsideInstallationError):
        validate_root(install, install_root=install)


def test_the_real_installation_root_is_a_directory() -> None:
    # Guards the fallback used from a source checkout: a wrong number of
    # parents here would silently stop refusing paths inside the installation.
    assert installation_root().is_dir()


def test_reports_the_free_space_of_the_volume(tmp_path: Path) -> None:
    location = describe(tmp_path, default_root=tmp_path / "elsewhere")

    assert location.free_bytes is not None
    assert location.total_bytes is not None
    assert 0 < location.free_bytes <= location.total_bytes


def test_reports_what_is_already_stored(tmp_path: Path) -> None:
    make_sprite(tmp_path, "hero.png", size=16)
    make_sprite(tmp_path, "villain.png", size=8)
    (tmp_path / "library.sqlite3").write_bytes(b"d" * 4)

    location = describe(tmp_path, default_root=tmp_path)

    # Everything under the root counts, because everything under it is the
    # user's library: the database as much as the sprites.
    assert location.used_bytes == 28
    assert location.is_default is True


def test_reports_an_empty_root(tmp_path: Path) -> None:
    location = describe(tmp_path, default_root=tmp_path / "elsewhere")

    assert location.used_bytes == 0
    assert location.is_default is False


def test_reports_a_root_that_does_not_exist(tmp_path: Path) -> None:
    # A candidate is described before it is adopted, and a directory that has
    # not been created yet must report rather than fail.
    location = describe(tmp_path / "nothing", default_root=tmp_path)

    assert location.used_bytes == 0


def test_the_sprites_directory_follows_the_data_root(tmp_path: Path) -> None:
    settings = Settings(data_root=tmp_path / "chosen")

    assert settings.sprites_dir == tmp_path / "chosen" / SPRITES_DIRNAME


def test_use_data_root_moves_the_sprites(tmp_path: Path, settings: Settings) -> None:
    settings.use_data_root(tmp_path / "moved")

    assert settings.data_root == tmp_path / "moved"
    assert settings.sprites_dir == tmp_path / "moved" / SPRITES_DIRNAME


def test_the_route_reports_the_current_location(client: TestClient, tmp_path: Path) -> None:
    make_sprite(tmp_path, "hero.png", size=32)

    response = client.get("/v1/storage")

    assert response.status_code == 200
    body = response.json()
    assert body["root"] == str(tmp_path)
    assert body["usedBytes"] == 32
    assert body["freeBytes"] > 0
    assert body["isDefault"] is False
    assert body["defaultRoot"] != ""


def test_the_route_validates_a_candidate(client: TestClient, tmp_path: Path) -> None:
    candidate = tmp_path / "candidate"

    response = client.post("/v1/storage/validate", json={"path": str(candidate)})

    assert response.status_code == 200
    assert response.json()["root"] == str(candidate)
    assert candidate.is_dir()


def test_the_route_refuses_a_relative_candidate(client: TestClient) -> None:
    response = client.post("/v1/storage/validate", json={"path": "sprites"})

    assert response.status_code == 400
    assert response.json()["detail"] == "storage.path_not_absolute"


def test_changing_the_root_leaves_the_old_sprites_where_they_are(
    client: TestClient,
    settings: Settings,
    tmp_path: Path,
) -> None:
    source = tmp_path / "source"
    make_sprite(source, "hero.png", size=64)
    settings.use_data_root(source)
    destination = tmp_path / "destination"

    response = client.post("/v1/storage", json={"path": str(destination)})

    assert response.status_code == 200
    body = response.json()
    assert body["dataMoved"] is False
    assert body["current"]["root"] == str(destination)
    assert body["current"]["usedBytes"] == 0
    # The old root is reported so that the interface can say what stayed there.
    assert body["previous"]["root"] == str(source)
    assert body["previous"]["usedBytes"] == 64
    assert (source / SPRITES_DIRNAME / "hero.png").is_file()
    assert settings.sprites_dir == destination / SPRITES_DIRNAME


def test_the_default_is_restored(
    client: TestClient,
    settings: Settings,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The real default lives in the user's profile, and a test must not create
    # anything there, so the route is pointed at a default of its own.
    fallback = tmp_path / "default"
    monkeypatch.setattr(storage_route, "default_data_root", lambda: fallback)

    client.post("/v1/storage", json={"path": str(tmp_path / "elsewhere")})
    assert settings.data_root == tmp_path / "elsewhere"

    response = client.post("/v1/storage/default")

    assert response.status_code == 200
    body = response.json()
    assert body["current"]["root"] == str(fallback)
    assert body["current"]["isDefault"] is True
    assert settings.data_root == fallback
    assert settings.sprites_dir == fallback / SPRITES_DIRNAME


def test_a_described_root_names_its_own_sprites_directory(
    client: TestClient,
    tmp_path: Path,
) -> None:
    # Every root in a response has to name the sprites directory that belongs to
    # it, not the one the process happens to be using. Two roots appear in a
    # change response and only one of them is in force, so reading the sprites
    # directory off the live settings would give the new root's path to the old
    # root as well, and tell the user their work moved when it did not.
    destination = tmp_path / "moved"
    origin = tmp_path / "origin"

    client.post("/v1/storage", json={"path": str(origin)})
    response = client.post("/v1/storage", json={"path": str(destination)})

    body = response.json()
    assert body["current"]["spritesDir"] == str(destination / SPRITES_DIRNAME)
    assert body["previous"]["spritesDir"] == str(origin / SPRITES_DIRNAME)


def test_a_validated_candidate_names_its_own_sprites_directory(
    client: TestClient,
    tmp_path: Path,
) -> None:
    # A candidate is not in force at all, so this is the same fault with nothing
    # to hide it: before the change, the live settings still point elsewhere.
    candidate = tmp_path / "candidate"

    response = client.post("/v1/storage/validate", json={"path": str(candidate)})

    assert response.status_code == 200
    assert response.json()["spritesDir"] == str(candidate / SPRITES_DIRNAME)
