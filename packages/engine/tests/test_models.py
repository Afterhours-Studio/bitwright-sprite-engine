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

"""Tests for the model registry and the downloader."""

from __future__ import annotations

import pytest

from bitwright_engine.config import Settings
from bitwright_engine.models import (
    REGISTRY,
    DownloadError,
    DownloadsDisabledError,
    ModelDownloader,
    ModelKind,
    get,
    list_models,
)


def test_every_entry_declares_a_licence() -> None:
    for entry in REGISTRY.values():
        assert entry.license_id
        assert entry.license_url.startswith("https://")
        assert entry.size_mb > 0


def test_registry_keys_match_their_entries() -> None:
    for model_id, entry in REGISTRY.items():
        assert entry.model_id == model_id


def test_list_models_filters_by_kind() -> None:
    assert all(entry.kind is ModelKind.LORA for entry in list_models(ModelKind.LORA))
    assert len(list_models()) == len(REGISTRY)


def test_get_raises_for_an_unknown_model() -> None:
    with pytest.raises(KeyError, match="unknown model"):
        get("does-not-exist")


def test_status_reports_a_missing_model(settings: Settings) -> None:
    status = ModelDownloader(settings).status("sd15-base")
    assert status.cached is False
    assert status.path.name == "sd15-base"


def test_ensure_refuses_when_downloads_are_disabled(settings: Settings) -> None:
    with pytest.raises(DownloadsDisabledError):
        ModelDownloader(settings).ensure("sd15-base")


def test_ensure_reports_that_downloading_is_not_implemented(settings: Settings) -> None:
    downloader = ModelDownloader(settings.model_copy(update={"allow_downloads": True}))
    with pytest.raises(DownloadError):
        downloader.ensure("sd15-base")


def test_ensure_returns_a_cached_model(settings: Settings) -> None:
    downloader = ModelDownloader(settings)
    path = downloader.path_for("sd15-base")
    path.mkdir(parents=True)
    (path / "model.safetensors").write_bytes(b"not a real model")

    assert downloader.ensure("sd15-base") == path
