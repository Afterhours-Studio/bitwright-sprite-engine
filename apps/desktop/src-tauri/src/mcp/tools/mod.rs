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

//! The tool surface, and the helpers every tool is built out of.
//!
//! A tool is a `ToolSpec`: a name, a description written for a model, a JSON
//! Schema, and a function of `(&dyn DocumentHost, &Session, Value)`. Nothing
//! else is a tool, so the transport in B.6 can serve `tools/list` and
//! `tools/call` without knowing anything about what any tool does, and nothing
//! a tool does can reach past the host it was handed.

use super::error::{ToolError, ToolResult};
use super::host::DocumentHost;
use super::session::Session;
use crate::raster::LayerRole;
use crate::store::{Asset, AssetId, OpResult};
use serde::de::DeserializeOwned;
use uuid::Uuid;

pub mod export;
pub mod guide;
pub mod history;
pub mod orientation;
pub mod palette;
pub mod read;
pub mod reference;
pub mod shading;
pub mod tilemap;
pub mod workflow;
pub mod write;

/// The signature every handler has. A plain function pointer rather than a
/// boxed closure because the catalogue is a static table, and a table you can
/// read at a glance is a table you can audit.
pub type Handler = fn(&dyn DocumentHost, &Session, serde_json::Value) -> ToolResult;

/// One tool, as it appears in `tools/list` and as it is dispatched by `call`.
pub struct ToolSpec {
    pub name: &'static str,
    /// Written for a model, from the catalogue.
    pub description: &'static str,
    /// A JSON Schema object, returned verbatim by `tools/list`.
    pub input_schema: fn() -> serde_json::Value,
    pub handler: Handler,
}

/// Every tool the server offers, in catalogue order.
pub fn catalogue() -> Vec<ToolSpec> {
    let mut tools = guide::tools();
    tools.extend(orientation::tools());
    tools.extend(read::tools());
    tools.extend(write::tools());
    tools.extend(shading::tools());
    tools.extend(palette::tools());
    tools.extend(reference::tools());
    tools.extend(tilemap::tools());
    tools.extend(export::tools());
    tools.extend(workflow::tools());
    tools.extend(history::tools());
    tools
}

/// Dispatches one `tools/call`.
///
/// An agent that announces nothing leaves a person watching the window with no
/// idea why it started moving, so a tool that names an asset reports that it is
/// about to touch it before it touches anything. The id may come from the
/// arguments or from the session; a tool with neither, like `list_projects`,
/// has nothing to announce.
pub fn call(
    host: &dyn DocumentHost,
    session: &Session,
    name: &str,
    args: serde_json::Value,
) -> ToolResult {
    let spec = catalogue()
        .into_iter()
        .find(|spec| spec.name == name)
        .ok_or_else(|| {
            ToolError::new(
                "tool.unknown",
                format!("no tool named {name}"),
                "Call tools/list for the tools this server offers.",
            )
        })?;
    let asset = args
        .get("assetId")
        .and_then(serde_json::Value::as_str)
        .and_then(|value| asset_id(value).ok())
        .or_else(|| session.current_asset());
    if let Some(asset) = asset {
        host.activity(&session.id, name, asset);
    }
    (spec.handler)(host, session, args)
}

/// Reads the arguments into the tool's own typed struct.
pub fn parse<T: DeserializeOwned>(args: serde_json::Value) -> Result<T, ToolError> {
    let args = if args.is_null() {
        serde_json::Value::Object(serde_json::Map::new())
    } else {
        args
    };
    serde_json::from_value(args).map_err(|error| {
        ToolError::new(
            "args.invalid",
            error.to_string(),
            "Check the argument names and types against the tool's input schema.",
        )
    })
}

/// A caller-supplied asset id.
pub fn asset_id(value: &str) -> Result<AssetId, ToolError> {
    Uuid::parse_str(value).map(AssetId).map_err(|_| {
        ToolError::new(
            "asset.not_found",
            format!("{value} is not an asset id"),
            "Asset ids are uuids; call list_assets for them.",
        )
    })
}

/// The asset a tool should work on: the one it was given, or the one the
/// session has open.
pub fn resolve_asset(session: &Session, value: Option<&str>) -> Result<AssetId, ToolError> {
    if let Some(value) = value {
        return asset_id(value);
    }
    session.current_asset().ok_or_else(|| {
        ToolError::new(
            "asset.not_open",
            "no asset is open in this session",
            "Pass assetId, or call open_asset first.",
        )
    })
}

/// A layer role by the only name an agent is ever given for it.
pub fn role(value: &str) -> Result<LayerRole, ToolError> {
    LayerRole::parse(value).map_err(|_| {
        ToolError::new(
            "layer.unknown_role",
            format!("{value} is not a layer role"),
            "Name the layer by workflow role: silhouette, flats, shadow-core, \
             shadow-deep, light, outline, detail, rim or accent.",
        )
    })
}

/// The workflow step that owns a layer role, from section 6 of the document
/// model.
///
/// Shadow owns two bands and accent owns two, which is why this is a function
/// rather than a field on the role: the pair is the step's output, not two
/// steps that happen to look alike.
pub fn step_of(role: LayerRole) -> &'static str {
    match role.0 {
        "silhouette" => "silhouette",
        "flats" => "flats",
        "shadow-core" | "shadow-deep" => "shadow",
        "light" => "light",
        "outline" => "outline",
        "detail" => "detail",
        "rim" | "accent" => "accent",
        other => unreachable!("{other} is not in LAYER_ROLES"),
    }
}

/// Refuses a write whose layer does not belong to the step the asset is on.
///
/// Revisiting an earlier step is legitimate and doing it by accident is not, so
/// the refusal carries the way past itself: `force` exists, and using it is the
/// caller saying on the record that it meant to.
pub fn guard_step(asset: &Asset, role: LayerRole, force: bool) -> Result<(), ToolError> {
    let step = step_of(role);
    if force || step == asset.step || asset.step == "cleanup" {
        return Ok(());
    }
    Err(ToolError::new(
        "step.wrong",
        format!(
            "layer {} belongs to step {step}; the asset is at step {}",
            role.0, asset.step
        ),
        "Draw on the layer of the current step, call revisit_step to go back \
         on purpose, or pass force: true.",
    ))
}

/// The diff summary every write returns: what changed, where, and how far the
/// op log has walked.
pub fn summary(result: &OpResult) -> serde_json::Value {
    serde_json::json!({
        "changed": result.changed,
        "bounds": result.bounds.map(|bounds| {
            serde_json::json!({
                "x": bounds.x,
                "y": bounds.y,
                "w": bounds.width,
                "h": bounds.height,
            })
        }),
        "seq": result.seq,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::host::HeadlessHost;
    use crate::raster::LAYER_ROLES;
    use crate::store::Store;
    use serde::Deserialize;
    use serde_json::json;

    #[derive(Debug, Deserialize)]
    struct Args {
        #[allow(dead_code)]
        name: String,
    }

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    struct OptionalArgs {
        name: Option<String>,
        size: Option<u32>,
    }

    fn asset(step: &str) -> Asset {
        Asset {
            id: AssetId(Uuid::nil()),
            project_id: Uuid::nil(),
            style_id: None,
            name: "sofia-idle-south".into(),
            kind: "character".into(),
            width: 64,
            height: 64,
            step: step.into(),
            created_at: 0,
            updated_at: 0,
        }
    }

    fn headless() -> HeadlessHost {
        HeadlessHost::new(Store::memory().unwrap())
    }

    #[test]
    fn parse_accepts_the_arguments_a_tool_declares() {
        let args = parse::<Args>(json!({ "name": "sofia" })).unwrap();
        assert_eq!(args.name, "sofia");
    }

    #[test]
    fn parse_reports_args_invalid_with_a_hint() {
        let error = parse::<Args>(json!({ "named": "sofia" })).unwrap_err();
        assert_eq!(error.code, "args.invalid");
        assert!(
            error.hint.contains("input schema"),
            "the hint has to say where to look: {}",
            error.hint
        );
    }

    #[test]
    fn parse_accepts_null_for_an_all_optional_struct() {
        let args = parse::<OptionalArgs>(serde_json::Value::Null).unwrap();
        assert_eq!(
            args,
            OptionalArgs {
                name: None,
                size: None
            }
        );
    }

    #[test]
    fn asset_id_reads_a_uuid_and_refuses_anything_else() {
        let text = Uuid::now_v7().to_string();
        assert_eq!(
            asset_id(&text).unwrap(),
            AssetId(Uuid::parse_str(&text).unwrap())
        );
        let error = asset_id("sofia-idle-south").unwrap_err();
        assert_eq!(error.code, "asset.not_found");
    }

    #[test]
    fn resolve_asset_falls_back_to_the_session() {
        let id = AssetId(Uuid::now_v7());
        let session = Session::new("s-1");
        let error = resolve_asset(&session, None).unwrap_err();
        assert_eq!(error.code, "asset.not_open");

        session.set_current_asset(id);
        assert_eq!(resolve_asset(&session, None).unwrap(), id);
        assert_eq!(
            resolve_asset(&session, Some(&id.0.to_string())).unwrap(),
            id
        );
    }

    #[test]
    fn role_reads_every_workflow_layer() {
        for (text, _) in LAYER_ROLES {
            assert_eq!(role(text).unwrap().0, text);
        }
    }

    #[test]
    fn role_refuses_a_name_an_agent_invented() {
        let error = role("background").unwrap_err();
        assert_eq!(error.code, "layer.unknown_role");
        assert!(error.hint.contains("silhouette"));
    }

    #[test]
    fn step_of_is_the_document_model_table() {
        let cases = [
            ("silhouette", "silhouette"),
            ("flats", "flats"),
            ("shadow-core", "shadow"),
            ("shadow-deep", "shadow"),
            ("light", "light"),
            ("outline", "outline"),
            ("detail", "detail"),
            ("rim", "accent"),
            ("accent", "accent"),
        ];
        assert_eq!(cases.len(), LAYER_ROLES.len());
        for (role, step) in cases {
            assert_eq!(step_of(LayerRole::parse(role).unwrap()), step);
        }
    }

    #[test]
    fn guard_step_allows_the_layer_that_belongs_to_the_current_step() {
        assert!(guard_step(&asset("shadow"), role("shadow-deep").unwrap(), false).is_ok());
    }

    #[test]
    fn guard_step_refuses_an_early_layer_and_names_the_step() {
        let error = guard_step(&asset("flats"), role("outline").unwrap(), false).unwrap_err();
        assert_eq!(error.code, "step.wrong");
        assert!(error.message.contains("flats"), "{}", error.message);
        assert!(error.hint.contains("force"), "{}", error.hint);
        assert!(error.hint.contains("revisit_step"), "{}", error.hint);
    }

    #[test]
    fn guard_step_lets_a_forced_write_through() {
        assert!(guard_step(&asset("flats"), role("outline").unwrap(), true).is_ok());
    }

    #[test]
    fn guard_step_opens_every_layer_while_polishing() {
        let polishing = asset("cleanup");
        for (text, _) in LAYER_ROLES {
            assert!(
                guard_step(&polishing, role(text).unwrap(), false).is_ok(),
                "{text}"
            );
        }
    }

    #[test]
    fn summary_reports_bounds_when_the_write_moved_pixels() {
        let result = OpResult {
            changed: 12,
            bounds: Some(crate::raster::ops::Bounds {
                x: 3,
                y: 4,
                width: 5,
                height: 6,
            }),
            roles: vec![],
            seq: 9,
        };
        assert_eq!(
            summary(&result),
            json!({ "changed": 12, "bounds": { "x": 3, "y": 4, "w": 5, "h": 6 }, "seq": 9 })
        );
    }

    #[test]
    fn summary_reports_null_bounds_when_nothing_moved() {
        let result = OpResult {
            changed: 0,
            bounds: None,
            roles: vec![],
            seq: 2,
        };
        assert_eq!(
            summary(&result),
            json!({ "changed": 0, "bounds": null, "seq": 2 })
        );
    }

    #[test]
    fn call_refuses_a_tool_that_is_not_registered() {
        let host = headless();
        let session = Session::new("s-1");
        let error = call(&host, &session, "paint_sprite", json!({})).unwrap_err();
        assert_eq!(error.code, "tool.unknown");
        assert!(error.hint.contains("tools/list"), "{}", error.hint);
    }

    #[test]
    fn catalogue_names_are_unique_and_schemas_are_objects() {
        let specs = catalogue();
        let mut names: Vec<_> = specs.iter().map(|spec| spec.name).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), specs.len());
        for spec in &specs {
            assert_eq!((spec.input_schema)()["type"], "object", "{}", spec.name);
        }
    }
}
