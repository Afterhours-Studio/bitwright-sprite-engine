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

"""Model registry route.

Every response carries the licence of the weights, because the user has to see
those terms before anything is downloaded. Weights are not covered by this
program's licence; see MODELS.md.
"""

from __future__ import annotations

from fastapi import APIRouter

from bitwright_engine.api.schemas import ModelInfo, ModelListResponse
from bitwright_engine.api.state import StateDep
from bitwright_engine.models import list_models

router = APIRouter(prefix="/v1/models", tags=["models"])


@router.get("", response_model=ModelListResponse)
def list_all(state: StateDep) -> ModelListResponse:
    """List registered models, their licences, and their cache state.

    Args:
        state: The engine state.

    Returns:
        One entry per registered model.
    """
    entries = [
        ModelInfo(
            model_id=entry.model_id,
            name=entry.name,
            kind=entry.kind.value,
            license_id=entry.license_id,
            license_url=entry.license_url,
            commercial_use=entry.commercial_use,
            size_mb=entry.size_mb,
            cached=state.downloader.status(entry.model_id).cached,
        )
        for entry in list_models()
    ]
    return ModelListResponse(models=entries)
