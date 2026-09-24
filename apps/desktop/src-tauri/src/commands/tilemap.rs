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

//! Tauri commands exposing the tilemap model (`raster::tilemap`) and its
//! storage (`Store::tilemap_*`, `asset_composite`) to the window.

use crate::commands::document::{run, DocumentState};
use crate::raster::{self, Placement, Tilemap};
use crate::store::{AppError, AssetId, Result, Store};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, State};

pub const EVENT_TILEMAP_CHANGED: &str = "tilemap://changed";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TilemapChanged {
    pub asset_id: AssetId,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TileAsset {
    pub id: AssetId,
    pub name: String,
    pub width: u16,
    pub height: u16,
    pub preview: String,
}

fn emit_changed<R: Runtime>(app: &AppHandle<R>, asset_id: AssetId) {
    if let Err(error) = app.emit(EVENT_TILEMAP_CHANGED, TilemapChanged { asset_id }) {
        log::warn!("{EVENT_TILEMAP_CHANGED} failed after the tilemap committed: {error}");
    }
}

fn create(
    store: &mut Store,
    asset_id: AssetId,
    tile_width: u16,
    tile_height: u16,
    columns: u16,
    rows: u16,
) -> Result<Tilemap> {
    if store.tilemap_read(asset_id).is_ok() {
        return Err(AppError::new(
            "tilemap.exists",
            "a tilemap already exists for this asset",
        ));
    }
    let map = Tilemap::new(tile_width, tile_height, columns, rows)?;
    store.tilemap_write(asset_id, &map)
}

fn place(
    store: &mut Store,
    asset_id: AssetId,
    layer: String,
    placements: Vec<Placement>,
) -> Result<Tilemap> {
    let mut map = store.tilemap_read(asset_id)?;
    map.place(&layer, &placements)?;
    store.tilemap_write(asset_id, &map)
}

fn add_layer(store: &mut Store, asset_id: AssetId, name: String, parallax: f32) -> Result<Tilemap> {
    let mut map = store.tilemap_read(asset_id)?;
    map.add_layer(&name, parallax)?;
    store.tilemap_write(asset_id, &map)
}

fn remove_layer(store: &mut Store, asset_id: AssetId, name: String) -> Result<Tilemap> {
    let mut map = store.tilemap_read(asset_id)?;
    map.remove_layer(&name)?;
    store.tilemap_write(asset_id, &map)
}

fn set_layer(
    store: &mut Store,
    asset_id: AssetId,
    name: String,
    parallax: Option<f32>,
    visible: Option<bool>,
) -> Result<Tilemap> {
    let mut map = store.tilemap_read(asset_id)?;
    map.set_layer(&name, parallax, visible)?;
    store.tilemap_write(asset_id, &map)
}

fn tiles(store: &mut Store, asset_id: AssetId) -> Result<Vec<TileAsset>> {
    let map = store.tilemap_read(asset_id)?;
    let asset = store.asset_read(asset_id)?;
    let assets = store.asset_list(asset.project_id)?;
    assets
        .into_iter()
        .filter(|a| a.kind == "tile" && a.width == map.tile_width && a.height == map.tile_height)
        .map(|a| {
            let composite = store.asset_composite(a.id)?;
            let preview = format!(
                "data:image/png;base64,{}",
                raster::png::encode_base64(&composite)?
            );
            Ok(TileAsset {
                id: a.id,
                name: a.name,
                width: a.width,
                height: a.height,
                preview,
            })
        })
        .collect()
}

fn preview(store: &mut Store, asset_id: AssetId, layer: Option<String>) -> Result<String> {
    let image = store.tilemap_render(asset_id, layer.as_deref())?;
    Ok(format!(
        "data:image/png;base64,{}",
        raster::png::encode_base64(&image)?
    ))
}

#[tauri::command]
pub async fn tilemap_create<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    tile_width: u16,
    tile_height: u16,
    columns: u16,
    rows: u16,
) -> Result<Tilemap> {
    let map = run(&state, move |s| {
        create(s, asset_id, tile_width, tile_height, columns, rows)
    })
    .await?;
    emit_changed(&app, asset_id);
    Ok(map)
}

#[tauri::command]
pub async fn tilemap_read(state: State<'_, DocumentState>, asset_id: AssetId) -> Result<Tilemap> {
    run(&state, move |s| s.tilemap_read(asset_id)).await
}

#[tauri::command]
pub async fn tilemap_place<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    layer: String,
    placements: Vec<Placement>,
) -> Result<Tilemap> {
    let map = run(&state, move |s| place(s, asset_id, layer, placements)).await?;
    emit_changed(&app, asset_id);
    Ok(map)
}

#[tauri::command]
pub async fn tilemap_add_layer<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    name: String,
    parallax: f32,
) -> Result<Tilemap> {
    let map = run(&state, move |s| add_layer(s, asset_id, name, parallax)).await?;
    emit_changed(&app, asset_id);
    Ok(map)
}

#[tauri::command]
pub async fn tilemap_remove_layer<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    name: String,
) -> Result<Tilemap> {
    let map = run(&state, move |s| remove_layer(s, asset_id, name)).await?;
    emit_changed(&app, asset_id);
    Ok(map)
}

#[tauri::command]
pub async fn tilemap_set_layer<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    name: String,
    parallax: Option<f32>,
    visible: Option<bool>,
) -> Result<Tilemap> {
    let map = run(&state, move |s| {
        set_layer(s, asset_id, name, parallax, visible)
    })
    .await?;
    emit_changed(&app, asset_id);
    Ok(map)
}

#[tauri::command]
pub async fn tilemap_tiles(
    state: State<'_, DocumentState>,
    asset_id: AssetId,
) -> Result<Vec<TileAsset>> {
    run(&state, move |s| tiles(s, asset_id)).await
}

#[tauri::command]
pub async fn tilemap_preview(
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    layer: Option<String>,
) -> Result<String> {
    run(&state, move |s| preview(s, asset_id, layer)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raster::Placement;
    use crate::store::Store;

    fn background(store: &mut Store) -> AssetId {
        let project = store.project_create("Project", "gameboy").unwrap();
        let asset = store
            .asset_create(project.id, "Map", "background", 1, 1)
            .unwrap();
        asset.id
    }

    fn tile(store: &mut Store, project_id: uuid::Uuid, w: u16, h: u16) -> AssetId {
        // Asset names are unique within a project, so each tile gets its own.
        let name = format!("Tile {}", uuid::Uuid::now_v7());
        let asset = store.asset_create(project_id, &name, "tile", w, h).unwrap();
        asset.id
    }

    #[test]
    fn create_twice_is_exists() {
        let mut store = Store::memory().unwrap();
        let asset_id = background(&mut store);
        create(&mut store, asset_id, 16, 16, 4, 4).unwrap();
        let err = create(&mut store, asset_id, 16, 16, 4, 4).unwrap_err();
        assert_eq!(err.code, "tilemap.exists");
    }

    #[test]
    fn place_then_read_back() {
        let mut store = Store::memory().unwrap();
        let asset_id = background(&mut store);
        let map = create(&mut store, asset_id, 16, 16, 4, 4).unwrap();
        let project_id = store.asset_read(asset_id).unwrap().project_id;
        let tile_id = tile(&mut store, project_id, 16, 16);

        let placements = vec![Placement {
            x: 0,
            y: 0,
            tile: Some(tile_id.0),
        }];
        let placed = place(&mut store, asset_id, map.layers[0].name.clone(), placements).unwrap();
        assert_eq!(placed.layers[0].tiles[0], Some(tile_id.0));

        let read_back = store.tilemap_read(asset_id).unwrap();
        assert_eq!(read_back, placed);
    }

    #[test]
    fn tiles_lists_same_project_and_size() {
        let mut store = Store::memory().unwrap();
        let asset_id = background(&mut store);
        create(&mut store, asset_id, 16, 16, 4, 4).unwrap();
        let project_id = store.asset_read(asset_id).unwrap().project_id;

        let matching = tile(&mut store, project_id, 16, 16);
        let _wrong_size = tile(&mut store, project_id, 8, 8);
        let other_project = store.project_create("Other", "gameboy").unwrap();
        let _other_project_tile = tile(&mut store, other_project.id, 16, 16);

        let listed = tiles(&mut store, asset_id).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, matching);
        assert!(listed[0].preview.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn preview_of_one_tile_map_is_data_url() {
        let mut store = Store::memory().unwrap();
        let asset_id = background(&mut store);
        create(&mut store, asset_id, 16, 16, 1, 1).unwrap();

        let url = preview(&mut store, asset_id, None).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
    }
}
