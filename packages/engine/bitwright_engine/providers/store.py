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

"""The set of configured providers, and which one is active.

Two things are persisted, and they are deliberately kept apart:

* ``providers.json`` holds the records - names, endpoints, models, headers. It
  is written by this module.
* The credentials live wherever :mod:`bitwright_engine.providers.credentials`
  decides, which on a normal machine is the operating system credential store
  and never a file here.

Splitting them is what makes the rest of the design safe. A record can be read,
serialised, returned over the API, and written to a log without any possibility
of a key travelling with it, because a key is not one of its fields.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from bitwright_engine.config import APP_ID
from bitwright_engine.providers import codes
from bitwright_engine.providers.credentials import (
    SecretError,
    SecretStore,
    create_secret_store,
    write_private_json,
)
from bitwright_engine.providers.records import (
    MAX_PROVIDERS,
    ProviderConfig,
    ProviderError,
    mask_key,
)
from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)

PROVIDERS_FILE = "providers.json"
"""Name of the file the records are written to."""

SCHEMA_VERSION = 1
"""Version stamped into the file, so a later format can be recognised."""

DIRECTORY_ENV = "BITWRIGHT_PROVIDER_DIR"
"""Environment variable that relocates the provider directory.

The sidecar reads it directly rather than taking the path from
:class:`~bitwright_engine.config.Settings`, because the provider directory is
not a generation setting: it is where credentials are kept, and tests and
packagers need to move it without touching anything the engine reads.
"""


def default_provider_dir() -> Path:
    """Return the per-user configuration directory for this platform.

    The same roots the model cache uses, but the application directory itself
    rather than the ``models`` subdirectory inside it, because what is stored
    here is configuration rather than data.

    Returns:
        The directory that holds ``providers.json``.
    """
    override = os.environ.get(DIRECTORY_ENV, "")
    if override:
        return Path(override)

    if sys.platform == "win32":
        root = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        root = Path.home() / "Library" / "Application Support"
    else:
        root = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return root / APP_ID


class ProviderStore:
    """Every configured provider, and the one that is active.

    Loaded once and held in memory. The sidecar serves a single user from a
    single process, so there is no second writer to reconcile with, and every
    mutation writes the whole file back.
    """

    def __init__(self, directory: Path | None = None, secrets: SecretStore | None = None) -> None:
        """Create the store.

        Args:
            directory: Where ``providers.json`` lives. Defaults to
                :func:`default_provider_dir`.
            secrets: Where credentials are kept. Defaults to the best store the
                platform offers, as chosen by
                :func:`~bitwright_engine.providers.credentials.create_secret_store`.
        """
        self._directory = directory if directory is not None else default_provider_dir()
        self._secrets = secrets if secrets is not None else create_secret_store(self._directory)
        self._providers: dict[str, ProviderConfig] = {}
        self._active_id = ""
        self._loaded = False

    @property
    def directory(self) -> Path:
        """Where the provider records are kept.

        Returns:
            The configuration directory.
        """
        return self._directory

    @property
    def path(self) -> Path:
        """Where the provider records are written.

        Returns:
            The path of ``providers.json``, whether or not it exists yet.
        """
        return self._directory / PROVIDERS_FILE

    @property
    def secret_storage(self) -> str:
        """How credentials are being held on this machine.

        Returns:
            ``keychain`` or ``file``. Reported to the interface, because a
            security property the user cannot see is one they cannot act on.
        """
        return self._secrets.kind

    def _load(self) -> None:
        """Read the records from disk, once.

        A file that cannot be parsed is treated as empty rather than fatal, and
        a single unusable entry is skipped rather than discarding the rest.
        Being locked out of the settings screen by a stray comma is worse than
        losing one row, and the row can be typed again.
        """
        if self._loaded:
            return
        self._loaded = True

        path = self.path
        if not path.is_file():
            return

        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            logger.warning("could not read %s, starting with no providers", PROVIDERS_FILE)
            return

        if not isinstance(raw, dict):
            return

        entries = raw.get("providers")
        for entry in entries if isinstance(entries, list) else []:
            if not isinstance(entry, dict):
                continue
            try:
                config = ProviderConfig.from_json(entry)
            except ProviderError as error:
                logger.warning("skipped an unusable provider entry: %s", error.code)
                continue
            self._providers[config.provider_id] = config

        active = str(raw.get("activeId", ""))
        self._active_id = active if active in self._providers else ""

    def _persist(self) -> None:
        """Write every record back to disk.

        Raises:
            ProviderError: The file could not be written.
        """
        payload: dict[str, Any] = {
            "version": SCHEMA_VERSION,
            "activeId": self._active_id,
            "providers": [config.to_json() for config in self._providers.values()],
        }
        try:
            write_private_json(self.path, payload)
        except OSError as error:
            logger.warning("could not write %s", PROVIDERS_FILE)
            raise ProviderError(codes.STORE_WRITE_FAILED) from error

    def all(self) -> list[ProviderConfig]:
        """Return every configured provider, in the order they were added.

        Returns:
            The records. Empty on a machine where nothing has been configured.
        """
        self._load()
        return list(self._providers.values())

    def get(self, provider_id: str) -> ProviderConfig | None:
        """Return one provider.

        Args:
            provider_id: Which provider to look up.

        Returns:
            The record, or ``None`` when nothing is stored under that
            identifier.
        """
        self._load()
        return self._providers.get(provider_id)

    def require(self, provider_id: str) -> ProviderConfig:
        """Return one provider, or fail with a translatable code.

        Args:
            provider_id: Which provider to look up.

        Returns:
            The record.

        Raises:
            ProviderError: Nothing is stored under that identifier.
        """
        config = self.get(provider_id)
        if config is None:
            raise ProviderError(codes.PROVIDER_UNKNOWN)
        return config

    @property
    def active_id(self) -> str:
        """Identifier of the active provider.

        Returns:
            The identifier, or an empty string when none is selected.
        """
        self._load()
        return self._active_id

    def active(self) -> ProviderConfig | None:
        """Return the provider that serves generation.

        Returns:
            The active record, or ``None`` when none is selected.
        """
        self._load()
        return self._providers.get(self._active_id)

    def save(
        self,
        config: ProviderConfig,
        api_key: str | None = None,
        *,
        activate: bool = False,
    ) -> ProviderConfig:
        """Add a provider, or replace an existing one.

        ``api_key`` distinguishes three cases deliberately, because a settings
        form that round-trips a record must not be able to destroy a key by
        saving a field it was never shown:

        * ``None`` leaves whatever is stored alone. This is what an edit that
          did not touch the key field sends.
        * A non-empty string replaces the stored credential.
        * An empty string removes it.

        Args:
            config: The validated record to store.
            api_key: The credential, or ``None`` to keep the stored one.
            activate: Whether this provider becomes the active one.

        Returns:
            The stored record.

        Raises:
            ProviderError: The provider limit is reached, or the records could
                not be written.
            SecretError: The credential could not be stored.
        """
        self._load()

        is_new = config.provider_id not in self._providers
        if is_new and len(self._providers) >= MAX_PROVIDERS:
            raise ProviderError(codes.LIMIT_REACHED)

        # The credential is written before the record, so a failure to store it
        # leaves no provider claiming a key it does not have.
        if api_key is not None:
            self._secrets.write(config.provider_id, api_key)

        self._providers[config.provider_id] = config

        # The first provider added becomes the active one. Configuring exactly
        # one and then having to select it as a second step is a step nobody
        # would understand the purpose of.
        if activate or not self._active_id:
            self._active_id = config.provider_id

        self._persist()
        return config

    def remove(self, provider_id: str) -> None:
        """Delete a provider and its credential.

        Args:
            provider_id: Which provider to delete.

        Raises:
            ProviderError: Nothing is stored under that identifier, or the
                records could not be written.
            SecretError: The credential could not be deleted.
        """
        self.require(provider_id)

        # The credential goes first. The reverse order can leave a key in the
        # credential store with nothing left that names it, which is a secret
        # nobody can see to delete.
        self._secrets.remove(provider_id)
        del self._providers[provider_id]

        if self._active_id == provider_id:
            self._active_id = next(iter(self._providers), "")

        self._persist()

    def activate(self, provider_id: str) -> ProviderConfig:
        """Select the provider that serves generation.

        Args:
            provider_id: Which provider to select.

        Returns:
            The now-active record.

        Raises:
            ProviderError: Nothing is stored under that identifier, or the
                records could not be written.
        """
        config = self.require(provider_id)
        self._active_id = provider_id
        self._persist()
        return config

    def api_key(self, provider_id: str) -> str:
        """Return the stored credential for one provider.

        The only method that hands a credential back, and nothing outside the
        request path calls it. It is never used to build a response body.

        Args:
            provider_id: Which provider's credential to read.

        Returns:
            The credential, or an empty string when none is stored.

        Raises:
            SecretError: The credential store could not be read.
        """
        return self._secrets.read(provider_id)

    def key_hint(self, provider_id: str) -> str:
        """Return a masked hint for one provider's credential.

        What the interface is shown instead of the key. A store that cannot be
        read reports no key rather than failing the whole settings screen: the
        user still needs to see their providers in order to fix the problem.

        Args:
            provider_id: Which provider's credential to describe.

        Returns:
            The masked hint, or an empty string when there is no key.
        """
        try:
            return mask_key(self._secrets.read(provider_id))
        except SecretError:
            return ""

    def has_key(self, provider_id: str) -> bool:
        """Report whether a credential is stored for one provider.

        Args:
            provider_id: Which provider to check.

        Returns:
            True when a credential is stored.
        """
        return self.key_hint(provider_id) != ""


_store: ProviderStore | None = None


def get_provider_store() -> ProviderStore:
    """Return the process wide provider store.

    Returns:
        The cached store, created on first use.
    """
    global _store
    if _store is None:
        _store = ProviderStore()
    return _store


def reset_provider_store() -> None:
    """Discard the cached store so the next read builds a fresh one.

    Tests use this after pointing :data:`DIRECTORY_ENV` somewhere temporary.
    """
    global _store
    _store = None
