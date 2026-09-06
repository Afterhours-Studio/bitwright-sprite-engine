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

"""Local generation on Apple Silicon through Metal Performance Shaders.

MPS declares fewer capabilities than CUDA. IP-Adapter support depends on
operators that are not implemented for the Metal device in the pinned torch
version, so it is left out rather than advertised and then failed at run time.
"""

from __future__ import annotations

import importlib.util
import platform
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
from bitwright_engine.backends.pipeline import PipelineCache, run_pipeline
from bitwright_engine.models import ModelDownloader
from bitwright_engine.utils.images import to_png_bytes
from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)

DEVICE = "mps"
"""Device string torch is asked for."""

CAPABILITIES = frozenset(
    {
        Capability.LORA_HOTSWAP,
        Capability.CONTROLNET,
        Capability.BATCH,
    }
)


class MpsBackend(BaseBackend):
    """Generation on an Apple Silicon GPU.

    Attributes:
        kind: Always :attr:`BackendKind.MPS`.
    """

    kind = BackendKind.MPS

    def __init__(self, downloader: ModelDownloader | None = None) -> None:
        """Create the backend.

        Args:
            downloader: Where weights come from. Defaults to one of its own,
                which reads the same settings.
        """
        self._downloader = downloader if downloader is not None else ModelDownloader()
        self._pipelines = PipelineCache()

    def available(self) -> Availability:
        """Check for a usable Metal device.

        Returns:
            Availability, with a reason code when the backend cannot run.
        """
        if platform.system() != "Darwin":
            return Availability(ready=False, detail="backend.mps.not_macos")

        if importlib.util.find_spec("torch") is None:
            return Availability(ready=False, detail="backend.mps.torch_missing")

        try:
            import torch
        except ImportError:  # pragma: no cover - guarded by find_spec above
            return Availability(ready=False, detail="backend.mps.torch_missing")

        if not torch.backends.mps.is_built():
            return Availability(ready=False, detail="backend.mps.torch_without_mps")

        if not torch.backends.mps.is_available():
            return Availability(ready=False, detail="backend.mps.device_unavailable")

        return Availability(ready=True, device=f"Apple {platform.machine()} GPU")

    def capabilities(self) -> frozenset[Capability]:
        """Report the optional features Metal generation supports.

        Returns:
            Every capability except IP-Adapter, which the Metal device does not
            implement in the pinned torch version.
        """
        return CAPABILITIES

    def _run(self, request: GenerationRequest) -> GenerationResult:
        """Generate sprites on the Metal device.

        Args:
            request: Generation parameters, known to be supported.

        Returns:
            One image per requested batch item.
        """
        started = time.monotonic()
        base_seed = request.seed if request.seed is not None else random.randrange(2**31)
        logger.info(
            "mps generate: model=%s size=%dx%d steps=%d batch=%d",
            request.model_id,
            request.width,
            request.height,
            request.steps,
            request.batch_size,
        )

        weights = self._downloader.ensure(request.model_id)
        lora = None if request.lora_id is None else self._downloader.ensure(request.lora_id)
        pipeline = self._pipelines.get(
            weights,
            request.model_id,
            lora,
            request.lora_id or "",
            DEVICE,
        )

        images = []
        for index in range(request.batch_size):
            seed = base_seed + index
            drawn = run_pipeline(
                pipeline,
                prompt=request.prompt,
                negative_prompt=request.negative_prompt,
                width=request.width,
                height=request.height,
                steps=request.steps,
                guidance_scale=request.guidance_scale,
                seed=seed,
                device=DEVICE,
            )
            images.append(
                GeneratedImage(
                    data=to_png_bytes(drawn),
                    width=drawn.width,
                    height=drawn.height,
                    seed=seed,
                )
            )

        elapsed_ms = int((time.monotonic() - started) * 1000)
        return GenerationResult(images=images, backend=self.kind, duration_ms=elapsed_ms)
