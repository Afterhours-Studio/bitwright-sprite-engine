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

What it holds is deliberately small. The sidecar no longer owns a model, a
download or a credential; it converts images on request. The one thing that
outlives a single request is the configuration, because the storage routes
repoint the data root in place and every later request has to see the new one.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request

from bitwright_engine.config import Settings, get_settings


@dataclass(slots=True)
class EngineState:
    """Everything the routes need, built once at startup.

    Attributes:
        settings: Process configuration. Mutated in place by the storage
            routes, which is why it is held here rather than read afresh from
            :func:`get_settings` at every call site.
    """

    settings: Settings

    @classmethod
    def create(cls, settings: Settings | None = None) -> EngineState:
        """Build the state from configuration.

        Args:
            settings: Configuration to use. Defaults to the process wide
                settings.

        Returns:
            A new state holder.
        """
        return cls(settings=settings if settings is not None else get_settings())


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
