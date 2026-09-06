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

"""The generation pipeline.

The generator is the only thing the HTTP layer talks to. It owns a backend,
runs post-processing over whatever that backend returns, and optionally packs
the frames into a sprite sheet. Swapping the backend does not change anything
downstream of this module.
"""

from __future__ import annotations

import time

from bitwright_engine.backends import (
    Backend,
    Capability,
    GenerationRequest,
    required_capabilities,
    select_backend,
)
from bitwright_engine.pipeline.postprocess import PostProcessOptions, SpriteSheet, apply, pack_grid
from bitwright_engine.utils.images import from_png_bytes, to_png_bytes
from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)


class SpriteGenerator:
    """Runs generation and post-processing for one backend.

    Attributes:
        backend: The backend that serves generation requests.
    """

    def __init__(self, backend: Backend | None = None) -> None:
        """Create the generator.

        Args:
            backend: Backend to use. Defaults to the first available one.
        """
        self.backend: Backend = backend if backend is not None else select_backend()

    def capabilities(self) -> frozenset[Capability]:
        """Report what the current backend supports.

        Returns:
            The backend's capabilities.
        """
        return self.backend.capabilities()

    def supports(self, request: GenerationRequest) -> bool:
        """Report whether the current backend can serve a request.

        Args:
            request: Generation parameters to check.

        Returns:
            True when every capability the request needs is available.
        """
        return required_capabilities(request).issubset(self.backend.capabilities())

    def generate(
        self,
        request: GenerationRequest,
        postprocess: PostProcessOptions | None = None,
    ) -> list[bytes]:
        """Generate sprites and post-process them.

        Args:
            request: Generation parameters.
            postprocess: Post-processing steps. Defaults to
                :class:`PostProcessOptions` with its default values.

        Returns:
            One PNG encoded sprite per requested batch item.

        Raises:
            BackendUnavailableError: The backend cannot run.
            UnsupportedCapabilityError: The request needs an undeclared
                capability.
        """
        options = postprocess if postprocess is not None else PostProcessOptions()
        started = time.monotonic()

        result = self.backend.generate(request)
        sprites = [
            to_png_bytes(apply(from_png_bytes(image.data), options)) for image in result.images
        ]

        logger.info(
            "generated %d sprite(s) in %d ms on %s",
            len(sprites),
            int((time.monotonic() - started) * 1000),
            result.backend.value,
        )
        return sprites

    def generate_sheet(
        self,
        request: GenerationRequest,
        postprocess: PostProcessOptions | None = None,
        columns: int | None = None,
        padding: int = 0,
    ) -> SpriteSheet:
        """Generate sprites and pack them into one sheet.

        Args:
            request: Generation parameters.
            postprocess: Post-processing steps applied to each frame.
            columns: Number of columns in the sheet. Defaults to near square.
            padding: Transparent gap between cells, in pixels.

        Returns:
            The packed sheet and the position of every frame.

        Raises:
            BackendUnavailableError: The backend cannot run.
            UnsupportedCapabilityError: The request needs an undeclared
                capability.
        """
        sprites = self.generate(request, postprocess)
        return pack_grid(
            [from_png_bytes(data) for data in sprites], columns=columns, padding=padding
        )
