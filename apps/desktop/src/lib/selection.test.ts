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
 * Selection masks and the region edits a selection shapes.
 *
 * Layers are written as grids of digits so the region each test is about can
 * be seen in the test rather than reconstructed from coordinates.
 */

import { describe, expect, it } from 'vitest';

import {
  clearSelected,
  clipToSelection,
  floodRegion,
  moveSelected,
  rectSelection,
  replaceSlot,
  selectionBounds,
  selectionOutline,
  selects,
  translatedLayer,
  translateSelection,
  wandSelection,
  type LayerPixels,
} from '@/lib/selection';

/**
 * A layer from rows of digits.
 *
 * @param rows - One string per row, one digit per pixel.
 * @returns The buffer.
 */
function grid(...rows: string[]): LayerPixels {
  return {
    width: rows[0]?.length ?? 0,
    height: rows.length,
    data: rows.flatMap((row) => Array.from(row, (digit) => Number(digit))),
  };
}

/**
 * A mask as rows of `#` and `.`, for comparing against a picture.
 *
 * @param mask - The mask.
 * @param width - Its width.
 * @returns One string per row.
 */
function picture(mask: Uint8Array, width: number): string[] {
  const rows: string[] = [];
  for (let start = 0; start < mask.length; start += width) {
    rows.push([...mask.slice(start, start + width)].map((v) => (v ? '#' : '.')).join(''));
  }
  return rows;
}

const CANVAS = { width: 4, height: 3 };

describe('rectSelection', () => {
  it('includes both corners, whichever way the drag went, clipped to the document', () => {
    const selection = rectSelection({ x: 2, y: 5 }, { x: -1, y: 1 }, CANVAS);

    expect(picture(selection.mask, 4)).toEqual(['....', '###.', '###.']);
  });
});

describe('floodRegion and the wand', () => {
  const layer = grid('1102', '0102', '1112');

  it('floods four-connected pixels of the seed slot, as fill_region does', () => {
    const region = floodRegion(layer, { x: 0, y: 0 });

    expect(region && picture(region, 4)).toEqual(['##..', '.#..', '###.']);
  });

  it('does not leave a selection it is held inside', () => {
    const within = rectSelection({ x: 0, y: 0 }, { x: 1, y: 1 }, CANVAS);
    const region = floodRegion(layer, { x: 0, y: 0 }, within);

    expect(region && picture(region, 4)).toEqual(['##..', '.#..', '....']);
    expect(floodRegion(layer, { x: 3, y: 2 }, within)).toBeNull();
  });

  it('selects every pixel of the slot with Shift, connected or not', () => {
    const contiguous = wandSelection(layer, { x: 2, y: 0 }, true);
    const global = wandSelection(layer, { x: 2, y: 0 }, false);

    expect(contiguous && picture(contiguous.mask, 4)).toEqual(['..#.', '..#.', '....']);
    expect(global && picture(global.mask, 4)).toEqual(['..#.', '#.#.', '....']);
    expect(wandSelection(layer, { x: 9, y: 0 }, true)).toBeNull();
  });
});

describe('clipping and bounds', () => {
  const selection = rectSelection({ x: 1, y: 1 }, { x: 2, y: 1 }, CANVAS);

  it('keeps only selected pixels', () => {
    const kept = clipToSelection(
      [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      selection,
    );

    expect(kept).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
    expect(clipToSelection([{ x: 0, y: 0 }], null)).toHaveLength(1);
    expect(selects(selection, -1, 1)).toBe(false);
  });

  it('bounds the selected pixels, and nothing for an empty mask', () => {
    expect(selectionBounds(selection)).toEqual({ x: 1, y: 1, width: 2, height: 1 });
    expect(selectionBounds({ width: 2, height: 1, mask: new Uint8Array(2) })).toBeNull();
  });

  it('outlines a box as four merged runs', () => {
    expect(selectionOutline(selection)).toBe('M1 1H3M1 2H3M1 1V2M3 1V2');
    expect(selectionOutline(selection, { x: 1, y: 0 })).toBe('M2 1H4M2 2H4M2 1V2M4 1V2');
  });

  it('moves a selection and drops what leaves the document', () => {
    const moved = translateSelection(selection, 2, 0);

    expect(picture(moved.mask, 4)).toEqual(['....', '...#', '....']);
  });
});

describe('region edits', () => {
  it('lifts painted pixels and puts them down at the offset', () => {
    const layer = grid('1200', '0000', '0000');
    const selection = rectSelection({ x: 0, y: 0 }, { x: 1, y: 0 }, CANVAS);

    expect(moveSelected(layer, selection, 1, 1)).toEqual([
      { x: 0, y: 0, slot: 0 },
      { x: 1, y: 0, slot: 0 },
      { x: 1, y: 1, slot: 1 },
      { x: 2, y: 1, slot: 2 },
    ]);
  });

  it('carries no transparent pixels, so a move does not punch holes', () => {
    const layer = grid('1030', '0000', '0000');
    const selection = rectSelection({ x: 0, y: 0 }, { x: 1, y: 0 }, CANVAS);

    // The selected transparent pixel at (1, 0) lands on the 3 at (2, 0) and
    // leaves it alone.
    expect(moveSelected(layer, selection, 1, 0)).toEqual([
      { x: 0, y: 0, slot: 0 },
      { x: 1, y: 0, slot: 1 },
    ]);
  });

  it('previews translate exactly as Rust applies it', () => {
    expect(translatedLayer(grid('1000', '0000', '0000'), 1, 0)).toEqual([
      { x: 0, y: 0, slot: 0 },
      { x: 1, y: 0, slot: 1 },
    ]);
  });

  it('clears only the painted pixels a selection holds', () => {
    const layer = grid('1020', '0000', '0000');
    const selection = rectSelection({ x: 0, y: 0 }, { x: 1, y: 0 }, CANVAS);

    expect(clearSelected(layer, selection)).toEqual([{ x: 0, y: 0, slot: 0 }]);
  });

  it('replaces one slot with another across the layer', () => {
    const layer = grid('1210', '0002', '0000');

    expect(replaceSlot(layer, 2, 5)).toEqual([
      { x: 1, y: 0, slot: 5 },
      { x: 3, y: 1, slot: 5 },
    ]);
    expect(replaceSlot(layer, 2, 2)).toEqual([]);
  });
});
