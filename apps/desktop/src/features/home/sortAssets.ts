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
 * How home orders and narrows its sprites.
 *
 * Kept out of the component so the ordering can be checked on its own: the
 * grid, the list and every project section all go through the same two
 * functions, and a tie broken differently in one of them would make the same
 * sprite jump places between views.
 */

import { ASSET_KINDS, type Asset } from '@/types/document';

/** What a list can be ordered by. */
export type SortKey = 'recent' | 'name' | 'size' | 'kind' | 'frames';

/** Every sort key, in the order the select offers them. */
export const SORT_KEYS: readonly SortKey[] = ['recent', 'name', 'size', 'kind', 'frames'];

/** Which way a sort runs. */
export type SortDirection = 'asc' | 'desc';

/**
 * Compares two assets by name, the tie-breaker for every other key.
 *
 * @param a - One asset.
 * @param b - The other.
 * @returns A negative, zero or positive number.
 */
function byName(a: Asset, b: Asset): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
}

/**
 * Compares two assets on one key.
 *
 * @param key - What to compare.
 * @param a - One asset.
 * @param b - The other.
 * @returns A negative, zero or positive number, ascending.
 */
function compare(key: SortKey, a: Asset, b: Asset): number {
  switch (key) {
    case 'recent':
      return a.updatedAt - b.updatedAt;
    case 'name':
      return byName(a, b);
    case 'size':
      return a.width * a.height - b.width * b.height;
    case 'kind':
      // The order the kinds are offered in, not their translated names, so a
      // language change does not reshuffle the grid.
      return ASSET_KINDS.indexOf(a.kind) - ASSET_KINDS.indexOf(b.kind);
    case 'frames':
      // A lone sprite counts as one frame, the same as the root of an
      // animation of one, so the two sort together.
      return Math.max(a.frames, 1) - Math.max(b.frames, 1);
  }
}

/**
 * Orders assets, leaving the input alone.
 *
 * Ties are broken by name, ascending whichever way the sort runs, and then by
 * id, so an order is always the same order.
 *
 * @param assets - The assets to order.
 * @param key - What to order them by.
 * @param direction - Which way.
 * @returns A new, ordered array.
 */
export function sortAssets(
  assets: readonly Asset[],
  key: SortKey,
  direction: SortDirection,
): Asset[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...assets].sort((a, b) => {
    const primary = compare(key, a, b) * sign;
    if (primary !== 0) {
      return primary;
    }
    const name = byName(a, b);
    return name !== 0 ? name : a.id.localeCompare(b.id);
  });
}

/**
 * Keeps the assets whose name contains the query, ignoring case and the
 * whitespace around it. An empty query keeps everything.
 *
 * @param assets - The assets to narrow.
 * @param query - What was typed.
 * @returns The assets that match.
 */
export function filterAssets(assets: readonly Asset[], query: string): Asset[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') {
    return [...assets];
  }
  return assets.filter((asset) => asset.name.toLocaleLowerCase().includes(needle));
}
