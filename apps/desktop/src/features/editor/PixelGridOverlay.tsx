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
import { useEffect, useRef, type ReactElement } from 'react';

import { useShellStore } from '@/stores/useShellStore';

/**
 * The smallest a sprite pixel may be on screen before the grid is hidden.
 *
 * Piskel's rule, `zoom * spacing < 6`, taken as written. A line at every sprite
 * pixel stops being a grid and becomes a flat grey field once the cells are a
 * few pixels across, so every editor suppresses it somewhere; Aseprite ramps
 * the opacity between two zoom levels instead, which needs a blend per zoom
 * step and arrives at the same place. One comparison against a number that
 * means something physical is cheaper and reads better in code.
 *
 * Six screen pixels per sprite pixel also means the one pixel line never eats
 * a meaningful share of a cell, which is what Piskel's companion line-thinning
 * loop exists to guarantee. With the cell held at six and the line held at one
 * device pixel, there is nothing left for that loop to do.
 */
export const MIN_GRID_CELL = 6;

export interface PixelGridOverlayProps {
  /** How many sprite pixels across the image is. */
  columns: number;
  /** How many sprite pixels down the image is. */
  rows: number;
  /** The drawn width of the image, in CSS pixels. */
  width: number;
  /** The drawn height of the image, in CSS pixels. */
  height: number;
  /**
   * Whether the line at every sprite pixel is drawn. Defaults to true; the
   * stage turns it off below {@link MIN_GRID_CELL} or when the grid is hidden,
   * while still asking for the tile guide.
   */
  cells?: boolean;
  /** The tile guide's cell size in sprite pixels, or 0 (the default) for none. */
  tileGuide?: number;
}

/**
 * Strokes a line every `step` sprite pixels across a device-pixel canvas.
 *
 * Each line sits at `round(i * deviceWidth / columns) + 0.5`. The rounding is
 * what puts it on a device pixel boundary; the half is what makes a one unit
 * stroke cover exactly that pixel rather than half of each of its neighbours.
 * Rounding per line rather than stepping by a rounded cell size also stops the
 * error accumulating: the last line lands on the image's edge whatever the
 * cell size is, which is not true of a running total.
 *
 * @param element - The canvas, already sized in device pixels.
 * @param columns - Sprite pixels across.
 * @param rows - Sprite pixels down.
 * @param step - Sprite pixels between lines.
 */
function strokeGrid(element: HTMLCanvasElement, columns: number, rows: number, step: number): void {
  // jsdom has no 2D context and reports that by returning null, so the guard
  // is what lets this component mount under test rather than being stubbed
  // out of it.
  const context = element.getContext('2d');
  if (context === null) {
    return;
  }
  const deviceWidth = element.width;
  const deviceHeight = element.height;
  context.clearRect(0, 0, deviceWidth, deviceHeight);
  if (step <= 0) {
    return;
  }
  context.strokeStyle = window.getComputedStyle(element).color;
  context.lineWidth = 1;

  context.beginPath();
  for (let column = step; column < columns; column += step) {
    const x = Math.round((column * deviceWidth) / columns) + 0.5;
    context.moveTo(x, 0);
    context.lineTo(x, deviceHeight);
  }
  for (let row = step; row < rows; row += step) {
    const y = Math.round((row * deviceHeight) / rows) + 0.5;
    context.moveTo(0, y);
    context.lineTo(deviceWidth, y);
  }
  // One path for every line, stroked once. A path per line costs a state
  // change each, and a 128 pixel sprite is 254 of them on every resize.
  context.stroke();
}

/**
 * A line at every sprite pixel boundary, and a stronger one at every tile,
 * drawn over the sprite.
 *
 * THIS IS A VIEW OVERLAY AND NOTHING ELSE. It changes what is on screen; it
 * never changes the sprite or anything that is saved. The cell size it draws
 * is the sprite's own, read from the buffer, rather than a number anything
 * asked for; the tile size is the one the tile guide menu offers, because
 * those are the sizes sheets and tile maps are actually cut at.
 *
 * A CANVAS RATHER THAN A REPEATING GRADIENT, and the reason is the device pixel
 * ratio. A gradient's period is a CSS length, so on a display at 1.25 or 1.5
 * device pixels per CSS pixel every line lands on a fraction of a device pixel
 * and the compositor antialiases it into a two pixel smear. Sixty-four of those
 * over a sprite is the grey haze the suppression rule above exists to avoid,
 * arriving anyway at a zoom where the grid should have been crisp. A canvas is
 * sized in device pixels, so each line can be put on a whole one.
 *
 * TWO CANVASES, because the two sets of lines are two colours and each canvas
 * reads its colour from its own computed `color`, which its class ties to a
 * token - so a canvas that cannot read a stylesheet still follows the theme.
 * The tile guide sits above the cells and is not suppressed at low zoom: a tile
 * boundary is still a boundary when the sprite is small, and there are few
 * enough of them that they never become a wash. The theme is a dependency of
 * the draw because flipping it changes what the tokens resolve to, and nothing
 * about a painted canvas re-evaluates on its own.
 *
 * @param props - The image's pixel dimensions, its drawn size, and the guide.
 * @returns The overlay canvases.
 */
export function PixelGridOverlay({
  columns,
  rows,
  width,
  height,
  cells = true,
  tileGuide = 0,
}: PixelGridOverlayProps): ReactElement {
  const grid = useRef<HTMLCanvasElement>(null);
  const tiles = useRef<HTMLCanvasElement>(null);
  const theme = useShellStore((state) => state.theme);

  useEffect(() => {
    const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const deviceWidth = Math.round(width * ratio);
    const deviceHeight = Math.round(height * ratio);
    for (const [element, step] of [
      [grid.current, cells ? 1 : 0],
      [tiles.current, tileGuide],
    ] as const) {
      if (element === null) {
        continue;
      }
      element.width = deviceWidth;
      element.height = deviceHeight;
      strokeGrid(element, columns, rows, step);
    }
  }, [columns, rows, width, height, cells, tileGuide, theme]);

  return (
    <>
      <canvas
        ref={grid}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full text-line"
      />
      <canvas
        ref={tiles}
        aria-hidden="true"
        data-tile-guide={tileGuide > 0 ? tileGuide : undefined}
        className="pointer-events-none absolute inset-0 h-full w-full text-neutral-300/70"
      />
    </>
  );
}
