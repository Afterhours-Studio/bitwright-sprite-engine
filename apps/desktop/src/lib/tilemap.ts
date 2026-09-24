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
 * The tilemap commands, and the event a map write emits.
 *
 * One function per command in `commands/tilemap.rs`, named after it. Every one
 * returns a {@link ShellResult}, like the rest of the bridge in `lib/tauri.ts`,
 * and the argument names are camelCase because Tauri 2 renames them.
 */

import type { UnlistenFn } from '@tauri-apps/api/event';

import { invoke, on } from '@/lib/tauri';
import type { ShellResult } from '@/lib/tauri';
import type { Placement, TileAsset, Tilemap, TilemapChangedEvent } from '@/types/tilemap';

/** The channel `commands/tilemap.rs` and the MCP host emit a map write on. */
export const TILEMAP_CHANGED = 'tilemap://changed';

/** Gives a background asset an empty map with one `ground` layer; refused if it has one. */
export function tilemapCreate(
  assetId: string,
  tileWidth: number,
  tileHeight: number,
  columns: number,
  rows: number,
): Promise<ShellResult<Tilemap>> {
  return invoke<Tilemap>('tilemap_create', { assetId, tileWidth, tileHeight, columns, rows });
}

/** Reads a background's map; `tilemap.none` when it has none yet. */
export function tilemapRead(assetId: string): Promise<ShellResult<Tilemap>> {
  return invoke<Tilemap>('tilemap_read', { assetId });
}

/** Sets cells on one layer, all or none; answers with the map as written. */
export function tilemapPlace(
  assetId: string,
  layer: string,
  placements: Placement[],
): Promise<ShellResult<Tilemap>> {
  return invoke<Tilemap>('tilemap_place', { assetId, layer, placements });
}

/** Adds an empty layer in front of the others. */
export function tilemapAddLayer(
  assetId: string,
  name: string,
  parallax: number,
): Promise<ShellResult<Tilemap>> {
  return invoke<Tilemap>('tilemap_add_layer', { assetId, name, parallax });
}

/** Removes a layer; the last one is refused. */
export function tilemapRemoveLayer(assetId: string, name: string): Promise<ShellResult<Tilemap>> {
  return invoke<Tilemap>('tilemap_remove_layer', { assetId, name });
}

/** Changes a layer's parallax, its visibility, or both. */
export function tilemapSetLayer(
  assetId: string,
  name: string,
  parallax?: number,
  visible?: boolean,
): Promise<ShellResult<Tilemap>> {
  return invoke<Tilemap>('tilemap_set_layer', { assetId, name, parallax, visible });
}

/** The project's tile assets that fit the map, each with a preview, for the picker. */
export function tilemapTiles(assetId: string): Promise<ShellResult<TileAsset[]>> {
  return invoke<TileAsset[]>('tilemap_tiles', { assetId });
}

/** The map rendered, or one layer of it, as a PNG data URL. */
export function tilemapPreview(assetId: string, layer?: string): Promise<ShellResult<string>> {
  return invoke<string>('tilemap_preview', { assetId, layer });
}

/** Subscribes to map writes, whether made here or by an agent. */
export function onTilemapChanged(
  handler: (event: TilemapChangedEvent) => void,
): Promise<UnlistenFn> {
  return on<TilemapChangedEvent>(TILEMAP_CHANGED, handler);
}
