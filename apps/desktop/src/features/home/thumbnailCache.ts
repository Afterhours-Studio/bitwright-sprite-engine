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
 * The composites home has already asked for, by id and update time.
 *
 * Kept apart from the component so tests can empty it between runs.
 */

import { documentComposite } from '@/lib/document';
import type { Asset, RgbaImage } from '@/types/document';

/** Composites already asked for, by `id:updatedAt`. A null is a refused read. */
const cache = new Map<string, Promise<RgbaImage | null>>();

/**
 * Reads one composite, once per id and update time.
 *
 * @param asset - The asset to composite.
 * @returns The image, or null when the shell refused.
 */
export function composite(asset: Asset): Promise<RgbaImage | null> {
  const key = `${asset.id}:${asset.updatedAt}`;
  let pending = cache.get(key);
  if (pending === undefined) {
    pending = documentComposite(asset.id).then((result) => (result.ok ? result.value : null));
    cache.set(key, pending);
  }
  return pending;
}

/** Forgets every cached composite. Tests call it so one run cannot feed the next. */
export function clearThumbnailCache(): void {
  cache.clear();
}
