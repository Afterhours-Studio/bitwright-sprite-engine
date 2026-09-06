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

"""Configuration for the sidecar process."""

from bitwright_engine.config.settings import (
    APP_ID,
    Settings,
    default_cache_dir,
    default_data_root,
    get_settings,
    reset_settings,
)
from bitwright_engine.config.storage import (
    MODELS_DIRNAME,
    StorageError,
    StorageLocation,
    describe,
    installation_root,
    validate_root,
)

__all__ = [
    "APP_ID",
    "MODELS_DIRNAME",
    "Settings",
    "StorageError",
    "StorageLocation",
    "default_cache_dir",
    "default_data_root",
    "describe",
    "get_settings",
    "installation_root",
    "reset_settings",
    "validate_root",
]
