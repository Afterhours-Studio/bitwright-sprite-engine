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
 * The geometry a freehand stroke is made of.
 *
 * Everything here works on the document's own grid: a 48 by 64 sprite has 48
 * by 64 addressable pixels however large it is drawn on screen, and a stroke
 * lands on whole ones or on none. That is the whole reason these functions
 * exist rather than the canvas being painted with `lineTo`: a canvas path is
 * antialiased and happily covers a third of a pixel, which is the one thing a
 * pixel editor must never do.
 *
 * WHAT IS NOT HERE ANY MORE, and why. This file used to hold a whole raster
 * engine - flood fill, rectangles, ellipses, curves, a buffer type and a
 * stamping routine - because the editor painted RGBA pixels in the browser.
 * The document model moved every one of those into Rust, behind `fill_region`
 * and `draw_shape`, and a second implementation of them here would be a second
 * answer to the same question: an agent's sprite and a person's sprite could
 * then differ by who drew them. What is left is the part no op has an argument
 * for - the path a hand actually took between two pointer reports, and the
 * footprint of the brush that walked it - which has to be resolved here before
 * it can be sent as one `set_pixels` op. The same goes for the few per-pixel
 * rules a freehand tool applies on the way: its mirror images, the dither's
 * checker, and the one ramp step lighten and darken take. The fill and the
 * shapes come back on this side only where a selection has to clip them (and
 * for the preview), and live in `lib/selection.ts` and `lib/shapes.ts`,
 * ported from Rust so the two agree.
 *
 * NO DOM. Nothing in this file touches a canvas, an element, or an event, so
 * every rule a stroke obeys can be tested without a browser.
 */

/** A position on the sprite's grid, in whole sprite pixels. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Builds the footprint a brush lays down, as offsets from its centre.
 *
 * The centre of an even sized brush cannot be a pixel, so it sits on the pixel
 * after the middle: a brush of size `n` runs from `-floor((n - 1) / 2)` to
 * `+floor(n / 2)`. That is what every editor does, and it is what makes a size
 * two brush cover the pixel that was pressed rather than the one before it.
 *
 * @param size - How many sprite pixels across the brush is.
 * @param shape - Circle or square.
 * @returns The offsets, which a caller adds to the pressed pixel.
 */
export function brushOffsets(size: number, shape: 'circle' | 'square'): Point[] {
  const width = Math.max(1, Math.round(size));
  const before = Math.floor((width - 1) / 2);
  const after = Math.floor(width / 2);

  const offsets: Point[] = [];
  // Measured from the brush's true centre, which for an even width falls on a
  // pixel boundary. Taking it from the middle pixel instead makes an even
  // circle lopsided: one side gets a row the other does not.
  const centre = (after - before) / 2;
  const radius = width / 2;

  // Counted from zero and shifted, rather than run from `-before`: negating a
  // zero produces a negative zero, which compares equal to zero and prints as
  // a different value, and the offsets are compared in tests and in sets.
  for (let row = 0; row < width; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const x = column - before;
      const y = row - before;
      if (shape === 'square') {
        offsets.push({ x, y });
        continue;
      }
      const dx = x - centre;
      const dy = y - centre;
      // Against the radius squared, so no square root is taken per pixel, and
      // measured from each pixel's centre, which is what the half is.
      if (dx * dx + dy * dy <= radius * radius) {
        offsets.push({ x, y });
      }
    }
  }
  return offsets;
}

/**
 * The pixels a straight line between two points covers.
 *
 * Bresenham, in the form that handles every octant without special cases. Both
 * ends are included, so a caller joining a run of points has to drop the first
 * of each segment to avoid stamping a join twice; with an opaque colour that
 * costs nothing, which is why nothing here does it.
 *
 * @param from - One end.
 * @param to - The other.
 * @returns The pixels, in order, from `from` to `to`.
 */
export function linePoints(from: Point, to: Point): Point[] {
  const dx = Math.abs(to.x - from.x);
  const dy = -Math.abs(to.y - from.y);
  const stepX = from.x < to.x ? 1 : -1;
  const stepY = from.y < to.y ? 1 : -1;

  let error = dx + dy;
  let x = from.x;
  let y = from.y;

  const points: Point[] = [];
  for (;;) {
    points.push({ x, y });
    if (x === to.x && y === to.y) {
      return points;
    }
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += stepX;
    }
    if (doubled <= dx) {
      error += dx;
      y += stepY;
    }
  }
}

/**
 * Drops the redundant middle of every corner in a freehand stroke.
 *
 * A stroke drawn by hand leaves an L wherever a diagonal changes direction:
 * three pixels where the eye wants two. The condition is the one Aseprite and
 * LibreSprite both use, on the last three points of the stroke - when the
 * first and the last are diagonal neighbours, and each is orthogonally
 * adjacent to the middle one, the middle one is what makes the corner and it
 * goes.
 *
 * Applied to the whole stroke each time it is redrawn rather than incrementally
 * as the pointer moves, because the editor redraws every stroke from the buffer
 * it started with; there is nothing to un-draw, which is the part that makes
 * the incremental form awkward.
 *
 * @param points - The stroke, in order.
 * @returns The stroke with its corner pixels removed.
 */
export function pixelPerfect(points: readonly Point[]): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    kept.push(point);
    const last = kept.length - 1;
    const a = kept[last - 2];
    const b = kept[last - 1];
    const c = kept[last];
    if (a === undefined || b === undefined || c === undefined) {
      continue;
    }
    if (orthogonal(a, b) && orthogonal(b, c) && diagonal(a, c)) {
      kept.splice(last - 1, 1);
    }
  }
  return kept;
}

/**
 * Reports whether two pixels share an edge.
 *
 * @param a - One pixel.
 * @param b - The other.
 * @returns True when they are side by side or one above the other.
 */
function orthogonal(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

/**
 * Reports whether two pixels share only a corner.
 *
 * @param a - One pixel.
 * @param b - The other.
 * @returns True when they touch diagonally.
 */
function diagonal(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) === 1 && Math.abs(a.y - b.y) === 1;
}

/** Which axes a stroke is mirrored about, through the canvas centre. */
export type SymmetryAxes = 'off' | 'horizontal' | 'vertical' | 'both';

/**
 * A point and its mirror images about the canvas centre.
 *
 * `horizontal` mirrors left to right - the axis is the vertical centre line -
 * because that is the symmetry a character facing the viewer has, and it is
 * what the panel's split-square icon draws. The mirror of column `x` is
 * `width - 1 - x`, so on an even canvas the axis falls between two columns and
 * on an odd one it runs down the middle column, which mirrors onto itself.
 *
 * @param point - The pixel the brush landed on.
 * @param axes - Which mirrors are on.
 * @param canvas - The document's size.
 * @returns The point first, then its images; repeats are left to the caller,
 *   which already drops them.
 */
export function mirrorPoints(
  point: Point,
  axes: SymmetryAxes,
  canvas: { width: number; height: number },
): Point[] {
  const across = canvas.width - 1 - point.x;
  const down = canvas.height - 1 - point.y;
  switch (axes) {
    case 'off':
      return [point];
    case 'horizontal':
      return [point, { x: across, y: point.y }];
    case 'vertical':
      return [point, { x: point.x, y: down }];
    case 'both':
      return [point, { x: across, y: point.y }, { x: point.x, y: down }, { x: across, y: down }];
  }
}

/**
 * The slot the checker dither writes at a pixel.
 *
 * Decided by the pixel's own position rather than by the order the stroke
 * reached it, so a stroke that crosses an earlier one continues its checker
 * instead of starting a second, out-of-phase one beside it.
 *
 * @param point - The pixel.
 * @param even - The slot for cells where `x + y` is even.
 * @param odd - The slot for the rest.
 * @returns The slot to write.
 */
export function ditherSlot(point: Point, even: number, odd: number): number {
  return (point.x + point.y) % 2 === 0 ? even : odd;
}

/**
 * The slot one step along a slot's ramp.
 *
 * Ramps are listed darkest first, so lighter is one index on. A slot that is
 * in no ramp, or already at the end the step is heading for, has nowhere to go
 * and is reported as null rather than as itself, which lets the caller leave
 * the pixel out of the batch instead of rewriting it with what it already is.
 *
 * @param slot - The slot a pixel is painted with.
 * @param ramps - The palette's ramps.
 * @param direction - `1` to lighten, `-1` to darken.
 * @returns The slot to write, or null to leave the pixel alone.
 */
export function rampStep(
  slot: number,
  ramps: readonly { slots: readonly number[] }[],
  direction: 1 | -1,
): number | null {
  if (slot === 0) {
    return null;
  }
  for (const ramp of ramps) {
    const index = ramp.slots.indexOf(slot);
    if (index === -1) {
      continue;
    }
    return ramp.slots[index + direction] ?? null;
  }
  return null;
}
