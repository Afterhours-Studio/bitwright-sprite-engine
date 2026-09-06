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
 *
 * A download reports its progress through the model list rather than through an
 * event, so this store polls while one is running. The poll's lifetime is tied
 * to the state that justifies it - some model reporting `downloading` - and not
 * to whichever screen happens to be open: every path out of that state clears
 * the timer, so nothing is left calling the engine once the transfer ends,
 * fails, or is cancelled.
 */

import { create } from 'zustand';

import {
  ApiError,
  cancelDownload,
  downloadModel,
  listBackends,
  listModels,
  selectBackend,
} from '@/lib/api';
import type { SidecarStatus } from '@/lib/tauri';
import type { BackendInfo, BackendKind, Capability, ModelInfo } from '@/types/engine';

/**
 * How often the model list is re-read while a download is running.
 *
 * One second is fast enough that a progress bar moves smoothly and slow enough
 * that the engine is not answering a request while it is trying to write to
 * disk.
 */
const POLL_INTERVAL_MS = 1000;

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
  /** Starts downloading a model's weights, and follows the transfer. */
  download: (modelId: string) => Promise<void>;
  /** Cancels a download that is in progress. */
  cancel: (modelId: string) => Promise<void>;
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

export const useEngineStore = create<EngineState>((set, get) => {
  /** The running poll, or null when no download is being followed. */
  let poll: ReturnType<typeof setInterval> | null = null;

  /** Stops the poll. Safe to call when none is running. */
  const stopPolling = (): void => {
    if (poll !== null) {
      clearInterval(poll);
      poll = null;
    }
  };

  /**
   * Starts or stops the poll to match what the models report.
   *
   * Every write to `models` goes through here, which is what guarantees the
   * timer cannot outlive the download that justified it.
   *
   * @param models - The model list just received.
   */
  const syncPolling = (models: ModelInfo[]): void => {
    if (!models.some((model) => model.downloading)) {
      stopPolling();
      return;
    }
    poll ??= setInterval(() => {
      void readModels();
    }, POLL_INTERVAL_MS);
  };

  /**
   * Re-reads the model list, which is how download progress arrives.
   *
   * A failed read stops the poll rather than retrying forever: if the sidecar
   * has gone away, a timer calling it every second for the rest of the session
   * is the bug, not the missing update. Reopening the screen and pressing
   * download again starts a fresh transfer.
   */
  const readModels = async (): Promise<void> => {
    try {
      const models = await listModels();
      set({ models });
      syncPolling(models);
    } catch (error) {
      stopPolling();
      set({ error: error instanceof ApiError ? error.code : 'unknown' });
    }
  };

  /**
   * Replaces one model in the list.
   *
   * @param modelId - Which model to replace.
   * @param patch - The fields to change.
   * @returns The new list.
   */
  const patchModel = (modelId: string, patch: Partial<ModelInfo>): ModelInfo[] =>
    get().models.map((model) => (model.modelId === modelId ? { ...model, ...patch } : model));

  return {
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
        syncPolling(models);
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

    download: async (modelId) => {
      // Clearing the previous failure first, so that a retry does not show the
      // error it is retrying beside a bar that is already moving.
      set({ models: patchModel(modelId, { error: '' }) });

      try {
        // The engine answers a download with the model entry, so the accepted
        // state is taken from the response rather than from a second read.
        const model = await downloadModel(modelId);
        const models = patchModel(modelId, model);
        set({ models, error: null });
        syncPolling(models);
      } catch (error) {
        const code = error instanceof ApiError ? error.code : 'unknown';
        // Recorded against the model as well as on the store, because the row
        // is where the user is looking and where the retry lives. `downloading`
        // is left alone: a refused start never changes it, and a rejection
        // saying the transfer is already running must not stop the poll.
        const models = patchModel(modelId, { error: code });
        set({ models, error: code });
        syncPolling(models);
      }
    },

    cancel: async (modelId) => {
      try {
        // The response body is not part of the contract for this route, so the
        // list is re-read instead of trusted, which also stops the poll.
        await cancelDownload(modelId);
        await readModels();
      } catch (error) {
        const code = error instanceof ApiError ? error.code : 'unknown';
        set({ models: patchModel(modelId, { error: code }), error: code });
      }
    },

    clearError: () => {
      set({ error: null });
    },
  };
});

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
