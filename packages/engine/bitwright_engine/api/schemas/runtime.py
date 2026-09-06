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

"""Request and response models for the GPU runtime route.

Every number the interface needs in order to warn before a download is here:
what would be fetched, how large it is unpacked, how much room the volume has,
and under which licences the pieces arrive. The interface must be able to state
all of that without a second request, because the confirmation the user presses
is the last moment before two and a half gigabytes start moving.
"""

from __future__ import annotations

from pydantic import Field

from bitwright_engine.api.schemas.common import CamelModel


class RuntimePackage(CamelModel):
    """One package an install would fetch.

    Attributes:
        name: Distribution name.
        version: Exact pinned version.
        license_id: SPDX expression the distribution declares.
        size_bytes: Download size of its wheel.
    """

    name: str
    version: str
    license_id: str
    size_bytes: int


class RuntimePlan(CamelModel):
    """What installing one variant would do.

    Attributes:
        accelerator: The hardware this build drives, one of ``cuda``, ``mps``
            or ``cpu``.
        torch_version: Version of torch it installs.
        cuda_version: CUDA version the build targets, or an empty string.
        bundles_nvidia: True when the wheels carry NVIDIA's redistributable
            CUDA libraries, which come under NVIDIA's own licence rather than
            PyTorch's. The interface must say so before the download starts.
        download_bytes: Bytes fetched over the network.
        installed_bytes: Bytes the result occupies on disk.
        required_bytes: Free space needed at the peak of the install, which is
            the unpacked tree plus the largest wheel still on disk.
        packages: Every package, torch first, with its licence.
        torch_license_url: Where PyTorch's licence is published.
        cuda_license_url: Where NVIDIA's licence is published. Empty when the
            variant carries nothing of NVIDIA's.
    """

    accelerator: str
    torch_version: str
    cuda_version: str
    bundles_nvidia: bool
    download_bytes: int
    installed_bytes: int
    required_bytes: int
    packages: list[RuntimePackage]
    torch_license_url: str
    cuda_license_url: str


class RuntimeInfo(CamelModel):
    """The GPU runtime, as the settings screen sees it.

    Attributes:
        supported: Whether this platform and interpreter have a pinned wheel
            set at all. False means no install can be offered here, and
            ``unsupported_reason`` says so.
        unsupported_reason: Stable reason code when ``supported`` is false.
        target: Manifest key for this machine, such as ``win_amd64-cp314``.
            Shown so a bug report can say which build was being asked for.
        install_dir: Where the runtime lives, or would live.
        installed: Whether a complete runtime is present.
        installed_accelerator: Which variant is installed, or an empty string.
        installed_torch_version: Version of torch installed, or an empty
            string. This is what is on disk, not what imported.
        torch_importable: Whether ``import torch`` works in this process. False
            with ``installed`` true is what a pending restart looks like.
        torch_version: Version torch reports, once imported.
        cuda_available: Whether torch reports a usable CUDA device. This, and
            nothing else, is the answer to whether the GPU works.
        mps_available: Whether torch reports a usable Metal device.
        device: Name of the device torch found, or an empty string.
        probe_detail: Stable reason code when torch is present but unusable.
        restart_required: True when a runtime is installed and this process is
            not using it, which is the case until the engine is restarted.
        free_bytes: Free space on the volume the runtime lands on, or null when
            the volume could not be read.
        total_bytes: Size of that volume, or null for the same reason.
        used_bytes: Bytes the installed runtime occupies right now.
        recommended_accelerator: Which variant suits the GPU the shell probed
            for, or an empty string when none can be offered.
        plans: What each installable variant would download.
        missing_packages: Names the installed tree is missing against the
            manifest this build ships. A runtime can be complete for the
            manifest it was installed from and incomplete for the current
            one, which is a repair rather than a reinstall.
        missing_bytes: What adding them would download.
        installing: True while an install is running.
        phase: ``download``, ``extract``, ``publish``, or an empty string.
        progress: Fraction between 0.0 and 1.0. Zero when nothing is running.
        installing_accelerator: Which variant is being installed.
        error: Stable reason code for the last failed install, or an empty
            string. Left empty by a cancellation, which is not a failure.
    """

    supported: bool
    unsupported_reason: str
    target: str
    install_dir: str

    installed: bool
    installed_accelerator: str
    installed_torch_version: str

    torch_importable: bool
    torch_version: str
    cuda_available: bool
    mps_available: bool
    device: str
    probe_detail: str
    restart_required: bool

    free_bytes: int | None
    total_bytes: int | None
    used_bytes: int

    recommended_accelerator: str
    plans: list[RuntimePlan]

    missing_packages: list[str] = Field(default_factory=list)
    missing_bytes: int = 0
    installing: bool
    phase: str
    progress: float
    installing_accelerator: str
    error: str


class RuntimeInstallBody(CamelModel):
    """Which runtime to install.

    Attributes:
        accelerator: ``cuda``, ``mps``, ``cpu``, or ``auto`` to take whichever
            suits the GPU the shell probed for.
        gpu: What the shell's probe found: ``cuda``, ``metal`` or ``none``. The
            engine does not run its own probe; the shell already has one that
            costs nothing and loads no machine learning framework.
    """

    accelerator: str = "auto"
    gpu: str = "none"
