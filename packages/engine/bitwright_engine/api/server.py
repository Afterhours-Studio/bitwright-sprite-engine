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

"""The sidecar HTTP server.

The process binds a loopback socket, prints a one line JSON handshake naming
the port it got and the token that authenticates callers, and then serves. The
shell reads that line rather than guessing a port, which is what keeps two
running copies of the application from colliding.

The only legitimate caller is the Rust shell. The webview never reaches this
API directly; it goes through shell commands, so the token never enters the
webview and a compromised page cannot use it. See
docs/architecture/ipc-protocol.md.
"""

from __future__ import annotations

import argparse
import json
import socket
import sys
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import uvicorn
from fastapi import Depends, FastAPI, Request, Response
from fastapi.responses import JSONResponse

from bitwright_engine.api.routes import health_router, protected_router
from bitwright_engine.api.schemas import ErrorResponse
from bitwright_engine.api.security import generate_token, reject_browser_origin, require_token
from bitwright_engine.api.state import EngineState
from bitwright_engine.backends import BackendError
from bitwright_engine.config import Settings, get_settings
from bitwright_engine.runtime import activate
from bitwright_engine.utils.logging import configure_logging, get_logger
from bitwright_engine.utils.watchdog import exit_now, install_parent_death_signal, watch_parent
from bitwright_engine.version import __version__

logger = get_logger(__name__)

HANDSHAKE_EVENT = "ready"

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "localhost"})
"""The only addresses the sidecar will bind."""


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Build the engine state on startup and log the selected backend.

    Args:
        app: The application being started.

    Yields:
        Control, for the lifetime of the application.
    """
    settings: Settings = app.state.settings
    app.state.engine = EngineState.create(settings)

    backend = app.state.engine.generator.backend
    availability = backend.available()
    logger.info(
        "engine %s ready: backend=%s available=%s device=%s",
        __version__,
        backend.kind.value,
        availability.ready,
        availability.device or availability.detail,
    )
    yield

    # A transfer that is still running when the process goes away loses its
    # socket as the loop tears down, and what is left on disk is whatever the
    # operating system happened to have flushed. Asking each worker to pause
    # and waiting for it to close its file is what leaves bytes the next
    # launch can continue from, which is the case the user actually hits:
    # they start a four gigabyte download and then close the application.
    paused = app.state.engine.downloader.pause_all()
    if paused:
        logger.info("paused %d download(s) on shutdown: %s", len(paused), ", ".join(paused))

    logger.info("engine shutting down")


def create_app(settings: Settings | None = None, token: str | None = None) -> FastAPI:
    """Build the FastAPI application.

    Args:
        settings: Configuration to use. Defaults to the process wide settings.
        token: Token callers must present. Defaults to a fresh one.

    Returns:
        The configured application.
    """
    resolved = settings if settings is not None else get_settings()

    app = FastAPI(
        title="Bitwright Sprite Engine",
        version=__version__,
        summary="Cross-platform sprite generation engine for pixel art games",
        lifespan=lifespan,
    )
    app.state.settings = resolved
    app.state.auth_token = token if token is not None else generate_token()

    @app.middleware("http")
    async def block_browser_origins(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        """Refuse any request that arrives with an ``Origin`` header.

        The shell is not a browser and sends no ``Origin``. One that does came
        from a web page, which is the shape a DNS rebinding attack takes: a
        page on an attacker's domain resolves to 127.0.0.1 and then calls this
        API from inside the user's machine.

        There is deliberately no CORS middleware. Allowing an origin is the
        opposite of what this API wants.

        Args:
            request: The incoming request.
            call_next: The rest of the stack.

        Returns:
            The downstream response, or 403.
        """
        if reject_browser_origin(request.headers.get("origin")):
            logger.warning(
                "refused a request to %s carrying an Origin header",
                request.url.path,
            )
            payload = ErrorResponse(code="auth.origin_not_allowed", message="origin not allowed")
            return JSONResponse(status_code=403, content=payload.model_dump(by_alias=True))

        return await call_next(request)

    @app.exception_handler(BackendError)
    async def handle_backend_error(request: Request, error: BackendError) -> JSONResponse:
        """Turn a backend failure into a response the frontend can translate.

        Args:
            request: The request that failed.
            error: The raised backend error.

        Returns:
            A 503 response carrying a stable reason code.
        """
        logger.warning("backend error on %s: %s", request.url.path, error)
        payload = ErrorResponse(code=error.code, message=str(error))
        return JSONResponse(status_code=503, content=payload.model_dump(by_alias=True))

    # Health is unauthenticated, so that the shell can probe for readiness
    # before it has parsed the handshake. It reports only liveness and the
    # backend state, and nothing that would help an unauthenticated caller.
    app.include_router(health_router)
    app.include_router(protected_router, dependencies=[Depends(require_token)])
    return app


def bind_socket(host: str, port: int) -> socket.socket:
    """Bind a listening socket, letting the operating system pick a free port.

    Binding here rather than inside uvicorn means the port is known before the
    server starts, so the handshake can be printed without a race.

    Args:
        host: Address to bind. Must be a loopback address.
        port: Port to bind. ``0`` asks for any free port.

    Returns:
        A bound, listening socket.

    Raises:
        ValueError: ``host`` is not a loopback address.
    """
    # Never 0.0.0.0. Binding any other address would put generation on the
    # network, where the token would be the only thing between an attacker and
    # this machine's GPU. This is a raise rather than an assert on purpose:
    # assertions are stripped when Python runs with -O, and this check must
    # survive that.
    if host not in LOOPBACK_HOSTS:
        raise ValueError(f"the sidecar may only bind a loopback address, not {host!r}")

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind((host, port))
    listener.listen(128)
    return listener


def announce(port: int, token: str) -> None:
    """Print the startup handshake on standard output.

    The shell reads standard output line by line until it sees this object.
    Everything else the process writes goes to standard error, so the handshake
    cannot be confused with log output, and the token never reaches a log.

    Args:
        port: The port the server is listening on.
        token: The token callers must present.
    """
    handshake = {
        "event": HANDSHAKE_EVENT,
        "port": port,
        "token": token,
        "version": __version__,
    }
    sys.stdout.write(json.dumps(handshake) + "\n")
    sys.stdout.flush()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse the command line.

    Args:
        argv: Arguments to parse. Defaults to the process arguments.

    Returns:
        The parsed arguments.
    """
    parser = argparse.ArgumentParser(
        prog="bitwright-engine",
        description="Sprite generation engine for Bitwright.",
    )
    parser.add_argument(
        "--parent-pid",
        type=int,
        default=None,
        help=(
            "Process id of the shell that spawned this process. When it exits, "
            "this process exits too, so that no orphan keeps holding GPU memory."
        ),
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    """Run the sidecar until it is asked to stop.

    Args:
        argv: Command line arguments. Defaults to the process arguments.
    """
    arguments = parse_args(argv)
    settings = get_settings()
    configure_logging(settings.log_level)

    # Before anything selects a backend, and therefore before anything tries to
    # import torch. A frozen bundle's import path holds only its own archive, so
    # a runtime installed into the user's data folder is invisible until this
    # runs. It is deliberately not called from create_app: the test suite builds
    # applications and must never pick up whatever is installed on the machine
    # running it.
    activate(settings)

    token = generate_token()
    listener = bind_socket(settings.host, settings.port)
    port = listener.getsockname()[1]
    announce(port, token)

    app = create_app(settings, token=token)
    config = uvicorn.Config(
        app,
        log_config=None,
        access_log=False,
        timeout_graceful_shutdown=10,
    )
    server = uvicorn.Server(config)

    # The shutdown route flips a flag on this object, which is how the shell
    # stops the process without relying on signals that Windows lacks.
    app.state.server = server

    if arguments.parent_pid is not None:
        install_parent_death_signal()
        watch_parent(arguments.parent_pid, lambda: _stop(server))

    server.run(sockets=[listener])


def _stop(server: uvicorn.Server) -> None:
    """Ask the server to exit, and leave hard if it will not.

    Called from the watchdog thread once the parent is gone. Setting the flag
    lets uvicorn unwind from its own loop, which is cleaner than terminating
    mid-request, but a server that has wedged must not become the orphan this
    watchdog exists to prevent.

    Args:
        server: The running server.
    """
    logger.info("parent exited, stopping the engine")
    server.should_exit = True
    server.force_exit = True

    # The flag is only read between iterations of the event loop. If the loop
    # is not running, nothing will read it, so a hard exit is the backstop.
    threading_timer_fallback(server)


def threading_timer_fallback(server: uvicorn.Server) -> None:
    """Leave the process if the graceful stop has not taken effect in time.

    Args:
        server: The running server.
    """
    import threading

    def check() -> None:
        if not server.started or server.should_exit:
            exit_now()

    timer = threading.Timer(5.0, check)
    timer.daemon = True
    timer.start()


if __name__ == "__main__":
    main()
