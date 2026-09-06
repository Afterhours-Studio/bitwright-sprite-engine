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
 * Remote inference providers: the configured list, the catalogue, and the
 * result of the last connection test.
 *
 * NO API KEY IS EVER HELD HERE.
 *
 * That is the point of the store's shape. A key is passed straight through
 * {@link ProviderState.save} into the engine and is not written to any field
 * of this state. What comes back is `hasKey` and a masked hint, so a key cannot
 * leak through a devtools inspection of the store, through a rerender, or
 * through anything that serialises application state.
 *
 * The test result is kept per provider rather than as one global value, so
 * testing a second provider does not wipe the answer the user just got for the
 * first.
 */

import { create } from 'zustand';

import {
  activateProvider,
  ApiError,
  listProviders,
  removeProvider,
  saveProvider,
  testProvider,
} from '@/lib/api';
import type {
  ConnectionTestResult,
  ProviderInfo,
  ProviderPreset,
  ProviderSaveRequest,
  SecretStorage,
} from '@/types/engine';

/** Reason code reported when the shell rejects with something unrecognised. */
const UNKNOWN = 'unknown';

interface ProviderState {
  /** Configured providers, in the order they were added. */
  providers: ProviderInfo[];
  /** The built-in catalogue. Empty until the engine answers. */
  presets: ProviderPreset[];
  /** Identifier of the provider serving generation, empty when none is. */
  activeId: string;
  /** How credentials are being held on this machine. */
  secretStorage: SecretStorage;
  /** How many providers may be stored in total. */
  maxProviders: number;
  /** True while a request to the engine is in flight. */
  loading: boolean;
  /** Identifier of the provider currently being tested, or null. */
  testing: string | null;
  /** The last connection test result, per provider. */
  results: Record<string, ConnectionTestResult>;
  /** Stable reason code for the last failure, or null. */
  error: string | null;

  /** Reloads the provider list from the engine. */
  refresh: () => Promise<void>;
  /** Creates a provider or replaces one. Resolves true when it was stored. */
  save: (request: ProviderSaveRequest) => Promise<boolean>;
  /** Deletes a provider and its credential. Resolves true when it was deleted. */
  remove: (providerId: string) => Promise<boolean>;
  /** Selects the provider that serves generation. */
  activate: (providerId: string) => Promise<void>;
  /** Runs one connection test and records the outcome. */
  test: (providerId: string) => Promise<void>;
  /** Clears the last error. */
  clearError: () => void;
  /** Forgets the recorded test result for one provider. */
  clearResult: (providerId: string) => void;
}

/**
 * Turns a thrown value into a reason code.
 *
 * @param error - Whatever was thrown.
 * @returns The stable reason code.
 */
function toCode(error: unknown): string {
  return error instanceof ApiError ? error.code : UNKNOWN;
}

/**
 * Returns the recorded results without the one belonging to a provider.
 *
 * Rebuilt rather than deleted from: a result describes one endpoint, and
 * leaving it behind would let a later provider inherit an answer about a
 * different one.
 *
 * @param results - The recorded results.
 * @param providerId - Whose result to drop.
 * @returns A new record without that entry.
 */
function without(
  results: Record<string, ConnectionTestResult>,
  providerId: string,
): Record<string, ConnectionTestResult> {
  return Object.fromEntries(Object.entries(results).filter(([key]) => key !== providerId));
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  presets: [],
  activeId: '',
  // Assumed to be the weaker tier until the engine says otherwise, so a screen
  // that renders before the first answer never claims a guarantee it has not
  // confirmed.
  secretStorage: 'file',
  maxProviders: 0,
  loading: false,
  testing: null,
  results: {},
  error: null,

  refresh: async () => {
    set({ loading: true });
    try {
      const listing = await listProviders();
      set({
        providers: listing.providers,
        presets: listing.presets,
        activeId: listing.activeId,
        secretStorage: listing.secretStorage,
        maxProviders: listing.maxProviders,
        error: null,
      });
    } catch (error) {
      set({ error: toCode(error) });
    } finally {
      set({ loading: false });
    }
  },

  save: async (request) => {
    set({ loading: true });
    try {
      const listing = await saveProvider(request);
      set({
        providers: listing.providers,
        presets: listing.presets,
        activeId: listing.activeId,
        secretStorage: listing.secretStorage,
        maxProviders: listing.maxProviders,
        error: null,
      });
      return true;
    } catch (error) {
      set({ error: toCode(error) });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  remove: async (providerId) => {
    set({ loading: true });
    try {
      const listing = await removeProvider(providerId);
      set({
        providers: listing.providers,
        activeId: listing.activeId,
        // The recorded test result goes with the provider it described.
        results: without(get().results, providerId),
        error: null,
      });
      return true;
    } catch (error) {
      set({ error: toCode(error) });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  activate: async (providerId) => {
    set({ loading: true });
    try {
      const listing = await activateProvider(providerId);
      set({ providers: listing.providers, activeId: listing.activeId, error: null });
    } catch (error) {
      set({ error: toCode(error) });
    } finally {
      set({ loading: false });
    }
  },

  test: async (providerId) => {
    set({ testing: providerId });
    try {
      const result = await testProvider(providerId);
      set({ results: { ...get().results, [providerId]: result }, error: null });
    } catch (error) {
      // The call itself failed, which is a different thing from the endpoint
      // refusing. It is still recorded against the row, because the row is
      // where the user is looking.
      const code = toCode(error);
      set({
        results: {
          ...get().results,
          [providerId]: { ok: false, code, detail: '', latencyMs: 0, modelCount: 0 },
        },
        error: code,
      });
    } finally {
      set({ testing: null });
    }
  },

  clearError: () => {
    set({ error: null });
  },

  clearResult: (providerId) => {
    set({ results: without(get().results, providerId) });
  },
}));

/**
 * Returns the provider currently serving generation.
 *
 * @param providers - The configured providers.
 * @returns The active provider, or null when none is.
 */
export function activeProvider(providers: ProviderInfo[]): ProviderInfo | null {
  return providers.find((provider) => provider.active) ?? null;
}
