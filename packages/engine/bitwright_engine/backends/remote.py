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
one, and the only option on hardware that neither CUDA nor Metal supports. The
endpoint and credentials come from settings; requests are sent to the provider
the user configured, and never proxied through Afterhours Studio.
"""

from __future__ import annotations

import random
import time

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
from bitwright_engine.utils.images import placeholder, to_png_bytes
from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)

CAPABILITIES = frozenset({Capability.BATCH})


class RemoteBackendError(BackendError):
    """Raised when the remote endpoint rejects a request or cannot be reached."""

    code = "backend.remote.request_failed"


class RemoteBackend(BaseBackend):
    """Generation delegated to a remote HTTP API.

    Attributes:
        kind: Always :attr:`BackendKind.REMOTE`.
    """

    kind = BackendKind.REMOTE

    def __init__(self, settings: Settings | None = None) -> None:
        """Create the backend.

        Args:
            settings: Configuration to read the endpoint and credentials from.
                Defaults to the process wide settings.
        """
        self._settings = settings if settings is not None else get_settings()

    def available(self) -> Availability:
        """Check that an endpoint and a credential are configured.

        Reachability is not probed here. :meth:`available` is called on every
        settings screen render, and a network round trip on each one would make
        the screen sluggish. A dead endpoint surfaces as a generation error
        with the ``backend.remote.request_failed`` code.

        Returns:
            Availability, with a reason code when configuration is incomplete.
        """
        if not self._settings.remote_endpoint:
            return Availability(ready=False, detail="backend.remote.endpoint_missing")

        if not self._settings.remote_api_key:
            return Availability(ready=False, detail="backend.remote.api_key_missing")

        return Availability(ready=True, device=self._settings.remote_endpoint)

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

        A real implementation posts the request to
        ``{remote_endpoint}/v1/generate`` with the API key as a bearer token,
        and decodes the returned images. The scaffold keeps the same shape so
        that the swap touches only this method.

        Args:
            request: Generation parameters, known to be supported.

        Returns:
            One placeholder image per requested batch item.
        """
        started = time.monotonic()
        base_seed = request.seed if request.seed is not None else random.randrange(2**31)
        logger.info(
            "remote generate: endpoint=%s model=%s batch=%d",
            self._settings.remote_endpoint,
            request.model_id,
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
