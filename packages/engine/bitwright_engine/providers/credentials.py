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

"""Where API keys are kept.

An API key is a bearer credential: whoever holds it can spend the user's money
at the provider. It is therefore not stored beside the other preferences, and
it is not stored by this application at all when the operating system offers
somewhere better.

TWO TIERS, AND THE USER IS TOLD WHICH ONE THEY GOT
--------------------------------------------------

1. :class:`KeychainStore` puts the key in the platform credential store -
   Windows Credential Manager, the macOS Keychain, or a Secret Service provider
   such as GNOME Keyring or KWallet on Linux. The key is then held by the
   operating system, encrypted at rest with the user's login credentials, and
   it never touches a file this application writes.

2. :class:`FileStore` is the fallback for a machine with no credential store
   at all, which in practice means a headless Linux session with no Secret
   Service running. It writes a JSON file, in plain text, created through
   :func:`os.open` with mode ``0o600`` so that the file is never briefly
   readable by anyone else between creation and the permission being set.

THE FALLBACK IS WEAKER, AND NOT EQUALLY WEAK EVERYWHERE
-------------------------------------------------------

The file tier protects a key from another *user* on a POSIX machine. It
protects it from nothing else. Any process running as this user can read it,
and a backup or a synchronisation client that follows the configuration
directory will copy the key off the machine. On Windows, ``0o600`` toggles only
the read-only attribute and confers no access control whatsoever, which is why
Windows is never expected to reach this tier: Credential Manager is always
present there.

Which tier is in force is reported through :attr:`SecretStore.kind` and shown
in the interface, because a security property the user cannot see is one they
cannot act on.

NOTHING HERE LOGS A KEY
-----------------------

No function in this module writes a secret to a log, an exception message, or a
repr. Failures carry a reason code and the provider identifier, never the
value. That rule is checked by a test, not just stated here.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from bitwright_engine.config import APP_ID
from bitwright_engine.providers import codes
from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)

KEYCHAIN = "keychain"
"""Value of :attr:`SecretStore.kind` for the operating system credential store."""

FILE = "file"
"""Value of :attr:`SecretStore.kind` for the plain file fallback."""

CREDENTIALS_FILE = "credentials.json"
"""Name of the file the fallback tier writes."""

STORE_ENV = "BITWRIGHT_SECRET_STORE"
"""Environment variable that forces which tier is used.

``keychain`` or ``file``. Unset, the tier is chosen by probing. It exists so
that the test suite can never reach the developer's own credential store, and
so that a user on a machine with a broken Secret Service can opt out of it.
"""

SERVICE_NAME = APP_ID
"""Service the credential store files these entries under."""

_FILE_MODE = 0o600
"""Owner read and write, nothing for anyone else."""

_DIRECTORY_MODE = 0o700
"""Owner only, so the file cannot be reached by listing the directory."""


def write_private_json(path: Path, payload: dict[str, Any]) -> None:
    """Write a JSON file only this user can read.

    Written to a temporary file and moved into place, so that an interrupted
    write cannot leave a truncated file and lose everything in it at once. The
    temporary file is opened through :func:`os.open` with its final mode
    already set, rather than created and then chmod'ed: the gap between those
    two calls is a window in which the file is world readable, and what goes
    through here is either credentials or the endpoints they belong to.

    On Windows the mode toggles only the read-only attribute and grants no
    access control. That limitation is stated in this module's docstring; the
    call is still made, because it costs nothing and is correct everywhere
    else.

    Args:
        path: Where the file goes. Parent directories are created.
        payload: JSON-serialisable content.

    Raises:
        OSError: The file could not be written. The temporary file is removed
            first, so nothing half written is left behind.
    """
    text = json.dumps(payload, indent=2, sort_keys=True)
    temporary = path.with_name(f"{path.name}.tmp")

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Path.chmod exists but takes no mode-only form that ruff's PTH rule
        # accepts here, and the directory mode has to be set explicitly.
        os.chmod(path.parent, _DIRECTORY_MODE)  # noqa: PTH101

        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, _FILE_MODE)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(text)
        temporary.replace(path)
    except OSError:
        temporary.unlink(missing_ok=True)
        raise


class SecretError(RuntimeError):
    """The credential store could not be read or written.

    Attributes:
        code: Stable reason code the user interface translates. Never carries
            the secret, and never carries the underlying message, which on some
            platforms embeds the value it failed to store.
    """

    def __init__(self, code: str) -> None:
        """Create the error.

        Args:
            code: The stable reason code.
        """
        super().__init__(code)
        self.code = code


@runtime_checkable
class SecretStore(Protocol):
    """Somewhere a per-provider credential can be kept.

    Attributes:
        kind: :data:`KEYCHAIN` or :data:`FILE`. Reported to the interface so
            the user can see how their keys are being held.
    """

    kind: str

    def read(self, provider_id: str) -> str:
        """Return the credential stored for one provider.

        Args:
            provider_id: Which provider's credential to read.

        Returns:
            The credential, or an empty string when none is stored.

        Raises:
            SecretError: The store could not be read.
        """
        ...

    def write(self, provider_id: str, secret: str) -> None:
        """Store the credential for one provider, replacing any previous one.

        Args:
            provider_id: Which provider the credential belongs to.
            secret: The credential. An empty string removes it.

        Raises:
            SecretError: The store refused to keep it.
        """
        ...

    def remove(self, provider_id: str) -> None:
        """Delete the credential for one provider.

        Removing a credential that is not there succeeds and does nothing, so
        that deleting a provider is idempotent.

        Args:
            provider_id: Which provider's credential to delete.

        Raises:
            SecretError: The store could not be written.
        """
        ...


class KeychainStore:
    """Credentials held by the operating system credential store.

    Attributes:
        kind: Always :data:`KEYCHAIN`.
    """

    kind = KEYCHAIN

    def __init__(self, service: str = SERVICE_NAME) -> None:
        """Create the store.

        Args:
            service: Service name entries are filed under. One per application,
                so that removing this application's entries never touches
                another's.
        """
        self._service = service

    def read(self, provider_id: str) -> str:
        """Return the credential stored for one provider.

        Args:
            provider_id: Which provider's credential to read.

        Returns:
            The credential, or an empty string when none is stored.

        Raises:
            SecretError: The credential store could not be read. On a locked
                keychain this is what the user sees, which is correct: the key
                is not gone, it is unavailable until they unlock it.
        """
        import keyring

        try:
            stored = keyring.get_password(self._service, provider_id)
        except Exception as error:
            # The message is dropped rather than chained into the reason code.
            # Some backends put the value they were handling into the error.
            logger.warning("credential store read failed for %s", provider_id)
            raise SecretError(codes.SECRET_READ_FAILED) from error

        return stored or ""

    def write(self, provider_id: str, secret: str) -> None:
        """Store the credential for one provider.

        Args:
            provider_id: Which provider the credential belongs to.
            secret: The credential. An empty string removes the entry.

        Raises:
            SecretError: The credential store refused to keep it.
        """
        if not secret:
            self.remove(provider_id)
            return

        import keyring

        try:
            keyring.set_password(self._service, provider_id, secret)
        except Exception as error:
            logger.warning("credential store write failed for %s", provider_id)
            raise SecretError(codes.SECRET_WRITE_FAILED) from error

    def remove(self, provider_id: str) -> None:
        """Delete the credential for one provider.

        Args:
            provider_id: Which provider's credential to delete.

        Raises:
            SecretError: The credential store could not be written.
        """
        import keyring
        from keyring.errors import PasswordDeleteError

        try:
            keyring.delete_password(self._service, provider_id)
        except PasswordDeleteError:
            # There was nothing there. Deleting a provider must not fail
            # because its key was already gone.
            return
        except Exception as error:
            logger.warning("credential store delete failed for %s", provider_id)
            raise SecretError(codes.SECRET_WRITE_FAILED) from error


class FileStore:
    """Credentials held in a plain file with restrictive permissions.

    The fallback tier. See this module's docstring for what it does and does
    not protect against; it is used only when no credential store is available.

    Attributes:
        kind: Always :data:`FILE`.
    """

    kind = FILE

    def __init__(self, directory: Path) -> None:
        """Create the store.

        Args:
            directory: Where the credentials file lives. Created on first
                write, owner-only.
        """
        self._path = directory / CREDENTIALS_FILE

    @property
    def path(self) -> Path:
        """Where the credentials are written.

        Returns:
            The file path, whether or not it exists yet.
        """
        return self._path

    def _load(self) -> dict[str, str]:
        """Read every stored credential.

        Returns:
            Provider identifiers mapped to credentials. Empty when the file is
            absent, which is the ordinary state before the first key is saved.

        Raises:
            SecretError: The file exists but could not be read or parsed.
        """
        if not self._path.is_file():
            return {}

        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            logger.warning("credentials file could not be read")
            raise SecretError(codes.SECRET_READ_FAILED) from error

        keys = raw.get("keys") if isinstance(raw, dict) else None
        if not isinstance(keys, dict):
            return {}
        return {str(key): str(value) for key, value in keys.items()}

    def _save(self, keys: dict[str, str]) -> None:
        """Write every stored credential back.

        Args:
            keys: Provider identifiers mapped to credentials.

        Raises:
            SecretError: The file could not be written.
        """
        try:
            write_private_json(self._path, {"version": 1, "keys": keys})
        except OSError as error:
            logger.warning("credentials file could not be written")
            raise SecretError(codes.SECRET_WRITE_FAILED) from error

    def read(self, provider_id: str) -> str:
        """Return the credential stored for one provider.

        Args:
            provider_id: Which provider's credential to read.

        Returns:
            The credential, or an empty string when none is stored.

        Raises:
            SecretError: The file could not be read.
        """
        return self._load().get(provider_id, "")

    def write(self, provider_id: str, secret: str) -> None:
        """Store the credential for one provider.

        Args:
            provider_id: Which provider the credential belongs to.
            secret: The credential. An empty string removes the entry.

        Raises:
            SecretError: The file could not be written.
        """
        keys = self._load()
        if secret:
            keys[provider_id] = secret
        else:
            keys.pop(provider_id, None)
        self._save(keys)

    def remove(self, provider_id: str) -> None:
        """Delete the credential for one provider.

        Args:
            provider_id: Which provider's credential to delete.

        Raises:
            SecretError: The file could not be written.
        """
        keys = self._load()
        if keys.pop(provider_id, None) is None:
            return
        self._save(keys)


def keychain_available() -> bool:
    """Report whether the platform credential store can be used.

    ``keyring`` resolves to a backend that refuses everything when it finds no
    usable one, so the check is that the resolved backend is not that refusal.
    Nothing is written during the probe: writing a canary entry to find out
    whether writing works would leave litter in the user's keychain.

    Returns:
        True when a real credential store answered.
    """
    try:
        import keyring
        from keyring.backends.fail import Keyring as FailingKeyring

        return not isinstance(keyring.get_keyring(), FailingKeyring)
    except Exception:
        # An import failure, a broken backend, or a D-Bus session that is not
        # there. All of them mean the same thing to the caller.
        logger.info("no operating system credential store is available")
        return False


def create_secret_store(directory: Path) -> SecretStore:
    """Return the best credential store this machine offers.

    :data:`STORE_ENV` forces the choice. The test suite sets it to ``file``, so
    that running the tests can never write an entry into the developer's own
    keychain and never leave one behind.

    Args:
        directory: Where the fallback tier would write its file.

    Returns:
        A :class:`KeychainStore` when the platform has a credential store, and
        a :class:`FileStore` otherwise.
    """
    forced = os.environ.get(STORE_ENV, "").strip().lower()
    if forced == FILE:
        return FileStore(directory)
    if forced == KEYCHAIN:
        return KeychainStore()

    if keychain_available():
        return KeychainStore()

    logger.warning(
        "storing API keys in a file under %s, because no credential store was found",
        directory,
    )
    return FileStore(directory)
