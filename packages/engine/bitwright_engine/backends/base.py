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

"""Backend abstraction for sprite generation.

A backend is anything that can turn a :class:`GenerationRequest` into images:
a local GPU pipeline, or a remote HTTP API. Every backend answers three
questions, and the rest of the engine depends on nothing else:

* :meth:`Backend.available` - can this backend run on this machine right now?
* :meth:`Backend.capabilities` - which optional features does it support?
* :meth:`Backend.generate` - produce images for a request.

Capabilities are declared up front so the user interface can disable controls
the selected backend cannot honour, rather than failing after the user presses
generate.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Protocol, runtime_checkable


class Capability(StrEnum):
    """An optional feature a backend may or may not support.

    Attributes:
        LORA_HOTSWAP: Load and unload LoRA adapters without reloading the base
            model.
        CONTROLNET: Condition generation on a control image, such as a pose or
            depth map.
        IP_ADAPTER: Condition generation on a reference image for style or
            identity transfer.
        BATCH: Generate more than one image per request in a single pass.
    """

    LORA_HOTSWAP = "lora_hotswap"
    CONTROLNET = "controlnet"
    IP_ADAPTER = "ip_adapter"
    BATCH = "batch"


class BackendKind(StrEnum):
    """Identifier for a concrete backend implementation."""

    CUDA = "cuda"
    MPS = "mps"
    REMOTE = "remote"


@dataclass(frozen=True, slots=True)
class Availability:
    """Whether a backend can run, and why not when it cannot.

    Attributes:
        ready: True when :meth:`Backend.generate` can be called.
        detail: Machine readable reason code when ``ready`` is False. The user
            interface maps this onto a translated message, so it must be a
            stable key rather than prose. Empty when ready.
        device: Human readable description of the device or endpoint that will
            serve requests, for example ``"NVIDIA GeForce RTX 4070"``. Empty
            when not ready.
    """

    ready: bool
    detail: str = ""
    device: str = ""


@dataclass(frozen=True, slots=True)
class GenerationRequest:
    """Parameters for one generation call.

    Attributes:
        prompt: Positive prompt describing the sprite.
        negative_prompt: Terms to steer away from.
        width: Output width in pixels, before post-processing.
        height: Output height in pixels, before post-processing.
        steps: Number of denoising steps.
        guidance_scale: Classifier free guidance strength.
        seed: Seed for reproducible output. ``None`` picks a random seed.
        batch_size: Number of images to produce. Values above one require
            :attr:`Capability.BATCH`.
        model_id: Registry identifier of the model to use.
        lora_id: Registry identifier of a LoRA adapter, or ``None``. Requires
            :attr:`Capability.LORA_HOTSWAP`.
    """

    prompt: str
    negative_prompt: str = ""
    width: int = 64
    height: int = 64
    steps: int = 20
    guidance_scale: float = 7.0
    seed: int | None = None
    batch_size: int = 1
    model_id: str = "sd15-base"
    lora_id: str | None = None


@dataclass(frozen=True, slots=True)
class GeneratedImage:
    """A single generated image.

    Attributes:
        data: Raw PNG bytes.
        width: Image width in pixels.
        height: Image height in pixels.
        seed: Seed that produced this image.
    """

    data: bytes
    width: int
    height: int
    seed: int


@dataclass(frozen=True, slots=True)
class GenerationResult:
    """The output of one generation call.

    Attributes:
        images: Generated images, in request order.
        backend: Which backend produced them.
        duration_ms: Wall clock time spent generating, in milliseconds.
        warnings: Non-fatal reason codes, for example a request field that was
            clamped. Keys are stable and translated by the user interface.
    """

    images: list[GeneratedImage]
    backend: BackendKind
    duration_ms: int = 0
    warnings: list[str] = field(default_factory=list)


class BackendError(RuntimeError):
    """Base class for backend failures.

    Attributes:
        code: Stable reason code that the user interface translates.
    """

    code: str = "backend.error"


class BackendUnavailableError(BackendError):
    """Raised when generation is attempted on a backend that cannot run."""

    code = "backend.unavailable"


class UnsupportedCapabilityError(BackendError):
    """Raised when a request needs a capability the backend does not declare."""

    code = "backend.unsupported_capability"


@runtime_checkable
class Backend(Protocol):
    """Structural interface every sprite generation backend satisfies.

    Implementations are usually written against :class:`BaseBackend`, which
    supplies request validation. The protocol exists so that callers, tests,
    and fakes are not tied to that base class.
    """

    kind: BackendKind

    def available(self) -> Availability:
        """Report whether this backend can serve requests on this machine.

        Implementations must not raise. A missing driver, an unreachable
        endpoint, or an absent dependency is reported through the returned
        value, never as an exception.

        Returns:
            The current availability of the backend.
        """
        ...

    def capabilities(self) -> frozenset[Capability]:
        """Report the optional features this backend supports.

        Returns:
            The supported capabilities. May be empty.
        """
        ...

    def generate(self, request: GenerationRequest) -> GenerationResult:
        """Generate sprite images for a request.

        Args:
            request: Generation parameters.

        Returns:
            The generated images and the metadata describing the run.

        Raises:
            BackendUnavailableError: The backend cannot run on this machine.
            UnsupportedCapabilityError: The request needs a capability that
                :meth:`capabilities` does not include.
            BackendError: Generation failed for any other reason.
        """
        ...


class BaseBackend(abc.ABC):
    """Common behaviour shared by concrete backends.

    Subclasses implement :meth:`available`, :meth:`capabilities`, and
    :meth:`_run`. Request validation against the declared capabilities happens
    once, here, so that every backend rejects the same requests for the same
    reasons.
    """

    kind: BackendKind

    def available(self) -> Availability:
        """Report whether this backend can serve requests on this machine.

        Returns:
            The current availability of the backend.
        """
        raise NotImplementedError

    def capabilities(self) -> frozenset[Capability]:
        """Report the optional features this backend supports.

        Returns:
            The supported capabilities.
        """
        raise NotImplementedError

    def generate(self, request: GenerationRequest) -> GenerationResult:
        """Validate a request, then run it.

        Args:
            request: Generation parameters.

        Returns:
            The generated images and the metadata describing the run.

        Raises:
            BackendUnavailableError: The backend cannot run on this machine.
            UnsupportedCapabilityError: The request needs an undeclared
                capability.
        """
        availability = self.available()
        if not availability.ready:
            raise BackendUnavailableError(availability.detail or "backend.unavailable")

        self._check_capabilities(request)
        return self._run(request)

    @abc.abstractmethod
    def _run(self, request: GenerationRequest) -> GenerationResult:
        """Perform generation for an already validated request.

        Args:
            request: Generation parameters, known to be supported.

        Returns:
            The generated images and the metadata describing the run.
        """

    def _check_capabilities(self, request: GenerationRequest) -> None:
        """Reject a request that needs a capability this backend lacks.

        Args:
            request: Generation parameters to check.

        Raises:
            UnsupportedCapabilityError: A required capability is missing.
        """
        supported = self.capabilities()
        for required in required_capabilities(request):
            if required not in supported:
                raise UnsupportedCapabilityError(required.value)


def required_capabilities(request: GenerationRequest) -> frozenset[Capability]:
    """Determine which capabilities a request depends on.

    The user interface calls this with the parameters currently entered, and
    compares the result against the selected backend, so that unsupported
    controls are disabled before the user presses generate.

    Args:
        request: Generation parameters to inspect.

    Returns:
        The capabilities the request cannot run without.
    """
    required: set[Capability] = set()
    if request.batch_size > 1:
        required.add(Capability.BATCH)
    if request.lora_id is not None:
        required.add(Capability.LORA_HOTSWAP)
    return frozenset(required)
