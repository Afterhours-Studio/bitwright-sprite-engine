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

"""Remote inference providers.

The remote backend needs somewhere to send a request and a credential to send
with it. This package is that: a small catalogue of providers known by name, a
custom kind for anything else that speaks the OpenAI compatible shape, storage
that keeps the credential out of the configuration file, and one explicit
connection test.
"""

from bitwright_engine.providers.catalogue import (
    CUSTOM_PRESET_ID,
    PRESETS,
    AuthScheme,
    ProviderKind,
    ProviderPreset,
    get_preset,
)
from bitwright_engine.providers.credentials import (
    FILE,
    KEYCHAIN,
    FileStore,
    KeychainStore,
    SecretError,
    SecretStore,
    create_secret_store,
    keychain_available,
)
from bitwright_engine.providers.probe import ProbeResult, probe
from bitwright_engine.providers.records import (
    MAX_PROVIDERS,
    ProviderConfig,
    ProviderError,
    build_provider,
    join_url,
    mask_key,
    new_provider_id,
    normalise_base_url,
)
from bitwright_engine.providers.store import (
    ProviderStore,
    default_provider_dir,
    get_provider_store,
    reset_provider_store,
)

__all__ = [
    "CUSTOM_PRESET_ID",
    "FILE",
    "KEYCHAIN",
    "MAX_PROVIDERS",
    "PRESETS",
    "AuthScheme",
    "FileStore",
    "KeychainStore",
    "ProbeResult",
    "ProviderConfig",
    "ProviderError",
    "ProviderKind",
    "ProviderPreset",
    "ProviderStore",
    "SecretError",
    "SecretStore",
    "build_provider",
    "create_secret_store",
    "default_provider_dir",
    "get_preset",
    "get_provider_store",
    "join_url",
    "keychain_available",
    "mask_key",
    "new_provider_id",
    "normalise_base_url",
    "probe",
    "reset_provider_store",
]
