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

"""Generation through a remote HTTP inference API.

The remote backend needs no local GPU. It is the fallback on machines without
one, and the only option on hardware that neither CUDA nor Metal supports.

WHERE THE ENDPOINT AND THE CREDENTIAL COME FROM
-----------------------------------------------

From the provider the user configured, which lives in
:mod:`bitwright_engine.providers`. One of several stored providers is active,
and that one serves requests.

An endpoint set through ``BITWRIGHT_REMOTE_ENDPOINT`` still works, and is used
when no provider has been configured. That path exists for a headless run and
for continuous integration, where there is no interface to configure anything
with. A configured provider always wins, because it is the one the user can
see.

Requests go to the provider the user chose, and are never proxied through
Afterhours Studio.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass

from bitwright_engine.backends.base import (
    Availability,
    BackendError,
    BackendKind,
    BaseBackend,
    Capability,
    GeneratedImage,
    GenerationRequest,
    GenerationResult,
)
from bitwright_engine.config import Settings, get_settings
from bitwright_engine.providers import codes
from bitwright_engine.providers.catalogue import AuthScheme, ProviderKind
from bitwright_engine.providers.records import ProviderConfig, ProviderError, normalise_base_url
from bitwright_engine.providers.store import ProviderStore, get_provider_store
from bitwright_engine.utils.images import placeholder, to_png_bytes
from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)

CAPABILITIES = frozenset({Capability.BATCH})

ENVIRONMENT_PROVIDER_ID = "environment"
"""Identifier of the synthetic provider built from environment settings.

Not a stored provider, and never written to ``providers.json``. It exists so
that the environment path and the configured path produce the same shape, and
the rest of this module has only one case to handle.
"""


class RemoteBackendError(BackendError):
    """Raised when the remote endpoint rejects a request or cannot be reached."""

    code = "backend.remote.request_failed"


@dataclass(frozen=True, slots=True)
class Resolution:
    """The provider that will serve requests, or the reason none will.

    Attributes:
        config: The provider to use, or ``None`` when the backend is not ready.
        detail: Stable reason code when ``config`` is ``None``, empty
            otherwise.
    """

    config: ProviderConfig | None
    detail: str = ""


class RemoteBackend(BaseBackend):
    """Generation delegated to a remote HTTP API.

    Attributes:
        kind: Always :attr:`BackendKind.REMOTE`.
    """

    kind = BackendKind.REMOTE

    def __init__(
        self,
        settings: Settings | None = None,
        providers: ProviderStore | None = None,
    ) -> None:
        """Create the backend.

        Args:
            settings: Configuration to read the environment fallback from.
                Defaults to the process wide settings.
            providers: Where configured providers are read from. Defaults to
                the process wide store.
        """
        self._settings = settings if settings is not None else get_settings()
        self._providers = providers if providers is not None else get_provider_store()

    def _from_environment(self) -> Resolution:
        """Build a provider from the environment settings, if they are set.

        Returns:
            The synthetic provider, or the reason the environment does not
            configure one.
        """
        endpoint = self._settings.remote_endpoint
        if not endpoint:
            return Resolution(None, codes.ENDPOINT_MISSING)

        if not self._settings.remote_api_key:
            return Resolution(None, codes.API_KEY_MISSING)

        try:
            base_url = normalise_base_url(endpoint)
        except ProviderError as error:
            return Resolution(None, error.code)

        return Resolution(
            ProviderConfig(
                provider_id=ENVIRONMENT_PROVIDER_ID,
                name=base_url,
                kind=ProviderKind.CUSTOM,
                base_url=base_url,
                # The environment names no model, so the request carries
                # whatever the caller asked for. Left empty rather than
                # guessed: a wrong model identifier fails at the provider with
                # a message nobody can act on.
                model="",
                auth_scheme=AuthScheme.BEARER,
                timeout_s=self._settings.remote_timeout_s,
            )
        )

    def resolve(self) -> Resolution:
        """Decide which provider serves requests right now.

        Returns:
            The active provider, or the reason there is none to use.
        """
        active = self._providers.active()

        if active is None:
            # No selection. Either nothing is configured at all, in which case
            # the environment is the remaining chance, or providers exist and
            # none is chosen, which is a different thing to tell the user.
            if self._providers.all():
                return Resolution(None, codes.NO_ACTIVE_PROVIDER)
            return self._from_environment()

        if active.needs_key and not self._providers.has_key(active.provider_id):
            return Resolution(None, codes.API_KEY_MISSING)

        return Resolution(active)

    def available(self) -> Availability:
        """Check that a provider is configured and holds a credential.

        Reachability is not probed here. :meth:`available` is called on every
        settings screen render, and a network round trip on each one would make
        the screen sluggish, so proving the endpoint answers is the explicit
        connection test instead. A dead endpoint surfaces at generation time as
        ``backend.remote.request_failed``.

        Returns:
            Availability, with a reason code when configuration is incomplete.
        """
        resolved = self.resolve()
        if resolved.config is None:
            return Availability(ready=False, detail=resolved.detail)

        device = f"{resolved.config.name} ({resolved.config.base_url})"
        return Availability(ready=True, device=device)

    def capabilities(self) -> frozenset[Capability]:
        """Report the optional features the remote API supports.

        Only batching is declared. Adapter support varies between providers and
        cannot be assumed, so the scaffold advertises the intersection. A real
        implementation queries the provider's capability endpoint here and
        caches the answer.

        Returns:
            The supported capabilities.
        """
        return CAPABILITIES

    def _run(self, request: GenerationRequest) -> GenerationResult:
        """Produce placeholder images for a validated request.

        A real implementation posts to ``{base_url}/images/generations`` with
        the headers :meth:`ProviderConfig.headers` builds, and decodes the
        returned images. The scaffold resolves the provider exactly as that
        implementation would, so the swap touches only the request itself.

        The log line names the provider and the endpoint. It never names the
        credential, and the credential is never read on this path at all,
        because nothing here sends a request yet.

        Args:
            request: Generation parameters, known to be supported.

        Returns:
            One placeholder image per requested batch item.
        """
        started = time.monotonic()
        base_seed = request.seed if request.seed is not None else random.randrange(2**31)

        resolved = self.resolve()
        if resolved.config is None:
            raise RemoteBackendError(resolved.detail or codes.REQUEST_FAILED)

        logger.info(
            "remote generate: provider=%s endpoint=%s model=%s batch=%d",
            resolved.config.name,
            resolved.config.base_url,
            resolved.config.model or request.model_id,
            request.batch_size,
        )

        images = [
            GeneratedImage(
                data=to_png_bytes(placeholder(request.width, request.height, base_seed + index)),
                width=request.width,
                height=request.height,
                seed=base_seed + index,
            )
            for index in range(request.batch_size)
        ]

        elapsed_ms = int((time.monotonic() - started) * 1000)
        return GenerationResult(images=images, backend=self.kind, duration_ms=elapsed_ms)
