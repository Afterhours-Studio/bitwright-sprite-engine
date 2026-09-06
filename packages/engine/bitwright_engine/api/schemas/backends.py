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

"""Response models for the backends and models routes."""

from __future__ import annotations

from bitwright_engine.api.schemas.common import CamelModel


class BackendInfo(CamelModel):
    """One backend, as the settings screen sees it.

    The frontend renders every backend, available or not, and uses ``detail``
    to explain why an unavailable one cannot be selected. ``capabilities``
    drives which generation controls are enabled.

    Attributes:
        kind: Backend identifier, one of ``cuda``, ``mps``, or ``remote``.
        available: Whether the backend can generate right now.
        detail: Stable reason code when unavailable, empty otherwise.
        device: Device or endpoint description when available, empty otherwise.
        capabilities: Optional features this backend supports.
        selected: Whether this is the backend currently serving requests.
    """

    kind: str
    available: bool
    detail: str
    device: str
    capabilities: list[str]
    selected: bool


class BackendListResponse(CamelModel):
    """Every backend and its current state.

    Attributes:
        backends: One entry per backend, in preference order.
    """

    backends: list[BackendInfo]


class ModelInfo(CamelModel):
    """One registry entry, with its local cache state.

    Attributes:
        model_id: Registry identifier.
        name: Display name.
        kind: Role in the pipeline.
        license_id: Licence identifier or name.
        license_url: Where to read the full licence text.
        commercial_use: Whether the licence permits commercial use.
        size_mb: Approximate download size in megabytes.
        cached: Whether the weights are already on this machine.
    """

    model_id: str
    name: str
    kind: str
    license_id: str
    license_url: str
    commercial_use: bool
    size_mb: int
    cached: bool


class ModelListResponse(CamelModel):
    """Every registered model.

    Attributes:
        models: One entry per registered model.
    """

    models: list[ModelInfo]
