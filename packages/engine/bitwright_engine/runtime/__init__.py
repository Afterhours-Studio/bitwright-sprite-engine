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

"""The GPU runtime: PyTorch, installed into the user's own data folder."""

from bitwright_engine.runtime.activation import TorchProbe, activate, activated_path, probe
from bitwright_engine.runtime.installer import (
    RUNTIME_DIRNAME,
    InstalledRecord,
    InstallState,
    RuntimeInstaller,
    RuntimeInstallError,
)
from bitwright_engine.runtime.manifest import (
    CUDA_LICENSE_URL,
    MANIFEST,
    TORCH_LICENSE_URL,
    Variant,
    Wheel,
    find_variant,
    recommended,
    target_key,
    variants_for,
)

__all__ = [
    "CUDA_LICENSE_URL",
    "MANIFEST",
    "RUNTIME_DIRNAME",
    "TORCH_LICENSE_URL",
    "InstallState",
    "InstalledRecord",
    "RuntimeInstallError",
    "RuntimeInstaller",
    "TorchProbe",
    "Variant",
    "Wheel",
    "activate",
    "activated_path",
    "find_variant",
    "probe",
    "recommended",
    "target_key",
    "variants_for",
]
