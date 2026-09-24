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
 * The tilemap bridge says the names the shell expects.
 *
 * As in `lib/mcp.test.ts`, there is no behaviour here to exercise: each
 * function is one call naming a command and its argument keys, and that
 * indirection is the whole risk. A command name or an argument key renamed on
 * one side of the boundary is not a compile error on either side, so these
 * tests assert the literal strings on the wire.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TILEMAP_CHANGED,
  onTilemapChanged,
  tilemapAddLayer,
  tilemapCreate,
  tilemapPlace,
  tilemapPreview,
  tilemapRead,
  tilemapRemoveLayer,
  tilemapSetLayer,
  tilemapTiles,
} from '@/lib/tilemap';
import type { Tilemap } from '@/types/tilemap';

vi.mock('@/lib/tauri', () => ({ invoke: vi.fn(), on: vi.fn() }));

const tauri = await import('@/lib/tauri');

/**
 * A map as the shell would answer with.
 *
 * @returns A map with one layer.
 */
function map(): Tilemap {
  return {
    tileWidth: 16,
    tileHeight: 16,
    columns: 20,
    rows: 12,
    layers: [{ name: 'ground', parallax: 1, visible: true, tiles: new Array(240).fill(null) }],
  };
}

/**
 * Makes the next command answer with a value.
 *
 * @param value - What the command returns.
 */
function answersWith(value: unknown): void {
  vi.mocked(tauri.invoke).mockResolvedValue({ ok: true, value } as never);
}

beforeEach(() => {
  vi.mocked(tauri.invoke).mockReset();
  vi.mocked(tauri.on).mockReset();
});

describe('tilemapCreate', () => {
  it('calls tilemap_create with the sizes under their wire keys', async () => {
    answersWith(map());

    await tilemapCreate('asset-1', 16, 16, 20, 12);

    expect(tauri.invoke).toHaveBeenCalledWith('tilemap_create', {
      assetId: 'asset-1',
      tileWidth: 16,
      tileHeight: 16,
      columns: 20,
      rows: 12,
    });
  });
});

describe('tilemapRead', () => {
  it('calls tilemap_read with only the asset id', async () => {
    answersWith(map());

    await expect(tilemapRead('asset-1')).resolves.toEqual({ ok: true, value: map() });
    expect(tauri.invoke).toHaveBeenCalledWith('tilemap_read', { assetId: 'asset-1' });
  });
});

describe('tilemapPlace', () => {
  it('sends the layer and the placements array unchanged', async () => {
    answersWith(map());

    await tilemapPlace('asset-1', 'ground', [{ x: 1, y: 2, tile: 'tile-9' }]);

    expect(tauri.invoke).toHaveBeenCalledWith('tilemap_place', {
      assetId: 'asset-1',
      layer: 'ground',
      placements: [{ x: 1, y: 2, tile: 'tile-9' }],
    });
  });
});

describe('tilemapAddLayer', () => {
  it('calls tilemap_add_layer with the name and parallax', async () => {
    answersWith(map());

    await tilemapAddLayer('asset-1', 'sky', 0.5);

    expect(tauri.invoke).toHaveBeenCalledWith('tilemap_add_layer', {
      assetId: 'asset-1',
      name: 'sky',
      parallax: 0.5,
    });
  });
});

describe('tilemapRemoveLayer', () => {
  it('calls tilemap_remove_layer with the layer name', async () => {
    answersWith(map());

    await tilemapRemoveLayer('asset-1', 'sky');

    expect(tauri.invoke).toHaveBeenCalledWith('tilemap_remove_layer', {
      assetId: 'asset-1',
      name: 'sky',
    });
  });
});

describe('tilemapSetLayer', () => {
  it('sends parallax and visible together when both change', async () => {
    answersWith(map());

    await tilemapSetLayer('asset-1', 'ground', 1.5, false);

    expect(tauri.invoke).toHaveBeenCalledWith('tilemap_set_layer', {
      assetId: 'asset-1',
      name: 'ground',
      parallax: 1.5,
      visible: false,
    });
  });

  it('leaves the unset half undefined rather than guessing a value', async () => {
    answersWith(map());

    await tilemapSetLayer('asset-1', 'ground', undefined, true);

    expect(tauri.invoke).toHaveBeenCalledWith('tilemap_set_layer', {
      assetId: 'asset-1',
      name: 'ground',
      parallax: undefined,
      visible: true,
    });
  });
});

describe('tilemapTiles', () => {
  it('calls tilemap_tiles with only the asset id', async () => {
    answersWith([]);

    await tilemapTiles('asset-1');

    expect(tauri.invoke).toHaveBeenCalledWith('tilemap_tiles', { assetId: 'asset-1' });
  });
});

describe('tilemapPreview', () => {
  it('calls tilemap_preview with the asset id and no layer for the whole map', async () => {
    answersWith('data:image/png;base64,');

    await tilemapPreview('asset-1');

    expect(tauri.invoke).toHaveBeenCalledWith('tilemap_preview', {
      assetId: 'asset-1',
      layer: undefined,
    });
  });

  it('sends the layer name when previewing one layer alone', async () => {
    answersWith('data:image/png;base64,');

    await tilemapPreview('asset-1', 'ground');

    expect(tauri.invoke).toHaveBeenCalledWith('tilemap_preview', {
      assetId: 'asset-1',
      layer: 'ground',
    });
  });
});

describe('onTilemapChanged', () => {
  it('subscribes to tilemap://changed', async () => {
    const unlisten = vi.fn();
    vi.mocked(tauri.on).mockResolvedValue(unlisten);
    const handler = vi.fn();

    await onTilemapChanged(handler);

    expect(TILEMAP_CHANGED).toBe('tilemap://changed');
    expect(tauri.on).toHaveBeenCalledWith('tilemap://changed', handler);
  });
});
