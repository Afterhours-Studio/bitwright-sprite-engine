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

"""The GPU runtime: reporting on it, installing it, and removing it.

PyTorch is gigabytes, so it is not in the installer. Without it the CUDA and
Metal backends report ``torch_missing`` and there is no way, short of a
terminal, for a user with a working GPU to reach it. These routes are that way.

The licence position travels with the plan rather than being assumed by the
interface: a CUDA build carries NVIDIA's redistributable libraries, which are
not under PyTorch's licence and not under this program's, and the user is shown
that before any bytes move, exactly as MODELS.md requires for weights.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status

from bitwright_engine.api.schemas import (
    RuntimeInfo,
    RuntimeInstallBody,
    RuntimePackage,
    RuntimePlan,
)
from bitwright_engine.api.state import EngineState, StateDep
from bitwright_engine.runtime import (
    CUDA_LICENSE_URL,
    TORCH_LICENSE_URL,
    Variant,
    activated_path,
    probe,
    recommended,
    target_key,
)
from bitwright_engine.runtime.installer import RuntimeInstallError
from bitwright_engine.utils.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/v1/runtime", tags=["runtime"])

UNSUPPORTED = "runtime.unsupported_platform"
"""Reason code for a platform with no pinned wheel set."""

KNOWN_GPU_KINDS = frozenset({"cuda", "metal", "none"})
"""What the shell's probe may report. Anything else is treated as no GPU."""

CONFLICT_CODES = frozenset(
    {
        "runtime.already_installing",
        "runtime.already_installed",
        "runtime.busy_installing",
        "runtime.not_installed",
        "runtime.downloads_disabled",
        "runtime.insufficient_space",
    }
)
"""Failures that are about the current state rather than about the request.

They answer 409, the way a model download already in flight does, so the
interface can tell "you cannot do that right now" from "that is not a thing".
"""


def _to_plan(variant: Variant) -> RuntimePlan:
    """Build the wire representation of one installable variant.

    Args:
        variant: The variant to describe.

    Returns:
        That variant as the interface sees it, licences included.
    """
    return RuntimePlan(
        accelerator=variant.accelerator,
        torch_version=variant.torch_version,
        cuda_version=variant.cuda_version,
        bundles_nvidia=variant.bundles_nvidia,
        download_bytes=variant.download_bytes,
        installed_bytes=variant.installed_bytes,
        required_bytes=variant.required_bytes,
        packages=[
            RuntimePackage(
                name=wheel.name,
                version=wheel.version,
                license_id=wheel.license_id,
                size_bytes=wheel.size_bytes,
            )
            for wheel in variant.wheels
        ],
        torch_license_url=TORCH_LICENSE_URL,
        cuda_license_url=CUDA_LICENSE_URL if variant.bundles_nvidia else "",
    )


def _describe(state: EngineState, gpu: str) -> RuntimeInfo:
    """Report the runtime as it stands.

    Args:
        state: The engine state.
        gpu: What the shell's GPU probe found.

    Returns:
        Everything the settings screen needs to decide what to offer.
    """
    installer = state.runtime
    variants = installer.variants()
    record = installer.record()
    install = installer.state()
    torch = probe()
    space = installer.free_bytes()

    suggestion = recommended(gpu)

    absent = installer.missing()
    pinned = next(
        (
            len(variant.wheels)
            for variant in variants
            if record is not None and variant.accelerator == record.accelerator
        ),
        0,
    )
    return RuntimeInfo(
        total_packages=pinned,
        missing_packages=[wheel.name for wheel in absent],
        missing_bytes=sum(wheel.size_bytes for wheel in absent),
        supported=bool(variants),
        unsupported_reason="" if variants else UNSUPPORTED,
        target=target_key(),
        install_dir=str(installer.root),
        installed=record is not None,
        installed_accelerator="" if record is None else record.accelerator,
        installed_torch_version="" if record is None else record.torch_version,
        torch_importable=torch.importable,
        torch_version=torch.version,
        cuda_available=torch.cuda_available,
        mps_available=torch.mps_available,
        device=torch.device,
        probe_detail=torch.detail,
        # A runtime on disk that this process never put on its import path is
        # exactly what a pending restart looks like, and it is the only thing
        # the interface can tell the user to do about it.
        restart_required=record is not None and activated_path() is None,
        free_bytes=None if space is None else space[1],
        total_bytes=None if space is None else space[0],
        used_bytes=installer.used_bytes(),
        recommended_accelerator="" if suggestion is None else suggestion.accelerator,
        plans=[_to_plan(variant) for variant in variants],
        installing=install.installing,
        phase=install.phase,
        progress=install.progress,
        installing_accelerator=install.accelerator,
        error=install.error,
    )


def _gpu_kind(raw: str) -> str:
    """Normalise what the shell reported about the GPU.

    Args:
        raw: The value as it arrived.

    Returns:
        One of the known kinds, defaulting to ``none``, because an unknown
        value must not be read as evidence that a GPU is present.
    """
    return raw if raw in KNOWN_GPU_KINDS else "none"


def _refuse(error: RuntimeInstallError) -> HTTPException:
    """Turn an installer failure into the response for it.

    Args:
        error: The failure raised by the installer.

    Returns:
        The exception to raise, carrying the stable reason code.
    """
    logger.warning("runtime request refused: %s (%s)", error.code, error)
    code = status.HTTP_409_CONFLICT if error.code in CONFLICT_CODES else status.HTTP_400_BAD_REQUEST
    return HTTPException(status_code=code, detail=error.code)


@router.get("", response_model=RuntimeInfo)
def current(
    state: StateDep,
    gpu: str = Query(default="none", description="What the shell's GPU probe found."),
) -> RuntimeInfo:
    """Report whether the GPU runtime is installed, and what installing costs.

    Args:
        state: The engine state.
        gpu: ``cuda``, ``metal`` or ``none``, from the shell's own probe. The
            engine does not probe for hardware itself; the shell already does,
            without loading any machine learning framework.

    Returns:
        The runtime as the settings screen sees it.
    """
    return _describe(state, _gpu_kind(gpu))


@router.post("/install", response_model=RuntimeInfo, status_code=status.HTTP_202_ACCEPTED)
def install(body: RuntimeInstallBody, state: StateDep) -> RuntimeInfo:
    """Start installing the GPU runtime in the background.

    Answers as soon as the worker is running, so the interface can show
    progress rather than hold a request open for gigabytes.

    Args:
        body: Which variant to install, and what the shell's probe found.
        state: The engine state.

    Returns:
        The runtime, now reporting the install as running.

    Raises:
        HTTPException: The platform is not covered, the variant does not exist,
            downloads are off, a runtime is already installed, an install is
            already running, or the volume has no room.
    """
    gpu = _gpu_kind(body.gpu)
    accelerator = body.accelerator
    if accelerator == "auto":
        suggestion = recommended(gpu)
        if suggestion is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=UNSUPPORTED,
            )
        accelerator = suggestion.accelerator

    try:
        variant = state.runtime.start(accelerator)
    except RuntimeInstallError as error:
        raise _refuse(error) from error

    logger.info(
        "installing the %s runtime: %d bytes to download",
        variant.accelerator,
        variant.download_bytes,
    )
    return _describe(state, gpu)


@router.post("/repair", response_model=RuntimeInfo, status_code=status.HTTP_202_ACCEPTED)
def repair(state: StateDep) -> RuntimeInfo:
    """Add the pinned packages the installed runtime is missing.

    Fetches only the difference. A package added to the manifest after a
    runtime was installed would otherwise cost a full reinstall, which for this
    runtime is gigabytes to add megabytes.

    Args:
        state: The engine state.

    Returns:
        The runtime state, with the repair running.

    Raises:
        HTTPException: There is nothing installed, nothing missing, downloads
            are off, or work is already running.
    """
    try:
        state.runtime.repair()
    except RuntimeInstallError as error:
        raise _refuse(error) from error

    return _describe(state, "")


@router.post("/cancel", response_model=RuntimeInfo, status_code=status.HTTP_202_ACCEPTED)
def cancel(state: StateDep) -> RuntimeInfo:
    """Ask a running install to stop.

    The worker stops between chunks and removes everything it had written, so a
    cancelled install leaves no gigabytes behind. Cancelling when nothing is
    running is accepted and does nothing.

    Args:
        state: The engine state.

    Returns:
        The runtime, which may still report the install as running until the
        worker notices.
    """
    state.runtime.cancel()
    return _describe(state, "none")


@router.post("/remove", response_model=RuntimeInfo)
def remove(state: StateDep) -> RuntimeInfo:
    """Delete the installed runtime.

    Args:
        state: The engine state.

    Returns:
        The runtime, now reporting nothing installed.

    Raises:
        HTTPException: An install is running, nothing is installed, or the
            directory could not be deleted.
    """
    try:
        state.runtime.remove()
    except RuntimeInstallError as error:
        raise _refuse(error) from error

    return _describe(state, "none")
