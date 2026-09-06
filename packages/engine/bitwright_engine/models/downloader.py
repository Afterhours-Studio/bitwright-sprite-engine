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

"""Model download and local cache management.

Downloads land in the per-user cache directory, never in the repository or the
application bundle. The scaffold reports cache state and refuses to download,
so that nothing is fetched before the download flow and its licence prompt are
implemented.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from bitwright_engine.config import Settings, get_settings
from bitwright_engine.models.registry import ModelEntry, get
from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)


class DownloadError(RuntimeError):
    """Raised when a model cannot be fetched or verified.

    Attributes:
        code: Stable reason code that the user interface translates.
    """

    code: str = "models.download_failed"


class DownloadsDisabledError(DownloadError):
    """Raised when a model is missing and downloads are turned off."""

    code = "models.downloads_disabled"


@dataclass(frozen=True, slots=True)
class CacheStatus:
    """Whether a model is present locally.

    Attributes:
        model_id: Registry identifier.
        cached: True when the model directory exists and is not empty.
        path: Where the model lives, or would live.
        size_mb: Approximate download size, from the registry.
    """

    model_id: str
    cached: bool
    path: Path
    size_mb: int


class ModelDownloader:
    """Resolves model identifiers to paths in the local cache."""

    def __init__(self, settings: Settings | None = None) -> None:
        """Create the downloader.

        Args:
            settings: Configuration to read the cache directory from. Defaults
                to the process wide settings.
        """
        self._settings = settings if settings is not None else get_settings()

    @property
    def cache_dir(self) -> Path:
        """The directory that holds downloaded weights.

        Returns:
            The configured cache directory.
        """
        return self._settings.cache_dir

    def path_for(self, model_id: str) -> Path:
        """Return where a model lives in the cache.

        Args:
            model_id: Registry identifier.

        Returns:
            The model directory, whether or not it exists.

        Raises:
            KeyError: The identifier is not registered.
        """
        entry = get(model_id)
        return self.cache_dir / entry.kind.value / entry.model_id

    def status(self, model_id: str) -> CacheStatus:
        """Report whether a model is already cached.

        Args:
            model_id: Registry identifier.

        Returns:
            The cache status for that model.

        Raises:
            KeyError: The identifier is not registered.
        """
        entry = get(model_id)
        path = self.path_for(model_id)
        cached = path.is_dir() and any(path.iterdir())
        return CacheStatus(
            model_id=entry.model_id,
            cached=cached,
            path=path,
            size_mb=entry.size_mb,
        )

    def ensure(self, model_id: str) -> Path:
        """Return a model's path, downloading it if it is missing.

        The download itself is not implemented in this scaffold. A model that
        is already cached resolves normally, so a developer who populated the
        cache by hand can run the pipeline end to end.

        Args:
            model_id: Registry identifier.

        Returns:
            The path to the cached model.

        Raises:
            KeyError: The identifier is not registered.
            DownloadsDisabledError: The model is missing and downloads are off.
            DownloadError: The model is missing and downloading is not yet
                implemented.
        """
        entry = get(model_id)
        status = self.status(model_id)
        if status.cached:
            return status.path

        if not self._settings.allow_downloads:
            raise DownloadsDisabledError(entry.model_id)

        logger.warning(
            "model %s is not cached; downloading is not implemented in this build",
            entry.model_id,
        )
        raise DownloadError(entry.model_id)

    def license_notice(self, model_id: str) -> ModelEntry:
        """Return the registry entry to show before a download starts.

        The user must see the licence, and whether commercial use is permitted,
        before any weights are fetched.

        Args:
            model_id: Registry identifier.

        Returns:
            The registry entry for that model.

        Raises:
            KeyError: The identifier is not registered.
        """
        return get(model_id)
