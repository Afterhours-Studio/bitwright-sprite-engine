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

import { ApiError, conformSprite, generate, saveSpriteEdit } from '@/lib/api';
import { useGalleryStore } from '@/stores/useGalleryStore';
import type {
  ConformOptions,
  DetectedGrid,
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
  /**
   * The grid the last correction found, or null before one has run.
   *
   * Kept because it is the only thing that says whether the correction had
   * anything to work with: a confidence near zero means the render was not an
   * upscaled sprite and the result is a resize.
   */
  detected: DetectedGrid | null;
  /** Reason codes the last correction reported, for the `errors` namespace. */
  conformWarnings: string[];
  /** Corrects one sprite in place, and reports its palette. */
  conform: (index: number, options: ConformOptions) => Promise<void>;
  /** Replaces one sprite with a painted version of itself, and files it. */
  paint: (index: number, data: string) => void;
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

/**
 * The most recent painted bytes waiting to be written, by sprite index.
 *
 * Painting produces a new sprite on every stroke and every undo, and a write
 * crosses two process boundaries. Queuing the latest bytes rather than sending
 * each set means a fast hand costs one write per stroke that finishes, not one
 * request per stroke that started, and the file ends up holding the last state
 * rather than whichever request happened to land last.
 */
const queued = new Map<number, string>();

/** Sprites with a write in flight, so a second one queues instead of racing. */
const writing = new Set<number>();

/**
 * Writes a painted sprite to disk.
 *
 * WHEN: as soon as a stroke is committed, not behind a save control. The
 * gallery is a view of the sprites directory rather than a list held in
 * memory, so work that exists only in the window is work that is gone when the
 * window closes - which is the same reason generation writes what it produces
 * without being asked.
 *
 * WHAT IT WRITES TO: not the file the sprite came from. The engine derives an
 * edited copy from the generated sprite the first time one is painted and
 * overwrites that copy afterwards, so a stroke never destroys what the model
 * produced, and a session leaves one extra file rather than one per stroke.
 * The sprite's path follows the copy, so the next write lands on the same
 * file.
 *
 * A sprite that was never written - generation reports an empty path when it
 * could not file one - is left alone. There is no file to update, and
 * inventing one would create a sprite the user never asked to keep.
 *
 * A failure is swallowed. The buffer is still the sprite, the interface still
 * shows it, and refusing to draw because a copy could not be filed would throw
 * away work that succeeded.
 *
 * @param index - Which sprite of the batch.
 * @param data - The painted sprite, base64 encoded PNG.
 */
async function file(index: number, data: string): Promise<void> {
  queued.set(index, data);
  if (writing.has(index)) {
    return;
  }

  writing.add(index);
  try {
    for (;;) {
      const next = queued.get(index);
      if (next === undefined) {
        return;
      }
      queued.delete(index);

      // Only ever the sprite these bytes belong to. A run that finished while
      // a write was in flight puts a different sprite at this index, and one
      // sprite's paint written over another's file is worse than no write at
      // all. The path is re-read for the same reason, and because the first
      // write moves it onto the edited copy the next one has to land on.
      const image = useGenerationStore.getState().images[index];
      if (image === undefined || image.path === '' || image.data !== next) {
        continue;
      }

      const saved = await saveSpriteEdit(spriteName(image.path), next);
      useGenerationStore.setState((state) => ({
        images: state.images.map((entry, at) =>
          at === index && entry.data === next ? { ...entry, path: saved.path } : entry,
        ),
      }));
    }
  } catch {
    // Nothing to report: the sprite is in the window either way, and the next
    // stroke tries again.
  } finally {
    writing.delete(index);
  }
}

/**
 * Takes the file name out of a path.
 *
 * The engine names a sprite by its file, and both separators appear because
 * the path was built on whichever platform the engine is running on.
 *
 * @param path - Where the sprite was written.
 * @returns The file name.
 */
function spriteName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
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
  detected: null,
  conformWarnings: [],
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
      set({
        images: next,
        palette: result.palette,
        detected: result.detected,
        conformWarnings: result.warnings,
      });
    } catch (error) {
      set({ error: error instanceof ApiError ? error.code : 'unknown' });
    } finally {
      set({ conforming: false });
    }
  },

  paint: (index, data) => {
    const { images } = get();
    const image = images[index];
    if (image === undefined) {
      return;
    }

    // In place, like a correction: this is the same sprite with paint on it,
    // not another attempt at it. The size cannot change - the buffer is the
    // sprite's own grid - so only the bytes are replaced.
    set({ images: images.map((entry, at) => (at === index ? { ...entry, data } : entry)) });
    void file(index, data);
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
    // The palette and the detected grid describe a sprite that is going away
    // with this call, so they go with it rather than being left to describe
    // something the user can no longer see.
    set({
      request: DEFAULT_REQUEST,
      images: [],
      durationMs: 0,
      error: null,
      palette: [],
      detected: null,
      conformWarnings: [],
    });
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
