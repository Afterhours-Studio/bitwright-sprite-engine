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
 * PNG to Pixel: a new sprite with a picture converted into its pixels.
 *
 * The picture is picked and measured before the sprite is created, so
 * cancelling the file picker, or picking something that is not a picture,
 * leaves nothing behind. Measuring finds the picture's own pixel grid (a
 * generated image draws its "pixels" as blocks of a fractional size), and the
 * sprite is created at that grid's size, within the sizes the new-sprite
 * dialog offers. The picture is then imported as the sprite's reference, the
 * same `reference_import` the editor's reference panel runs, and finally
 * pixelized into the sprite's first layer: background removed, one colour per
 * block, snapped to a palette made from the picture.
 */

import i18n from '@/lib/i18n';
import {
  referenceImport,
  referencePickFile,
  referencePixelize,
  referencePixelizeProbe,
} from '@/lib/reference';
import { useProjectStore } from '@/stores/useProjectStore';
import { useToastStore } from '@/stores/useToastStore';
import { PRESET_CANVAS, type Asset, type StylePreset } from '@/types/document';

/** The code the shell answers when the picked file is not a PNG. */
const NOT_A_PNG = 'png.invalid';

/**
 * The sprite name a picture's path suggests: its file name without the
 * extension, or the whole file name when that would leave nothing.
 *
 * @param path - The picked path, with either separator.
 * @returns The name.
 */
export function nameFromPath(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  const stem = file.replace(/\.[^.]+$/, '');
  return stem.trim() === '' ? file : stem;
}

/**
 * Raises the error toast every failure in this flow shares.
 *
 * @param code - The shell's error code, when it gave one.
 * @param fallbackKey - What to say when the errors namespace has no entry for
 *   the code, so a code it does not know never shows as a raw key.
 */
function fail(code: string | null, fallbackKey: string): void {
  useToastStore.getState().notify({
    severity: 'error',
    titleKey: 'home:png.failedTitle',
    messageKey: code !== null && i18n.exists(`errors:${code}`) ? `errors:${code}` : fallbackKey,
  });
}

/**
 * Picks a picture, creates a sprite for it in a project, imports the picture as
 * that sprite's reference and converts it into the sprite's first layer.
 *
 * @param projectId - The project the sprite goes into.
 * @param preset - That project's preset, whose canvas is used for a picture
 *   the shell cannot measure (a JPEG, say), which is converted from its
 *   conformed copy instead.
 * @returns The created sprite, or null when nothing was created.
 */
export async function pngToPixel(projectId: string, preset: StylePreset): Promise<Asset | null> {
  const picked = await referencePickFile();
  if (!picked.ok) {
    fail(picked.error.code, 'errors:unknown');
    return null;
  }
  if (picked.value === null) {
    return null;
  }

  const probe = await referencePixelizeProbe(picked.value);
  let canvas = PRESET_CANVAS[preset];
  if (probe.ok) {
    canvas = { width: probe.value.canvasWidth, height: probe.value.canvasHeight };
  } else if (probe.error.code !== NOT_A_PNG) {
    // An empty picture, one that is too large or unreadable: nothing is
    // created, so there is no half-made sprite to explain.
    fail(probe.error.code, 'home:png.unreadable');
    return null;
  }

  const asset = await useProjectStore
    .getState()
    .createAssetIn(projectId, nameFromPath(picked.value), 'character', canvas.width, canvas.height);
  if (asset === null) {
    // The store has already said why.
    return null;
  }

  const imported = await referenceImport(asset.id, picked.value);
  if (!imported.ok) {
    // The sprite is kept: it is a real row now, and its reference panel can
    // import the picture again without the size being chosen twice.
    fail(null, 'home:png.importFailed');
    return asset;
  }

  const pixelized = await referencePixelize(asset.id, imported.value.id);
  if (!pixelized.ok) {
    // The sprite and its reference are kept; the picture can be converted
    // again by an agent (pixelize_reference) or redrawn by hand.
    fail(pixelized.error.code, 'home:png.pixelizeFailed');
  }
  return asset;
}
