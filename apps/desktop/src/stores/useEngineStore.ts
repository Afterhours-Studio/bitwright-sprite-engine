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

/**
 * Engine state: the sidecar's status, the available backends, and the models.
 *
 * The capability list held here is what the generate screen reads to decide
 * which controls to disable, so that an unsupported option is never offered.
 */

import { create } from 'zustand';

import { ApiError, listBackends, listModels, selectBackend } from '@/lib/api';
import type { SidecarStatus } from '@/lib/tauri';
import type { BackendInfo, BackendKind, Capability, ModelInfo } from '@/types/engine';

interface EngineState {
  /** The sidecar's status, as last reported by the shell. */
  sidecar: SidecarStatus;
  /** Every backend, in preference order. Empty until the sidecar answers. */
  backends: BackendInfo[];
  /** Registered models. Empty until the sidecar answers. */
  models: ModelInfo[];
  /** True while a request to the sidecar is in flight. */
  loading: boolean;
  /** Stable reason code for the last failure, or null. */
  error: string | null;

  /** Records a sidecar status update from the shell. */
  setSidecar: (status: SidecarStatus) => void;
  /** Reloads backends and models from the sidecar. */
  refresh: () => Promise<void>;
  /** Switches the active backend and reloads the list. */
  select: (kind: BackendKind) => Promise<void>;
  /** Clears the last error. */
  clearError: () => void;
}

/** The status used before the shell has answered, and outside a shell. */
const UNKNOWN_SIDECAR: SidecarStatus = {
  ready: false,
  port: 0,
  version: '',
  error: '',
  detail: '',
};

export const useEngineStore = create<EngineState>((set, get) => ({
  sidecar: UNKNOWN_SIDECAR,
  backends: [],
  models: [],
  loading: false,
  error: null,

  setSidecar: (sidecar) => {
    set({ sidecar, error: sidecar.error === '' ? get().error : sidecar.error });
    if (sidecar.ready) {
      void get().refresh();
    }
  },

  refresh: async () => {
    set({ loading: true });
    try {
      const [backendList, models] = await Promise.all([listBackends(), listModels()]);
      set({ backends: backendList.backends, models, error: null });
    } catch (error) {
      set({ error: error instanceof ApiError ? error.code : 'unknown' });
    } finally {
      set({ loading: false });
    }
  },

  select: async (kind) => {
    set({ loading: true });
    try {
      const backendList = await selectBackend(kind);
      set({ backends: backendList.backends, error: null });
    } catch (error) {
      set({ error: error instanceof ApiError ? error.code : 'unknown' });
    } finally {
      set({ loading: false });
    }
  },

  clearError: () => {
    set({ error: null });
  },
}));

/**
 * Returns the backend currently serving generation.
 *
 * @param backends - The known backends.
 * @returns The selected backend, or null when none is.
 */
export function selectedBackend(backends: BackendInfo[]): BackendInfo | null {
  return backends.find((backend) => backend.selected) ?? null;
}

/**
 * Returns the capabilities of the selected backend.
 *
 * @param backends - The known backends.
 * @returns The selected backend's capabilities, or an empty list.
 */
export function activeCapabilities(backends: BackendInfo[]): Capability[] {
  return selectedBackend(backends)?.capabilities ?? [];
}
