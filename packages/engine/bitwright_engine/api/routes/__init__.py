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

"""HTTP routes.

Split into two routers by whether they need the token. Health is open, because
the shell probes it before it has read the handshake, and it reveals only
liveness. Everything else is authenticated.
"""

from fastapi import APIRouter

from bitwright_engine.api.routes import backends, generation, health, models

health_router = APIRouter()
health_router.include_router(health.router)

protected_router = APIRouter()
protected_router.include_router(health.shutdown_router)
protected_router.include_router(backends.router)
protected_router.include_router(generation.router)
protected_router.include_router(models.router)

__all__ = ["health_router", "protected_router"]
