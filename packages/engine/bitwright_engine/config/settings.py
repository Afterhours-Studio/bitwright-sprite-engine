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
``BITWRIGHT_``. The Tauri shell passes the chosen port and the data root that
way when it spawns the sidecar. The sidecar is spawned fresh on every launch
and reads no configuration file of its own, so the shell is the only place a
choice can be remembered.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from bitwright_engine.config.storage import SPRITES_DIRNAME

APP_ID = "studio.afterhours.bitwright"


def default_data_root() -> Path:
    """Return the per-user directory that holds this application's data.

    This is the root the user is allowed to move. Everything the application
    writes lives under it, so moving it moves the whole library rather than
    scattering it.

    Returns:
        The per-user data directory for this platform.
    """
    if sys.platform == "win32":
        root = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    elif sys.platform == "darwin":
        root = Path.home() / "Library" / "Application Support"
    else:
        root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return root / APP_ID


class Settings(BaseSettings):
    """Runtime configuration for the sidecar.

    Attributes:
        host: Loopback address the HTTP server binds to. Binding anywhere other
            than loopback exposes this API to the network, and is not
            supported.
        port: Port to bind. ``0`` asks the operating system for a free port.
        log_level: Minimum log level.
        data_root: Directory that holds everything this application writes. The
            one setting the user moves when their system drive is full.
        sprites_dir: Directory sprites are written to. Derived from
            ``data_root``, so it follows the location the user chose.
    """

    model_config = SettingsConfigDict(
        env_prefix="BITWRIGHT_",
        env_nested_delimiter="__",
        extra="ignore",
    )

    host: str = "127.0.0.1"
    port: int = 0
    log_level: str = "INFO"

    data_root: Path = Field(default_factory=default_data_root)

    @property
    def sprites_dir(self) -> Path:
        """Return where sprites are written.

        Derived rather than stored, so moving the data root moves this with
        it. A sprite is small, but it is what the user came for, and putting it
        anywhere other than the location they deliberately chose is the kind of
        surprise a settings screen may not spring on them.

        Returns:
            The directory. It may not exist yet.
        """
        return self.data_root / SPRITES_DIRNAME

    def use_data_root(self, root: Path) -> None:
        """Point this process at another data root.

        Only the process is repointed. Nothing on disk is moved: sprites that
        are already there stay where they are, and the caller is expected to
        tell the user so.

        Args:
            root: The validated directory to use from now on.
        """
        self.data_root = root


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
