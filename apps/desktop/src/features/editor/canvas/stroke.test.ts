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
 * What a drag turns into on the wire.
 *
 * A stroke is one batch, because the batch is the undo entry. A pencil stroke
 * that arrived as three hundred single-pixel writes would take three hundred
 * presses of undo to take back, and nothing on screen would say so - which is
 * why the shape of the batch is asserted on here rather than left to be
 * noticed by whoever first tries to undo a line.
 */

import { describe, expect, it } from 'vitest';

import { strokeOps, strokePixels, TRANSPARENT, type Stroke } from '@/features/editor/canvas/stroke';
import type { Point } from '@/types/document';

const CANVAS = { width: 16, height: 16 };

/**
 * A drag, with everything but the interesting part left at its default.
 *
 * @param over - What this particular stroke differs by.
 * @returns A whole stroke.
 */
function stroke(over: Partial<Stroke>): Stroke {
  return {
    tool: 'pencil',
    shape: 'rectangle',
    layer: 'flats',
    slot: 7,
    brushSize: 1,
    brushShape: 'circle',
    points: [{ x: 2, y: 2 }],
    canvas: CANVAS,
    ...over,
  };
}

describe('strokePixels', () => {
  it('joins the gaps between the positions a pointer reported', () => {
    // A hand moves faster than the pointer reports, so consecutive reports are
    // joined with a line. Without it a quick stroke is a row of dots.
    const pixels = strokePixels(
      stroke({
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
        ],
      }),
    );

    expect(pixels.map((pixel) => pixel.x)).toEqual([0, 1, 2, 3, 4]);
    expect(pixels.every((pixel) => pixel.y === 0 && pixel.slot === 7)).toBe(true);
  });

  it('writes each pixel once, however often the stroke crossed it', () => {
    const pixels = strokePixels(
      stroke({
        points: [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 0, y: 0 },
        ],
      }),
    );

    expect(pixels).toHaveLength(4);
  });

  it('erases with index zero rather than with the chosen slot', () => {
    const pixels = strokePixels(stroke({ tool: 'eraser', slot: 7 }));

    expect(pixels).toEqual([{ x: 2, y: 2, slot: TRANSPARENT }]);
  });

  it('stamps the brush footprint at sizes above one', () => {
    const pixels = strokePixels(stroke({ brushSize: 3, brushShape: 'square' }));

    expect(pixels).toHaveLength(9);
    expect(pixels).toContainEqual({ x: 1, y: 1, slot: 7 });
    expect(pixels).toContainEqual({ x: 3, y: 3, slot: 7 });
  });

  it('clips to the document rather than sending pixels that do not exist', () => {
    const pixels = strokePixels(
      stroke({ points: [{ x: 0, y: 0 }], brushSize: 3, brushShape: 'square' }),
    );

    // The footprint's top and left rows fall off the canvas; four pixels of it
    // are on it. A write naming a pixel outside the buffer is
    // `document.invalid_buffer`, which would lose the whole batch.
    expect(pixels).toHaveLength(4);
    expect(pixels.every((pixel) => pixel.x >= 0 && pixel.y >= 0)).toBe(true);
  });

  it('drops the redundant corner of a diagonal at a one pixel brush', () => {
    const corner: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ];

    expect(strokePixels(stroke({ points: corner }))).toHaveLength(2);
    // A wider brush covers the pixel the rule would remove, so running it there
    // would thin the stroke rather than clean it.
    expect(strokePixels(stroke({ points: corner, brushSize: 2 })).length).toBeGreaterThan(2);
  });
});

describe('strokeOps', () => {
  it('sends a freehand stroke as one set_pixels op', () => {
    const ops = strokeOps(
      stroke({
        points: [
          { x: 1, y: 1 },
          { x: 1, y: 5 },
        ],
      }),
    );

    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'set_pixels', layer: 'flats' });
    expect(ops[0]?.kind === 'set_pixels' && ops[0].pixels).toHaveLength(5);
  });

  it('sends a bucket as one fill_region seeded where the press landed', () => {
    // Not where the pointer ended up: a bucket is a click, and a hand that
    // drifted two pixels during it did not mean a different seed.
    const ops = strokeOps(
      stroke({
        tool: 'fill',
        points: [
          { x: 3, y: 4 },
          { x: 5, y: 6 },
        ],
      }),
    );

    expect(ops).toEqual([
      { kind: 'fill_region', layer: 'flats', x: 3, y: 4, slot: 7, contiguous: true },
    ]);
  });

  it('sends a shape as one draw_shape, in the op vocabulary', () => {
    const ops = strokeOps(
      stroke({
        tool: 'shape',
        shape: 'rectangle',
        points: [
          { x: 1, y: 1 },
          { x: 9, y: 9 },
        ],
      }),
    );

    // The interface says `rectangle`, because that is what a person calls it;
    // the op says `rect`, because that is what Rust's enum serialises.
    expect(ops).toEqual([
      {
        kind: 'draw_shape',
        layer: 'flats',
        shape: 'rect',
        from: { x: 1, y: 1 },
        to: { x: 9, y: 9 },
        slot: 7,
        pixelPerfect: true,
      },
    ]);
  });

  it('writes to the layer it was given and to no other', () => {
    const ops = strokeOps(stroke({ layer: 'shadow-deep' }));

    expect(ops[0]).toMatchObject({ layer: 'shadow-deep' });
  });

  it('sends nothing at all for a drag that landed on nothing', () => {
    // An empty batch comes back as `document.invalid_batch`, which would report
    // a failure for a stroke that was never made.
    expect(strokeOps(stroke({ points: [] }))).toEqual([]);
    expect(strokeOps(stroke({ points: [{ x: -4, y: -4 }] }))).toEqual([]);
    expect(strokeOps(stroke({ tool: 'fill', points: [{ x: 99, y: 99 }] }))).toEqual([]);
  });
});
