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

"""Wire models for the provider routes.

THE CREDENTIAL TRAVELS IN ONE DIRECTION ONLY
--------------------------------------------

:class:`ProviderSaveBody` has an ``apiKey``. :class:`ProviderInfo` does not,
and it never will. A key goes in when the user types one and never comes back
out; what comes back is ``hasKey`` and a masked ``keyHint``, which is enough to
tell two configured providers apart and not enough to use either of them.

That asymmetry is what makes a settings form that round-trips a provider safe.
The frontend can read a provider, edit its name, and save it again without ever
having held the key: ``apiKey`` absent from the body means "leave the stored
one alone".

The incoming field is a :class:`~pydantic.SecretStr`, so the value is masked in
every repr and in anything that logs a model by accident.
"""

from __future__ import annotations

from pydantic import Field, SecretStr

from bitwright_engine.api.schemas.common import CamelModel
from bitwright_engine.providers.records import (
    DEFAULT_TIMEOUT_S,
    MAX_MODEL,
    MAX_NAME,
    MAX_TIMEOUT_S,
    MAX_URL,
    MIN_TIMEOUT_S,
)


class ProviderInfo(CamelModel):
    """One configured provider, as the settings screen sees it.

    Attributes:
        provider_id: Stable identifier.
        name: Display name.
        kind: ``preset`` or ``custom``.
        preset_id: Catalogue entry this came from, empty for a custom provider.
        base_url: Where requests are sent, with no trailing slash.
        model: Model identifier sent with generation requests.
        auth_scheme: ``bearer``, ``header``, or ``none``.
        auth_header: Header the credential is sent in, when ``auth_scheme`` is
            ``header``.
        extra_headers: Further headers this provider requires.
        timeout_s: Request timeout in seconds.
        has_key: Whether a credential is stored for this provider. There is no
            field carrying the credential itself.
        key_hint: Masked hint, such as ``****a1b2``. Empty when no credential
            is stored.
        active: Whether this provider serves generation.
    """

    provider_id: str
    name: str
    kind: str
    preset_id: str
    base_url: str
    model: str
    auth_scheme: str
    auth_header: str
    extra_headers: dict[str, str]
    timeout_s: float
    has_key: bool
    key_hint: str
    active: bool


class ProviderPresetInfo(CamelModel):
    """One catalogue entry, offered when adding a provider.

    Attributes:
        preset_id: Stable identifier, sent back when the user picks this one.
        name: Default display name.
        base_url: Endpoint this preset uses.
        default_model: Model proposed when the provider is added. Empty when
            the provider has no sensible default and the user must choose.
        auth_scheme: How this provider expects the credential.
        auth_header: Header name when ``auth_scheme`` is ``header``.
        documentation_url: Where the user gets a key.
    """

    preset_id: str
    name: str
    base_url: str
    default_model: str
    auth_scheme: str
    auth_header: str
    documentation_url: str


class ProviderListResponse(CamelModel):
    """Every configured provider, plus what is needed to add another.

    Attributes:
        providers: Configured providers, in the order they were added.
        presets: The built-in catalogue.
        active_id: Identifier of the provider serving generation, empty when
            none is selected.
        secret_storage: ``keychain`` when credentials are held by the operating
            system, ``file`` when they are in a permission-restricted file
            because this machine offers no credential store. Shown to the user,
            because a weaker guarantee they cannot see is one they cannot act
            on.
        max_providers: How many providers may be stored in total.
    """

    providers: list[ProviderInfo]
    presets: list[ProviderPresetInfo]
    active_id: str
    secret_storage: str
    max_providers: int


class ProviderSaveBody(CamelModel):
    """A provider to create or replace.

    Attributes:
        provider_id: Identifier to replace. Empty creates a new provider.
        name: Display name. A preset supplies its own when this is empty.
        kind: ``preset`` or ``custom``.
        preset_id: Catalogue entry, required when ``kind`` is ``preset``.
        base_url: Endpoint. A preset supplies its own when this is empty; a
            custom provider must carry one.
        model: Model identifier sent with generation requests.
        auth_scheme: ``bearer``, ``header``, or ``none``.
        auth_header: Header name, required when ``auth_scheme`` is ``header``.
        extra_headers: Further headers this provider requires.
        timeout_s: Request timeout in seconds.
        api_key: The credential. Absent leaves the stored one untouched, which
            is what an edit that did not open the key field sends. An empty
            string removes it. It is never echoed back in any response.
        activate: Whether this provider becomes the active one.
    """

    provider_id: str = ""
    name: str = Field(default="", max_length=MAX_NAME)
    kind: str = "custom"
    preset_id: str = ""
    base_url: str = Field(default="", max_length=MAX_URL)
    model: str = Field(default="", max_length=MAX_MODEL)
    auth_scheme: str = "bearer"
    auth_header: str = ""
    extra_headers: dict[str, str] = Field(default_factory=dict)
    timeout_s: float = Field(default=DEFAULT_TIMEOUT_S, ge=MIN_TIMEOUT_S, le=MAX_TIMEOUT_S)
    api_key: SecretStr | None = None
    activate: bool = False


class ConnectionTestResponse(CamelModel):
    """The outcome of one connection test.

    Attributes:
        ok: Whether the endpoint answered and accepted the credential.
        code: Stable reason code the interface translates, including on
            success.
        detail: Short English description, composed by the engine. The
            provider's own response body is never copied into it.
        latency_ms: Round trip time in milliseconds.
        model_count: How many models the endpoint listed.
        models: Their identifiers, for the interface to offer.
    """

    ok: bool
    code: str
    detail: str
    latency_ms: int
    model_count: int
    models: list[str] = Field(default_factory=list)
