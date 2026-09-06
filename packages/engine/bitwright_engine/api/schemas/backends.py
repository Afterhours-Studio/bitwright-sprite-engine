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
    """One registry entry, with its local cache and download state.

    A model that is neither ``cached`` nor ``downloading`` but reports
    ``resumable`` is paused: bytes are on disk and a later start continues from
    them. That state is derived from the cache rather than stored, so it is
    still reported correctly by an engine that has just been launched.

    Attributes:
        model_id: Registry identifier.
        name: Display name.
        kind: Role in the pipeline.
        license_id: Licence identifier or name.
        license_url: Where to read the full licence text.
        commercial_use: Whether the licence permits commercial use.
        size_mb: Approximate download size in megabytes.
        cached: Whether the weights are already on this machine.
        downloading: Whether a download for this model is in flight.
        progress: How far that download has got, from 0.0 to 1.0. Best effort,
            and reported for a paused download as well as a running one.
        downloaded_bytes: Bytes of this download already on disk, running or
            paused. 0 when nothing has arrived.
        total_bytes: Full size of the download in bytes when the host has
            announced one, and 0 when it has not. ``size_mb`` is an estimate
            and is deliberately not substituted for it.
        resumable: Whether a paused or interrupted download can be continued
            rather than started again.
        error: Stable reason code of the last download failure, or an empty
            string. The frontend looks it up in the ``errors`` namespace.
    """

    model_id: str
    name: str
    kind: str
    license_id: str
    license_url: str
    commercial_use: bool
    size_mb: int
    cached: bool
    downloading: bool = False
    progress: float = 0.0
    downloaded_bytes: int = 0
    total_bytes: int = 0
    resumable: bool = False
    error: str = ""


class ModelListResponse(CamelModel):
    """Every registered model.

    Attributes:
        models: One entry per registered model.
    """

    models: list[ModelInfo]
