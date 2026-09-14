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
 * What a drawing tool is made of.
 *
 * Everything here works on the sprite's own grid: a 64 by 64 sprite has 64 by
 * 64 addressable pixels however large it is drawn on screen, and a stroke
 * lands on whole ones or on none. That is the whole reason these functions
 * exist rather than the canvas being painted with `lineTo`: a canvas path is
 * antialiased and happily covers a third of a pixel, which is the one thing a
 * pixel editor must never do.
 *
 * NO DOM. Nothing in this file touches a canvas, an element, or an event, so
 * every rule the tools obey can be tested without a browser. The encoding and
 * decoding that does need a canvas lives in `lib/png.ts`, and the pointer
 * handling in the surface component.
 *
 * Buffers are laid out exactly as `ImageData` is - row major, four bytes per
 * pixel, red first - so one can be handed to `putImageData` without a copy.
 */

/** A position on the sprite's grid, in whole sprite pixels. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A region of the sprite's grid, in whole sprite pixels. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One colour, each channel from 0 to 255. */
export type Rgba = readonly [number, number, number, number];

/** A sprite, as pixels rather than as encoded bytes. */
export interface Pixels {
  readonly width: number;
  readonly height: number;
  /**
   * Row major RGBA, four bytes per pixel.
   *
   * Narrowed to a buffer that is not shared, which is exactly the type
   * `ImageData` is built from. Leaving it as the wider default would mean a
   * copy at every handover to a canvas, on a path that runs on every pointer
   * move.
   */
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * What the eraser writes.
 *
 * All four channels, not just alpha. A pixel left with its colour and an alpha
 * of zero still carries that colour into anything that later reads it back -
 * the palette report, a flood fill, an image scaled by anything other than
 * nearest neighbour - so erasing clears the lot.
 */
export const ERASE: Rgba = [0, 0, 0, 0];

/**
 * How far a colour may be from the one under the cursor and still be flooded.
 *
 * The same figure, and the same per channel measure, as the engine's
 * background removal uses for its corner fill. Two parts of one application
 * disagreeing about what counts as the same colour is worse than either
 * number being slightly wrong.
 */
export const FILL_TOLERANCE = 12;

/**
 * Reads one channel.
 *
 * `noUncheckedIndexedAccess` types every index read as possibly absent, which
 * a typed array is not within its own length. It is unpacked here, once,
 * rather than guarded at each of the four channels of every pixel.
 *
 * @param data - The buffer.
 * @param offset - Byte offset to read.
 * @returns The channel value, or 0 when the offset is outside the buffer.
 */
function channel(data: Uint8ClampedArray<ArrayBuffer>, offset: number): number {
  return data[offset] ?? 0;
}

/**
 * Builds an empty, fully transparent buffer.
 *
 * @param width - Width in sprite pixels.
 * @param height - Height in sprite pixels.
 * @returns The buffer.
 */
export function createPixels(width: number, height: number): Pixels {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/**
 * Copies a buffer.
 *
 * Every operation here writes into a buffer the caller owns, and the editor
 * works by cloning before each change: that is what makes an undo snapshot,
 * and what lets a shape be redrawn from scratch on every pointer move without
 * the previous preview still being on the sprite.
 *
 * @param pixels - The buffer to copy.
 * @returns An independent copy.
 */
export function clonePixels(pixels: Pixels): Pixels {
  return {
    width: pixels.width,
    height: pixels.height,
    data: new Uint8ClampedArray(pixels.data),
  };
}

/**
 * Reads one pixel.
 *
 * @param pixels - The buffer.
 * @param point - Which pixel.
 * @returns The colour, or fully transparent when the point is outside.
 */
export function pixelAt(pixels: Pixels, point: Point): Rgba {
  if (!withinSprite(point, pixels)) {
    return ERASE;
  }
  const offset = (point.y * pixels.width + point.x) * 4;
  return [
    channel(pixels.data, offset),
    channel(pixels.data, offset + 1),
    channel(pixels.data, offset + 2),
    channel(pixels.data, offset + 3),
  ];
}

/**
 * Turns a pointer position into a sprite pixel.
 *
 * The result is deliberately not clamped. A drag that leaves the sprite still
 * has a meaning - a rectangle whose far corner is off the edge is a rectangle
 * that runs off the edge - and every write below clips, so an outside point
 * costs nothing and pulling it back to the border would move the shape.
 *
 * @param offset - Where the pointer is inside the drawn image, in CSS pixels.
 * @param drawn - The drawn size of the image, in CSS pixels.
 * @param sprite - The sprite's own size, in sprite pixels.
 * @returns The pixel under the pointer. Outside the sprite when the pointer is.
 */
export function spritePoint(
  offset: Point,
  drawn: { width: number; height: number },
  sprite: { width: number; height: number },
): Point {
  // A stage with no size cannot answer, and dividing by it would report every
  // pointer as being on the same pixel rather than on none.
  if (drawn.width <= 0 || drawn.height <= 0) {
    return { x: -1, y: -1 };
  }
  return {
    x: Math.floor((offset.x * sprite.width) / drawn.width),
    y: Math.floor((offset.y * sprite.height) / drawn.height),
  };
}

/**
 * Reports whether a point is on the sprite.
 *
 * @param point - The point.
 * @param sprite - The sprite's size.
 * @returns True when the point addresses a pixel that exists.
 */
export function withinSprite(point: Point, sprite: { width: number; height: number }): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < sprite.width && point.y < sprite.height;
}

/**
 * Builds the rectangle two dragged corners describe.
 *
 * @param from - Where the drag started.
 * @param to - Where it is now.
 * @returns The rectangle, with both corners inside it.
 */
export function rectFrom(from: Point, to: Point): Rect {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return {
    x,
    y,
    width: Math.abs(to.x - from.x) + 1,
    height: Math.abs(to.y - from.y) + 1,
  };
}

/**
 * Reports whether a rectangle holds a point.
 *
 * @param rect - The rectangle, or null for no restriction at all.
 * @param point - The point.
 * @returns True when the point may be written.
 */
export function containsPoint(rect: Rect | null, point: Point): boolean {
  return (
    rect === null ||
    (point.x >= rect.x &&
      point.y >= rect.y &&
      point.x < rect.x + rect.width &&
      point.y < rect.y + rect.height)
  );
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
 * Writes one pixel, if it is on the sprite and inside the selection.
 *
 * @param pixels - The buffer, written in place.
 * @param point - Which pixel.
 * @param colour - What to write.
 * @param clip - The selection, or null when there is none.
 */
export function writePixel(pixels: Pixels, point: Point, colour: Rgba, clip: Rect | null): void {
  if (!withinSprite(point, pixels) || !containsPoint(clip, point)) {
    return;
  }
  const offset = (point.y * pixels.width + point.x) * 4;
  pixels.data[offset] = colour[0];
  pixels.data[offset + 1] = colour[1];
  pixels.data[offset + 2] = colour[2];
  pixels.data[offset + 3] = colour[3];
}

/**
 * Stamps the brush at one point.
 *
 * @param pixels - The buffer, written in place.
 * @param point - Where the brush is.
 * @param colour - What to write. {@link ERASE} for the eraser.
 * @param offsets - The brush footprint, from {@link brushOffsets}.
 * @param clip - The selection, or null when there is none.
 */
export function stamp(
  pixels: Pixels,
  point: Point,
  colour: Rgba,
  offsets: readonly Point[],
  clip: Rect | null,
): void {
  for (const offset of offsets) {
    writePixel(pixels, { x: point.x + offset.x, y: point.y + offset.y }, colour, clip);
  }
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
 * The pixels a rectangle's outline covers.
 *
 * An outline rather than a filled box, which is what the shape tools in
 * Aseprite and Pixelorama lay down by default; filling is the bucket's job and
 * it is one press away.
 *
 * @param from - One corner.
 * @param to - The opposite one.
 * @returns The outline, with no pixel repeated.
 */
export function rectanglePoints(from: Point, to: Point): Point[] {
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y, to.y);

  const points: Point[] = [];
  for (let x = left; x <= right; x += 1) {
    points.push({ x, y: top });
    if (bottom !== top) {
      points.push({ x, y: bottom });
    }
  }
  // The corners already went in with the two horizontal runs.
  for (let y = top + 1; y < bottom; y += 1) {
    points.push({ x: left, y });
    if (right !== left) {
      points.push({ x: right, y });
    }
  }
  return points;
}

/**
 * The pixels an ellipse's outline covers, inside the box two corners describe.
 *
 * The rectangular form of the midpoint ellipse, which takes the bounding box
 * rather than a centre and two radii. That matters here: a centre and a radius
 * cannot describe an ellipse an even number of pixels across, so the drag
 * would quietly snap to odd sizes and the shape would not follow the cursor.
 *
 * @param from - One corner of the box.
 * @param to - The opposite one.
 * @returns The outline. A pixel may appear twice where the quadrants meet.
 */
export function ellipsePoints(from: Point, to: Point): Point[] {
  let left = Math.min(from.x, to.x);
  let right = Math.max(from.x, to.x);
  let top = Math.min(from.y, to.y);
  let bottom = Math.max(from.y, to.y);

  const across = right - left;
  const down = bottom - top;
  // An even height has no middle row, so the two halves start one apart and
  // the error term carries that difference from the first step.
  const odd = down & 1;

  let dx = 4 * (1 - across) * down * down;
  let dy = 4 * (odd + 1) * across * across;
  let error = dx + dy + odd * across * across;

  top += (down + 1) >> 1;
  bottom = top - odd;

  const stepX = 8 * across * across;
  const stepY = 8 * down * down;

  const points: Point[] = [];
  do {
    points.push(
      { x: right, y: top },
      { x: left, y: top },
      { x: left, y: bottom },
      {
        x: right,
        y: bottom,
      },
    );
    const doubled = 2 * error;
    if (doubled <= dy) {
      top += 1;
      bottom -= 1;
      dy += stepX;
      error += dy;
    }
    if (doubled >= dx || 2 * error > dy) {
      left += 1;
      right -= 1;
      dx += stepY;
      error += dx;
    }
  } while (left <= right);

  // A flat ellipse runs out of horizontal steps before its ends are drawn, so
  // the tips are filled in afterwards.
  while (top - bottom < down) {
    points.push({ x: left - 1, y: top }, { x: right + 1, y: top });
    top += 1;
    points.push({ x: left - 1, y: bottom }, { x: right + 1, y: bottom });
    bottom -= 1;
  }
  return points;
}

/**
 * The pixels a bowed run between two points covers.
 *
 * A quadratic curve whose control point is the corner of the drag box, which
 * is the one curve two points can describe on their own: the other editors
 * that offer a curve tool take a third press for the control point, and a tool
 * that needed one would be a second input model for one slot in the dock.
 *
 * @param from - Where the drag started.
 * @param to - Where it ended.
 * @returns The curve, as a connected run of pixels.
 */
export function curvePoints(from: Point, to: Point): Point[] {
  const control = { x: to.x, y: from.y };
  // One sample per pixel of the box's longest side, which is denser than the
  // curve can possibly need; the samples are joined with lines anyway, so
  // being generous here costs a few short segments and guarantees no gap.
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1);

  const points: Point[] = [];
  let previous = from;
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const inverse = 1 - t;
    const next = {
      x: Math.round(inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x),
      y: Math.round(inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y),
    };
    // The first point of each segment is the last point of the one before it.
    points.push(...linePoints(previous, next).slice(points.length === 0 ? 0 : 1));
    previous = next;
  }
  return points;
}

/**
 * The pixels one shape's outline covers.
 *
 * @param shape - Which outline.
 * @param from - Where the drag started.
 * @param to - Where it is now.
 * @returns The outline.
 */
export function shapePoints(
  shape: 'line' | 'curve' | 'rectangle' | 'ellipse',
  from: Point,
  to: Point,
): Point[] {
  switch (shape) {
    case 'line':
      return linePoints(from, to);
    case 'curve':
      return curvePoints(from, to);
    case 'rectangle':
      return rectanglePoints(from, to);
    case 'ellipse':
      return ellipsePoints(from, to);
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

/**
 * Reports whether two colours are within a per channel tolerance.
 *
 * @param a - One colour.
 * @param b - The other.
 * @param tolerance - Largest per channel difference still counted as the same.
 * @returns True when every channel is within the tolerance.
 */
export function similar(a: Rgba, b: Rgba, tolerance: number): boolean {
  return (
    Math.abs(a[0] - b[0]) <= tolerance &&
    Math.abs(a[1] - b[1]) <= tolerance &&
    Math.abs(a[2] - b[2]) <= tolerance &&
    Math.abs(a[3] - b[3]) <= tolerance
  );
}

/**
 * Floods the connected region under a point with one colour.
 *
 * Four connected, and bounded by colour similarity rather than by equality:
 * the sprite a model produces is full of colours that are a unit or two apart
 * and read as one flat area, and a fill that only matched exactly would leave
 * a rash of untouched pixels behind.
 *
 * Scanline rather than a pixel queue: a row is filled in one pass and only the
 * rows above and below it are queued, which is what keeps a 512 pixel sprite
 * from putting a quarter of a million entries on a stack.
 *
 * @param pixels - The buffer, written in place.
 * @param seed - Where the fill starts.
 * @param colour - What to write.
 * @param tolerance - How far a colour may be from the seed's and still fill.
 * @param clip - The selection, which the fill may not cross.
 */
export function floodFill(
  pixels: Pixels,
  seed: Point,
  colour: Rgba,
  tolerance: number,
  clip: Rect | null,
): void {
  if (!withinSprite(seed, pixels) || !containsPoint(clip, seed)) {
    return;
  }

  const target = pixelAt(pixels, seed);
  // Already the wanted colour: every pixel the fill would visit is one it
  // would not change, so the whole pass is a no-op. Checked rather than
  // relied on, because the visited mask is what stops the walk and building
  // one for a fill that does nothing is pure cost.
  if (similar(target, colour, 0)) {
    return;
  }

  const left = clip === null ? 0 : Math.max(0, clip.x);
  const top = clip === null ? 0 : Math.max(0, clip.y);
  const right =
    clip === null ? pixels.width - 1 : Math.min(pixels.width - 1, clip.x + clip.width - 1);
  const bottom =
    clip === null ? pixels.height - 1 : Math.min(pixels.height - 1, clip.y + clip.height - 1);

  const visited = new Uint8Array(pixels.width * pixels.height);
  const queue: Point[] = [seed];

  while (queue.length > 0) {
    const point = queue.pop();
    if (point === undefined) {
      break;
    }
    if (visited[point.y * pixels.width + point.x] === 1) {
      continue;
    }

    // Walk out to both ends of the run this point sits in.
    let start = point.x;
    while (start > left && matches(pixels, { x: start - 1, y: point.y }, target, tolerance)) {
      start -= 1;
    }
    let end = point.x;
    while (end < right && matches(pixels, { x: end + 1, y: point.y }, target, tolerance)) {
      end += 1;
    }

    for (let x = start; x <= end; x += 1) {
      visited[point.y * pixels.width + x] = 1;
      writePixel(pixels, { x, y: point.y }, colour, clip);
      // The rows either side are queued per pixel rather than per run. A run
      // above can be broken into several by a pixel that does not match, and
      // queuing only its ends would fill one of the pieces and miss the rest.
      for (const y of [point.y - 1, point.y + 1]) {
        if (y >= top && y <= bottom && matches(pixels, { x, y }, target, tolerance)) {
          queue.push({ x, y });
        }
      }
    }
  }
}

/**
 * Reports whether a pixel is close enough to the fill's target colour.
 *
 * @param pixels - The buffer.
 * @param point - Which pixel.
 * @param target - The colour under the seed.
 * @param tolerance - Largest per channel difference still counted as the same.
 * @returns True when the pixel would be filled.
 */
function matches(pixels: Pixels, point: Point, target: Rgba, tolerance: number): boolean {
  return similar(pixelAt(pixels, point), target, tolerance);
}

/**
 * Reads a hex colour into channels.
 *
 * The palette reports colours as hex, because that is what the engine sends
 * and what a person recognises; the buffer holds channels. Three, four, six
 * and eight digit forms are all accepted, since the palette is not the only
 * thing that may hand one over.
 *
 * @param hex - A colour such as the palette reports, with a leading hash.
 * @returns The colour, or null when the string is not one.
 */
export function parseColour(hex: string): Rgba | null {
  const digits = hex.startsWith('#') ? hex.slice(1) : hex;
  if (!/^(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(digits)) {
    return null;
  }

  // The short forms repeat each digit rather than padding with a zero, so `f`
  // is 255 and not 15. A form that carries no alpha is opaque, which is what
  // the padding supplies.
  const expanded = digits.length <= 4 ? digits.replace(/./g, (digit) => digit + digit) : digits;
  const long = expanded.padEnd(8, 'f');

  const at = (index: number): number => Number.parseInt(long.slice(index, index + 2), 16);
  return [at(0), at(2), at(4), at(6)];
}
