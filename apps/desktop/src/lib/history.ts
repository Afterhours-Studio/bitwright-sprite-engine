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
 * Taking a stroke back.
 *
 * A stroke that cannot be undone makes people afraid to draw, so this is not
 * an extra: it is what allows the tools to be used at all.
 *
 * WHOLE SPRITES, NOT DIFFERENCES. Each entry is the buffer as it was before a
 * stroke. A sprite is small - a 64 by 64 buffer is 16 KiB, and the largest
 * size the parameter panel offers is 1 MiB - and a difference has to be built,
 * stored, and applied in both directions, which is three more places for undo
 * to be subtly wrong. Undo being subtly wrong is worse than it being large.
 *
 * The unit is the stroke, not the pixel. One drag is one entry, however many
 * pixels it covered, because the drag is what the person did.
 *
 * The depth is bounded twice over, by entries and by bytes, and the oldest
 * entries are dropped first. One bound alone is not enough: a cap on entries
 * lets 64 sprites of a megabyte each sit in memory, and a cap on bytes alone
 * lets a tiny sprite keep thousands of steps that no one will ever walk back
 * through.
 */

import { clonePixels, type Pixels } from '@/lib/pixels';

/** How many strokes can be taken back. */
export const MAX_STEPS = 64;

/**
 * How much the taken-back strokes may occupy, in bytes.
 *
 * Thirty-two mebibytes, which is 2000 steps of a 64 pixel sprite and 32 of the
 * largest sprite the parameter panel will make. Redo holds at most what undo
 * gave it, so the pair can reach twice this in the worst case.
 */
export const MAX_BYTES = 32 * 1024 * 1024;

/** Strokes that can be taken back, and strokes that were. */
export interface History {
  /** Snapshots from before each stroke, oldest first. */
  readonly past: readonly Pixels[];
  /** Snapshots undone, newest first, cleared as soon as anything is drawn. */
  readonly future: readonly Pixels[];
}

/** A history with nothing in it. */
export const EMPTY_HISTORY: History = { past: [], future: [] };

/**
 * Records the state a stroke started from.
 *
 * The future is cleared, because drawing after undoing is what makes the
 * strokes that were taken back unreachable: keeping them would offer a redo
 * onto a sprite that no longer leads to them.
 *
 * @param history - The history so far.
 * @param before - The buffer as it was before the stroke.
 * @returns The history with the stroke recorded, trimmed to the bounds.
 */
export function record(history: History, before: Pixels): History {
  return { past: trim([...history.past, before]), future: [] };
}

/**
 * Steps back one stroke.
 *
 * @param history - The history so far.
 * @param current - The buffer as it is now, which becomes the redo entry.
 * @returns The earlier buffer and the history around it, or null when there is
 *   nothing to take back.
 */
export function undo(
  history: History,
  current: Pixels,
): { history: History; pixels: Pixels } | null {
  const previous = history.past.at(-1);
  if (previous === undefined) {
    return null;
  }
  return {
    history: { past: history.past.slice(0, -1), future: [current, ...history.future] },
    // Handed out as a copy, so that the caller drawing on it cannot reach back
    // into an entry the history still holds.
    pixels: clonePixels(previous),
  };
}

/**
 * Steps forward one stroke.
 *
 * @param history - The history so far.
 * @param current - The buffer as it is now, which becomes the undo entry.
 * @returns The later buffer and the history around it, or null when nothing
 *   has been taken back.
 */
export function redo(
  history: History,
  current: Pixels,
): { history: History; pixels: Pixels } | null {
  const [next, ...rest] = history.future;
  if (next === undefined) {
    return null;
  }
  return {
    history: { past: trim([...history.past, current]), future: rest },
    pixels: clonePixels(next),
  };
}

/**
 * Drops the oldest entries until the bounds hold.
 *
 * @param past - The entries, oldest first.
 * @returns The entries that fit.
 */
function trim(past: readonly Pixels[]): Pixels[] {
  let kept = past.slice(Math.max(0, past.length - MAX_STEPS));

  let bytes = kept.reduce((total, entry) => total + entry.data.byteLength, 0);
  // The newest entry is always kept, however large it is: a history holding
  // nothing at all is worse than one over its budget by a single sprite.
  while (kept.length > 1 && bytes > MAX_BYTES) {
    bytes -= kept[0]?.data.byteLength ?? 0;
    kept = kept.slice(1);
  }
  return kept;
}
