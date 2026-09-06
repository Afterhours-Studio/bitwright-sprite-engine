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
 * The parameters on the generate screen, and the state of the current run.
 *
 * Components read from here and call actions; none of them hold state of their
 * own. That is what lets a screen be rendered in a test with an arbitrary
 * store state.
 */

import { create } from 'zustand';

import { loadValue, saveValue, STORAGE_KEYS } from '@/lib/persist';

import { ApiError, conformSprite, generate } from '@/lib/api';
import { useGalleryStore } from '@/stores/useGalleryStore';
import type {
  ConformOptions,
  GenerateRequest,
  GenerateResponse,
  SpriteImage,
} from '@/types/engine';

/** The parameters a run starts from. */
export const DEFAULT_REQUEST: GenerateRequest = {
  prompt: '',
  negativePrompt: '',
  width: 64,
  height: 64,
  steps: 20,
  guidanceScale: 7,
  seed: null,
  batchSize: 1,
  style: 'pixel',
  camera: 'side',
  directions: 1,
  modelId: 'sd15-base',
  loraId: null,
  postprocess: {
    removeBackground: true,
    backgroundTolerance: 12,
    paletteSize: 32,
    dither: false,
    pixelGrid: null,
  },
};

interface GenerationState {
  /** The parameters currently entered. */
  request: GenerateRequest;
  /** True while a run is in flight. */
  running: boolean;
  /** True while a correction is being applied to the shown sprite. */
  conforming: boolean;
  /** Colours the shown sprite uses, most used first. Empty until conformed. */
  palette: string[];
  /** Corrects one sprite in place, and reports its palette. */
  conform: (index: number, options: ConformOptions) => Promise<void>;
  /** The sprites from the last successful run. */
  images: SpriteImage[];
  /** How long the last run took, in milliseconds. */
  durationMs: number;
  /** Stable reason code for the last failure, or null. */
  error: string | null;

  /** Updates one or more parameters. */
  patch: (patch: Partial<GenerateRequest>) => void;
  /** Updates one or more post-processing options. */
  patchPostprocess: (patch: Partial<GenerateRequest['postprocess']>) => void;
  /** Restores the default parameters. */
  reset: () => void;
  /** Runs generation with the current parameters. */
  run: () => Promise<void>;
}

export const useGenerationStore = create<GenerationState>((set, get) => ({
  // Merged over the defaults rather than replacing them, so a record
  // written before a field existed still loads and simply lacks that field.
  request: {
    ...DEFAULT_REQUEST,
    ...((loadValue(STORAGE_KEYS.request) as Partial<GenerateRequest> | null) ?? {}),
  },
  running: false,
  conforming: false,
  palette: [],
  images: [],
  durationMs: 0,
  error: null,

  conform: async (selected, options) => {
    const { images } = get();
    const image = images[selected];
    if (image === undefined) {
      return;
    }

    set({ conforming: true, error: null });
    try {
      const result = await conformSprite({ image: image.data, ...options });
      // Replaced in place rather than appended: this is the same sprite
      // corrected, not another attempt at it, and a batch strip that grew every
      // time a correction ran would stop meaning what it says.
      const next = images.map((entry, index) =>
        index === selected
          ? { ...entry, data: result.image, width: result.width, height: result.height }
          : entry,
      );
      set({ images: next, palette: result.palette });
    } catch (error) {
      set({ error: error instanceof ApiError ? error.code : 'unknown' });
    } finally {
      set({ conforming: false });
    }
  },

  patch: (patch) => {
    const request = { ...get().request, ...patch };
    set({ request });
    saveValue(STORAGE_KEYS.request, request);
  },

  patchPostprocess: (patch) => {
    const request = get().request;
    set({ request: { ...request, postprocess: { ...request.postprocess, ...patch } } });
  },

  reset: () => {
    set({ request: DEFAULT_REQUEST, images: [], durationMs: 0, error: null });
  },

  run: async () => {
    if (get().running) {
      return;
    }

    set({ running: true, error: null });
    try {
      const response: GenerateResponse = await generate(get().request);
      set({ images: response.images, durationMs: response.durationMs });
      useGalleryStore.getState().add(response.images, get().request.prompt);
    } catch (error) {
      set({ error: error instanceof ApiError ? error.code : 'unknown' });
    } finally {
      set({ running: false });
    }
  },
}));
