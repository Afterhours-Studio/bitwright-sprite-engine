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
 * The client shape rasteriser, which must land where Rust's does.
 *
 * The expected pixels are worked by hand from `raw_shape_points` in
 * `src-tauri/src/raster/ops.rs` and the `Shape::Curve` arm of `figure` in
 * `raster/document_ops.rs`, so a drift between the port and the original shows
 * up here rather than as a preview that disagrees with the stroke it previews.
 */

import { describe, expect, it } from 'vitest';

import { shapePoints } from '@/lib/shapes';

const CANVAS = { width: 16, height: 16 };

describe('shapePoints', () => {
  it('draws a line as Bresenham from end to end', () => {
    expect(shapePoints('line', { x: 0, y: 0 }, { x: 3, y: 1 }, false, CANVAS)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]);
  });

  it('draws the curve Rust draws: a cubic elbow through the start row corner', () => {
    // Control (3, 0); handles (2, 0) and (3, 1); ten samples; the two corner
    // pixels (2, 0) and (3, 1) are removed by the pixel-perfect pass.
    expect(shapePoints('curve', { x: 0, y: 0 }, { x: 3, y: 3 }, false, CANVAS)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 1 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
    ]);
  });

  it('outlines a rectangle as its inner boundary and fills it on request', () => {
    const outline = shapePoints('rect', { x: 1, y: 1 }, { x: 4, y: 3 }, false, CANVAS);
    const filled = shapePoints('rect', { x: 4, y: 3 }, { x: 1, y: 1 }, true, CANVAS);

    expect(outline).toHaveLength(10);
    expect(outline).not.toContainEqual({ x: 2, y: 2 });
    expect(filled).toHaveLength(12);
  });

  it('draws an ellipse symmetric about its box centre', () => {
    const points = shapePoints('ellipse', { x: 0, y: 0 }, { x: 6, y: 4 }, false, CANVAS);
    const keys = new Set(points.map((point) => `${String(point.x)},${String(point.y)}`));

    for (const point of points) {
      expect(keys.has(`${String(6 - point.x)},${String(point.y)}`)).toBe(true);
      expect(keys.has(`${String(point.x)},${String(4 - point.y)}`)).toBe(true);
    }
    // The corners of the box are outside an ellipse.
    expect(keys.has('0,0')).toBe(false);
    expect(keys.has('3,0')).toBe(true);
  });

  it('is one pixel for a one pixel drag, whatever the figure', () => {
    for (const shape of ['line', 'curve', 'rect', 'ellipse'] as const) {
      expect(shapePoints(shape, { x: 5, y: 5 }, { x: 5, y: 5 }, false, CANVAS)).toEqual([
        { x: 5, y: 5 },
      ]);
    }
  });

  it('never returns a pixel off the document', () => {
    const points = shapePoints('line', { x: -4, y: 2 }, { x: 20, y: 2 }, false, CANVAS);

    expect(points).toHaveLength(16);
    expect(points.every((point) => point.x >= 0 && point.x < 16)).toBe(true);
  });
});
