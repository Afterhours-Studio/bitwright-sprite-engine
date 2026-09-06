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
}

/**
 * A line at every sprite pixel boundary, drawn over the sprite.
 *
 * THIS IS A VIEW OVERLAY AND NOTHING ELSE. It changes what is on screen; it
 * never changes the image, the request, or anything that is saved. It is not
 * the generation request's `postprocess.pixelGrid`, which is a block size the
 * engine resamples the sprite onto and which produces a different image.
 *
 * A CANVAS RATHER THAN A REPEATING GRADIENT, and the reason is the device pixel
 * ratio. A gradient's period is a CSS length, so on a display at 1.25 or 1.5
 * device pixels per CSS pixel every line lands on a fraction of a device pixel
 * and the compositor antialiases it into a two pixel smear. Sixty-four of those
 * over a sprite is the grey haze the suppression rule above exists to avoid,
 * arriving anyway at a zoom where the grid should have been crisp. A canvas is
 * sized in device pixels, so each line can be put on a whole one.
 *
 * Each line sits at `round(i * deviceWidth / columns) + 0.5`. The rounding is
 * what puts it on a device pixel boundary; the half is what makes a one unit
 * stroke cover exactly that pixel rather than half of each of its neighbours.
 * Rounding per line rather than stepping by a rounded cell size also stops the
 * error accumulating: the last line lands on the image's edge whatever the
 * cell size is, which is not true of a running total.
 *
 * The colour is read from the element's own computed `color`, which the class
 * ties to a border token, so a canvas that cannot read a stylesheet still
 * follows the theme. The theme is a dependency of the draw for that reason:
 * flipping it changes what that token resolves to and the canvas has to be
 * redrawn, because nothing about a painted canvas re-evaluates on its own.
 *
 * @param props - The image's pixel dimensions and its drawn size.
 * @returns The overlay canvas.
 */
export function PixelGridOverlay({
  columns,
  rows,
  width,
  height,
}: PixelGridOverlayProps): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useShellStore((state) => state.theme);

  useEffect(() => {
    const element = canvas.current;
    if (element === null) {
      return;
    }

    const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const deviceWidth = Math.round(width * ratio);
    const deviceHeight = Math.round(height * ratio);
    element.width = deviceWidth;
    element.height = deviceHeight;

    // jsdom has no 2D context and reports that by returning null, so the guard
    // is what lets this component mount under test rather than being stubbed
    // out of it.
    const context = element.getContext('2d');
    if (context === null) {
      return;
    }

    context.clearRect(0, 0, deviceWidth, deviceHeight);
    context.strokeStyle = window.getComputedStyle(element).color;
    context.lineWidth = 1;

    context.beginPath();
    for (let column = 1; column < columns; column += 1) {
      const x = Math.round((column * deviceWidth) / columns) + 0.5;
      context.moveTo(x, 0);
      context.lineTo(x, deviceHeight);
    }
    for (let row = 1; row < rows; row += 1) {
      const y = Math.round((row * deviceHeight) / rows) + 0.5;
      context.moveTo(0, y);
      context.lineTo(deviceWidth, y);
    }
    // One path for every line, stroked once. A path per line costs a state
    // change each, and a 128 pixel sprite is 254 of them on every resize.
    context.stroke();
  }, [columns, rows, width, height, theme]);

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full text-line"
    />
  );
}
