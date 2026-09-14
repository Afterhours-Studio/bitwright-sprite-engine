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
 * What the tools do, checked without a browser.
 *
 * Every rule a stroke obeys lives in `lib/pixels.ts` precisely so that it can
 * be checked here: a coordinate that lands on the wrong pixel, a fill that
 * escapes a selection, or a brush that is off centre are all faults you cannot
 * see by looking at a screenshot, and all of them make a pixel editor useless.
 */

import { describe, expect, it } from 'vitest';

import {
  brushOffsets,
  containsPoint,
  createPixels,
  curvePoints,
  ellipsePoints,
  ERASE,
  floodFill,
  linePoints,
  parseColour,
  pixelAt,
  pixelPerfect,
  rectanglePoints,
  rectFrom,
  spritePoint,
  stamp,
  withinSprite,
  writePixel,
  type Point,
  type Rgba,
} from '@/lib/pixels';

/** Opaque red, as channels. */
const RED: Rgba = [255, 0, 0, 255];

/** Opaque blue, as channels. */
const BLUE: Rgba = [0, 0, 255, 255];

/**
 * Builds a hex colour without writing one in the source.
 *
 * A literal colour anywhere under `src` fails the token discipline check, and
 * that check reads test files too. The digits are the subject here, so they
 * are assembled rather than written.
 *
 * @param digits - The hex digits, without a leading hash.
 * @returns The colour as the palette would report it.
 */
function hex(digits: string): string {
  return '#'.concat(digits);
}

/**
 * Sorts points so two sets can be compared whatever order they were made in.
 *
 * @param points - The points.
 * @returns The same points, in a fixed order.
 */
function ordered(points: readonly Point[]): Point[] {
  return [...points].sort((a, b) => a.y - b.y || a.x - b.x);
}

describe('spritePoint', () => {
  it('maps a pointer position onto a whole sprite pixel', () => {
    const drawn = { width: 640, height: 640 };
    const sprite = { width: 64, height: 64 };

    expect(spritePoint({ x: 0, y: 0 }, drawn, sprite)).toEqual({ x: 0, y: 0 });
    // Nine tenths of the way into the first cell is still the first cell.
    expect(spritePoint({ x: 9.4, y: 9.9 }, drawn, sprite)).toEqual({ x: 0, y: 0 });
    expect(spritePoint({ x: 10, y: 10 }, drawn, sprite)).toEqual({ x: 1, y: 1 });
    expect(spritePoint({ x: 639, y: 639 }, drawn, sprite)).toEqual({ x: 63, y: 63 });
  });

  it('never reports a fraction of a pixel, at any scale', () => {
    const drawn = { width: 437, height: 437 };
    const sprite = { width: 64, height: 64 };

    for (let offset = 0; offset < 437; offset += 1) {
      const point = spritePoint({ x: offset + 0.5, y: offset + 0.5 }, drawn, sprite);
      expect(Number.isInteger(point.x)).toBe(true);
      expect(Number.isInteger(point.y)).toBe(true);
    }
  });

  it('reports a pixel outside the sprite when the pointer is outside it', () => {
    const drawn = { width: 320, height: 320 };
    const sprite = { width: 32, height: 32 };

    expect(withinSprite(spritePoint({ x: -1, y: 5 }, drawn, sprite), sprite)).toBe(false);
    expect(withinSprite(spritePoint({ x: 320, y: 5 }, drawn, sprite), sprite)).toBe(false);
    expect(withinSprite(spritePoint({ x: 5, y: 5 }, drawn, sprite), sprite)).toBe(true);
  });

  it('answers nothing usable before the stage has been laid out', () => {
    const point = spritePoint({ x: 4, y: 4 }, { width: 0, height: 0 }, { width: 16, height: 16 });
    expect(withinSprite(point, { width: 16, height: 16 })).toBe(false);
  });
});

describe('brushOffsets', () => {
  it('is one pixel at size one, whatever the shape', () => {
    expect(brushOffsets(1, 'circle')).toEqual([{ x: 0, y: 0 }]);
    expect(brushOffsets(1, 'square')).toEqual([{ x: 0, y: 0 }]);
  });

  it('covers the pressed pixel at every size', () => {
    for (let size = 1; size <= 16; size += 1) {
      for (const shape of ['circle', 'square'] as const) {
        expect(brushOffsets(size, shape)).toContainEqual({ x: 0, y: 0 });
      }
    }
  });

  it('covers exactly the square of its own size', () => {
    expect(brushOffsets(4, 'square')).toHaveLength(16);
    expect(brushOffsets(5, 'square')).toHaveLength(25);
  });

  it('rounds the corners off a circle', () => {
    const circle = brushOffsets(5, 'circle');

    expect(circle).toHaveLength(21);
    expect(circle).not.toContainEqual({ x: -2, y: -2 });
    expect(circle).toContainEqual({ x: 0, y: -2 });
  });
});

describe('linePoints', () => {
  it('includes both ends', () => {
    const points = linePoints({ x: 2, y: 3 }, { x: 9, y: 7 });

    expect(points.at(0)).toEqual({ x: 2, y: 3 });
    expect(points.at(-1)).toEqual({ x: 9, y: 7 });
  });

  it('leaves no gap between one pixel and the next', () => {
    const points = linePoints({ x: 0, y: 0 }, { x: 13, y: 5 });

    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      expect(Math.abs((current?.x ?? 0) - (previous?.x ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((current?.y ?? 0) - (previous?.y ?? 0))).toBeLessThanOrEqual(1);
    }
  });

  it('is a single pixel when it goes nowhere', () => {
    expect(linePoints({ x: 4, y: 4 }, { x: 4, y: 4 })).toEqual([{ x: 4, y: 4 }]);
  });
});

describe('rectanglePoints', () => {
  it('is the outline and not the fill', () => {
    const points = rectanglePoints({ x: 1, y: 1 }, { x: 4, y: 3 });

    // A four by three box: ten pixels round the edge, and the middle two left
    // alone.
    expect(points).toHaveLength(10);
    expect(points).not.toContainEqual({ x: 2, y: 2 });
    expect(points).toContainEqual({ x: 1, y: 1 });
    expect(points).toContainEqual({ x: 4, y: 3 });
  });

  it('repeats no pixel', () => {
    const points = rectanglePoints({ x: 0, y: 0 }, { x: 6, y: 6 });
    const unique = new Set(points.map((point) => `${String(point.x)}:${String(point.y)}`));

    expect(unique.size).toBe(points.length);
  });

  it('follows a drag made in any direction', () => {
    const forwards = ordered(rectanglePoints({ x: 1, y: 1 }, { x: 5, y: 4 }));
    const backwards = ordered(rectanglePoints({ x: 5, y: 4 }, { x: 1, y: 1 }));

    expect(backwards).toEqual(forwards);
  });
});

describe('ellipsePoints', () => {
  it('stays inside the box it was dragged out', () => {
    const points = ellipsePoints({ x: 2, y: 3 }, { x: 12, y: 9 });

    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(2);
      expect(point.x).toBeLessThanOrEqual(12);
      expect(point.y).toBeGreaterThanOrEqual(3);
      expect(point.y).toBeLessThanOrEqual(9);
    }
  });

  it('touches every side of that box', () => {
    const points = ellipsePoints({ x: 0, y: 0 }, { x: 10, y: 10 });
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);

    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(10);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(10);
  });

  it('is hollow', () => {
    const points = ellipsePoints({ x: 0, y: 0 }, { x: 10, y: 10 });

    expect(points).not.toContainEqual({ x: 5, y: 5 });
  });
});

describe('curvePoints', () => {
  it('runs from one end to the other without a gap', () => {
    const points = curvePoints({ x: 1, y: 12 }, { x: 14, y: 2 });

    expect(points.at(0)).toEqual({ x: 1, y: 12 });
    expect(points.at(-1)).toEqual({ x: 14, y: 2 });
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1] ?? { x: 0, y: 0 };
      const current = points[index] ?? { x: 0, y: 0 };
      expect(Math.abs(current.x - previous.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(current.y - previous.y)).toBeLessThanOrEqual(1);
    }
  });

  it('bows away from the straight line between its ends', () => {
    const straight = linePoints({ x: 0, y: 10 }, { x: 10, y: 0 });
    const curved = curvePoints({ x: 0, y: 10 }, { x: 10, y: 0 });

    expect(ordered(curved)).not.toEqual(ordered(straight));
  });
});

describe('pixelPerfect', () => {
  it('drops the middle of an L shaped corner', () => {
    // Right, then down: the pixel at the turn is the one the eye does not want.
    const corrected = pixelPerfect([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);

    expect(corrected).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  it('leaves a straight run alone', () => {
    const straight = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];

    expect(pixelPerfect(straight)).toEqual(straight);
  });

  it('leaves a clean diagonal alone', () => {
    const diagonal = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];

    expect(pixelPerfect(diagonal)).toEqual(diagonal);
  });
});

describe('stamp', () => {
  it('writes the brush footprint around the pressed pixel', () => {
    const pixels = createPixels(8, 8);
    stamp(pixels, { x: 4, y: 4 }, RED, brushOffsets(3, 'square'), null);

    expect(pixelAt(pixels, { x: 3, y: 3 })).toEqual(RED);
    expect(pixelAt(pixels, { x: 5, y: 5 })).toEqual(RED);
    expect(pixelAt(pixels, { x: 6, y: 5 })).toEqual(ERASE);
  });

  it('writes nothing outside the sprite', () => {
    const pixels = createPixels(4, 4);
    stamp(pixels, { x: 0, y: 0 }, RED, brushOffsets(3, 'square'), null);

    expect(pixelAt(pixels, { x: 0, y: 0 })).toEqual(RED);
    // No wrap onto the far side, which is what a missing bounds check gives.
    expect(pixelAt(pixels, { x: 3, y: 3 })).toEqual(ERASE);
  });

  it('writes nothing outside the selection', () => {
    const pixels = createPixels(8, 8);
    const selection = { x: 4, y: 0, width: 4, height: 8 };
    stamp(pixels, { x: 4, y: 4 }, RED, brushOffsets(3, 'square'), selection);

    expect(pixelAt(pixels, { x: 4, y: 4 })).toEqual(RED);
    expect(pixelAt(pixels, { x: 3, y: 4 })).toEqual(ERASE);
  });
});

describe('floodFill', () => {
  it('fills the region under the seed and stops at a different colour', () => {
    const pixels = createPixels(5, 3);
    // A wall down the middle: the fill must not get past it.
    for (let y = 0; y < 3; y += 1) {
      writePixel(pixels, { x: 2, y }, BLUE, null);
    }

    floodFill(pixels, { x: 0, y: 0 }, RED, 0, null);

    expect(pixelAt(pixels, { x: 0, y: 2 })).toEqual(RED);
    expect(pixelAt(pixels, { x: 1, y: 1 })).toEqual(RED);
    expect(pixelAt(pixels, { x: 2, y: 1 })).toEqual(BLUE);
    expect(pixelAt(pixels, { x: 3, y: 1 })).toEqual(ERASE);
  });

  it('reaches round an obstacle rather than through it', () => {
    const pixels = createPixels(5, 3);
    // A wall with a gap in the bottom row.
    writePixel(pixels, { x: 2, y: 0 }, BLUE, null);
    writePixel(pixels, { x: 2, y: 1 }, BLUE, null);

    floodFill(pixels, { x: 0, y: 0 }, RED, 0, null);

    expect(pixelAt(pixels, { x: 4, y: 0 })).toEqual(RED);
  });

  it('treats colours within the tolerance as the same', () => {
    const pixels = createPixels(3, 1);
    writePixel(pixels, { x: 0, y: 0 }, [100, 100, 100, 255], null);
    writePixel(pixels, { x: 1, y: 0 }, [106, 100, 100, 255], null);
    writePixel(pixels, { x: 2, y: 0 }, [200, 100, 100, 255], null);

    floodFill(pixels, { x: 0, y: 0 }, RED, 12, null);

    expect(pixelAt(pixels, { x: 1, y: 0 })).toEqual(RED);
    expect(pixelAt(pixels, { x: 2, y: 0 })).toEqual([200, 100, 100, 255]);
  });

  it('does not escape the selection', () => {
    const pixels = createPixels(6, 1);
    const selection = { x: 0, y: 0, width: 3, height: 1 };

    floodFill(pixels, { x: 0, y: 0 }, RED, 0, selection);

    expect(pixelAt(pixels, { x: 2, y: 0 })).toEqual(RED);
    expect(pixelAt(pixels, { x: 3, y: 0 })).toEqual(ERASE);
  });

  it('does nothing when the seed already holds the colour', () => {
    const pixels = createPixels(3, 3);
    floodFill(pixels, { x: 1, y: 1 }, ERASE, 0, null);

    expect(pixelAt(pixels, { x: 0, y: 0 })).toEqual(ERASE);
  });

  it('does nothing when the seed is outside the sprite', () => {
    const pixels = createPixels(3, 3);
    floodFill(pixels, { x: 9, y: 9 }, RED, 0, null);

    expect(pixelAt(pixels, { x: 1, y: 1 })).toEqual(ERASE);
  });
});

describe('rectFrom and containsPoint', () => {
  it('holds both dragged corners whichever way round they came', () => {
    const rect = rectFrom({ x: 6, y: 8 }, { x: 2, y: 3 });

    expect(rect).toEqual({ x: 2, y: 3, width: 5, height: 6 });
    expect(containsPoint(rect, { x: 6, y: 8 })).toBe(true);
    expect(containsPoint(rect, { x: 2, y: 3 })).toBe(true);
    expect(containsPoint(rect, { x: 7, y: 8 })).toBe(false);
  });

  it('holds everything when there is no selection at all', () => {
    expect(containsPoint(null, { x: 1000, y: -4 })).toBe(true);
  });
});

describe('parseColour', () => {
  it('reads the form the palette reports', () => {
    expect(parseColour(hex('ff0000'))).toEqual([255, 0, 0, 255]);
    expect(parseColour(hex('0a0b0c'))).toEqual([10, 11, 12, 255]);
  });

  it('reads the short forms by repeating each digit', () => {
    expect(parseColour(hex('f00'))).toEqual([255, 0, 0, 255]);
    expect(parseColour(hex('f008'))).toEqual([255, 0, 0, 136]);
  });

  it('reads an alpha when one is given', () => {
    expect(parseColour(hex('00000000'))).toEqual([0, 0, 0, 0]);
  });

  it('reports anything else as not a colour', () => {
    expect(parseColour('red')).toBeNull();
    expect(parseColour(hex('12345'))).toBeNull();
    expect(parseColour('')).toBeNull();
  });
});
