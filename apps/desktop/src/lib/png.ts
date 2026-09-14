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
 * The boundary between the bytes the engine exchanges and the pixels the
 * editor works on.
 *
 * This is the one part of the editor that needs a browser: there is no PNG
 * codec in the application, and there does not need to be, because the
 * platform has one behind a canvas. Everything that decides what a stroke does
 * lives in `lib/pixels.ts`, which needs nothing, and is tested without one.
 *
 * Every function here answers null rather than throwing when there is no
 * canvas to work with. That is not defensive habit: the test environment has
 * no 2D context at all, and an editor that took the window down when it could
 * not encode would be worse than one that simply keeps its buffer in memory
 * for the session.
 */

import { toDataUrl } from '@/lib/api';
import type { Pixels } from '@/lib/pixels';

/** The prefix a data URL from a canvas carries before its payload. */
const DATA_URL_SEPARATOR = ',';

/**
 * Builds a canvas sized to a sprite, with a context to draw on.
 *
 * @param width - Width in sprite pixels.
 * @param height - Height in sprite pixels.
 * @returns The canvas and its context, or null when there is no context.
 */
function scratch(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    return context === null ? null : { canvas, context };
  } catch {
    return null;
  }
}

/**
 * Decodes PNG bytes into a pixel buffer.
 *
 * The image is drawn at its own size with no scaling of any kind, so the
 * buffer holds exactly the pixels the engine sent.
 *
 * @param data - Base64 encoded PNG bytes, with no data URL prefix.
 * @returns The pixels, or null when they could not be read.
 */
export async function decodePng(data: string): Promise<Pixels | null> {
  let image: HTMLImageElement;
  try {
    image = new Image();
    image.src = toDataUrl(data);
    await image.decode();
  } catch {
    // A payload that is not an image, or a platform that cannot decode one.
    return null;
  }

  const target = scratch(image.naturalWidth, image.naturalHeight);
  if (target === null) {
    return null;
  }

  try {
    target.context.drawImage(image, 0, 0);
    const read = target.context.getImageData(0, 0, image.naturalWidth, image.naturalHeight);
    return { width: read.width, height: read.height, data: read.data };
  } catch {
    return null;
  }
}

/**
 * Encodes a pixel buffer as PNG bytes.
 *
 * PNG rather than anything else, because that is what every other part of the
 * application already exchanges, and because a sprite's transparency and its
 * exact colours both have to survive the round trip.
 *
 * @param pixels - The buffer.
 * @returns Base64 encoded PNG bytes with no prefix, or null when the platform
 *   cannot encode.
 */
export function encodePng(pixels: Pixels): string | null {
  const target = scratch(pixels.width, pixels.height);
  if (target === null) {
    return null;
  }

  try {
    target.context.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
    const url = target.canvas.toDataURL('image/png');
    const payload = url.slice(url.indexOf(DATA_URL_SEPARATOR) + 1);
    return payload === '' ? null : payload;
  } catch {
    return null;
  }
}
