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

"""Local generation on an NVIDIA GPU through CUDA.

This scaffold detects the device and declares capabilities honestly, but
returns placeholder images instead of running a diffusion pipeline. Replacing
:meth:`CudaBackend._run` with a real pipeline is the only change needed; the
detection and capability code is final.
"""

from __future__ import annotations

import importlib.util
import random
import time

from bitwright_engine.backends.base import (
    Availability,
    BackendKind,
    BaseBackend,
    Capability,
    GeneratedImage,
    GenerationRequest,
    GenerationResult,
)
from bitwright_engine.utils.images import placeholder, to_png_bytes
from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)

CAPABILITIES = frozenset(
    {
        Capability.LORA_HOTSWAP,
        Capability.CONTROLNET,
        Capability.IP_ADAPTER,
        Capability.BATCH,
    }
)


class CudaBackend(BaseBackend):
    """Generation on an NVIDIA GPU.

    Attributes:
        kind: Always :attr:`BackendKind.CUDA`.
    """

    kind = BackendKind.CUDA

    def available(self) -> Availability:
        """Check for a usable CUDA device.

        The check is ordered so that the reason code tells the user what to
        install: the torch package first, then the driver, then the device.

        Returns:
            Availability, with a reason code when the backend cannot run.
        """
        if importlib.util.find_spec("torch") is None:
            return Availability(ready=False, detail="backend.cuda.torch_missing")

        try:
            import torch
        except ImportError:  # pragma: no cover - guarded by find_spec above
            return Availability(ready=False, detail="backend.cuda.torch_missing")

        if not torch.cuda.is_available():
            return Availability(ready=False, detail="backend.cuda.driver_missing")

        if torch.cuda.device_count() == 0:
            return Availability(ready=False, detail="backend.cuda.no_device")

        return Availability(ready=True, device=torch.cuda.get_device_name(0))

    def capabilities(self) -> frozenset[Capability]:
        """Report the optional features CUDA generation supports.

        Returns:
            Every capability. A local pipeline can load adapters and batch.
        """
        return CAPABILITIES

    def _run(self, request: GenerationRequest) -> GenerationResult:
        """Produce placeholder images for a validated request.

        Args:
            request: Generation parameters, known to be supported.

        Returns:
            One placeholder image per requested batch item.
        """
        started = time.monotonic()
        base_seed = request.seed if request.seed is not None else random.randrange(2**31)
        logger.info(
            "cuda generate: model=%s size=%dx%d steps=%d batch=%d",
            request.model_id,
            request.width,
            request.height,
            request.steps,
            request.batch_size,
        )

        images = [
            GeneratedImage(
                data=to_png_bytes(placeholder(request.width, request.height, base_seed + index)),
                width=request.width,
                height=request.height,
                seed=base_seed + index,
            )
            for index in range(request.batch_size)
        ]

        elapsed_ms = int((time.monotonic() - started) * 1000)
        return GenerationResult(images=images, backend=self.kind, duration_ms=elapsed_ms)
