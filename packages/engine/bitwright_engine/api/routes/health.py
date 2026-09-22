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

"""Health and lifecycle routes.

Two routers, because they need different authentication. The shell polls health
before it has read the handshake, so that route carries no token and reveals
only liveness. Shutting the engine down is authenticated, since an unauthorised
caller could otherwise stop the sidecar at will.
"""

from __future__ import annotations

from fastapi import APIRouter, Request, Response, status

from bitwright_engine.api.schemas import HealthResponse
from bitwright_engine.utils.logging import get_logger
from bitwright_engine.version import __version__

logger = get_logger(__name__)

router = APIRouter(tags=["health"])
shutdown_router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Report that the sidecar is up.

    No engine state is read. The shell polls this while the application is
    still starting, and a probe that depended on anything the process builds
    would answer 500 during exactly the window it exists to cover.

    Returns:
        The current health of the process.
    """
    return HealthResponse(status="ok", version=__version__)


@shutdown_router.post("/shutdown", status_code=status.HTTP_202_ACCEPTED)
def shutdown(request: Request) -> Response:
    """Ask the server to stop once in-flight requests have finished.

    The shell calls this before it terminates the process, so that a conform
    already under way is not cut off mid-write. Setting the flag is portable;
    signalling a process group is not, on Windows.

    Args:
        request: The incoming request, used to reach the running server.

    Returns:
        An empty 202 response. The server exits after this response is sent.
    """
    server = getattr(request.app.state, "server", None)
    if server is None:
        logger.warning("shutdown requested but no server is attached")
    else:
        logger.info("shutdown requested")
        server.should_exit = True
    return Response(status_code=status.HTTP_202_ACCEPTED)
