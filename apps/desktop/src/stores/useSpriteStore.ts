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
 * The sprite the editor has open.
 *
 * ONE SPRITE, OPENED FROM THE GALLERY.
 *
 * The editor used to be fed by a run: generation produced a batch and the
 * stage showed one of it. Generation is gone, and the document model that
 * replaces it - projects, assets, indexed layers, an op log in SQLite - is the
 * next phase of work. Until that lands, the sprites already on disk are what
 * there is to edit, so opening one from the gallery is how a sprite gets onto
 * the stage.
 *
 * It holds a sprite, not a request. Nothing here asks the engine to make
 * anything; the two things it can do to what is open are paint it, which the
 * canvas does, and conform it, which the sidecar does.
 */

import { create } from 'zustand';

import { ApiError, conformSprite, saveSpriteEdit } from '@/lib/api';
import type { ConformOptions, DetectedGrid, SpriteImage } from '@/types/engine';

interface SpriteState {
  /** The sprite on the stage, or null when none has been opened. */
  image: SpriteImage | null;
  /** True while a correction is being applied. */
  conforming: boolean;
  /** Colours the sprite uses, most used first. Empty until it is conformed. */
  palette: string[];
  /**
   * The grid the last correction found, or null before one has run.
   *
   * Kept because it is the only thing that says whether the correction had
   * anything to work with: a confidence near zero means the image was not
   * drawn on a pixel grid and the result is a resize.
   */
  detected: DetectedGrid | null;
  /** Reason codes the last correction reported, for the `errors` namespace. */
  warnings: string[];
  /** Stable reason code for the last failure, or null. */
  error: string | null;

  /** Puts a sprite on the stage, replacing whatever was there. */
  open: (image: SpriteImage) => void;
  /** Takes the sprite off the stage. */
  close: () => void;
  /** Replaces the sprite with a painted version of itself, and files it. */
  paint: (data: string) => void;
  /** Corrects the sprite in place, and reports its palette. */
  conform: (options: ConformOptions) => Promise<void>;
}

/**
 * The most recent painted bytes waiting to be written.
 *
 * Painting produces a new sprite on every stroke and every undo, and a write
 * crosses two process boundaries. Queuing the latest bytes rather than sending
 * each set means a fast hand costs one write per stroke that finishes, not one
 * request per stroke that started, and the file ends up holding the last state
 * rather than whichever request happened to land last.
 */
let queued: string | null = null;

/** True while a write is in flight, so a second one queues instead of racing. */
let writing = false;

/**
 * Writes a painted sprite to disk.
 *
 * WHEN: as soon as a stroke is committed, not behind a save control. The
 * gallery is a view of the sprites directory rather than a list held in
 * memory, so work that exists only in the window is work that is gone when the
 * window closes.
 *
 * WHAT IT WRITES TO: not the file the sprite came from. The engine derives an
 * edited copy the first time one is painted and overwrites that copy
 * afterwards, so a stroke never destroys what was opened, and a session leaves
 * one extra file rather than one per stroke. The sprite's path follows the
 * copy, so the next write lands on the same file.
 *
 * A sprite with no path on disk is left alone. There is no file to update, and
 * inventing one would create a sprite the user never asked to keep.
 *
 * A failure is swallowed. The buffer is still the sprite, the interface still
 * shows it, and refusing to draw because a copy could not be filed would throw
 * away work that succeeded.
 *
 * @param data - The painted sprite, base64 encoded PNG.
 */
async function file(data: string): Promise<void> {
  queued = data;
  if (writing) {
    return;
  }

  writing = true;
  try {
    for (;;) {
      const next = queued;
      if (next === null) {
        return;
      }
      queued = null;

      // Only ever the sprite these bytes belong to. Opening another sprite
      // while a write is in flight puts a different one on the stage, and one
      // sprite's paint written over another's file is worse than no write at
      // all. The path is re-read for the same reason, and because the first
      // write moves it onto the edited copy the next one has to land on.
      const image = useSpriteStore.getState().image;
      if (image === null || image.path === '' || image.data !== next) {
        continue;
      }

      const saved = await saveSpriteEdit(spriteName(image.path), next);
      useSpriteStore.setState((state) =>
        state.image !== null && state.image.data === next
          ? { image: { ...state.image, path: saved.path } }
          : {},
      );
    }
  } catch {
    // Nothing to report: the sprite is in the window either way, and the next
    // stroke tries again.
  } finally {
    writing = false;
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

export const useSpriteStore = create<SpriteState>((set, get) => ({
  image: null,
  conforming: false,
  palette: [],
  detected: null,
  warnings: [],
  error: null,

  open: (image) => {
    // The palette and the conform readout describe the sprite that was there,
    // not this one, so they are dropped rather than left to describe something
    // the user is no longer looking at.
    set({ image, palette: [], detected: null, warnings: [], error: null });
  },

  close: () => {
    set({ image: null, palette: [], detected: null, warnings: [], error: null });
  },

  paint: (data) => {
    const { image } = get();
    if (image === null) {
      return;
    }

    // In place, like a correction: this is the same sprite with paint on it,
    // not another sprite. The size cannot change - the buffer is the sprite's
    // own grid - so only the bytes are replaced.
    set({ image: { ...image, data } });
    void file(data);
  },

  conform: async (options) => {
    const { image } = get();
    if (image === null) {
      return;
    }

    set({ conforming: true, error: null });
    try {
      const result = await conformSprite({ image: image.data, ...options });
      // Replaced in place: this is the same sprite corrected, not a second
      // sprite derived from it.
      set({
        image: { ...image, data: result.image, width: result.width, height: result.height },
        palette: result.palette,
        detected: result.detected,
        warnings: result.warnings,
      });
    } catch (error) {
      set({ error: error instanceof ApiError ? error.code : 'unknown' });
    } finally {
      set({ conforming: false });
    }
  },
}));
