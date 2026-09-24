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

//! Tilemaps: backgrounds built from tile assets placed on a grid.

use super::super::error::ToolError;
use super::super::host::{with_store, DocumentHost};
use super::super::session::Session;
use super::{asset_id, parse, resolve_asset, ToolResult, ToolSpec};
use crate::raster::{Placement, RasterError, Tilemap, TilemapLayer};
use crate::store::AppError;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

const CHARSET: &str = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

fn raster_err(error: RasterError) -> ToolError {
    ToolError::from(AppError::from(error))
}

/// The tile-width and tile-height and grid shape and layer summary every
/// tilemap tool returns.
fn summary(map: &Tilemap) -> Value {
    let layers: Vec<Value> = map
        .layers
        .iter()
        .map(|layer| {
            json!({
                "name": layer.name,
                "parallax": layer.parallax,
                "visible": layer.visible,
                "placed": layer.tiles.iter().filter(|t| t.is_some()).count(),
            })
        })
        .collect();
    json!({
        "tileWidth": map.tile_width,
        "tileHeight": map.tile_height,
        "columns": map.columns,
        "rows": map.rows,
        "layers": layers,
    })
}

// ---------------------------------------------------------------------------
// create_tilemap
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateTilemapArgs {
    asset_id: Option<String>,
    tile_width: u16,
    tile_height: u16,
    columns: u16,
    rows: u16,
}

fn create_tilemap_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": {
                "type": "string",
                "description": "The background asset's id; defaults to the session's open asset.",
            },
            "tileWidth": { "type": "integer", "minimum": 8, "maximum": 64 },
            "tileHeight": { "type": "integer", "minimum": 8, "maximum": 64 },
            "columns": { "type": "integer", "minimum": 1, "maximum": 256 },
            "rows": { "type": "integer", "minimum": 1, "maximum": 256 },
        },
        "required": ["tileWidth", "tileHeight", "columns", "rows"],
    })
}

fn create_tilemap(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: CreateTilemapArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let existing = with_store(host, |store| match store.tilemap_read(asset) {
        Ok(map) => Ok(Some(map)),
        Err(error) if error.code == "tilemap.none" => Ok(None),
        Err(error) => Err(error),
    })?;
    if existing.is_some() {
        return Err(ToolError::new(
            "tilemap.exists",
            format!("{} already has a tilemap", asset.0),
            "Call place_tiles or tilemap_layers to edit it, or read_tilemap to see it.",
        ));
    }
    let map = Tilemap::new(args.tile_width, args.tile_height, args.columns, args.rows)
        .map_err(raster_err)?;
    let stored = with_store(host, |store| store.tilemap_write(asset, &map))?;
    Ok(summary(&stored))
}

// ---------------------------------------------------------------------------
// read_tilemap
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadTilemapArgs {
    asset_id: Option<String>,
    layer: Option<String>,
}

fn read_tilemap_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string" },
            "layer": {
                "type": "string",
                "description": "Show only this layer; default is every layer, back to front.",
            },
        },
    })
}

fn read_tilemap(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: ReadTilemapArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let map = with_store(host, |store| store.tilemap_read(asset))?;

    let layers: Vec<&TilemapLayer> = match &args.layer {
        Some(name) => {
            let layer = map.layers.iter().find(|l| &l.name == name).ok_or_else(|| {
                ToolError::new(
                    "tilemap.layer_not_found",
                    format!("no layer named {name}"),
                    "Call read_tilemap without a layer to see the layer names.",
                )
            })?;
            vec![layer]
        }
        None => map.layers.iter().collect(),
    };

    // Symbols are assigned in order of first appearance, row-major within a
    // layer, then layer order (back to front).
    let mut symbols: Vec<uuid::Uuid> = Vec::new();
    for layer in &layers {
        for id in layer.tiles.iter().flatten() {
            if !symbols.contains(id) {
                symbols.push(*id);
            }
        }
    }
    if symbols.len() > CHARSET.len() {
        return Err(ToolError::new(
            "tilemap.too_many_tiles",
            format!(
                "{} distinct tiles is more than this grid can show",
                symbols.len()
            ),
            "Call read_tilemap with a single layer to see fewer tiles at once.",
        ));
    }
    let chars: Vec<char> = CHARSET.chars().collect();

    let names: HashMap<uuid::Uuid, String> = with_store(host, |store| {
        let mut names = HashMap::new();
        for id in &symbols {
            let tile_asset = store.asset_read(crate::store::AssetId(*id))?;
            names.insert(*id, tile_asset.name);
        }
        Ok(names)
    })?;

    let mut lines: Vec<String> = symbols
        .iter()
        .enumerate()
        .map(|(index, id)| format!("{} = {} ({})", chars[index], names[id], id))
        .collect();

    for layer in &layers {
        lines.push(format!(
            "layer {} (parallax {}, {}):",
            layer.name,
            layer.parallax,
            if layer.visible { "visible" } else { "hidden" },
        ));
        for row in 0..map.rows as usize {
            let mut line = String::with_capacity(map.columns as usize);
            for col in 0..map.columns as usize {
                let index = row * map.columns as usize + col;
                let ch = match layer.tiles[index] {
                    None => '.',
                    Some(id) => chars[symbols.iter().position(|s| *s == id).unwrap()],
                };
                line.push(ch);
            }
            lines.push(line);
        }
    }

    let mut result = summary(&map);
    result["text"] = json!(lines.join("\n"));
    Ok(result)
}

// ---------------------------------------------------------------------------
// place_tiles
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlacementArg {
    x: u16,
    y: u16,
    tile: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlaceTilesArgs {
    asset_id: Option<String>,
    layer: String,
    placements: Vec<PlacementArg>,
}

fn place_tiles_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string" },
            "layer": { "type": "string" },
            "placements": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "x": { "type": "integer", "minimum": 0 },
                        "y": { "type": "integer", "minimum": 0 },
                        "tile": {
                            "type": ["string", "null"],
                            "description": "A tile asset's id, or null to clear the cell.",
                        },
                    },
                    "required": ["x", "y", "tile"],
                },
            },
        },
        "required": ["layer", "placements"],
    })
}

fn place_tiles(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: PlaceTilesArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let mut placements = Vec::with_capacity(args.placements.len());
    for placement in &args.placements {
        let tile = match &placement.tile {
            Some(value) => Some(asset_id(value)?.0),
            None => None,
        };
        placements.push(Placement {
            x: placement.x,
            y: placement.y,
            tile,
        });
    }
    let (changed, map) = with_store(host, |store| {
        let mut map = store.tilemap_read(asset)?;
        let changed = map.place(&args.layer, &placements)?;
        let map = store.tilemap_write(asset, &map)?;
        Ok((changed, map))
    })?;
    host.tilemap_changed(asset);
    let mut result = json!({ "changed": changed });
    if let (Some(object), Some(fields)) = (result.as_object_mut(), summary(&map).as_object()) {
        for (key, value) in fields {
            object.insert(key.clone(), value.clone());
        }
    }
    Ok(result)
}

// ---------------------------------------------------------------------------
// tilemap_layers
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AddLayerArg {
    name: String,
    parallax: f32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetLayerArg {
    name: String,
    parallax: Option<f32>,
    visible: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TilemapLayersArgs {
    asset_id: Option<String>,
    add: Option<AddLayerArg>,
    remove: Option<String>,
    set: Option<SetLayerArg>,
}

fn tilemap_layers_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string" },
            "add": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "parallax": { "type": "number", "minimum": 0.0, "maximum": 4.0 },
                },
                "required": ["name", "parallax"],
            },
            "remove": { "type": "string" },
            "set": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "parallax": { "type": "number", "minimum": 0.0, "maximum": 4.0 },
                    "visible": { "type": "boolean" },
                },
                "required": ["name"],
            },
        },
    })
}

fn tilemap_layers(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: TilemapLayersArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let picked = [
        args.add.is_some(),
        args.remove.is_some(),
        args.set.is_some(),
    ]
    .iter()
    .filter(|present| **present)
    .count();
    if picked != 1 {
        return Err(ToolError::new(
            "args.invalid",
            "exactly one of add, remove or set is required",
            "Pass add, remove, or set — not zero and not more than one.",
        ));
    }
    let map = with_store(host, |store| {
        let mut map = store.tilemap_read(asset)?;
        if let Some(add) = &args.add {
            map.add_layer(&add.name, add.parallax)?;
        } else if let Some(name) = &args.remove {
            map.remove_layer(name)?;
        } else if let Some(set) = &args.set {
            map.set_layer(&set.name, set.parallax, set.visible)?;
        }
        store.tilemap_write(asset, &map)
    })?;
    host.tilemap_changed(asset);
    Ok(summary(&map))
}

// ---------------------------------------------------------------------------

pub fn tools() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "create_tilemap",
            description: "Start a tilemap on a background asset: a grid of tile-sized cells, \
                one layer named 'ground'. Tiles are ordinary 'tile' assets drawn first with the \
                normal tools; this only places them by id, and every placed tile must match the \
                map's tile size.",
            input_schema: create_tilemap_schema,
            handler: create_tilemap,
        },
        ToolSpec {
            name: "read_tilemap",
            description: "See a tilemap as a text grid: one character per cell ('.' empty, then \
                a-z, A-Z, 0-9 per distinct tile in the order it first appears), with a legend \
                naming each tile asset, and each layer's parallax and visibility.",
            input_schema: read_tilemap_schema,
            handler: read_tilemap,
        },
        ToolSpec {
            name: "place_tiles",
            description: "Place or clear tiles on one layer of a tilemap by cell. `tile` is a \
                tile asset's id, drawn beforehand with the normal tools, or null to clear the \
                cell. Refreshes the open window.",
            input_schema: place_tiles_schema,
            handler: place_tiles,
        },
        ToolSpec {
            name: "tilemap_layers",
            description: "Add, remove, or reconfigure one layer of a tilemap — exactly one of \
                add, remove, or set per call. Layers are drawn back to front; parallax scales \
                how fast a layer scrolls relative to the camera.",
            input_schema: tilemap_layers_schema,
            handler: tilemap_layers,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::host::HeadlessHost;
    use crate::mcp::tools::call;
    use crate::store::{AssetId, Store};
    use uuid::Uuid;

    fn setup() -> (HeadlessHost, Session, Uuid, AssetId) {
        let mut store = Store::memory().unwrap();
        let project = store.project_create("demo", "hd2d").unwrap();
        let background = store
            .asset_create(project.id, "bg", "background", 64, 64)
            .unwrap();
        let host = HeadlessHost::new(store);
        (host, Session::new("test"), project.id, background.id)
    }

    fn make_tile(host: &HeadlessHost, project: Uuid, name: &str, size: u16) -> AssetId {
        let arc = host.store();
        let mut store = arc.lock().unwrap();
        store
            .asset_create(project, name, "tile", size, size)
            .unwrap()
            .id
    }

    #[test]
    fn creating_twice_is_refused() {
        let (host, session, _project, bg) = setup();
        let args = json!({
            "assetId": bg.0.to_string(),
            "tileWidth": 16, "tileHeight": 16, "columns": 4, "rows": 4,
        });
        let first = call(&host, &session, "create_tilemap", args.clone()).unwrap();
        assert_eq!(first["columns"], 4);
        let err = call(&host, &session, "create_tilemap", args).unwrap_err();
        assert_eq!(err.code, "tilemap.exists");
    }

    #[test]
    fn placing_two_tiles_shows_them_in_the_grid_with_a_legend() {
        let (host, session, project, bg) = setup();
        call(
            &host,
            &session,
            "create_tilemap",
            json!({ "assetId": bg.0.to_string(), "tileWidth": 16, "tileHeight": 16, "columns": 3, "rows": 2 }),
        )
        .unwrap();
        let grass = make_tile(&host, project, "grass", 16);
        let stone = make_tile(&host, project, "stone", 16);

        let placed = call(
            &host,
            &session,
            "place_tiles",
            json!({
                "assetId": bg.0.to_string(),
                "layer": "ground",
                "placements": [
                    { "x": 0, "y": 0, "tile": grass.0.to_string() },
                    { "x": 2, "y": 1, "tile": stone.0.to_string() },
                ],
            }),
        )
        .unwrap();
        assert_eq!(placed["changed"], 2);

        let read = call(
            &host,
            &session,
            "read_tilemap",
            json!({ "assetId": bg.0.to_string() }),
        )
        .unwrap();
        let text = read["text"].as_str().unwrap();
        assert!(text.contains(&format!("a = grass ({})", grass.0)));
        assert!(text.contains(&format!("b = stone ({})", stone.0)));
        let lines: Vec<&str> = text.lines().collect();
        assert!(lines.contains(&"a.."));
        assert!(lines.contains(&"..b"));
    }

    #[test]
    fn placing_out_of_bounds_changes_nothing() {
        let (host, session, project, bg) = setup();
        call(
            &host,
            &session,
            "create_tilemap",
            json!({ "assetId": bg.0.to_string(), "tileWidth": 16, "tileHeight": 16, "columns": 2, "rows": 2 }),
        )
        .unwrap();
        let grass = make_tile(&host, project, "grass", 16);
        let err = call(
            &host,
            &session,
            "place_tiles",
            json!({
                "assetId": bg.0.to_string(),
                "layer": "ground",
                "placements": [{ "x": 5, "y": 0, "tile": grass.0.to_string() }],
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "tilemap.out_of_bounds");

        let read = call(
            &host,
            &session,
            "read_tilemap",
            json!({ "assetId": bg.0.to_string() }),
        )
        .unwrap();
        assert_eq!(read["layers"][0]["placed"], 0);
    }

    #[test]
    fn tilemap_layers_add_set_and_remove() {
        let (host, session, _project, bg) = setup();
        call(
            &host,
            &session,
            "create_tilemap",
            json!({ "assetId": bg.0.to_string(), "tileWidth": 16, "tileHeight": 16, "columns": 2, "rows": 2 }),
        )
        .unwrap();

        let added = call(
            &host,
            &session,
            "tilemap_layers",
            json!({ "assetId": bg.0.to_string(), "add": { "name": "sky", "parallax": 0.5 } }),
        )
        .unwrap();
        assert_eq!(added["layers"].as_array().unwrap().len(), 2);

        let set = call(
            &host,
            &session,
            "tilemap_layers",
            json!({ "assetId": bg.0.to_string(), "set": { "name": "sky", "visible": false } }),
        )
        .unwrap();
        let sky = set["layers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|layer| layer["name"] == "sky")
            .unwrap();
        assert_eq!(sky["visible"], false);

        let removed = call(
            &host,
            &session,
            "tilemap_layers",
            json!({ "assetId": bg.0.to_string(), "remove": "sky" }),
        )
        .unwrap();
        assert_eq!(removed["layers"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn neither_or_two_of_add_remove_set_is_invalid() {
        let (host, session, _project, bg) = setup();
        call(
            &host,
            &session,
            "create_tilemap",
            json!({ "assetId": bg.0.to_string(), "tileWidth": 16, "tileHeight": 16, "columns": 2, "rows": 2 }),
        )
        .unwrap();

        let neither = call(
            &host,
            &session,
            "tilemap_layers",
            json!({ "assetId": bg.0.to_string() }),
        )
        .unwrap_err();
        assert_eq!(neither.code, "args.invalid");

        let both = call(
            &host,
            &session,
            "tilemap_layers",
            json!({
                "assetId": bg.0.to_string(),
                "remove": "ground",
                "set": { "name": "ground" },
            }),
        )
        .unwrap_err();
        assert_eq!(both.code, "args.invalid");
    }

    #[test]
    fn a_wrong_sized_tile_is_refused() {
        let (host, session, project, bg) = setup();
        call(
            &host,
            &session,
            "create_tilemap",
            json!({ "assetId": bg.0.to_string(), "tileWidth": 16, "tileHeight": 16, "columns": 2, "rows": 2 }),
        )
        .unwrap();
        let too_big = make_tile(&host, project, "boulder", 32);
        let err = call(
            &host,
            &session,
            "place_tiles",
            json!({
                "assetId": bg.0.to_string(),
                "layer": "ground",
                "placements": [{ "x": 0, "y": 0, "tile": too_big.0.to_string() }],
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "tilemap.tile_invalid");
    }
}
