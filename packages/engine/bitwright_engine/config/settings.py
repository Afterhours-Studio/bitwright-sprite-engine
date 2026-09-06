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

"""Sidecar configuration.

Every setting can be overridden with an environment variable prefixed
``BITWRIGHT_``. The Tauri shell passes the chosen port and the model cache
directory that way when it spawns the sidecar.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_ID = "studio.afterhours.bitwright"


def default_cache_dir() -> Path:
    """Return the per-user model cache directory for this platform.

    Returns:
        The directory that holds downloaded model weights.
    """
    if sys.platform == "win32":
        root = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    elif sys.platform == "darwin":
        root = Path.home() / "Library" / "Application Support"
    else:
        root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return root / APP_ID / "models"


class Settings(BaseSettings):
    """Runtime configuration for the sidecar.

    Attributes:
        host: Loopback address the HTTP server binds to. Binding anywhere other
            than loopback exposes generation to the network, and is not
            supported.
        port: Port to bind. ``0`` asks the operating system for a free port.
        log_level: Minimum log level.
        backend: Which backend to select, one of ``cuda``, ``mps``, ``remote``,
            or ``auto`` to pick the first available.
        remote_endpoint: Base URL of the remote inference API.
        remote_api_key: Bearer token for the remote endpoint.
        remote_timeout_s: Request timeout for the remote endpoint, in seconds.
        cache_dir: Directory that holds downloaded model weights.
        allow_downloads: When False, a missing model is an error rather than a
            download.
    """

    model_config = SettingsConfigDict(
        env_prefix="BITWRIGHT_",
        env_nested_delimiter="__",
        extra="ignore",
    )

    host: str = "127.0.0.1"
    port: int = 0
    log_level: str = "INFO"

    backend: str = "auto"

    remote_endpoint: str = ""
    remote_api_key: str = ""
    remote_timeout_s: float = 120.0

    cache_dir: Path = Field(default_factory=default_cache_dir)
    allow_downloads: bool = True


_settings: Settings | None = None


def get_settings() -> Settings:
    """Return the process wide settings, reading the environment once.

    Returns:
        The cached settings instance.
    """
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def reset_settings() -> None:
    """Discard the cached settings so the next read sees the environment again.

    Tests use this after changing environment variables.
    """
    global _settings
    _settings = None
