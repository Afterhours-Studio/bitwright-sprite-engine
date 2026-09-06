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

"""The model registry.

Weights are not part of this program and are not covered by its licence. Every
entry here records where a model comes from and under what terms, so that the
application can show the user the licence before anything is downloaded. See
MODELS.md, which mirrors this table.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class ModelKind(StrEnum):
    """What role a model plays in the pipeline."""

    BASE = "base"
    LORA = "lora"
    SEGMENTATION = "segmentation"


@dataclass(frozen=True, slots=True)
class ModelEntry:
    """One downloadable model.

    Attributes:
        model_id: Stable identifier used by requests and by settings.
        name: Display name.
        kind: Role in the pipeline.
        repo: Host repository the weights come from.
        revision: Pinned revision, so that a download is reproducible.
        license_id: SPDX identifier, or the licence name when the licence has
            no SPDX identifier, as is the case for the RAIL family.
        license_url: Where to read the full licence text.
        commercial_use: Whether the licence permits commercial use. Restrictions
            may still apply; the licence text governs.
        size_mb: Approximate download size in megabytes.
    """

    model_id: str
    name: str
    kind: ModelKind
    repo: str
    revision: str
    license_id: str
    license_url: str
    commercial_use: bool
    size_mb: int


REGISTRY: dict[str, ModelEntry] = {
    "sd15-base": ModelEntry(
        model_id="sd15-base",
        name="Stable Diffusion 1.5",
        kind=ModelKind.BASE,
        repo="runwayml/stable-diffusion-v1-5",
        revision="main",
        license_id="CreativeML Open RAIL-M",
        license_url="https://huggingface.co/spaces/CompVis/stable-diffusion-license",
        commercial_use=True,
        size_mb=4200,
    ),
    "sdxl-base": ModelEntry(
        model_id="sdxl-base",
        name="Stable Diffusion XL 1.0",
        kind=ModelKind.BASE,
        repo="stabilityai/stable-diffusion-xl-base-1.0",
        revision="main",
        license_id="CreativeML Open RAIL++-M",
        license_url="https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/main/LICENSE.md",
        commercial_use=True,
        size_mb=6900,
    ),
    "pixel-art-lora": ModelEntry(
        model_id="pixel-art-lora",
        name="Pixel Art Style LoRA",
        kind=ModelKind.LORA,
        repo="nerijs/pixel-art-xl",
        revision="main",
        license_id="CreativeML Open RAIL-M",
        license_url="https://huggingface.co/spaces/CompVis/stable-diffusion-license",
        commercial_use=True,
        size_mb=170,
    ),
    "rembg-u2net": ModelEntry(
        model_id="rembg-u2net",
        name="U2-Net Background Removal",
        kind=ModelKind.SEGMENTATION,
        repo="danielgatis/rembg",
        revision="main",
        license_id="Apache-2.0",
        license_url="https://www.apache.org/licenses/LICENSE-2.0",
        commercial_use=True,
        size_mb=176,
    ),
}


def get(model_id: str) -> ModelEntry:
    """Look up a model by identifier.

    Args:
        model_id: Registry identifier.

    Returns:
        The matching entry.

    Raises:
        KeyError: No model with that identifier is registered.
    """
    try:
        return REGISTRY[model_id]
    except KeyError as error:
        raise KeyError(f"unknown model: {model_id}") from error


def list_models(kind: ModelKind | None = None) -> list[ModelEntry]:
    """List registered models.

    Args:
        kind: Restrict to one role. ``None`` returns every model.

    Returns:
        Matching entries, in registration order.
    """
    entries = list(REGISTRY.values())
    if kind is None:
        return entries
    return [entry for entry in entries if entry.kind is kind]
