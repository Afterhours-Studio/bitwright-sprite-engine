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
 * The pixels a shape tool covers, computed the way Rust computes them.
 *
 * WHY A SECOND RASTERISER EXISTS AT ALL. Without a selection a shape is sent
 * as `draw_shape` and Rust rasterises it, which keeps the pixels an agent and a
 * person get from the same drag identical. Two things need the pixels on this
 * side as well: the preview drawn while the button is still down, and a shape
 * drawn inside a selection, which has to be clipped before it is sent and so
 * goes out as `set_pixels`. Both are only right if they land exactly where
 * Rust would have, so this is a port of `raw_shape_points` in
 * `src-tauri/src/raster/ops.rs` and of the `Shape::Curve` arm of `figure` in
 * `raster/document_ops.rs`, line for line, including their rounding.
 *
 * NO DOM, so the agreement is asserted in unit tests rather than eyeballed.
 */

import { linePoints, pixelPerfect, type Point } from '@/lib/pixels';

/** The figure, in the op's own names for them. */
export type ShapeKind = 'line' | 'rect' | 'ellipse' | 'curve';

/** A document's size, in document pixels. */
export interface ShapeCanvas {
  width: number;
  height: number;
}

/**
 * Rounds half away from zero, which is what Rust's `f64::round` does.
 *
 * `Math.round` rounds half toward positive infinity instead, and the two part
 * company at every negative half - which a curve's samples reach whenever an
 * endpoint is dragged off the left or top edge.
 *
 * @param value - The number to round.
 * @returns The nearest integer, ties away from zero.
 */
function roundHalfAway(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Rust's `pixel_perfect`: the TypeScript one, after dropping repeats.
 *
 * Rust skips a point equal to the last one it kept before testing the corner
 * rule, and the curve relies on that because each sampled segment starts on
 * the pixel the previous one ended on. Dropping consecutive repeats first is
 * the same thing, because the last point kept is always the last one seen.
 *
 * @param points - The path, in order.
 * @returns The path with repeats and corner pixels removed.
 */
function pixelPerfectDeduped(points: readonly Point[]): Point[] {
  const unique: Point[] = [];
  for (const point of points) {
    const last = unique[unique.length - 1];
    if (last === undefined || last.x !== point.x || last.y !== point.y) {
      unique.push(point);
    }
  }
  return pixelPerfect(unique);
}

/**
 * A pixel-perfect Bresenham line, as Rust's `line` makes it.
 *
 * @param from - One end.
 * @param to - The other.
 * @returns The line's pixels, in order.
 */
function line(from: Point, to: Point): Point[] {
  return pixelPerfectDeduped(linePoints(from, to));
}

/**
 * The curve `draw_shape` draws between two points.
 *
 * The op carries endpoints but no handles, so Rust takes the corner of their
 * bounding box that shares the start's row as a quadratic control and raises
 * it to a cubic whose handles sit two thirds of the way from each end to it.
 * The handles are truncated toward zero, which is what Rust's integer division
 * does; the samples are rounded half away from zero, which is what its
 * `round` does. Two samples per pixel of the control polygon's length keep the
 * flattened curve from skipping a pixel however tightly it turns.
 *
 * @param from - Where the drag began.
 * @param to - Where it ended.
 * @returns The curve's pixels, in order, before clipping.
 */
function curve(from: Point, to: Point): Point[] {
  const control = { x: to.x, y: from.y };
  const handle = (p: Point): Point => ({
    x: Math.trunc((p.x + 2 * control.x) / 3),
    y: Math.trunc((p.y + 2 * control.y) / 3),
  });
  const a = handle(from);
  const b = handle(to);

  const polygon = [from, a, b, to];
  let span = 0;
  for (let index = 1; index < polygon.length; index += 1) {
    const p = polygon[index - 1] as Point;
    const q = polygon[index] as Point;
    span += Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y));
  }
  const steps = Math.max(span, 1) * 2;

  const component = (p: number, q: number, r: number, s: number, t: number): number => {
    const u = 1 - t;
    return roundHalfAway(u * u * u * p + 3 * u * u * t * q + 3 * u * t * t * r + t * t * t * s);
  };

  const points: Point[] = [];
  let previous = from;
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const next = {
      x: component(from.x, a.x, b.x, to.x, t),
      y: component(from.y, a.y, b.y, to.y, t),
    };
    points.push(...line(previous, next));
    previous = next;
  }
  return pixelPerfectDeduped(points);
}

/**
 * A rectangle or an ellipse, outlined or filled, inside the box two corners
 * span.
 *
 * Rust does not trace either figure. It scans the box and keeps each pixel
 * that is inside the figure and - for an outline - has a four-neighbour that is
 * not, so the outline is exactly the figure's inner boundary and the filled
 * form is exactly its inside. The ellipse test is against the box's centre and
 * half-extents measured in whole pixels, so a drag of one pixel is one pixel.
 *
 * @param from - One corner.
 * @param to - The opposite corner.
 * @param ellipse - True for an ellipse, false for a rectangle.
 * @param filled - True to keep the inside as well as the boundary.
 * @param canvas - The document's size; the scan never leaves it.
 * @returns The figure's pixels, row by row.
 */
function box(
  from: Point,
  to: Point,
  ellipse: boolean,
  filled: boolean,
  canvas: ShapeCanvas,
): Point[] {
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y, to.y);
  const rx = (right - left + 1) / 2;
  const ry = (bottom - top + 1) / 2;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;

  const inside = (x: number, y: number): boolean => {
    if (x < left || x > right || y < top || y > bottom) {
      return false;
    }
    if (!ellipse) {
      return true;
    }
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  };

  const points: Point[] = [];
  for (let y = Math.max(top, 0); y <= Math.min(bottom, canvas.height - 1); y += 1) {
    for (let x = Math.max(left, 0); x <= Math.min(right, canvas.width - 1); x += 1) {
      if (!inside(x, y)) {
        continue;
      }
      if (
        filled ||
        !inside(x - 1, y) ||
        !inside(x + 1, y) ||
        !inside(x, y - 1) ||
        !inside(x, y + 1)
      ) {
        points.push({ x, y });
      }
    }
  }
  return points;
}

/**
 * Every document pixel a shape covers, clipped to the document.
 *
 * Always the pixel-perfect form, because that is what the stage sends
 * (`pixelPerfect: true`) and the only form it ever previews.
 *
 * @param shape - The figure.
 * @param from - Where the drag began.
 * @param to - Where it ended.
 * @param fill - Whether a rectangle or an ellipse is filled. Ignored by the
 *   line and the curve, which have no inside.
 * @param canvas - The document's size.
 * @returns The pixels, each once, all on the document.
 */
export function shapePoints(
  shape: ShapeKind,
  from: Point,
  to: Point,
  fill: boolean,
  canvas: ShapeCanvas,
): Point[] {
  let points: Point[];
  switch (shape) {
    case 'line':
      points = line(from, to);
      break;
    case 'curve':
      points = curve(from, to);
      break;
    case 'rect':
      return box(from, to, false, fill, canvas);
    case 'ellipse':
      return box(from, to, true, fill, canvas);
  }

  // A path can cross itself and can run off the document; Rust's writes are
  // keyed by pixel and bounds-checked, so a repeat or an off-canvas point
  // lands nowhere. The same is done here so the pixel list is what lands.
  const seen = new Set<number>();
  const clipped: Point[] = [];
  for (const point of points) {
    if (point.x < 0 || point.y < 0 || point.x >= canvas.width || point.y >= canvas.height) {
      continue;
    }
    const key = point.y * canvas.width + point.x;
    if (!seen.has(key)) {
      seen.add(key);
      clipped.push(point);
    }
  }
  return clipped;
}
