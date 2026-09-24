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

//! Orientation tools: projects, assets, style rules.

use super::super::error::ToolError;
use super::super::host::{with_store, DocumentHost};
use super::super::session::Session;
use super::{parse, resolve_asset, ToolResult, ToolSpec};
use bitwright::raster::LAYER_ROLES;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

fn not_project(id: &str) -> ToolError {
    ToolError::new(
        "project.not_found",
        format!("{id} does not name a project"),
        "Call list_projects for valid ids.",
    )
}

fn remap_project(err: ToolError) -> ToolError {
    if err.code == "asset.not_found" {
        ToolError::new(
            "project.not_found",
            err.message,
            "Call list_projects for valid ids.",
        )
    } else {
        err
    }
}

// ---------------------------------------------------------------------------
// list_projects
// ---------------------------------------------------------------------------

fn list_projects_schema() -> Value {
    json!({
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
    })
}

fn list_projects(host: &dyn DocumentHost, _session: &Session, _args: Value) -> ToolResult {
    let projects = with_store(host, |store| {
        let list = store.project_list()?;
        let mut result = Vec::with_capacity(list.len());
        for p in &list {
            let style = match p.style_id {
                Some(style_id) => store.style_read(style_id)?.preset,
                None => "default".to_string(),
            };
            let asset_count = store.asset_list(p.id)?.len();
            result.push(json!({
                "id": p.id,
                "name": p.name,
                "style": style,
                "assetCount": asset_count,
            }));
        }
        Ok(result)
    })?;
    Ok(json!({ "projects": projects }))
}

// ---------------------------------------------------------------------------
// create_project
// ---------------------------------------------------------------------------

const VALID_PRESETS: &[&str] = &["hd2d", "snes", "gameboy", "custom"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateProjectArgs {
    name: String,
    preset: Option<String>,
}

fn create_project_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "name": { "type": "string" },
            "preset": {
                "type": "string",
                "enum": ["hd2d", "snes", "gameboy", "custom"]
            }
        },
        "required": ["name"],
        "additionalProperties": false
    })
}

fn create_project(host: &dyn DocumentHost, _session: &Session, args: Value) -> ToolResult {
    let args: CreateProjectArgs = parse(args)?;
    let preset = args.preset.as_deref().unwrap_or("hd2d");
    if !VALID_PRESETS.contains(&preset) {
        return Err(ToolError::new(
            "args.invalid",
            format!("{preset} is not a valid preset"),
            "Use one of: hd2d, snes, gameboy, custom.",
        ));
    }
    let project = with_store(host, |store| store.project_create(&args.name, preset))?;
    Ok(json!({ "project": project }))
}

// ---------------------------------------------------------------------------
// list_assets
// ---------------------------------------------------------------------------

fn parse_project_id(value: &str) -> Result<Uuid, ToolError> {
    Uuid::parse_str(value).map_err(|_| not_project(value))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListAssetsArgs {
    project_id: String,
}

fn list_assets_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "projectId": { "type": "string", "format": "uuid" }
        },
        "required": ["projectId"],
        "additionalProperties": false
    })
}

fn list_assets(host: &dyn DocumentHost, _session: &Session, args: Value) -> ToolResult {
    let args: ListAssetsArgs = parse(args)?;
    let project_id = parse_project_id(&args.project_id)?;
    let assets = with_store(host, |store| {
        let list = store.asset_list(project_id)?;
        let mut result = Vec::with_capacity(list.len());
        for asset in &list {
            let step = store.step_state(asset.id)?;
            result.push(json!({
                "id": asset.id,
                "name": asset.name,
                "kind": asset.kind,
                "width": asset.width,
                "height": asset.height,
                "step": step.step,
                "gatePass": step.gate.pass,
            }));
        }
        Ok(result)
    })
    .map_err(remap_project)?;
    Ok(json!({ "assets": assets }))
}

// ---------------------------------------------------------------------------
// create_asset
// ---------------------------------------------------------------------------

const VALID_KINDS: &[&str] = &["character", "prop", "tile", "tileset", "background"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateAssetArgs {
    project_id: String,
    name: String,
    kind: String,
    width: Option<u16>,
    height: Option<u16>,
}

fn create_asset_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "projectId": { "type": "string", "format": "uuid" },
            "name": { "type": "string" },
            "kind": {
                "type": "string",
                "enum": ["character", "prop", "tile", "tileset", "background"]
            },
            "width": { "type": "integer", "minimum": 1 },
            "height": { "type": "integer", "minimum": 1 }
        },
        "required": ["projectId", "name", "kind"],
        "additionalProperties": false
    })
}

fn create_asset(host: &dyn DocumentHost, _session: &Session, args: Value) -> ToolResult {
    let args: CreateAssetArgs = parse(args)?;
    let project_id = parse_project_id(&args.project_id)?;
    if !VALID_KINDS.contains(&args.kind.as_str()) {
        return Err(ToolError::new(
            "args.invalid",
            format!("{} is not a valid asset kind", args.kind),
            "Use one of: character, prop, tile, tileset, background.",
        ));
    }
    let (asset, style_rules) = with_store(host, |store| {
        let rules = store.project_rules(project_id)?;
        let width = args.width.unwrap_or(rules.canvas.width);
        let height = args.height.unwrap_or(rules.canvas.height);
        let asset = store.asset_create(project_id, &args.name, &args.kind, width, height)?;
        let style_rules = store.asset_rules(asset.id)?;
        Ok((asset, style_rules))
    })
    .map_err(remap_project)?;
    Ok(json!({ "asset": asset, "styleRules": style_rules }))
}

// ---------------------------------------------------------------------------
// open_asset
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OpenAssetArgs {
    asset_id: String,
}

fn open_asset_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" }
        },
        "required": ["assetId"],
        "additionalProperties": false
    })
}

fn open_asset(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: OpenAssetArgs = parse(args)?;
    let id = crate::mcp::tools::asset_id(&args.asset_id)?;
    let (doc, step_state) = with_store(host, |store| {
        let doc = store.asset_open(id)?;
        let step = store.step_state(id)?;
        Ok((doc, step))
    })?;
    session.set_current_asset(id);
    host.opened(id);

    // Summarise layers by role in LAYER_ROLES order.
    let mut parts: Vec<String> = Vec::with_capacity(LAYER_ROLES.len());
    for (role_name, _) in &LAYER_ROLES {
        let count = doc
            .layers
            .iter()
            .find(|l| l.role.0 == *role_name)
            .map(|l| l.buffer.data.iter().filter(|&&b| b != 0).count())
            .unwrap_or(0);
        let label = if count == 0 {
            "empty".to_string()
        } else {
            format!("{count}px",)
        };
        parts.push(format!("{role_name}: {label}"));
    }
    let layers = parts.join(", ");

    Ok(json!({
        "asset": doc.asset,
        "step": step_state.step,
        "gate": step_state.gate,
        "palette": doc.palette,
        "layers": layers,
    }))
}

// ---------------------------------------------------------------------------
// get_style_rules
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GetStyleRulesArgs {
    asset_id: Option<String>,
}

fn get_style_rules_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" }
        },
        "required": [],
        "additionalProperties": false
    })
}

fn get_style_rules(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: GetStyleRulesArgs = parse(args)?;
    let id = resolve_asset(session, args.asset_id.as_deref())?;
    let rules = with_store(host, |store| store.asset_rules(id))?;
    Ok(json!({ "assetId": id.0, "rules": rules }))
}

// ---------------------------------------------------------------------------
// Catalogue entry
// ---------------------------------------------------------------------------

pub fn tools() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "list_projects",
            description: "List every project in the document. Each entry includes \
                the project id, name, style preset, and asset count.",
            input_schema: list_projects_schema,
            handler: list_projects,
        },
        ToolSpec {
            name: "create_project",
            description: "Create a new project. Choose a preset that defines the \
                default style rules (canvas size, palette limits).",
            input_schema: create_project_schema,
            handler: create_project,
        },
        ToolSpec {
            name: "list_assets",
            description: "List the assets in a project, including each asset's \
                current workflow step and whether it passes the step gate.",
            input_schema: list_assets_schema,
            handler: list_assets,
        },
        ToolSpec {
            name: "create_asset",
            description: "Create a new asset in a project. Width and height default \
                to the project's canvas size from its style rules.",
            input_schema: create_asset_schema,
            handler: create_asset,
        },
        ToolSpec {
            name: "open_asset",
            description: "Make an asset the one you are working on, and show it in \
                the window. Returns its step, gate report, palette and which layers \
                have content. Call this before drawing.",
            input_schema: open_asset_schema,
            handler: open_asset,
        },
        ToolSpec {
            name: "get_style_rules",
            description: "The rules the gates check this asset against: slot ceiling, \
                ramp lengths, hue shift, outline mode, light direction, canvas. Read \
                them before drawing so you do not discover them by failing a gate.",
            input_schema: get_style_rules_schema,
            handler: get_style_rules,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::host::HeadlessHost;
    use crate::mcp::session::Session;
    use crate::store::Store;
    use serde_json::json;

    fn setup() -> (HeadlessHost, Session) {
        let host = HeadlessHost::new(Store::memory().unwrap());
        let session = Session::new("t");
        (host, session)
    }

    fn create_project_and_asset(host: &HeadlessHost, session: &Session) -> String {
        super::super::call(
            host,
            session,
            "create_project",
            json!({
                "name": "P",
                "preset": "hd2d"
            }),
        )
        .unwrap();
        let project_id = super::super::call(host, session, "list_projects", json!(null)).unwrap()
            ["projects"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        super::super::call(
            host,
            session,
            "create_asset",
            json!({
                "projectId": project_id,
                "name": "Hero",
                "kind": "character",
                "width": 8,
                "height": 8
            }),
        )
        .unwrap();
        super::super::call(
            host,
            session,
            "list_assets",
            json!({ "projectId": project_id }),
        )
        .unwrap()["assets"][0]["id"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn create_then_list_a_project() {
        let (host, session) = setup();
        let result = super::super::call(
            &host,
            &session,
            "create_project",
            json!({
                "name": "My Game",
                "preset": "snes"
            }),
        )
        .unwrap();
        let id = result["project"]["id"].as_str().unwrap();
        let list = super::super::call(&host, &session, "list_projects", json!(null)).unwrap();
        let projects = list["projects"].as_array().unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0]["id"].as_str().unwrap(), id);
        assert_eq!(projects[0]["name"].as_str().unwrap(), "My Game");
        assert_eq!(projects[0]["style"].as_str().unwrap(), "snes");
        assert_eq!(projects[0]["assetCount"].as_u64().unwrap(), 0);
    }

    #[test]
    fn bad_preset_is_rejected() {
        let (host, session) = setup();
        let err = super::super::call(
            &host,
            &session,
            "create_project",
            json!({
                "name": "Bad",
                "preset": "vector"
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "args.invalid");
        assert!(err.hint.contains("hd2d"));
    }

    #[test]
    fn create_asset_with_explicit_size() {
        let (host, session) = setup();
        super::super::call(
            &host,
            &session,
            "create_project",
            json!({
                "name": "P",
                "preset": "hd2d"
            }),
        )
        .unwrap();
        let project_id = super::super::call(&host, &session, "list_projects", json!(null)).unwrap()
            ["projects"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let result = super::super::call(
            &host,
            &session,
            "create_asset",
            json!({
                "projectId": project_id,
                "name": "Hero",
                "kind": "character",
                "width": 32,
                "height": 32
            }),
        )
        .unwrap();
        assert_eq!(result["asset"]["name"].as_str().unwrap(), "Hero");
        assert_eq!(result["asset"]["width"].as_u64().unwrap(), 32);
        assert_eq!(result["asset"]["height"].as_u64().unwrap(), 32);
        assert!(result["styleRules"].is_object());
    }

    #[test]
    fn create_asset_without_size_uses_project_canvas() {
        let (host, session) = setup();
        super::super::call(
            &host,
            &session,
            "create_project",
            json!({
                "name": "P",
                "preset": "gameboy"
            }),
        )
        .unwrap();
        let project_id = super::super::call(&host, &session, "list_projects", json!(null)).unwrap()
            ["projects"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let result = super::super::call(
            &host,
            &session,
            "create_asset",
            json!({
                "projectId": project_id,
                "name": "Sprite",
                "kind": "prop"
            }),
        )
        .unwrap();
        // gameboy inherits the default canvas (48x64) since it only overrides palette rules.
        assert_eq!(result["asset"]["width"].as_u64().unwrap(), 48);
        assert_eq!(result["asset"]["height"].as_u64().unwrap(), 64);
    }

    #[test]
    fn bad_kind_is_rejected() {
        let (host, session) = setup();
        super::super::call(
            &host,
            &session,
            "create_project",
            json!({
                "name": "P",
                "preset": "hd2d"
            }),
        )
        .unwrap();
        let project_id = super::super::call(&host, &session, "list_projects", json!(null)).unwrap()
            ["projects"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let err = super::super::call(
            &host,
            &session,
            "create_asset",
            json!({
                "projectId": project_id,
                "name": "X",
                "kind": "spaceship"
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "args.invalid");
        assert!(err.hint.contains("character"));
    }

    #[test]
    fn list_assets_shows_gate_pass() {
        let (host, session) = setup();
        super::super::call(
            &host,
            &session,
            "create_project",
            json!({
                "name": "P",
                "preset": "hd2d"
            }),
        )
        .unwrap();
        let project_id = super::super::call(&host, &session, "list_projects", json!(null)).unwrap()
            ["projects"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        super::super::call(
            &host,
            &session,
            "create_asset",
            json!({
                "projectId": project_id,
                "name": "Hero",
                "kind": "character",
                "width": 8,
                "height": 8
            }),
        )
        .unwrap();
        let list = super::super::call(
            &host,
            &session,
            "list_assets",
            json!({
                "projectId": project_id
            }),
        )
        .unwrap();
        let assets = list["assets"].as_array().unwrap();
        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0]["name"].as_str().unwrap(), "Hero");
        assert!(assets[0]["gatePass"].is_boolean());
    }

    #[test]
    fn unknown_project_id_is_rejected() {
        let (host, session) = setup();
        let err = super::super::call(
            &host,
            &session,
            "list_assets",
            json!({
                "projectId": "not-a-uuid"
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "project.not_found");
        assert!(err.hint.contains("list_projects"));
    }

    #[test]
    fn nonexistent_project_id_is_rejected() {
        let (host, session) = setup();
        let fake_id = Uuid::now_v7().to_string();
        let err = super::super::call(
            &host,
            &session,
            "list_assets",
            json!({
                "projectId": fake_id
            }),
        )
        .unwrap_err();
        assert_eq!(err.code, "project.not_found");
        assert!(err.hint.contains("list_projects"));
    }

    #[test]
    fn list_projects_shows_default_style_when_project_has_none() {
        let (host, session) = setup();
        super::super::call(
            &host,
            &session,
            "create_project",
            json!({
                "name": "P",
                "preset": "hd2d"
            }),
        )
        .unwrap();
        let project_id_str = super::super::call(&host, &session, "list_projects", json!(null))
            .unwrap()["projects"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let project_id = Uuid::parse_str(&project_id_str).unwrap();
        host.store()
            .lock()
            .unwrap()
            .project_set_style(project_id, None)
            .unwrap();
        let list = super::super::call(&host, &session, "list_projects", json!(null)).unwrap();
        let style = list["projects"][0]["style"].as_str().unwrap();
        assert_eq!(style, "default");
    }

    // ----- open_asset tests -----

    #[test]
    fn open_asset_sets_current_asset_and_returns_empty_layers() {
        let (host, session) = setup();
        let asset_id = create_project_and_asset(&host, &session);
        let result = super::super::call(
            &host,
            &session,
            "open_asset",
            json!({ "assetId": asset_id }),
        )
        .unwrap();
        assert_eq!(
            session.current_asset(),
            Some(crate::mcp::tools::asset_id(asset_id.as_str()).unwrap())
        );
        assert_eq!(result["asset"]["name"].as_str().unwrap(), "Hero");
        assert_eq!(result["step"].as_str().unwrap(), "reference");
        assert!(result["gate"].is_object());
        assert!(result["palette"].is_object());
        let layers = result["layers"].as_str().unwrap();
        assert!(layers.contains("silhouette: empty"), "{layers}");
        assert!(layers.contains("flats: empty"), "{layers}");
        assert!(layers.contains("accent: empty"), "{layers}");
    }

    #[test]
    fn open_asset_unknown_uuid_is_not_found() {
        let (host, session) = setup();
        let fake_id = Uuid::now_v7().to_string();
        let err = super::super::call(&host, &session, "open_asset", json!({ "assetId": fake_id }))
            .unwrap_err();
        assert_eq!(err.code, "asset.not_found");
    }

    // ----- get_style_rules tests -----

    #[test]
    fn get_style_rules_with_explicit_id() {
        let (host, session) = setup();
        let asset_id = create_project_and_asset(&host, &session);
        let result = super::super::call(
            &host,
            &session,
            "get_style_rules",
            json!({ "assetId": asset_id }),
        )
        .unwrap();
        assert_eq!(result["assetId"].as_str().unwrap(), asset_id);
        assert!(result["rules"].is_object());
    }

    #[test]
    fn get_style_rules_falls_back_to_session_after_open() {
        let (host, session) = setup();
        let asset_id = create_project_and_asset(&host, &session);
        // Open the asset so the session tracks it.
        super::super::call(
            &host,
            &session,
            "open_asset",
            json!({ "assetId": asset_id }),
        )
        .unwrap();
        // Now call get_style_rules with no assetId.
        let result = super::super::call(&host, &session, "get_style_rules", json!({})).unwrap();
        assert_eq!(result["assetId"].as_str().unwrap(), asset_id);
        assert!(result["rules"].is_object());
    }

    #[test]
    fn get_style_rules_no_id_no_open_asset_is_not_open() {
        let (host, session) = setup();
        let err = super::super::call(&host, &session, "get_style_rules", json!({})).unwrap_err();
        assert_eq!(err.code, "asset.not_open");
    }
}
