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
 * Taking strokes back.
 *
 * The bounds are the part worth checking mechanically: a history that grows
 * without one is a session that ends in a window running out of memory, and
 * that is the kind of fault that only shows up after an hour of work.
 */

import { describe, expect, it } from 'vitest';

import { EMPTY_HISTORY, MAX_STEPS, record, redo, undo } from '@/lib/history';
import { createPixels, pixelAt, writePixel, type Pixels } from '@/lib/pixels';

/**
 * Builds a one pixel sprite holding a recognisable value.
 *
 * @param mark - The red channel, which stands in for a whole sprite's worth of
 *   difference.
 * @returns The buffer.
 */
function marked(mark: number): Pixels {
  const pixels = createPixels(1, 1);
  writePixel(pixels, { x: 0, y: 0 }, [mark, 0, 0, 255], null);
  return pixels;
}

/**
 * Reads back the value {@link marked} wrote.
 *
 * @param pixels - The buffer.
 * @returns The red channel.
 */
function mark(pixels: Pixels): number {
  return pixelAt(pixels, { x: 0, y: 0 })[0];
}

describe('history', () => {
  it('has nothing to take back until something is recorded', () => {
    expect(undo(EMPTY_HISTORY, marked(1))).toBeNull();
    expect(redo(EMPTY_HISTORY, marked(1))).toBeNull();
  });

  it('gives back the state a stroke started from', () => {
    const history = record(EMPTY_HISTORY, marked(1));
    const stepped = undo(history, marked(2));

    expect(stepped).not.toBeNull();
    expect(mark(stepped?.pixels ?? marked(0))).toBe(1);
  });

  it('puts a stroke back after it was taken back', () => {
    const history = record(EMPTY_HISTORY, marked(1));
    const back = undo(history, marked(2));
    expect(back).not.toBeNull();

    const forward = redo(back?.history ?? EMPTY_HISTORY, back?.pixels ?? marked(0));

    expect(mark(forward?.pixels ?? marked(0))).toBe(2);
  });

  it('walks back through several strokes in order', () => {
    let history = record(EMPTY_HISTORY, marked(1));
    history = record(history, marked(2));

    const first = undo(history, marked(3));
    expect(mark(first?.pixels ?? marked(0))).toBe(2);

    const second = undo(first?.history ?? EMPTY_HISTORY, first?.pixels ?? marked(0));
    expect(mark(second?.pixels ?? marked(0))).toBe(1);
  });

  it('forgets what was taken back as soon as something new is drawn', () => {
    const history = record(EMPTY_HISTORY, marked(1));
    const back = undo(history, marked(2));
    const drawn = record(back?.history ?? EMPTY_HISTORY, back?.pixels ?? marked(0));

    expect(drawn.future).toHaveLength(0);
    expect(redo(drawn, marked(3))).toBeNull();
  });

  it('hands out a copy, so drawing on it cannot reach back into the history', () => {
    const history = record(EMPTY_HISTORY, marked(1));
    const stepped = undo(history, marked(2));
    const restored = stepped?.pixels ?? marked(0);

    writePixel(restored, { x: 0, y: 0 }, [9, 0, 0, 255], null);

    const again = redo(stepped?.history ?? EMPTY_HISTORY, restored);
    const back = undo(again?.history ?? EMPTY_HISTORY, again?.pixels ?? marked(0));

    expect(mark(back?.pixels ?? marked(0))).toBe(9);
  });

  it('keeps only the most recent strokes, oldest dropped first', () => {
    let history = EMPTY_HISTORY;
    for (let step = 0; step < MAX_STEPS + 20; step += 1) {
      history = record(history, marked(step % 251));
    }

    expect(history.past).toHaveLength(MAX_STEPS);
    // The oldest entry kept is the one MAX_STEPS back, not the first stroke of
    // the session.
    expect(mark(history.past[0] ?? marked(0))).toBe(20 % 251);
  });

  it('drops entries when they grow past the byte budget, however few there are', () => {
    // Two megapixels each, so a handful of them is already past the budget a
    // whole session is allowed.
    const large = (): Pixels => createPixels(1024, 512);

    let history = EMPTY_HISTORY;
    for (let step = 0; step < MAX_STEPS; step += 1) {
      history = record(history, large());
    }

    expect(history.past.length).toBeLessThan(MAX_STEPS);
    expect(history.past.length).toBeGreaterThan(0);
  });
});
