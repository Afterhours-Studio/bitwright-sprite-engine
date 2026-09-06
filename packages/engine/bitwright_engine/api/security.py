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

"""Authentication for the sidecar API.

Binding to loopback keeps the API off the network, but it does not keep it away
from other processes on the same machine. Any local program, including one
running as another user on a shared desktop, can reach a loopback port. The
engine therefore authenticates every caller.

Three defences, in order of what they stop:

1. **A shared secret.** The sidecar generates a token at startup and prints it
   alongside the port. Only the shell that spawned the process ever sees it, so
   only that shell can call the API.
2. **Loopback binding.** Enforced in :func:`bitwright_engine.api.server.bind_socket`,
   so the port is never reachable from another machine.
3. **Origin rejection.** The only legitimate caller is the Rust shell, which is
   not a browser and sends no ``Origin``. A request that carries one came from
   a web page, which is the shape a DNS rebinding attack takes.
"""

from __future__ import annotations

import secrets

from fastapi import HTTPException, Request, status

TOKEN_HEADER = "X-Bitwright-Token"
"""Header the shell puts its token in."""

TOKEN_BYTES = 32
"""Entropy in the generated token, in bytes."""


def generate_token() -> str:
    """Create a token for this run of the sidecar.

    A new token every start means a stale one cannot be replayed against a
    later process, and nothing has to be persisted or rotated.

    Returns:
        A URL-safe token with :data:`TOKEN_BYTES` bytes of entropy.
    """
    return secrets.token_urlsafe(TOKEN_BYTES)


async def require_token(request: Request) -> None:
    """Reject a request that does not carry the current token.

    Args:
        request: The incoming request.

    Raises:
        HTTPException: The token is missing or wrong, as 401.
    """
    expected: str = getattr(request.app.state, "auth_token", "")
    provided = request.headers.get(TOKEN_HEADER, "")

    # An empty expected token means the application was built without one,
    # which is a configuration error rather than a reason to let a caller
    # through. compare_digest rather than ==, so that a wrong token cannot be
    # guessed a character at a time by measuring how long the check took.
    if not expected or not secrets.compare_digest(provided, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="auth.invalid_token",
        )


def reject_browser_origin(origin: str | None) -> bool:
    """Decide whether a request should be refused for carrying an ``Origin``.

    The shell is the only legitimate caller, and it is not a browser. A request
    with an ``Origin`` therefore came from a web page, which is what a DNS
    rebinding attack looks like: a page on an attacker's domain resolves to
    127.0.0.1 and then calls the local API with the user's own machine as the
    source.

    Args:
        origin: The ``Origin`` header, or ``None`` when absent.

    Returns:
        True when the request must be refused.
    """
    return origin is not None
