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
    MODELS_DIRNAME,
    PROBE_PREFIX,
    StorageCreateFailedError,
    StorageInsideInstallationError,
    StorageNotADirectoryError,
    StorageNotWritableError,
    StoragePathEmptyError,
    StoragePathNotAbsoluteError,
    describe,
    installation_root,
    scan_models,
    validate_root,
)
from bitwright_engine.models.downloader import ModelDownloader


def make_model(root: Path, kind: str, model_id: str, size: int = 8) -> Path:
    """Create a downloaded model under a data root.

    Args:
        root: The data root.
        kind: Registry kind, which is the first level of the layout.
        model_id: Registry identifier, which is the second.
        size: Bytes to write into the weights file.

    Returns:
        The model directory.
    """
    directory = root / MODELS_DIRNAME / kind / model_id
    directory.mkdir(parents=True)
    (directory / "model.safetensors").write_bytes(b"w" * size)
    return directory


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
        validate_root("models", install_root=tmp_path / "app")

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


def test_reports_what_is_already_downloaded(tmp_path: Path) -> None:
    make_model(tmp_path, "base", "sd15-base", size=16)
    make_model(tmp_path, "segmentation", "rembg-u2net", size=8)
    (tmp_path / MODELS_DIRNAME / ".partial").mkdir()
    (tmp_path / MODELS_DIRNAME / ".partial" / "base-sd15-base.part").write_bytes(b"x" * 4)

    location = describe(tmp_path, default_root=tmp_path)

    assert location.existing_models == ("sd15-base", "rembg-u2net")
    # The interrupted transfer is not a model and is not counted as one.
    assert location.used_bytes == 24
    assert location.is_default is True
    assert location.models_dir == tmp_path / MODELS_DIRNAME


def test_reports_an_empty_root(tmp_path: Path) -> None:
    location = describe(tmp_path, default_root=tmp_path / "elsewhere")

    assert location.existing_models == ()
    assert location.used_bytes == 0
    assert location.is_default is False


def test_scanning_a_missing_models_directory_is_empty(tmp_path: Path) -> None:
    assert scan_models(tmp_path / "nothing") == ((), 0)


def test_the_cache_directory_follows_the_data_root(tmp_path: Path) -> None:
    settings = Settings(data_root=tmp_path / "chosen")

    assert settings.cache_dir == tmp_path / "chosen" / MODELS_DIRNAME


def test_an_explicit_cache_directory_still_wins(tmp_path: Path) -> None:
    # The documented BITWRIGHT_CACHE_DIR override has to keep working.
    settings = Settings(data_root=tmp_path / "chosen", cache_dir=tmp_path / "elsewhere")

    assert settings.cache_dir == tmp_path / "elsewhere"


def test_use_data_root_moves_the_cache(tmp_path: Path, settings: Settings) -> None:
    settings.use_data_root(tmp_path / "moved")

    assert settings.data_root == tmp_path / "moved"
    assert settings.cache_dir == tmp_path / "moved" / MODELS_DIRNAME


def test_the_route_reports_the_current_location(client: TestClient, tmp_path: Path) -> None:
    make_model(tmp_path, "base", "sd15-base", size=32)

    response = client.get("/v1/storage")

    assert response.status_code == 200
    body = response.json()
    assert body["root"] == str(tmp_path)
    assert body["modelsDir"] == str(tmp_path / MODELS_DIRNAME)
    assert body["existingModels"] == ["sd15-base"]
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
    response = client.post("/v1/storage/validate", json={"path": "models"})

    assert response.status_code == 400
    assert response.json()["detail"] == "storage.path_not_absolute"


def test_changing_the_root_leaves_the_old_downloads_where_they_are(
    client: TestClient,
    settings: Settings,
    tmp_path: Path,
) -> None:
    make_model(tmp_path, "base", "sd15-base", size=64)
    destination = tmp_path / "destination"

    response = client.post("/v1/storage", json={"path": str(destination)})

    assert response.status_code == 200
    body = response.json()
    assert body["dataMoved"] is False
    assert body["current"]["root"] == str(destination)
    assert body["current"]["existingModels"] == []
    # The old root is reported so that the interface can say what stayed there.
    assert body["previous"]["root"] == str(tmp_path)
    assert body["previous"]["existingModels"] == ["sd15-base"]
    assert (tmp_path / MODELS_DIRNAME / "base" / "sd15-base").is_dir()
    assert settings.cache_dir == destination / MODELS_DIRNAME


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
    assert settings.cache_dir == fallback / MODELS_DIRNAME


def test_the_root_cannot_move_while_a_download_runs(
    client: TestClient,
    settings: Settings,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ModelDownloader, "active", lambda _self: ("sd15-base",))

    response = client.post("/v1/storage", json={"path": str(tmp_path / "elsewhere")})

    assert response.status_code == 409
    assert response.json()["detail"] == "storage.busy_downloading"
    # Refused, so the process is still pointed at the original location.
    assert settings.data_root == tmp_path
