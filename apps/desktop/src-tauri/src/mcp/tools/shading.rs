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

//! Shading: the tools where the engine chooses the colour.

use super::super::error::ToolError;
use super::super::host::DocumentHost;
use super::super::session::Session;
use super::{guard_step, parse, resolve_asset, role, summary, ToolResult, ToolSpec};
use bitwright::raster::document_ops::Rect;
use bitwright::raster::shading::{Direction, OutlineMode};
use bitwright::raster::LayerRole;
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

/// The four layers a shade call may target.
const SHADE_TARGETS: &[&str] = &["shadow-core", "shadow-deep", "light", "rim"];

/// Parse a layer name and confirm it is one of the four shade targets.
fn shade_target(value: &str) -> Result<LayerRole, ToolError> {
    if SHADE_TARGETS.contains(&value) {
        role(value)
    } else {
        Err(ToolError::new(
            "args.invalid",
            format!("{value} is not a valid shade target"),
            format!(
                "shade targets must be one of: {}.",
                SHADE_TARGETS.join(", ")
            ),
        ))
    }
}

fn validate_range(value: u8, min: u8, max: u8, name: &str) -> Result<u8, ToolError> {
    if value >= min && value <= max {
        Ok(value)
    } else {
        Err(ToolError::new(
            "args.invalid",
            format!("{name} must be between {min} and {max}, got {value}"),
            format!("Pass a value from {min} to {max} for {name}."),
        ))
    }
}

// ---------------------------------------------------------------------------
// shade
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ShadeArgs {
    asset_id: Option<String>,
    target: String,
    from: String,
    region: Option<Rect>,
    direction: Option<Direction>,
    depth: Option<u8>,
    force: Option<bool>,
}

fn shade_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "target": {
                "type": "string",
                "enum": ["shadow-core", "shadow-deep", "light", "rim"]
            },
            "from": { "type": "string" },
            "region": {
                "type": "object",
                "properties": {
                    "x": { "type": "integer", "minimum": 0 },
                    "y": { "type": "integer", "minimum": 0 },
                    "w": { "type": "integer", "minimum": 1 },
                    "h": { "type": "integer", "minimum": 1 }
                },
                "required": ["x", "y", "w", "h"],
                "additionalProperties": false
            },
            "direction": {
                "type": "string",
                "enum": ["upper-left", "upper-right", "lower-left", "lower-right", "up", "down", "left", "right"]
            },
            "depth": {
                "type": "integer",
                "minimum": 1,
                "maximum": 4,
                "default": 1
            },
            "force": { "type": "boolean" }
        },
        "required": ["target", "from"],
        "additionalProperties": false
    })
}

fn shade_handler(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: ShadeArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let target = shade_target(&args.target)?;
    let from = role(&args.from)?;
    let depth = args.depth.unwrap_or(1);
    let depth = validate_range(depth, 1, 4, "depth")?;
    let force = args.force.unwrap_or(false);
    let op = Op::Shade {
        target,
        from,
        region: args.region,
        direction: args.direction,
        depth,
    };
    with_tool_store(host, |store| {
        let asset_data = store.asset_read(asset)?;
        guard_step(&asset_data, op.target(), force)?;
        let result = store.write_ops(asset, vec![op], &session.actor())?;
        host.changed(asset, &result);
        Ok(summary(&result))
    })
}

// ---------------------------------------------------------------------------
// outline
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OutlineArgs {
    asset_id: Option<String>,
    from: String,
    mode: Option<OutlineMode>,
    darken: Option<u8>,
    force: Option<bool>,
}

fn outline_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "from": { "type": "string" },
            "mode": {
                "type": "string",
                "enum": ["none", "selective", "full"]
            },
            "darken": {
                "type": "integer",
                "minimum": 1,
                "maximum": 4,
                "default": 1
            },
            "force": { "type": "boolean" }
        },
        "required": ["from"],
        "additionalProperties": false
    })
}

fn outline_handler(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: OutlineArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let from = role(&args.from)?;
    let darken = args.darken.unwrap_or(1);
    let darken = validate_range(darken, 1, 4, "darken")?;
    let force = args.force.unwrap_or(false);
    let op = Op::Outline {
        from,
        mode: args.mode,
        darken,
    };
    let outline_role = LayerRole("outline");
    with_tool_store(host, |store| {
        let asset_data = store.asset_read(asset)?;
        guard_step(&asset_data, outline_role, force)?;
        let result = store.write_ops(asset, vec![op], &session.actor())?;
        host.changed(asset, &result);
        Ok(summary(&result))
    })
}

// ---------------------------------------------------------------------------
// antialias
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AntialiasArgs {
    asset_id: Option<String>,
    layer: String,
    strength: Option<u8>,
    force: Option<bool>,
}

fn antialias_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "layer": { "type": "string" },
            "strength": {
                "type": "integer",
                "minimum": 1,
                "maximum": 4,
                "default": 1
            },
            "force": { "type": "boolean" }
        },
        "required": ["layer"],
        "additionalProperties": false
    })
}

fn antialias_handler(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: AntialiasArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let layer = role(&args.layer)?;
    let strength = args.strength.unwrap_or(1);
    let strength = validate_range(strength, 1, 4, "strength")?;
    let force = args.force.unwrap_or(false);
    let op = Op::Antialias { layer, strength };
    with_tool_store(host, |store| {
        let asset_data = store.asset_read(asset)?;
        guard_step(&asset_data, op.target(), force)?;
        let result = store.write_ops(asset, vec![op], &session.actor())?;
        host.changed(asset, &result);
        Ok(summary(&result))
    })
}

// ---------------------------------------------------------------------------
// catalogue
// ---------------------------------------------------------------------------

pub fn tools() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "shade",
            description: "Shade from a source layer into shadow-core, shadow-deep, \
                light or rim. The engine steps each source slot along its own ramp \
                (down for shadow, up for light) and places it by the light \
                direction; you never name a colour. Pixels whose slot is in no \
                ramp are skipped.",
            input_schema: shade_schema,
            handler: shade_handler,
        },
        ToolSpec {
            name: "outline",
            description: "Derive the outline from the fills it borders, never flat \
                black. selective leaves out edges the key light strikes.",
            input_schema: outline_schema,
            handler: outline_handler,
        },
        ToolSpec {
            name: "antialias",
            description: "Place intermediate ramp steps on stair-stepped interior \
                edges. Never touches the outer silhouette edge.",
            input_schema: antialias_schema,
            handler: antialias_handler,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::host::HeadlessHost;
    use crate::store::Store;
    use bitwright::raster::{Material, Palette, PaletteSlot, Ramp};
    use serde_json::json;

    fn setup() -> (HeadlessHost, Session) {
        let host = HeadlessHost::new(Store::memory().unwrap());
        let session = Session::new("test");
        (host, session)
    }

    /// Write a palette with a ramp and create an asset at the shadow step,
    /// then paste a filled flats layer.  Returns the asset id as a string.
    fn create_asset_with_ramp(host: &HeadlessHost) -> String {
        with_tool_store(host, |store| {
            let project = store.project_create("Test", "hd2d")?;
            let asset = store.asset_create(project.id, "Hero", "character", 8, 8)?;
            let palette = Palette {
                slots: (1..=10)
                    .map(|i| PaletteSlot {
                        index: i,
                        rgba: [i * 20, i * 15, i * 10, 255],
                        name: None,
                        ramp: if (1..=5).contains(&i) {
                            Some("body".into())
                        } else {
                            None
                        },
                        step: if (1..=5).contains(&i) {
                            Some(i - 1)
                        } else {
                            None
                        },
                    })
                    .collect(),
                ramps: vec![Ramp {
                    name: "body".into(),
                    material: Material::Cloth,
                    slots: vec![1, 2, 3, 4, 5],
                }],
            };
            store.palette_write(asset.id, palette)?;
            store.write_ops(
                asset.id,
                vec![Op::PasteGrid {
                    layer: LayerRole("flats"),
                    x: 0,
                    y: 0,
                    rows: vec![
                        "ABCDE...".into(),
                        "ABCDE...".into(),
                        "ABCDE...".into(),
                        "ABCDE...".into(),
                        "........".into(),
                        "........".into(),
                        "........".into(),
                        "........".into(),
                    ],
                    mode: Default::default(),
                }],
                "user",
            )?;
            Ok(asset.id.0.to_string())
        })
        .unwrap()
    }

    // ----- shade -----

    #[test]
    fn shade_into_shadow_core_changes_pixels() {
        let (host, session) = setup();
        let asset_id = create_asset_with_ramp(&host);
        let result = super::super::call(
            &host,
            &session,
            "shade",
            json!({
                "assetId": asset_id,
                "target": "shadow-core",
                "from": "flats",
                "force": true
            }),
        )
        .unwrap();
        assert!(
            result["changed"].as_u64().unwrap() > 0,
            "shade into shadow-core should change at least one pixel"
        );
    }

    // ----- outline -----

    #[test]
    fn outline_writes_the_outline_layer() {
        let (host, session) = setup();
        let asset_id = create_asset_with_ramp(&host);
        let result = super::super::call(
            &host,
            &session,
            "outline",
            json!({
                "assetId": asset_id,
                "from": "flats",
                "mode": "full",
                "force": true
            }),
        )
        .unwrap();
        assert!(
            result["changed"].as_u64().unwrap() > 0,
            "outline should change at least one pixel"
        );
        with_tool_store(&host, |store| {
            let id = crate::mcp::tools::asset_id(&asset_id).unwrap();
            let layer = store.layer_read(id, LayerRole("outline"))?;
            let has_outline = layer.buffer.data.iter().any(|&s| s != 0);
            assert!(has_outline, "outline layer should have non-zero pixels");
            Ok(())
        })
        .unwrap();
    }

    // ----- antialias -----

    #[test]
    fn antialias_runs_without_error() {
        let (host, session) = setup();
        let asset_id = create_asset_with_ramp(&host);
        let result = super::super::call(
            &host,
            &session,
            "antialias",
            json!({
                "assetId": asset_id,
                "layer": "flats",
                "strength": 1,
                "force": true
            }),
        )
        .unwrap();
        assert!(result.is_object());
    }

    // ----- args.invalid -----

    #[test]
    fn shade_rejects_invalid_target() {
        let (host, session) = setup();
        let asset_id = create_asset_with_ramp(&host);
        let err = super::super::call(
            &host,
            &session,
            "shade",
            json!({
                "assetId": asset_id,
                "target": "background",
                "from": "flats",
                "force": true
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "args.invalid");
        assert!(err.hint.contains("shadow-core"));
    }

    #[test]
    fn shade_rejects_invalid_direction() {
        let (host, session) = setup();
        let asset_id = create_asset_with_ramp(&host);
        let err = super::super::call(
            &host,
            &session,
            "shade",
            json!({
                "assetId": asset_id,
                "target": "shadow-core",
                "from": "flats",
                "direction": "sideways",
                "force": true
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "args.invalid");
    }

    #[test]
    fn shade_rejects_depth_zero() {
        let (host, session) = setup();
        let asset_id = create_asset_with_ramp(&host);
        let err = super::super::call(
            &host,
            &session,
            "shade",
            json!({
                "assetId": asset_id,
                "target": "shadow-core",
                "from": "flats",
                "depth": 0,
                "force": true
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "args.invalid");
        assert!(err.hint.contains("depth"));
    }

    // ----- step.wrong -----

    #[test]
    fn shade_step_wrong_without_force() {
        let (host, session) = setup();
        let asset_id = create_asset_with_ramp(&host);
        // The asset is at "reference" step. shade's target (shadow-core)
        // belongs to "shadow" step, so guard_step should refuse without force.
        let err = super::super::call(
            &host,
            &session,
            "shade",
            json!({
                "assetId": asset_id,
                "target": "shadow-core",
                "from": "flats"
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "step.wrong");
        assert!(err.hint.contains("force"));
    }
}
