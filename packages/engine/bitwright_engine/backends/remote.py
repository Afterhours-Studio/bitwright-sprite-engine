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

import base64
import io
import random
import time
from dataclasses import dataclass

import httpx
from PIL import Image

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
from bitwright_engine.backends.pipeline import reduce_to
from bitwright_engine.config import Settings, get_settings
from bitwright_engine.providers import codes
from bitwright_engine.providers.catalogue import AuthScheme, ProviderKind
from bitwright_engine.providers.records import (
    ProviderConfig,
    ProviderError,
    join_url,
    normalise_base_url,
)
from bitwright_engine.providers.store import ProviderStore, get_provider_store
from bitwright_engine.utils.images import to_png_bytes
from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)

CAPABILITIES = frozenset({Capability.BATCH})

OFFERED_SIZES: tuple[int, ...] = (256, 512, 1024, 1536, 2048)
"""Square sizes an image API is likely to accept, smallest first."""

ENVIRONMENT_PROVIDER_ID = "environment"
"""Identifier of the synthetic provider built from environment settings.

Not a stored provider, and never written to ``providers.json``. It exists so
that the environment path and the configured path produce the same shape, and
the rest of this module has only one case to handle.
"""


class RemoteBackendError(BackendError):
    """Raised when the remote endpoint rejects a request or cannot be reached.

    The code is per instance rather than per class, because one failure here
    covers a wrong key, an account without billing, a quota that ran out and a
    host that never answered. Collapsing those into one message sends the
    reader to look in four places at once.
    """

    def __init__(self, code: str = "backend.remote.request_failed") -> None:
        """Create the error.

        Args:
            code: Stable reason code naming what actually happened.
        """
        super().__init__(code)
        self.code = code


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
        """Ask the active provider for the sprites.

        The request is the OpenAI image shape, because that is the contract
        every preset and every custom endpoint here is documented against.

        The provider is asked for a square that is large enough to draw, not
        for the sprite's own size: an image API refuses sizes it does not
        offer, and a model asked for 64 pixels returns mush anyway. The result
        is brought down here, the same way the local backends bring theirs
        down.

        Args:
            request: Generation parameters, known to be supported.

        Returns:
            One image per requested batch item.

        Raises:
            RemoteBackendError: No provider is usable, or the endpoint refused.
        """
        started = time.monotonic()
        base_seed = request.seed if request.seed is not None else random.randrange(2**31)

        resolved = self.resolve()
        if resolved.config is None:
            raise RemoteBackendError(resolved.detail or codes.REQUEST_FAILED)

        config = resolved.config
        model = config.model or request.model_id
        logger.info(
            "remote generate: provider=%s endpoint=%s model=%s batch=%d",
            config.name,
            config.base_url,
            model,
            request.batch_size,
        )

        api_key = self._providers.api_key(config.provider_id)
        headers = config.headers(api_key)

        # Not every model that draws is reached through the images endpoint.
        # Google's image models answer on chat completions and refuse the
        # images one outright, so the shape follows the model rather than the
        # provider - the alternative is telling the user their key is broken
        # when the request simply went to the wrong door.
        via_chat = _draws_through_chat(model)
        path = "chat/completions" if via_chat else "images/generations"
        url = join_url(config.base_url, path)
        payload = (
            _chat_payload(model, request.prompt)
            if via_chat
            else _image_payload(model, request, _request_size(request.width, request.height))
        )

        try:
            with httpx.Client(timeout=config.timeout_s, follow_redirects=False) as client:
                response = client.post(url, json=payload, headers=headers)
        except httpx.HTTPError as error:
            raise RemoteBackendError(codes.REQUEST_FAILED) from error

        if response.is_error:
            # The provider's own message is not carried through: some echo the
            # offending key back in it. The status is, because "rejected or
            # unreachable" covers a wrong key, an unpaid account and a quota
            # that ran out, and sends the reader to look in three places at
            # once.
            logger.warning("remote generate refused with HTTP %d", response.status_code)
            raise RemoteBackendError(_refusal(response.status_code, response.text))

        try:
            body = response.json()
            decoded = _from_chat(body) if via_chat else _decode(body["data"])
        except (ValueError, KeyError, TypeError) as error:
            raise RemoteBackendError(codes.UNEXPECTED_SHAPE) from error

        images = [
            GeneratedImage(
                data=to_png_bytes(reduce_to(image, request.width, request.height)),
                width=request.width,
                height=request.height,
                seed=base_seed + index,
            )
            for index, image in enumerate(decoded)
        ]

        if not images:
            raise RemoteBackendError(codes.UNEXPECTED_SHAPE)

        elapsed_ms = int((time.monotonic() - started) * 1000)
        return GenerationResult(images=images, backend=self.kind, duration_ms=elapsed_ms)


def _request_size(width: int, height: int) -> str:
    """Return the size to ask a provider for.

    An image API offers a fixed set of sizes and refuses the rest, and a sprite
    is asked for far below any of them. The nearest offered square that is at
    least as large is requested and the result reduced afterwards, which is the
    same bargain the local backends make.

    Args:
        width: Sprite width.
        height: Sprite height.

    Returns:
        A size string, such as ``1024x1024``.
    """
    wanted = max(width, height)
    for offered in OFFERED_SIZES:
        if offered >= wanted:
            return f"{offered}x{offered}"
    return f"{OFFERED_SIZES[-1]}x{OFFERED_SIZES[-1]}"


def _decode(entries: object) -> list[Image.Image]:
    """Read the images out of an OpenAI image response.

    Both forms are accepted: base64 in the body, and a URL to fetch. Only the
    first is decoded here - following a URL would be a second request to a host
    the provider named, which is the same reason redirects are refused.

    Args:
        entries: The ``data`` array from the response.

    Returns:
        The decoded images, skipping anything that is not one.
    """
    if not isinstance(entries, list):
        return []

    images: list[Image.Image] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        encoded = entry.get("b64_json")
        if not isinstance(encoded, str) or not encoded:
            continue
        try:
            images.append(Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGBA"))
        except (ValueError, OSError):
            logger.warning("a returned image could not be decoded")

    return images


def _refusal(status: int, body: str) -> str:
    """Return the reason code for a status a provider refused with.

    The body is read for one thing only: whether a 429 means the allowance ran
    out or that there was never one. Google answers both with 429, and telling
    someone to wait for a quota of zero to replenish is telling them to wait
    for ever. Nothing from the body is shown to the user - some providers echo
    the offending key back inside it.

    Args:
        status: The HTTP status.
        body: The response body, read but never carried through.

    Returns:
        A stable reason code naming what to do about it.
    """
    if status == httpx.codes.UNAUTHORIZED:
        return codes.BAD_KEY
    if status == httpx.codes.FORBIDDEN:
        return codes.FORBIDDEN
    if status == httpx.codes.TOO_MANY_REQUESTS:
        return codes.NO_ALLOWANCE if "limit: 0" in body else codes.RATE_LIMITED
    if status == httpx.codes.NOT_FOUND:
        return codes.NOT_FOUND
    if status >= httpx.codes.INTERNAL_SERVER_ERROR:
        return codes.SERVER_ERROR
    return codes.REJECTED


def _draws_through_chat(model: str) -> bool:
    """Report whether a model draws through chat completions.

    Named by the model rather than by the provider, because one provider can
    offer both kinds: Google's Imagen models answer on the images endpoint and
    its Gemini image models answer on chat, from the same base URL.

    Args:
        model: The model identifier.

    Returns:
        True when the request should go to chat completions.
    """
    name = model.lower()
    return "gemini" in name and "image" in name


def _image_payload(model: str, request: GenerationRequest, size: str) -> dict[str, object]:
    """Build the body for the images endpoint.

    Args:
        model: Model identifier.
        request: The generation parameters.
        size: Size to ask the provider for.

    Returns:
        The request body.
    """
    return {
        "model": model,
        "prompt": request.prompt,
        "n": request.batch_size,
        "size": size,
        "response_format": "b64_json",
    }


def _chat_payload(model: str, prompt: str) -> dict[str, object]:
    """Build the body for a model that draws through chat completions.

    Args:
        model: Model identifier.
        prompt: What to draw.

    Returns:
        The request body.
    """
    return {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "modalities": ["image", "text"],
    }


def _from_chat(body: object) -> list[Image.Image]:
    """Read the images out of a chat completion.

    A chat model returns them as attachments on the message rather than as a
    data array, so the two shapes cannot share a reader.

    Args:
        body: The decoded response body.

    Returns:
        The decoded images.
    """
    if not isinstance(body, dict):
        return []

    choices = body.get("choices")
    if not isinstance(choices, list):
        return []

    images: list[Image.Image] = []
    for choice in choices:
        if not isinstance(choice, dict):
            continue
        message = choice.get("message")
        if not isinstance(message, dict):
            continue
        for item in message.get("images") or []:
            if not isinstance(item, dict):
                continue
            url = item.get("image_url")
            source = url.get("url") if isinstance(url, dict) else url
            if not isinstance(source, str) or "base64," not in source:
                continue
            try:
                raw = base64.b64decode(source.split("base64,", 1)[1])
                images.append(Image.open(io.BytesIO(raw)).convert("RGBA"))
            except (ValueError, OSError):
                logger.warning("a returned image could not be decoded")

    return images
