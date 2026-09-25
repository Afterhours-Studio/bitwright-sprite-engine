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

/** How home orders and narrows its sprites. */

import { describe, expect, it } from 'vitest';

import { filterAssets, sortAssets } from '@/features/home/sortAssets';
import type { Asset } from '@/types/document';

/**
 * An asset row with the fields the sort reads.
 *
 * @param overrides - The fields that differ.
 * @returns The row.
 */
function asset(overrides: Partial<Asset> & Pick<Asset, 'id' | 'name'>): Asset {
  return {
    projectId: 'p',
    styleId: null,
    kind: 'character',
    width: 32,
    height: 32,
    step: 'reference',
    createdAt: 0,
    updatedAt: 0,
    rootId: null,
    frames: 1,
    ...overrides,
  };
}

const TREE = asset({ id: 'a', name: 'tree', kind: 'prop', width: 64, height: 64, updatedAt: 30 });
const HERO = asset({
  id: 'b',
  name: 'Hero',
  kind: 'character',
  width: 16,
  height: 16,
  updatedAt: 10,
});
const GRASS = asset({ id: 'c', name: 'grass', kind: 'tile', width: 32, height: 32, updatedAt: 20 });
const ALL = [TREE, HERO, GRASS];

const names = (assets: Asset[]): string[] => assets.map((entry) => entry.name);

describe('sortAssets', () => {
  it('orders by update time, newest first when descending', () => {
    expect(names(sortAssets(ALL, 'recent', 'desc'))).toEqual(['tree', 'grass', 'Hero']);
    expect(names(sortAssets(ALL, 'recent', 'asc'))).toEqual(['Hero', 'grass', 'tree']);
  });

  it('orders by name ignoring case', () => {
    expect(names(sortAssets(ALL, 'name', 'asc'))).toEqual(['grass', 'Hero', 'tree']);
  });

  it('orders by pixel area', () => {
    expect(names(sortAssets(ALL, 'size', 'desc'))).toEqual(['tree', 'grass', 'Hero']);
  });

  it('orders by kind in the order kinds are offered', () => {
    expect(names(sortAssets(ALL, 'kind', 'asc'))).toEqual(['Hero', 'tree', 'grass']);
  });

  it('orders by frame count, most frames first when descending', () => {
    const walk = asset({ id: 'w', name: 'walk', frames: 6 });
    const idle = asset({ id: 'i', name: 'idle', frames: 3 });
    expect(names(sortAssets([...ALL, walk, idle], 'frames', 'desc'))).toEqual([
      'walk',
      'idle',
      'grass',
      'Hero',
      'tree',
    ]);
  });

  it('breaks ties by name whichever way the sort runs', () => {
    const b = asset({ id: 'x', name: 'b', updatedAt: 5 });
    const a = asset({ id: 'y', name: 'a', updatedAt: 5 });
    expect(names(sortAssets([b, a], 'recent', 'desc'))).toEqual(['a', 'b']);
  });

  it('leaves its input alone', () => {
    const input = [...ALL];
    sortAssets(input, 'name', 'asc');
    expect(input).toEqual(ALL);
  });
});

describe('filterAssets', () => {
  it('keeps names containing the query, ignoring case and outer spaces', () => {
    expect(names(filterAssets(ALL, '  ER '))).toEqual(['Hero']);
  });

  it('keeps everything for an empty query', () => {
    expect(filterAssets(ALL, '   ')).toHaveLength(3);
  });
});
