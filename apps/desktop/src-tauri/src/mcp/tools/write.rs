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

//! Writing pixels: grids, runs, pixels, shapes, fills, mirror, translate, clear.
use super::super::error::ToolError;
use super::super::host::DocumentHost;
use super::super::session::Session;
use super::{guard_step, parse, resolve_asset, role, summary, ToolResult, ToolSpec};
use bitwright::raster::document_ops::{Axis, PasteMode, PixelSet, Point, Run, Shape};
use bitwright::raster::Op;
use serde::Deserialize;
use serde_json::{json, Value};

/// Run one unit of work that may call `guard_step`, returning `ToolResult`.
///
/// `with_store` expects its closure to return `Result<T, AppError>`, but
/// `guard_step` returns `ToolError`. This helper bridges the two: the
/// inner closure converts every `AppError` to `ToolError` before the
/// `?` operator touches it, so the outer `?` converts `AppError` back
/// to `ToolError` at the `with_store` boundary.
fn with_tool_store<T>(
    host: &dyn DocumentHost,
    work: impl FnOnce(&mut bitwright::store::Store) -> Result<T, ToolError>,
) -> Result<T, ToolError> {
    let arc = host.store();
    let mut store = arc.lock().map_err(|_| {
        ToolError::new(
            "store.lock_failed",
            "document store lock was poisoned",
            "Try the call again; the lock will have been released.",
        )
    })?;
    let value = work(&mut store).map_err(ToolError::from)?;
    Ok(value)
}

// ---------------------------------------------------------------------------
// paste_grid
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PasteGridArgs {
    asset_id: Option<String>,
    layer: String,
    x: u16,
    y: u16,
    rows: Vec<String>,
    mode: Option<PasteMode>,
    force: Option<bool>,
}

fn paste_grid_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "layer": { "type": "string" },
            "x": { "type": "integer", "minimum": 0 },
            "y": { "type": "integer", "minimum": 0 },
            "rows": {
                "type": "array",
                "items": { "type": "string" },
                "minItems": 1
            },
            "mode": {
                "type": "string",
                "enum": ["replace", "over"]
            },
            "force": { "type": "boolean" }
        },
        "required": ["layer", "x", "y", "rows"],
        "additionalProperties": false
    })
}

fn validate_grid(rows: &[String]) -> Result<(), ToolError> {
    if rows.is_empty() {
        return Ok(());
    }
    let expected = rows[0].len();
    for (i, row) in rows.iter().enumerate().skip(1) {
        if row.len() != expected {
            return Err(ToolError::new(
                "grid.size_mismatch",
                format!(
                    "row {} has {} characters but row 0 has {}",
                    i,
                    row.len(),
                    expected
                ),
                format!(
                    "All rows must have the same length. The first row (0) has {} characters.",
                    expected
                ),
            ));
        }
    }
    Ok(())
}

fn paste_grid_handler(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: PasteGridArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let layer = role(&args.layer)?;
    validate_grid(&args.rows)?;
    let mode = args.mode.unwrap_or_default();
    let force = args.force.unwrap_or(false);
    let op = Op::PasteGrid {
        layer,
        x: args.x,
        y: args.y,
        rows: args.rows,
        mode,
    };
    let target = op.target();
    with_tool_store(host, |store| {
        let asset_data = store.asset_read(asset)?;
        guard_step(&asset_data, target, force)?;
        let result = store.write_ops(asset, vec![op], &session.actor())?;
        host.changed(asset, &result);
        Ok(summary(&result))
    })
}

// ---------------------------------------------------------------------------
// draw_runs
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DrawRunsArgs {
    asset_id: Option<String>,
    layer: String,
    runs: Vec<Run>,
    force: Option<bool>,
}

fn draw_runs_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "layer": { "type": "string" },
            "runs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "y": { "type": "integer" },
                        "x0": { "type": "integer" },
                        "x1": { "type": "integer" },
                        "slot": { "type": "integer", "minimum": 0, "maximum": 63 }
                    },
                    "required": ["y", "x0", "x1", "slot"]
                },
                "minItems": 1
            },
            "force": { "type": "boolean" }
        },
        "required": ["layer", "runs"],
        "additionalProperties": false
    })
}

fn draw_runs_handler(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: DrawRunsArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let layer = role(&args.layer)?;
    let force = args.force.unwrap_or(false);
    if args.runs.is_empty() {
        return Err(ToolError::new(
            "args.invalid",
            "runs must contain at least one run",
            "Provide at least one run with y, x0, x1, and slot.",
        ));
    }
    let op = Op::DrawRuns {
        layer,
        runs: args.runs,
    };
    let target = op.target();
    with_tool_store(host, |store| {
        let asset_data = store.asset_read(asset)?;
        guard_step(&asset_data, target, force)?;
        let result = store.write_ops(asset, vec![op], &session.actor())?;
        host.changed(asset, &result);
        Ok(summary(&result))
    })
}

// ---------------------------------------------------------------------------
// set_pixels
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetPixelsArgs {
    asset_id: Option<String>,
    layer: String,
    pixels: Vec<PixelSet>,
    force: Option<bool>,
}

fn set_pixels_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "layer": { "type": "string" },
            "pixels": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "x": { "type": "integer" },
                        "y": { "type": "integer" },
                        "slot": { "type": "integer", "minimum": 0, "maximum": 63 }
                    },
                    "required": ["x", "y", "slot"]
                },
                "minItems": 1,
                "maxItems": 512
            },
            "force": { "type": "boolean" }
        },
        "required": ["layer", "pixels"],
        "additionalProperties": false
    })
}

fn set_pixels_handler(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: SetPixelsArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let layer = role(&args.layer)?;
    let force = args.force.unwrap_or(false);
    if args.pixels.is_empty() {
        return Err(ToolError::new(
            "args.invalid",
            "pixels must contain at least one pixel",
            "Provide between 1 and 512 pixels.",
        ));
    }
    if args.pixels.len() > 512 {
        return Err(ToolError::new(
            "args.invalid",
            format!("too many pixels: {} (maximum is 512)", args.pixels.len()),
            "Use paste_grid or draw_runs for more than 512 pixels.",
        ));
    }
    let op = Op::SetPixels {
        layer,
        pixels: args.pixels,
    };
    let target = op.target();
    with_tool_store(host, |store| {
        let asset_data = store.asset_read(asset)?;
        guard_step(&asset_data, target, force)?;
        let result = store.write_ops(asset, vec![op], &session.actor())?;
        host.changed(asset, &result);
        Ok(summary(&result))
    })
}

// ---------------------------------------------------------------------------
// clear_layer
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClearLayerArgs {
    asset_id: Option<String>,
    layer: String,
    force: Option<bool>,
}

fn clear_layer_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "layer": { "type": "string" },
            "force": { "type": "boolean" }
        },
        "required": ["layer"],
        "additionalProperties": false
    })
}

fn clear_layer_handler(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: ClearLayerArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let layer = role(&args.layer)?;
    let force = args.force.unwrap_or(false);
    let op = Op::Clear { layer };
    let target = op.target();
    with_tool_store(host, |store| {
        let asset_data = store.asset_read(asset)?;
        guard_step(&asset_data, target, force)?;
        let result = store.write_ops(asset, vec![op], &session.actor())?;
        host.changed(asset, &result);
        Ok(summary(&result))
    })
}

// ---------------------------------------------------------------------------
// draw_shape
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DrawShapeArgs {
    asset_id: Option<String>,
    layer: String,
    shape: Shape,
    from: Point,
    to: Point,
    slot: u8,
    fill: Option<bool>,
    pixel_perfect: Option<bool>,
    force: Option<bool>,
}

fn draw_shape_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "layer": { "type": "string" },
            "shape": {
                "type": "string",
                "enum": ["line", "rect", "ellipse", "curve"]
            },
            "from": {
                "type": "object",
                "properties": {
                    "x": { "type": "integer" },
                    "y": { "type": "integer" }
                },
                "required": ["x", "y"]
            },
            "to": {
                "type": "object",
                "properties": {
                    "x": { "type": "integer" },
                    "y": { "type": "integer" }
                },
                "required": ["x", "y"]
            },
            "slot": { "type": "integer", "minimum": 0, "maximum": 63 },
            "fill": { "type": "boolean", "default": false },
            "pixelPerfect": { "type": "boolean", "default": true },
            "force": { "type": "boolean" }
        },
        "required": ["layer", "shape", "from", "to", "slot"],
        "additionalProperties": false
    })
}

fn draw_shape_handler(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: DrawShapeArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let layer = role(&args.layer)?;
    let force = args.force.unwrap_or(false);
    let op = Op::DrawShape {
        layer,
        shape: args.shape,
        from: args.from,
        to: args.to,
        slot: args.slot,
        fill: args.fill.unwrap_or(false),
        pixel_perfect: args.pixel_perfect.unwrap_or(true),
    };
    let target = op.target();
    with_tool_store(host, |store| {
        let asset_data = store.asset_read(asset)?;
        guard_step(&asset_data, target, force)?;
        let result = store.write_ops(asset, vec![op], &session.actor())?;
        host.changed(asset, &result);
        Ok(summary(&result))
    })
}

// ---------------------------------------------------------------------------
// fill_region
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FillRegionArgs {
    asset_id: Option<String>,
    layer: String,
    x: u16,
    y: u16,
    slot: u8,
    contiguous: Option<bool>,
    force: Option<bool>,
}

fn fill_region_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "layer": { "type": "string" },
            "x": { "type": "integer", "minimum": 0 },
            "y": { "type": "integer", "minimum": 0 },
            "slot": { "type": "integer", "minimum": 0, "maximum": 63 },
            "contiguous": { "type": "boolean", "default": true },
            "force": { "type": "boolean" }
        },
        "required": ["layer", "x", "y", "slot"],
        "additionalProperties": false
    })
}

fn fill_region_handler(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: FillRegionArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let layer = role(&args.layer)?;
    let force = args.force.unwrap_or(false);
    let op = Op::FillRegion {
        layer,
        x: args.x,
        y: args.y,
        slot: args.slot,
        contiguous: args.contiguous.unwrap_or(true),
    };
    let target = op.target();
    with_tool_store(host, |store| {
        let asset_data = store.asset_read(asset)?;
        guard_step(&asset_data, target, force)?;
        let result = store.write_ops(asset, vec![op], &session.actor())?;
        host.changed(asset, &result);
        Ok(summary(&result))
    })
}

// ---------------------------------------------------------------------------
// mirror
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MirrorArgs {
    asset_id: Option<String>,
    layer: String,
    axis: Axis,
    about: Option<u16>,
    force: Option<bool>,
}

fn mirror_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "layer": { "type": "string" },
            "axis": {
                "type": "string",
                "enum": ["x", "y"]
            },
            "about": { "type": "integer", "minimum": 0 },
            "force": { "type": "boolean" }
        },
        "required": ["layer", "axis"],
        "additionalProperties": false
    })
}

fn mirror_handler(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: MirrorArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let layer = role(&args.layer)?;
    let force = args.force.unwrap_or(false);
    let op = Op::Mirror {
        layer,
        axis: args.axis,
        about: args.about,
    };
    let target = op.target();
    with_tool_store(host, |store| {
        let asset_data = store.asset_read(asset)?;
        guard_step(&asset_data, target, force)?;
        let result = store.write_ops(asset, vec![op], &session.actor())?;
        host.changed(asset, &result);
        Ok(summary(&result))
    })
}

// ---------------------------------------------------------------------------
// translate
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TranslateArgs {
    asset_id: Option<String>,
    layer: String,
    dx: i32,
    dy: i32,
    force: Option<bool>,
}

fn translate_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "layer": { "type": "string" },
            "dx": { "type": "integer" },
            "dy": { "type": "integer" },
            "force": { "type": "boolean" }
        },
        "required": ["layer", "dx", "dy"],
        "additionalProperties": false
    })
}

fn translate_handler(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: TranslateArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let layer = role(&args.layer)?;
    let force = args.force.unwrap_or(false);
    let op = Op::Translate {
        layer,
        dx: args.dx,
        dy: args.dy,
    };
    let target = op.target();
    with_tool_store(host, |store| {
        let asset_data = store.asset_read(asset)?;
        guard_step(&asset_data, target, force)?;
        let layer_data = store.layer_read(asset, target)?;
        let w = i32::from(layer_data.buffer.width);
        let h = i32::from(layer_data.buffer.height);
        let mut lost = 0u32;
        for (i, &slot) in layer_data.buffer.data.iter().enumerate() {
            if slot != 0 {
                let x = i64::from((i as i32) % w);
                let y = i64::from((i as i32) / w);
                let nx = x + i64::from(args.dx);
                let ny = y + i64::from(args.dy);
                if nx < 0 || nx >= i64::from(w) || ny < 0 || ny >= i64::from(h) {
                    lost += 1;
                }
            }
        }
        let result = store.write_ops(asset, vec![op], &session.actor())?;
        host.changed(asset, &result);
        let mut val = summary(&result);
        val["lost"] = json!(lost);
        Ok(val)
    })
}
// ---------------------------------------------------------------------------
// catalogue
// ---------------------------------------------------------------------------

pub fn tools() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "paste_grid",
            description: "Paste a block of rows onto a layer. Characters: . is \
                transparent, A-Z are slots 1-26, a-z 27-52, 0-9 53-62. The \
                natural tool for a silhouette or a whole tile. mode over keeps \
                existing pixels under the grid's dots.",
            input_schema: paste_grid_schema,
            handler: paste_grid_handler,
        },
        ToolSpec {
            name: "draw_runs",
            description: "Fill horizontal spans, each stating its own row, \
                first and last column (inclusive) and slot. The most robust \
                way to fill a shape scanline by scanline.",
            input_schema: draw_runs_schema,
            handler: draw_runs_handler,
        },
        ToolSpec {
            name: "set_pixels",
            description: "Set up to 512 individual pixels. For corrections; \
                use paste_grid or draw_runs for anything larger.",
            input_schema: set_pixels_schema,
            handler: set_pixels_handler,
        },
        ToolSpec {
            name: "clear_layer",
            description: "Empty a layer. One undo step.",
            input_schema: clear_layer_schema,
            handler: clear_layer_handler,
        },
        ToolSpec {
            name: "draw_shape",
            description: "Draw a line, rectangle, ellipse or curve between \
                two points. pixelPerfect (default true) drops the doubled \
                corner pixels on diagonals.",
            input_schema: draw_shape_schema,
            handler: draw_shape_handler,
        },
        ToolSpec {
            name: "fill_region",
            description: "Flood-fill from a seed pixel over the slot found \
                there, four-connected.",
            input_schema: fill_region_schema,
            handler: fill_region_handler,
        },
        ToolSpec {
            name: "mirror",
            description: "Mirror a layer across the x or y axis, about a \
                column or row if given. Draw one half of a symmetric sprite, \
                then mirror.",
            input_schema: mirror_schema,
            handler: mirror_handler,
        },
        ToolSpec {
            name: "translate",
            description: "Shift a layer's content. Pixels pushed off the \
                canvas are lost; the response says how many.",
            input_schema: translate_schema,
            handler: translate_handler,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::host::HeadlessHost;
    use crate::store::Store;
    use bitwright::raster::{Palette, PaletteSlot};
    use serde_json::json;

    fn setup() -> (HeadlessHost, Session) {
        let host = HeadlessHost::new(Store::memory().unwrap());
        let session = Session::new("test");
        (host, session)
    }

    /// Write a palette with enough slots for tests, then create a project
    /// and asset. Returns the asset id as a string.
    fn create_asset(host: &HeadlessHost) -> String {
        with_tool_store(host, |store| {
            let project = store.project_create("Test", "hd2d")?;
            let asset = store.asset_create(project.id, "Hero", "character", 8, 8)?;
            let palette = Palette {
                slots: (1..=10)
                    .map(|i| PaletteSlot {
                        index: i,
                        rgba: [i * 20, i * 15, i * 10, 255],
                        name: None,
                        ramp: None,
                        step: None,
                    })
                    .collect(),
                ramps: vec![],
            };
            store.palette_write(asset.id, palette)?;
            Ok(asset.id.0.to_string())
        })
        .unwrap()
    }

    // ----- paste_grid -----

    #[test]
    fn paste_grid_writes_rows_onto_the_layer() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        let result = super::super::call(
            &host,
            &session,
            "paste_grid",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "x": 0,
                "y": 0,
                "rows": ["A.", ".B"],
                "force": true
            }),
        )
        .unwrap();
        assert!(result["changed"].as_u64().unwrap() > 0);
        with_tool_store(&host, |store| {
            let id = crate::mcp::tools::asset_id(&asset_id).unwrap();
            let layer = store.layer_read(id, bitwright::raster::LayerRole("silhouette"))?;
            assert_eq!(layer.buffer.data[0], 1);
            assert_eq!(layer.buffer.data[1], 0);
            assert_eq!(layer.buffer.data[8], 0);
            assert_eq!(layer.buffer.data[9], 2);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn paste_grid_rejects_rows_of_different_lengths() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        let err = super::super::call(
            &host,
            &session,
            "paste_grid",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "x": 0,
                "y": 0,
                "rows": ["AB", "A"]
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "grid.size_mismatch");
        assert!(err.message.contains("row 1"), "{}", err.message);
    }

    #[test]
    fn paste_grid_with_mode_over_preserves_existing_pixels() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        // First paste: A at (0,0), transparent at (1,0).
        super::super::call(
            &host,
            &session,
            "paste_grid",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "x": 0,
                "y": 0,
                "rows": ["A."],
                "force": true
            }),
        )
        .unwrap();
        // Second paste with mode over: "." at (0,0) won't overwrite A,
        // "B" at (1,0) fills the empty cell.
        super::super::call(
            &host,
            &session,
            "paste_grid",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "x": 0,
                "y": 0,
                "rows": [".B"],
                "mode": "over",
                "force": true
            }),
        )
        .unwrap();
        with_tool_store(&host, |store| {
            let id = crate::mcp::tools::asset_id(&asset_id).unwrap();
            let layer = store.layer_read(id, bitwright::raster::LayerRole("silhouette"))?;
            assert_eq!(layer.buffer.data[0], 1, "A should remain from first paste");
            assert_eq!(layer.buffer.data[1], 2, "B should fill the empty cell");
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn step_wrong_without_force() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        let err = super::super::call(
            &host,
            &session,
            "paste_grid",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "x": 0,
                "y": 0,
                "rows": ["A"]
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "step.wrong");
        assert!(err.hint.contains("force"));
    }

    // ----- draw_runs -----

    #[test]
    fn draw_runs_writes_horizontal_spans() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        let result = super::super::call(
            &host,
            &session,
            "draw_runs",
            json!({
                "assetId": asset_id,
                "layer": "flats",
                "runs": [
                    { "y": 0, "x0": 0, "x1": 2, "slot": 5 },
                    { "y": 1, "x0": 1, "x1": 3, "slot": 7 }
                ],
                "force": true
            }),
        )
        .unwrap();
        assert!(result["changed"].as_u64().unwrap() > 0);
        with_tool_store(&host, |store| {
            let id = crate::mcp::tools::asset_id(&asset_id).unwrap();
            let layer = store.layer_read(id, bitwright::raster::LayerRole("flats"))?;
            assert_eq!(layer.buffer.data[0], 5);
            assert_eq!(layer.buffer.data[1], 5);
            assert_eq!(layer.buffer.data[2], 5);
            assert_eq!(layer.buffer.data[3], 0, "col 3 untouched");
            assert_eq!(layer.buffer.data[8], 0, "col 0 untouched");
            assert_eq!(layer.buffer.data[9], 7);
            assert_eq!(layer.buffer.data[10], 7);
            assert_eq!(layer.buffer.data[11], 7);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn draw_runs_rejects_empty_runs() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        let err = super::super::call(
            &host,
            &session,
            "draw_runs",
            json!({
                "assetId": asset_id,
                "layer": "flats",
                "runs": [],
                "force": true
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "args.invalid");
    }

    // ----- set_pixels -----

    #[test]
    fn set_pixels_writes_individual_pixels() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        let result = super::super::call(
            &host,
            &session,
            "set_pixels",
            json!({
                "assetId": asset_id,
                "layer": "outline",
                "pixels": [
                    { "x": 0, "y": 0, "slot": 3 },
                    { "x": 5, "y": 7, "slot": 9 }
                ],
                "force": true
            }),
        )
        .unwrap();
        assert!(result["changed"].as_u64().unwrap() > 0);
        with_tool_store(&host, |store| {
            let id = crate::mcp::tools::asset_id(&asset_id).unwrap();
            let layer = store.layer_read(id, bitwright::raster::LayerRole("outline"))?;
            assert_eq!(layer.buffer.data[0], 3);
            assert_eq!(layer.buffer.get(5, 7), 9);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn set_pixels_rejects_more_than_512() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        let pixels: Vec<_> = (0..513)
            .map(|i| json!({ "x": i % 8, "y": i / 8, "slot": 1 }))
            .collect();
        let err = super::super::call(
            &host,
            &session,
            "set_pixels",
            json!({
                "assetId": asset_id,
                "layer": "flats",
                "pixels": pixels,
                "force": true
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "args.invalid");
        assert!(err.hint.contains("paste_grid"));
    }

    #[test]
    fn set_pixels_rejects_empty_pixels() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        let err = super::super::call(
            &host,
            &session,
            "set_pixels",
            json!({
                "assetId": asset_id,
                "layer": "flats",
                "pixels": [],
                "force": true
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "args.invalid");
    }

    // ----- clear_layer -----

    #[test]
    fn clear_layer_empties_the_layer() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        super::super::call(
            &host,
            &session,
            "paste_grid",
            json!({
                "assetId": asset_id,
                "layer": "detail",
                "x": 0,
                "y": 0,
                "rows": ["AA", "AA"],
                "force": true
            }),
        )
        .unwrap();
        with_tool_store(&host, |store| {
            let id = crate::mcp::tools::asset_id(&asset_id).unwrap();
            let layer = store.layer_read(id, bitwright::raster::LayerRole("detail"))?;
            assert!(layer.buffer.data.iter().any(|&s| s != 0));
            Ok(())
        })
        .unwrap();
        let result = super::super::call(
            &host,
            &session,
            "clear_layer",
            json!({
                "assetId": asset_id,
                "layer": "detail",
                "force": true
            }),
        )
        .unwrap();
        assert!(result["changed"].as_u64().unwrap() > 0);
        with_tool_store(&host, |store| {
            let id = crate::mcp::tools::asset_id(&asset_id).unwrap();
            let layer = store.layer_read(id, bitwright::raster::LayerRole("detail"))?;
            assert!(
                layer.buffer.data.iter().all(|&s| s == 0),
                "layer should be empty after clear"
            );
            Ok(())
        })
        .unwrap();
    }

    // ----- coordinate bounds -----
    // paste_grid uses u16 coords so it silently skips off-canvas cells;
    // set_pixels uses i32 coords, so a value beyond 65535 triggers
    // the raster engine's coordinate range check ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ bounds.outside.

    #[test]
    fn set_pixels_outside_canvas_gives_bounds_outside() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        let err = super::super::call(
            &host,
            &session,
            "set_pixels",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "pixels": [{ "x": -65536, "y": 0, "slot": 1 }],
                "force": true
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "bounds.outside");
    }

    // ----- draw_shape -----

    #[test]
    fn draw_shape_changes_the_layer() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        let result = super::super::call(
            &host,
            &session,
            "draw_shape",
            json!({
                "assetId": asset_id,
                "layer": "flats",
                "shape": "rect",
                "from": { "x": 0, "y": 0 },
                "to": { "x": 7, "y": 7 },
                "slot": 3,
                "fill": true,
                "force": true
            }),
        )
        .unwrap();
        assert!(result["changed"].as_u64().unwrap() > 0);
        with_tool_store(&host, |store| {
            let id = crate::mcp::tools::asset_id(&asset_id).unwrap();
            let layer = store.layer_read(id, bitwright::raster::LayerRole("flats"))?;
            assert_eq!(layer.buffer.data[0], 3);
            assert_eq!(layer.buffer.get(7, 7), 3);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn draw_shape_rejects_bad_shape_name() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        let err = super::super::call(
            &host,
            &session,
            "draw_shape",
            json!({
                "assetId": asset_id,
                "layer": "flats",
                "shape": "triangle",
                "from": { "x": 0, "y": 0 },
                "to": { "x": 7, "y": 7 },
                "slot": 1,
                "force": true
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "args.invalid");
    }

    #[test]
    fn draw_shape_step_wrong_without_force() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        let err = super::super::call(
            &host,
            &session,
            "draw_shape",
            json!({
                "assetId": asset_id,
                "layer": "flats",
                "shape": "line",
                "from": { "x": 0, "y": 0 },
                "to": { "x": 7, "y": 7 },
                "slot": 1
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "step.wrong");
        assert!(err.hint.contains("force"));
    }

    // ----- fill_region -----

    #[test]
    fn fill_region_changes_the_layer() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        super::super::call(
            &host,
            &session,
            "paste_grid",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "x": 0,
                "y": 0,
                "rows": ["A.", ".B"],
                "force": true
            }),
        )
        .unwrap();
        let result = super::super::call(
            &host,
            &session,
            "fill_region",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "x": 1,
                "y": 0,
                "slot": 5,
                "force": true
            }),
        )
        .unwrap();
        assert!(result["changed"].as_u64().unwrap() > 0);
        with_tool_store(&host, |store| {
            let id = crate::mcp::tools::asset_id(&asset_id).unwrap();
            let layer = store.layer_read(id, bitwright::raster::LayerRole("silhouette"))?;
            assert_eq!(layer.buffer.get(1, 0), 5, "seed pixel should have slot 5");
            assert_eq!(layer.buffer.get(0, 0), 1, "A pixel should remain");
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn fill_region_step_wrong_without_force() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        let err = super::super::call(
            &host,
            &session,
            "fill_region",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "x": 0,
                "y": 0,
                "slot": 1
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "step.wrong");
        assert!(err.hint.contains("force"));
    }

    // ----- mirror -----

    #[test]
    fn mirror_changes_the_layer() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        super::super::call(
            &host,
            &session,
            "paste_grid",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "x": 0,
                "y": 0,
                "rows": ["A."],
                "force": true
            }),
        )
        .unwrap();
        let result = super::super::call(
            &host,
            &session,
            "mirror",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "axis": "x",
                "force": true
            }),
        )
        .unwrap();
        assert!(result["changed"].as_u64().unwrap() > 0);
        with_tool_store(&host, |store| {
            let id = crate::mcp::tools::asset_id(&asset_id).unwrap();
            let layer = store.layer_read(id, bitwright::raster::LayerRole("silhouette"))?;
            assert_eq!(
                layer.buffer.get(0, 0),
                0,
                "original position should be empty"
            );
            assert_eq!(
                layer.buffer.get(7, 0),
                1,
                "mirrored pixel should land at far edge"
            );
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn mirror_step_wrong_without_force() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        let err = super::super::call(
            &host,
            &session,
            "mirror",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "axis": "x"
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "step.wrong");
        assert!(err.hint.contains("force"));
    }

    // ----- translate -----

    #[test]
    fn translate_shifts_content() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        super::super::call(
            &host,
            &session,
            "paste_grid",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "x": 0,
                "y": 0,
                "rows": ["A."],
                "force": true
            }),
        )
        .unwrap();
        let result = super::super::call(
            &host,
            &session,
            "translate",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "dx": 1,
                "dy": 0,
                "force": true
            }),
        )
        .unwrap();
        assert!(result["changed"].as_u64().unwrap() > 0);
        assert_eq!(result["lost"].as_u64().unwrap(), 0);
        with_tool_store(&host, |store| {
            let id = crate::mcp::tools::asset_id(&asset_id).unwrap();
            let layer = store.layer_read(id, bitwright::raster::LayerRole("silhouette"))?;
            assert_eq!(
                layer.buffer.get(0, 0),
                0,
                "original position should be empty"
            );
            assert_eq!(layer.buffer.get(1, 0), 1, "pixel should shift right");
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn translate_reports_lost_pixels() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        super::super::call(
            &host,
            &session,
            "paste_grid",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "x": 0,
                "y": 0,
                "rows": ["A."],
                "force": true
            }),
        )
        .unwrap();
        let result = super::super::call(
            &host,
            &session,
            "translate",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "dx": -1,
                "dy": 0,
                "force": true
            }),
        )
        .unwrap();
        assert_eq!(result["lost"].as_u64().unwrap(), 1);
    }

    #[test]
    fn translate_extreme_shift_does_not_panic() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        super::super::call(
            &host,
            &session,
            "paste_grid",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "x": 1,
                "y": 0,
                "rows": ["AA"],
                "force": true
            }),
        )
        .unwrap();
        let outcome = super::super::call(
            &host,
            &session,
            "translate",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "dx": i32::MAX,
                "dy": 0,
                "force": true
            }),
        );
        match outcome {
            Ok(value) => {
                assert_eq!(
                    value["lost"].as_u64().unwrap(),
                    2,
                    "every pixel is pushed off canvas"
                );
            }
            Err(err) => {
                assert!(!err.code.is_empty());
            }
        }
    }

    #[test]
    fn translate_by_canvas_width_reports_all_pixels_lost() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        super::super::call(
            &host,
            &session,
            "paste_grid",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "x": 1,
                "y": 0,
                "rows": ["AA"],
                "force": true
            }),
        )
        .unwrap();
        let result = super::super::call(
            &host,
            &session,
            "translate",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "dx": 8,
                "dy": 0,
                "force": true
            }),
        )
        .unwrap();
        assert_eq!(result["lost"].as_u64().unwrap(), 2);
    }

    #[test]
    fn translate_step_wrong_without_force() {
        let (host, session) = setup();
        let asset_id = create_asset(&host);
        let err = super::super::call(
            &host,
            &session,
            "translate",
            json!({
                "assetId": asset_id,
                "layer": "silhouette",
                "dx": 1,
                "dy": 0
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "step.wrong");
        assert!(err.hint.contains("force"));
    }
}
