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

"""Pydantic models for the HTTP API."""

from bitwright_engine.api.schemas.backends import (
    BackendInfo,
    BackendListResponse,
    ModelInfo,
    ModelListResponse,
)
from bitwright_engine.api.schemas.common import ErrorResponse, HealthResponse
from bitwright_engine.api.schemas.generation import (
    GenerateBody,
    GenerateResponse,
    PostProcessBody,
    SpriteImage,
)

__all__ = [
    "BackendInfo",
    "BackendListResponse",
    "ErrorResponse",
    "GenerateBody",
    "GenerateResponse",
    "HealthResponse",
    "ModelInfo",
    "ModelListResponse",
    "PostProcessBody",
    "SpriteImage",
]
