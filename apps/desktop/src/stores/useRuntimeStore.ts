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
 * The GPU runtime: whether PyTorch is installed, and getting it installed.
 *
 * The engine answers the install request as soon as the transfer is running,
 * because two and a half gigabytes do not fit in a request. So this polls while
 * an install is in flight, the way the model list is polled, and stops as soon
 * as the engine says nothing is running.
 *
 * Nothing here starts a download on its own. `install` and `remove` are only
 * ever called from a confirmation the user pressed, and the card is what shows
 * the size and the licences that confirmation is about.
 */

import { create } from 'zustand';

import { useDownloadStore } from '@/stores/useDownloadStore';

import {
  ApiError,
  cancelRuntimeInstall,
  getRuntime,
  installRuntime,
  removeRuntime,
  repairRuntime,
} from '@/lib/api';
import type { RuntimeInfo, RuntimeRequest } from '@/types/engine';

/** How often the state is re-read while an install is running, in milliseconds. */
export const POLL_INTERVAL_MS = 1000;

interface RuntimeState {
  /** The runtime as the engine last reported it, or null before it answered. */
  info: RuntimeInfo | null;
  /** True while a request to the engine is in flight. */
  loading: boolean;
  /** Stable reason code for the last failed request, or null. */
  error: string | null;

  /** Re-reads the runtime state. */
  refresh: () => Promise<void>;
  /** Starts installing a build. Only ever called from a confirmation. */
  install: (accelerator: RuntimeRequest) => Promise<void>;
  /** Asks a running install to stop. */
  /** Adds the packages the installed runtime is missing, and nothing else. */
  repair: () => Promise<void>;
  cancel: () => Promise<void>;
  /** Deletes the installed runtime. Only ever called from a confirmation. */
  remove: () => Promise<void>;
  /** Stops the polling this store started, if any. */
  stopPolling: () => void;
  /** Clears the last error. */
  clearError: () => void;
}

/** What the transfers panel calls a runtime install. */
const RUNTIME_LABEL = 'GPU runtime';

export const useRuntimeStore = create<RuntimeState>((set, get) => {
  // Module scope rather than store state: a timer is not something a component
  // renders, and putting it in the store would make every tick a re-render of
  // everything subscribed.
  let timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Stops the polling timer.
   */
  const stop = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  /**
   * Starts polling while an install is running, and stops when it is not.
   */
  const sync = (): void => {
    const installing = get().info?.installing === true;
    if (installing && timer === null) {
      timer = setInterval(() => {
        void get().refresh();
      }, POLL_INTERVAL_MS);
    } else if (!installing) {
      stop();
    }
  };

  /**
   * Records a failure under its reason code.
   *
   * @param error - Whatever was thrown.
   */
  const fail = (error: unknown): void => {
    set({ error: error instanceof ApiError ? error.code : 'unknown', loading: false });
  };

  /**
   * Stores an answer from the engine and adjusts the polling to match it.
   *
   * @param info - The runtime state the engine reported.
   */
  /**
   * Files a finished install, so the transfers panel remembers it.
   *
   * Recorded here, where every runtime state arrives, for the same reason the
   * model records are written where the model list arrives: a subscriber
   * attached beside the store stops being called when its module is replaced,
   * and the record silently stops being written.
   *
   * @param before - The state as it was.
   * @param after - The state as it now is.
   * @param failure - The reason code, when the work failed.
   */
  const recordFinished = (
    before: RuntimeInfo | null,
    after: RuntimeInfo,
    failure: string | null,
  ): void => {
    if (before === null || !before.installing || after.installing) {
      return;
    }
    useDownloadStore.getState().record({
      name: RUNTIME_LABEL,
      outcome: failure !== null ? 'failed' : 'done',
      error: failure ?? '',
      bytes: after.usedBytes,
    });
  };

  const accept = (info: RuntimeInfo): void => {
    recordFinished(get().info, info, get().error);
    set({ info, loading: false });
    sync();
  };

  return {
    info: null,
    loading: false,
    error: null,

    refresh: async () => {
      try {
        accept(await getRuntime());
      } catch (error) {
        // Polling must not turn one lost answer into an error the user sees
        // over and over, so a refresh that fails while an install is running
        // leaves the last known state on screen.
        if (get().info === null) {
          fail(error);
        }
      }
    },

    install: async (accelerator) => {
      set({ loading: true, error: null });
      try {
        accept(await installRuntime(accelerator));
      } catch (error) {
        fail(error);
        await get().refresh();
      }
    },

    repair: async () => {
      set({ loading: true, error: null });
      try {
        accept(await repairRuntime());
      } catch (error) {
        fail(error);
        await get().refresh();
      }
    },

    cancel: async () => {
      set({ loading: true, error: null });
      try {
        accept(await cancelRuntimeInstall());
      } catch (error) {
        fail(error);
      }
    },

    remove: async () => {
      set({ loading: true, error: null });
      try {
        accept(await removeRuntime());
      } catch (error) {
        fail(error);
        await get().refresh();
      }
    },

    stopPolling: () => {
      stop();
    },

    clearError: () => {
      set({ error: null });
    },
  };
});
