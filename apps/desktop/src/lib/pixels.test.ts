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
 * What a freehand stroke covers, checked without a browser.
 *
 * Every rule a stroke obeys lives in `lib/pixels.ts` precisely so that it can
 * be checked here: a brush that is off centre, a line that leaves a gap, or a
 * corner that keeps its redundant pixel are all faults you cannot see in a
 * screenshot, and all of them make a pixel editor useless.
 */

import { describe, expect, it } from 'vitest';

import {
  brushOffsets,
  ditherSlot,
  linePoints,
  mirrorPoints,
  pixelPerfect,
  rampStep,
} from '@/lib/pixels';

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

describe('mirrorPoints', () => {
  const canvas = { width: 8, height: 5 };

  it('mirrors about the canvas centre on the chosen axes', () => {
    const point = { x: 1, y: 1 };

    expect(mirrorPoints(point, 'off', canvas)).toEqual([point]);
    expect(mirrorPoints(point, 'horizontal', canvas)).toEqual([point, { x: 6, y: 1 }]);
    expect(mirrorPoints(point, 'vertical', canvas)).toEqual([point, { x: 1, y: 3 }]);
    expect(mirrorPoints(point, 'both', canvas)).toEqual([
      point,
      { x: 6, y: 1 },
      { x: 1, y: 3 },
      { x: 6, y: 3 },
    ]);
  });

  it('maps the middle row of an odd canvas onto itself', () => {
    expect(mirrorPoints({ x: 0, y: 2 }, 'vertical', canvas)).toEqual([
      { x: 0, y: 2 },
      { x: 0, y: 2 },
    ]);
  });
});

describe('ditherSlot', () => {
  it('writes the first slot on even cells and the second on odd ones', () => {
    expect(ditherSlot({ x: 0, y: 0 }, 3, 5)).toBe(3);
    expect(ditherSlot({ x: 1, y: 0 }, 3, 5)).toBe(5);
    expect(ditherSlot({ x: 1, y: 1 }, 3, 5)).toBe(3);
  });
});

describe('rampStep', () => {
  const ramps = [{ slots: [4, 5, 6] }, { slots: [10, 11] }];

  it('moves one step toward the light end or the dark end', () => {
    expect(rampStep(5, ramps, 1)).toBe(6);
    expect(rampStep(5, ramps, -1)).toBe(4);
    expect(rampStep(11, ramps, -1)).toBe(10);
  });

  it('has nowhere to go past either end, off every ramp, or on transparent', () => {
    expect(rampStep(6, ramps, 1)).toBeNull();
    expect(rampStep(4, ramps, -1)).toBeNull();
    expect(rampStep(9, ramps, 1)).toBeNull();
    expect(rampStep(0, ramps, 1)).toBeNull();
  });
});
