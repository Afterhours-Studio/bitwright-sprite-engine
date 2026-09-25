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
 * PNG to Pixel: a new sprite with a picture already imported as its reference.
 *
 * The picture is picked before the sprite is created, so cancelling the file
 * picker leaves nothing behind. The import is the same `reference_import` the
 * editor's reference panel runs, and it never touches the document: the
 * picture is conformed to the sprite's size and kept beside it to draw
 * against, which is the reference step of the workflow.
 */

import i18n from '@/lib/i18n';
import { referenceImport, referencePickFile } from '@/lib/reference';
import { useProjectStore } from '@/stores/useProjectStore';
import { useToastStore } from '@/stores/useToastStore';
import { PRESET_CANVAS, type Asset, type StylePreset } from '@/types/document';

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
 * Picks a picture, creates a sprite for it in a project, and imports the
 * picture as that sprite's reference.
 *
 * @param projectId - The project the sprite goes into.
 * @param preset - That project's preset, which sets the sprite's size.
 * @returns The created sprite, or null when nothing was created.
 */
export async function pngToPixel(projectId: string, preset: StylePreset): Promise<Asset | null> {
  const notify = useToastStore.getState().notify;
  const picked = await referencePickFile();
  if (!picked.ok) {
    notify({
      severity: 'error',
      titleKey: 'home:png.failedTitle',
      // A code the errors namespace does not know would show as a raw key.
      messageKey: i18n.exists(`errors:${picked.error.code}`)
        ? `errors:${picked.error.code}`
        : 'errors:unknown',
    });
    return null;
  }
  if (picked.value === null) {
    return null;
  }

  const canvas = PRESET_CANVAS[preset];
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
    notify({
      severity: 'error',
      titleKey: 'home:png.failedTitle',
      messageKey: 'home:png.importFailed',
    });
  }
  return asset;
}
