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
 * Where the application's data is kept.
 *
 * A location is never adopted by the same press that chose it. Picking a folder
 * only produces a candidate, which the engine has already checked and reported
 * the free space for; a second, explicit press is what moves where the library
 * lands. That is why the candidate lives here rather than as component state:
 * it is a validated answer from the engine, not a string in a field.
 *
 * Nothing is ever moved on disk. After a change, `leftBehind` names the old
 * location when something is still sitting in it, so the interface can say so
 * instead of letting the user believe their sprites followed them.
 */

import { create } from 'zustand';

import {
  ApiError,
  getStorage,
  pickDirectory,
  resetStorageRoot,
  setStorageRoot,
  validateStorage,
} from '@/lib/api';
import type { StorageInfo } from '@/types/engine';

interface StorageState {
  /** The location in use, or null before the engine has answered. */
  info: StorageInfo | null;
  /** A checked location awaiting confirmation, or null when none is proposed. */
  candidate: StorageInfo | null;
  /**
   * The previous location, when the last change left data sitting in it. Null
   * when nothing moved, or when the location the user left was empty.
   */
  leftBehind: string | null;
  /** True while a request to the engine or the picker is in flight. */
  loading: boolean;
  /** Stable reason code for the last failure, or null. */
  error: string | null;

  /** Re-reads the location in use. */
  refresh: () => Promise<void>;
  /** Opens the system directory picker and proposes what was chosen. */
  browse: () => Promise<void>;
  /** Proposes the per-user default location. */
  proposeDefault: () => Promise<void>;
  /** Drops the proposal without changing anything. */
  clearCandidate: () => void;
  /** Adopts the proposed location. Does nothing when none is proposed. */
  apply: () => Promise<void>;
  /** Clears the last error. */
  clearError: () => void;
}

export const useStorageStore = create<StorageState>((set, get) => {
  /**
   * Records a failure under its reason code.
   *
   * @param error - Whatever was thrown.
   */
  const fail = (error: unknown): void => {
    set({ error: error instanceof ApiError ? error.code : 'unknown', loading: false });
  };

  return {
    info: null,
    candidate: null,
    leftBehind: null,
    loading: false,
    error: null,

    refresh: async () => {
      set({ loading: true });
      try {
        set({ info: await getStorage(), loading: false });
      } catch (error) {
        fail(error);
      }
    },

    browse: async () => {
      set({ loading: true, error: null });
      try {
        const chosen = await pickDirectory();
        if (chosen === null) {
          // The dialog was closed without a choice. Not a failure, and not a
          // reason to leave a stale proposal on screen.
          set({ loading: false });
          return;
        }
        set({ candidate: await validateStorage(chosen), loading: false });
      } catch (error) {
        fail(error);
      }
    },

    proposeDefault: async () => {
      const current = get().info;
      if (current === null) {
        return;
      }

      set({ loading: true, error: null });
      try {
        // Checked like any other candidate: a profile directory can be full or
        // read-only too, and the user is owed that answer before confirming.
        set({ candidate: await validateStorage(current.defaultRoot), loading: false });
      } catch (error) {
        fail(error);
      }
    },

    clearCandidate: () => {
      set({ candidate: null });
    },

    apply: async () => {
      const candidate = get().candidate;
      if (candidate === null) {
        return;
      }

      set({ loading: true, error: null });
      try {
        // Going back to the default clears the remembered choice rather than
        // storing the default path, so a future change to where the default
        // lives is picked up instead of being frozen into the preferences.
        const change = candidate.isDefault
          ? await resetStorageRoot()
          : await setStorageRoot(candidate.root);

        const moved = change.previous.root !== change.current.root;
        set({
          info: change.current,
          candidate: null,
          // Only worth saying when the old location still holds something. A
          // user who moved an empty folder has nothing to go back for.
          leftBehind: moved && change.previous.usedBytes > 0 ? change.previous.root : null,
          loading: false,
        });
      } catch (error) {
        fail(error);
        // The engine may have adopted the location and failed only to remember
        // it, so what is on screen has to come from the engine rather than
        // from what this store hoped had happened.
        await get().refresh();
      }
    },

    clearError: () => {
      set({ error: null });
    },
  };
});
