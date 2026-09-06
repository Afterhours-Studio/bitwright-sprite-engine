// Bitwright - Sprite Engine
// Copyright (C) 2026 Afterhours Studio
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

import { activeCapabilities, useEngineStore } from '@/stores/useEngineStore';
import type { Capability } from '@/types/engine';

/** What the selected backend can do. */
export interface CapabilityState {
  /** The selected backend's capabilities. */
  capabilities: Capability[];
  /** Whether a given capability is available. */
  supports: (capability: Capability) => boolean;
  /** Whether the engine is ready to serve requests at all. */
  ready: boolean;
}

/**
 * Reports what the selected backend supports.
 *
 * Controls are disabled from this, before the user can reach them. Offering an
 * option and then failing the request is worse than not offering it: the user
 * has already written a prompt and waited by the time they find out.
 *
 * @returns The capability state of the selected backend.
 */
export function useCapabilities(): CapabilityState {
  const backends = useEngineStore((state) => state.backends);
  const sidecar = useEngineStore((state) => state.sidecar);

  const capabilities = activeCapabilities(backends);

  return {
    capabilities,
    supports: (capability) => capabilities.includes(capability),
    ready: sidecar.ready && backends.some((backend) => backend.selected && backend.available),
  };
}
