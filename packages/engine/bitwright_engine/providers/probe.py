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

"""The connection test.

One request, made only when the user asks for it. ``GET {base_url}/models`` is
the cheapest call in the OpenAI compatible surface that still proves both
things worth proving: that something is listening at that address, and that it
accepts this credential. It generates nothing and costs nothing.

WHY IT IS NOT AUTOMATIC
-----------------------

Nothing here runs while the user types. A probe on every keystroke would send a
half typed key to a half typed host, dozens of times, and the interesting
failure - a key that was rejected - would be indistinguishable from a key that
is not finished yet. The test is a button.

WHAT A FAILURE REPORTS
----------------------

A stable code from :mod:`bitwright_engine.providers.codes`, distinguishing the
cases a user can act on differently: the host was not there, something refused
the connection, it accepted and then went quiet, the key was rejected, or
something answered that was not an OpenAI compatible model listing.

NO RESPONSE BODY REACHES THE CALLER
-----------------------------------

The ``detail`` on the result is composed here, from this module's own strings.
The provider's response body is never copied into it and never logged. A
provider that echoes the offending credential back in its error message - and
some do - would otherwise put that key straight into a log file and a response
body. The credential is additionally scrubbed from the detail before it is
returned, which is belt and braces for exactly that case.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx

from bitwright_engine.providers import codes
from bitwright_engine.providers.records import ProviderConfig, join_url
from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)

MODELS_PATH = "models"
"""Path appended to the base URL. The OpenAI compatible model listing."""

PROBE_TIMEOUT_S = 15.0
"""Longest a connection test may take.

Shorter than a generation timeout on purpose. This is a button the user is
waiting on, and a provider that needs more than fifteen seconds to list its
models has already answered the question.
"""

REDACTED = "[redacted]"
"""What a credential is replaced with if one ever reaches a message."""

_MAX_DETAIL = 200
"""Longest detail string returned, so nothing unbounded reaches a log."""


@dataclass(frozen=True, slots=True)
class ProbeResult:
    """The outcome of one connection test.

    Attributes:
        ok: True when the endpoint answered with a usable model listing.
        code: Stable reason code. :data:`~bitwright_engine.providers.codes.REACHABLE`
            on success, and the specific failure otherwise.
        detail: Short English description for logs and bug reports. Composed
            here; never taken from the provider's response.
        latency_ms: Round trip time in milliseconds. Zero when no request was
            completed.
        model_count: How many models the endpoint listed. Zero on failure.
        models: The identifiers that draw, which is what this application
            asks for. Falls back to everything the provider listed when
            none of them look like image models, because a provider may
            name them in a way this cannot recognise.
        all_models: Everything the provider listed, for the interface to
            offer when the filtered list is not what was wanted.
    """

    ok: bool
    code: str
    detail: str
    latency_ms: int = 0
    model_count: int = 0
    models: tuple[str, ...] = ()
    all_models: tuple[str, ...] = ()


def _scrub(text: str, api_key: str) -> str:
    """Remove a credential from a message and bound its length.

    Args:
        text: The message.
        api_key: The credential that must not appear in it.

    Returns:
        The message, truncated, with any occurrence of the credential replaced.
    """
    cleaned = text.replace(api_key, REDACTED) if api_key else text
    return cleaned[:_MAX_DETAIL]


def _is_refused(error: BaseException) -> bool:
    """Report whether a transport failure was an active refusal.

    A refusal means something is at that address and declined to talk, which is
    a different problem from a host that does not resolve: the first is usually
    a wrong port or a service that is not running, the second a typo in the
    host name. The operating system error is buried in the exception chain, so
    the chain is walked rather than the message being matched.

    Args:
        error: The raised transport error.

    Returns:
        True when the connection was refused or reset.
    """
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, ConnectionRefusedError | ConnectionResetError):
            return True
        current = current.__cause__ or current.__context__
    return False


def _read_models(payload: object) -> list[str] | None:
    """Read the identifiers from an OpenAI compatible model listing.

    The names are returned, not merely counted, because the interface has to
    offer them: asking someone to type a model identifier from memory is asking
    them to guess, and a provider's catalogue is the only place the right
    spelling exists.

    Args:
        payload: The decoded response body.

    Returns:
        The identifiers, or ``None`` when the body is not a model listing. An
        empty listing is a valid answer and returns an empty list: the endpoint
        spoke the protocol, which is what the test asked.
    """
    entries: object
    if isinstance(payload, dict):
        entries = payload.get("data")
        if not isinstance(entries, list):
            return None
    elif isinstance(payload, list):
        entries = payload
    else:
        return None

    names: list[str] = []
    for entry in entries:
        if isinstance(entry, dict):
            identifier = entry.get("id") or entry.get("name")
            if isinstance(identifier, str) and identifier:
                names.append(identifier)
        elif isinstance(entry, str) and entry:
            names.append(entry)

    # Sorted, because a provider's own order is arbitrary and a searchable list
    # is easier to scan when it is not.
    return sorted(set(names))


IMAGE_MARKERS: tuple[str, ...] = (
    "image",
    "imagen",
    "dall-e",
    "dalle",
    "flux",
    "stable-diffusion",
    "sdxl",
    "sd3",
    "kandinsky",
    "playground",
    "pixart",
    "photon",
    "recraft",
    "ideogram",
    "seedream",
    "qwen-image",
)
"""Substrings that name a model as one that draws.

Matched on the identifier because an OpenAI compatible listing carries nothing
else: there is no modality field to read. A provider that lists fifty five
models offers perhaps three that draw, and the rest are text, audio and
research models that fail the moment they are asked for a picture.
"""


def image_models(names: list[str]) -> list[str]:
    """Keep the models that draw.

    Args:
        names: Every identifier the provider listed.

    Returns:
        The ones that appear to draw. Empty when none match, which the caller
        reads as "this provider names them some other way" rather than as
        "this provider draws nothing".
    """
    return [name for name in names if any(mark in name.lower() for mark in IMAGE_MARKERS)]


def _from_status(status: int) -> tuple[str, str]:
    """Map an HTTP status onto a reason code.

    Args:
        status: The status the provider answered with.

    Returns:
        The reason code and a short English detail.
    """
    if status == httpx.codes.UNAUTHORIZED:
        return codes.BAD_KEY, "HTTP 401, the endpoint rejected the key"
    if status == httpx.codes.FORBIDDEN:
        return codes.FORBIDDEN, "HTTP 403, the key is not permitted to do this"
    if status == httpx.codes.NOT_FOUND:
        return codes.NOT_FOUND, "HTTP 404, there is no model listing at that base URL"
    if status == httpx.codes.BAD_REQUEST:
        # Not every provider answers 401 to a bad key. Google answers 400,
        # so this cannot be reported as a transport problem.
        return codes.REJECTED, "HTTP 400, the provider refused the request"
    if status == httpx.codes.TOO_MANY_REQUESTS:
        return codes.RATE_LIMITED, "HTTP 429, the provider is throttling this key"
    if status >= httpx.codes.INTERNAL_SERVER_ERROR:
        return codes.SERVER_ERROR, f"HTTP {status}, the provider failed on its own side"
    if httpx.codes.MULTIPLE_CHOICES <= status < httpx.codes.BAD_REQUEST:
        return codes.NOT_FOUND, f"HTTP {status}, the base URL redirected elsewhere"
    return codes.REQUEST_FAILED, f"HTTP {status}"


def probe(
    config: ProviderConfig,
    api_key: str,
    *,
    client: httpx.Client | None = None,
) -> ProbeResult:
    """Run one connection test against a provider.

    Never raises. Every failure, including a malformed URL, comes back as a
    result carrying a reason code, because the caller is a button and a button
    reports rather than throws.

    Redirects are not followed. A redirect on this request means the base URL
    is wrong, and following one would carry the credential to whatever host the
    provider named.

    Args:
        config: The provider to test.
        api_key: Its credential, or an empty string when it needs none.
        client: HTTP client to use. Supplied by tests, which mount a transport
            rather than reaching the network. A client passed in is left open;
            one created here is closed here.

    Returns:
        The outcome.
    """
    url = join_url(config.base_url, MODELS_PATH)
    headers = config.headers(api_key)
    timeout = min(config.timeout_s, PROBE_TIMEOUT_S)

    owned = client is None
    active = client if client is not None else httpx.Client(timeout=timeout)
    started = time.monotonic()

    try:
        response = active.request("GET", url, headers=headers, follow_redirects=False)
    except httpx.TimeoutException:
        logger.warning("connection test to %s timed out", config.name)
        return ProbeResult(
            ok=False,
            code=codes.TIMEOUT,
            detail=f"no answer within {timeout:.0f}s",
        )
    except httpx.TransportError as error:
        refused = _is_refused(error)
        logger.warning(
            "connection test to %s failed: %s",
            config.name,
            "refused" if refused else "unreachable",
        )
        return ProbeResult(
            ok=False,
            code=codes.REFUSED if refused else codes.UNREACHABLE,
            detail="the connection was refused" if refused else "the host could not be reached",
        )
    finally:
        if owned:
            active.close()

    latency_ms = int((time.monotonic() - started) * 1000)

    if not response.is_success:
        code, detail = _from_status(response.status_code)
        logger.warning("connection test to %s answered %s", config.name, response.status_code)
        return ProbeResult(
            ok=False,
            code=code,
            detail=_scrub(detail, api_key),
            latency_ms=latency_ms,
        )

    try:
        payload = response.json()
    except ValueError:
        payload = None

    models = _read_models(payload)
    if models is None:
        logger.warning("connection test to %s answered no model listing", config.name)
        return ProbeResult(
            ok=False,
            code=codes.UNEXPECTED_SHAPE,
            detail="the answer was not an OpenAI compatible model listing",
            latency_ms=latency_ms,
        )

    logger.info("connection test to %s succeeded, %d models listed", config.name, len(models))
    return ProbeResult(
        ok=True,
        code=codes.REACHABLE,
        detail=f"listed {len(models)} models",
        latency_ms=latency_ms,
        model_count=len(models),
        models=tuple(image_models(models) or models),
        all_models=tuple(models),
    )
