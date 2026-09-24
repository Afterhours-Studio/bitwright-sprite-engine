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
 * Tilemaps: a background asset drawn as a grid of tile assets in layers.
 *
 * The shapes match `raster/tilemap.rs` and `commands/tilemap.rs` field for
 * field, in the camelCase serde gives them. See
 * `docs/architecture/tilemap-and-export.md`.
 */

/** One layer of a map, back to front in {@link Tilemap.layers}. */
export interface TilemapLayer {
  /** Unique within the map, 1 to 40 characters. */
  name: string;
  /** 0 to 4; 1 moves with the camera, less scrolls slower, as far scenery does. */
  parallax: number;
  visible: boolean;
  /** Row-major, `columns * rows` long; `null` is an empty cell, else a tile asset id. */
  tiles: (string | null)[];
}

/** A background's map. */
export interface Tilemap {
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  layers: TilemapLayer[];
}

/** One cell to set: a tile asset id, or `null` to clear it. */
export interface Placement {
  x: number;
  y: number;
  tile: string | null;
}

/** A tile asset the map can use, with its composite as a data URL for the picker. */
export interface TileAsset {
  id: string;
  name: string;
  width: number;
  height: number;
  preview: string;
}

/** Emitted after any write to a map, from the window or an agent. */
export interface TilemapChangedEvent {
  assetId: string;
}
