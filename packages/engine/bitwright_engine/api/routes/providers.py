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

"""Provider configuration routes.

The settings screen reads and writes remote inference providers here: several
may be stored, exactly one is active, and each holds a credential that this API
accepts but never returns.

Everything is ``GET`` or ``POST``, and an action on one provider is a ``POST``
to a verb under its identifier, matching ``/v1/backends/{kind}/select`` and
``/v1/models/{id}/download``. The shell forwards a fixed method and a checked
path for every call it makes, so keeping to two methods keeps that surface
small.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from bitwright_engine.api.schemas import (
    ConnectionTestResponse,
    ProviderInfo,
    ProviderListResponse,
    ProviderPresetInfo,
    ProviderSaveBody,
)
from bitwright_engine.api.state import EngineState, StateDep
from bitwright_engine.providers import codes
from bitwright_engine.providers.catalogue import PRESETS, ProviderPreset
from bitwright_engine.providers.credentials import SecretError
from bitwright_engine.providers.probe import probe
from bitwright_engine.providers.records import (
    MAX_PROVIDERS,
    ProviderConfig,
    ProviderError,
    build_provider,
    is_valid_provider_id,
)
from bitwright_engine.providers.store import ProviderStore
from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/v1/providers", tags=["providers"])


def _to_info(config: ProviderConfig, store: ProviderStore) -> ProviderInfo:
    """Build the wire representation of one provider.

    The credential is read only to be masked, and the mask is what leaves this
    function. There is no field on :class:`ProviderInfo` that could carry the
    value even by mistake.

    Args:
        config: The stored record.
        store: Where the credential lives.

    Returns:
        The provider as the interface sees it.
    """
    hint = store.key_hint(config.provider_id)
    return ProviderInfo(
        provider_id=config.provider_id,
        name=config.name,
        kind=config.kind.value,
        preset_id=config.preset_id,
        base_url=config.base_url,
        model=config.model,
        auth_scheme=config.auth_scheme.value,
        auth_header=config.auth_header,
        extra_headers=dict(config.extra_headers),
        timeout_s=config.timeout_s,
        has_key=hint != "",
        key_hint=hint,
        active=config.provider_id == store.active_id,
    )


def _to_preset_info(preset: ProviderPreset) -> ProviderPresetInfo:
    """Build the wire representation of one catalogue entry.

    Args:
        preset: The catalogue entry.

    Returns:
        The entry as the interface sees it.
    """
    return ProviderPresetInfo(
        preset_id=preset.preset_id,
        name=preset.name,
        base_url=preset.base_url,
        default_model=preset.default_model,
        auth_scheme=preset.auth_scheme.value,
        auth_header=preset.auth_header,
        documentation_url=preset.documentation_url,
    )


def _listing(state: EngineState) -> ProviderListResponse:
    """Build the full provider listing.

    Every mutating route answers with this rather than with the one record it
    touched. Activating a provider deactivates another, and removing one can
    move the active selection, so a single record is never the whole change.

    Args:
        state: The engine state.

    Returns:
        Every provider, the catalogue, and how credentials are being held.
    """
    store = state.providers
    return ProviderListResponse(
        providers=[_to_info(config, store) for config in store.all()],
        presets=[_to_preset_info(preset) for preset in PRESETS],
        active_id=store.active_id,
        secret_storage=store.secret_storage,
        max_providers=MAX_PROVIDERS,
    )


def _checked_id(provider_id: str) -> str:
    """Reject an identifier that is not the shape an identifier has.

    Args:
        provider_id: The value from the URL path.

    Returns:
        The identifier.

    Raises:
        HTTPException: The value is not a plain identifier.
    """
    if not is_valid_provider_id(provider_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=codes.PROVIDER_UNKNOWN,
        )
    return provider_id


@router.get("", response_model=ProviderListResponse)
def list_all(state: StateDep) -> ProviderListResponse:
    """List configured providers, the catalogue, and the credential store kind.

    Args:
        state: The engine state.

    Returns:
        Everything the settings screen needs to render the providers card.
    """
    return _listing(state)


@router.post("/save", response_model=ProviderListResponse)
def save(body: ProviderSaveBody, state: StateDep) -> ProviderListResponse:
    """Create a provider, or replace an existing one.

    Validation happens in the provider package rather than here, so that a
    record typed into the interface and a record loaded from a hand-edited file
    are held to the same rules.

    Nothing about the body is logged. It carries a credential.

    Args:
        body: The provider to store.
        state: The engine state.

    Returns:
        The refreshed listing.

    Raises:
        HTTPException: The provider is not usable, the limit is reached, or the
            credential could not be stored.
    """
    store = state.providers

    if body.provider_id and store.get(body.provider_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=codes.PROVIDER_UNKNOWN,
        )

    try:
        config = build_provider(
            provider_id=body.provider_id,
            name=body.name,
            kind=body.kind,
            preset_id=body.preset_id,
            base_url=body.base_url,
            model=body.model,
            auth_scheme=body.auth_scheme,
            auth_header=body.auth_header,
            extra_headers=body.extra_headers,
            timeout_s=body.timeout_s,
        )
    except ProviderError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=error.code,
        ) from error

    # get_secret_value is called at the last possible moment and the result is
    # not bound to a name that outlives the call.
    api_key = None if body.api_key is None else body.api_key.get_secret_value()

    try:
        store.save(config, api_key, activate=body.activate)
    except ProviderError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=error.code) from error
    except SecretError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=error.code,
        ) from error

    logger.info("saved provider %s", config.provider_id)
    return _listing(state)


@router.post("/{provider_id}/activate", response_model=ProviderListResponse)
def activate(provider_id: str, state: StateDep) -> ProviderListResponse:
    """Select the provider that serves generation.

    Args:
        provider_id: Which provider to select.
        state: The engine state.

    Returns:
        The refreshed listing.

    Raises:
        HTTPException: The identifier does not name a stored provider.
    """
    try:
        state.providers.activate(_checked_id(provider_id))
    except ProviderError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=error.code) from error

    return _listing(state)


@router.post("/{provider_id}/remove", response_model=ProviderListResponse)
def remove(provider_id: str, state: StateDep) -> ProviderListResponse:
    """Delete a provider and the credential stored for it.

    The confirmation happens in the interface, because that is where the user
    is. This route does what it is told.

    Args:
        provider_id: Which provider to delete.
        state: The engine state.

    Returns:
        The refreshed listing.

    Raises:
        HTTPException: The identifier does not name a stored provider, or the
            credential could not be deleted.
    """
    checked = _checked_id(provider_id)
    try:
        state.providers.remove(checked)
    except ProviderError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=error.code) from error
    except SecretError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=error.code,
        ) from error

    logger.info("removed provider %s", checked)
    return _listing(state)


@router.post("/test", response_model=ConnectionTestResponse)
def test_draft(body: ProviderSaveBody, state: StateDep) -> ConnectionTestResponse:
    """Run one connection test against a provider that is not saved yet.

    The editor needs this: a model list can only come from the provider, the
    provider will not answer without a credential, and asking someone to save
    a configuration before they can find out whether it works is asking them to
    commit to a guess.

    The key is taken from the body and never stored by this route.

    Args:
        body: The configuration being edited.
        state: The engine state, for the key a saved provider already has.

    Returns:
        The outcome, carrying a stable reason code either way.

    Raises:
        HTTPException: The configuration is not one that could be saved.
    """
    try:
        config = build_provider(
            provider_id=body.provider_id,
            name=body.name,
            kind=body.kind,
            preset_id=body.preset_id,
            base_url=body.base_url,
            model=body.model,
            auth_scheme=body.auth_scheme,
            auth_header=body.auth_header,
            extra_headers=body.extra_headers,
            timeout_s=body.timeout_s,
        )
    except ProviderError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=error.code,
        ) from error

    # Read into a local and not held: this route stores nothing, and a draft's
    # key exists only for the length of the request that carried it.
    #
    # An absent key means "the one already stored", the same as it does when
    # saving. Without that, editing a saved provider and asking it for its
    # model list failed unless the key was pasted again - which is not a
    # security measure, it is a password prompt for something the application
    # already has.
    if body.api_key is not None:
        api_key = body.api_key.get_secret_value()
    elif body.provider_id:
        api_key = state.providers.api_key(body.provider_id)
    else:
        api_key = ""

    result = probe(config, api_key)
    return ConnectionTestResponse(
        ok=result.ok,
        code=result.code,
        detail=result.detail,
        latency_ms=result.latency_ms,
        model_count=result.model_count,
        models=list(result.models),
        all_models=list(result.all_models),
    )


@router.post("/{provider_id}/test", response_model=ConnectionTestResponse)
def test_connection(provider_id: str, state: StateDep) -> ConnectionTestResponse:
    """Run one connection test against a stored provider.

    Answers 200 whether or not the endpoint did. A refused key is not a failure
    of this API, it is the result the user pressed the button to find out, and
    an HTTP error here would be reported as an engine fault instead.

    Args:
        provider_id: Which provider to test.
        state: The engine state.

    Returns:
        The outcome, carrying a stable reason code either way.

    Raises:
        HTTPException: The identifier does not name a stored provider, or its
            credential could not be read.
    """
    store = state.providers
    try:
        config = store.require(_checked_id(provider_id))
    except ProviderError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=error.code) from error

    try:
        api_key = store.api_key(config.provider_id)
    except SecretError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=error.code,
        ) from error

    if config.needs_key and not api_key:
        return ConnectionTestResponse(
            ok=False,
            code=codes.API_KEY_MISSING,
            detail="no credential is stored for this provider",
            latency_ms=0,
            model_count=0,
        )

    result = probe(config, api_key, client=state.probe_client)
    return ConnectionTestResponse(
        ok=result.ok,
        code=result.code,
        detail=result.detail,
        latency_ms=result.latency_ms,
        model_count=result.model_count,
        models=list(result.models),
        all_models=list(result.all_models),
    )
