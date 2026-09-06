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

"""Process state shared by the HTTP routes.

The sidecar serves one user, so a single mutable holder is enough. Keeping it
here, rather than in the module that builds the application, lets the routes
depend on it without importing the server.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

import httpx
from fastapi import Depends, Request

from bitwright_engine.backends import Backend, BackendKind, build_backend, select_backend
from bitwright_engine.config import Settings, get_settings
from bitwright_engine.models import ModelDownloader
from bitwright_engine.pipeline import SpriteGenerator
from bitwright_engine.providers import ProviderStore, get_provider_store
from bitwright_engine.runtime import RuntimeInstaller


@dataclass(slots=True)
class EngineState:
    """Everything the routes need, built once at startup.

    Attributes:
        settings: Process configuration.
        generator: The pipeline serving generation requests.
        downloader: Resolves models in the local cache.
        providers: Configured remote inference providers and their
            credentials.
        runtime: Installs and removes the GPU runtime under the data root.
        probe_client: HTTP client the connection test borrows, or ``None`` to
            let it open its own. Only tests set it, and they set it to a client
            with a mounted transport, which is what keeps the suite off the
            network.
    """

    settings: Settings
    generator: SpriteGenerator
    downloader: ModelDownloader
    providers: ProviderStore
    runtime: RuntimeInstaller
    probe_client: httpx.Client | None = None

    @classmethod
    def create(cls, settings: Settings | None = None) -> EngineState:
        """Build the state from configuration.

        Backend selection never fails here. When nothing is available the
        remote backend is held, so that the settings screen can still load and
        show the user why each option is unusable.

        Args:
            settings: Configuration to use. Defaults to the process wide
                settings.

        Returns:
            A new state holder.
        """
        resolved = settings if settings is not None else get_settings()
        try:
            backend: Backend = select_backend(resolved.backend, resolved)
        # Startup must not fail because a GPU is missing or a driver is broken.
        except Exception:
            backend = build_backend(BackendKind.REMOTE, resolved)

        return cls(
            settings=resolved,
            generator=SpriteGenerator(backend),
            downloader=ModelDownloader(resolved),
            providers=get_provider_store(),
            runtime=RuntimeInstaller(resolved),
        )

    def select(self, kind: BackendKind) -> None:
        """Switch the backend that serves generation requests.

        Args:
            kind: Which backend to select.
        """
        self.generator = SpriteGenerator(build_backend(kind, self.settings))


def get_state(request: Request) -> EngineState:
    """Return the state attached to the running application.

    Args:
        request: The incoming request.

    Returns:
        The application's engine state.
    """
    state: EngineState = request.app.state.engine
    return state


StateDep = Annotated[EngineState, Depends(get_state)]
"""Dependency alias so routes can declare ``state: StateDep``."""
