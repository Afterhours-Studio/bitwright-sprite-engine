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

//! Managing what exists: renaming and deleting projects and assets, and
//! listing and deleting an asset's reference images.
//!
//! The window can do all of these, so an agent can too. Every tool calls the
//! same store function the matching Tauri command calls, so the validation and
//! the error codes are the window's; what a tool adds is the announcement to
//! the host (so a timeline or header someone is watching follows) and, for
//! the destructive ones, a description that says plainly what cannot be undone.

use super::super::error::ToolError;
use super::super::host::{with_store, DocumentHost};
use super::super::session::Session;
use super::{asset_id, parse, resolve_asset, ToolResult, ToolSpec};
use crate::commands::animation::{renamed_frames, touched};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

fn project_id(value: &str) -> Result<Uuid, ToolError> {
    Uuid::parse_str(value).map_err(|_| {
        ToolError::new(
            "project.not_found",
            format!("{value} does not name a project"),
            "Call list_projects for valid ids.",
        )
    })
}

/// The store reports a missing project with the asset code; an agent that
/// passed a project id should hear about a project.
fn as_project(error: ToolError) -> ToolError {
    if error.code == "asset.not_found" {
        ToolError::new(
            "project.not_found",
            error.message,
            "Call list_projects for valid ids.",
        )
    } else {
        error
    }
}

// ---------------------------------------------------------------------------
// rename_project
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RenameProjectArgs {
    project_id: String,
    name: String,
}

fn rename_project_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "projectId": { "type": "string", "format": "uuid" },
            "name": { "type": "string" }
        },
        "required": ["projectId", "name"],
        "additionalProperties": false
    })
}

fn rename_project(host: &dyn DocumentHost, _session: &Session, args: Value) -> ToolResult {
    let args: RenameProjectArgs = parse(args)?;
    let id = project_id(&args.project_id)?;
    let project =
        with_store(host, |store| store.project_rename(id, &args.name)).map_err(as_project)?;
    Ok(json!({ "project": project }))
}

// ---------------------------------------------------------------------------
// delete_project
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeleteProjectArgs {
    project_id: String,
    force: Option<bool>,
}

fn delete_project_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "projectId": { "type": "string", "format": "uuid" },
            "force": {
                "type": "boolean",
                "description": "Required to delete a project that still has assets."
            }
        },
        "required": ["projectId"],
        "additionalProperties": false
    })
}

fn delete_project(host: &dyn DocumentHost, _session: &Session, args: Value) -> ToolResult {
    let args: DeleteProjectArgs = parse(args)?;
    let id = project_id(&args.project_id)?;
    let force = args.force.unwrap_or(false);
    let assets = with_store(host, |store| {
        let count = store.asset_list(id)?.len();
        if count == 0 || force {
            store.project_delete(id)?;
        }
        Ok(count)
    })
    .map_err(as_project)?;
    if assets > 0 && !force {
        return Err(ToolError::new(
            "project.not_empty",
            format!("the project still has {assets} asset(s); nothing was deleted"),
            "Deleting a project deletes its assets and cannot be undone. Call \
             list_assets to see what would go, then pass force: true if that is \
             what you mean.",
        ));
    }
    Ok(json!({ "deleted": id, "assetsDeleted": assets }))
}

// ---------------------------------------------------------------------------
// rename_asset
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RenameAssetArgs {
    asset_id: String,
    name: String,
}

fn rename_asset_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "name": { "type": "string" }
        },
        "required": ["assetId", "name"],
        "additionalProperties": false
    })
}

fn rename_asset(host: &dyn DocumentHost, _session: &Session, args: Value) -> ToolResult {
    let args: RenameAssetArgs = parse(args)?;
    let id = asset_id(&args.asset_id)?;
    // The same sequence the window's command runs: renaming a root renames
    // its frames, so each of them, and the timeline, is announced.
    let (asset, touched_frames, animation) = with_store(host, |store| {
        let before = store.animation_read(id)?;
        let asset = store.asset_rename(id, &args.name)?;
        let animation = store.animation_read(id)?;
        let mut touched_frames = vec![(id, touched(store, id)?)];
        for frame in renamed_frames(&before, &animation) {
            if frame != id {
                touched_frames.push((frame, touched(store, frame)?));
            }
        }
        Ok((asset, touched_frames, animation))
    })?;
    if animation.frames.len() > 1 {
        host.animation_changed(&animation);
    }
    for (frame, result) in &touched_frames {
        host.changed(*frame, result);
    }
    Ok(json!({ "asset": asset }))
}

// ---------------------------------------------------------------------------
// delete_asset
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeleteAssetArgs {
    asset_id: String,
}

fn delete_asset_schema() -> Value {
    json!({
        "type": "object",
        "properties": { "assetId": { "type": "string", "format": "uuid" } },
        "required": ["assetId"],
        "additionalProperties": false
    })
}

fn delete_asset(host: &dyn DocumentHost, _session: &Session, args: Value) -> ToolResult {
    let args: DeleteAssetArgs = parse(args)?;
    let id = asset_id(&args.asset_id)?;
    // Deleting a later frame leaves its animation behind, one frame shorter.
    let remaining = with_store(host, |store| {
        let root = store.asset_read(id)?.root_id;
        store.asset_delete(id)?;
        root.map(|root| store.animation_read(root)).transpose()
    })?;
    if let Some(animation) = &remaining {
        host.animation_changed(animation);
    }
    Ok(json!({ "deleted": id }))
}

// ---------------------------------------------------------------------------
// list_references
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListReferencesArgs {
    asset_id: Option<String>,
}

fn asset_only_schema() -> Value {
    json!({
        "type": "object",
        "properties": { "assetId": { "type": "string", "format": "uuid" } },
        "required": [],
        "additionalProperties": false
    })
}

fn list_references(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: ListReferencesArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let references = with_store(host, |store| store.reference_list(asset))?;
    let summaries: Vec<_> = references.iter().map(crate::reference::summary).collect();
    Ok(json!({ "assetId": asset.0, "references": summaries }))
}

// ---------------------------------------------------------------------------
// delete_reference
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeleteReferenceArgs {
    asset_id: Option<String>,
    reference_id: String,
}

fn delete_reference_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "referenceId": { "type": "string", "format": "uuid" }
        },
        "required": ["referenceId"],
        "additionalProperties": false
    })
}

fn delete_reference(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: DeleteReferenceArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let not_found = |detail: String| {
        ToolError::new(
            "reference.not_found",
            detail,
            "Call list_references for the ids on this asset.",
        )
    };
    let reference = Uuid::parse_str(&args.reference_id)
        .map_err(|_| not_found(format!("{} is not a reference id", args.reference_id)))?;
    with_store(host, |store| store.reference_delete(asset, reference)).map_err(|error| {
        if error.code == "asset.not_found" {
            not_found(format!("no reference {reference} on this asset"))
        } else {
            error
        }
    })?;
    Ok(json!({ "deleted": reference }))
}

// ---------------------------------------------------------------------------

pub fn tools() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "rename_project",
            description: "Rename a project. The name must be nonempty, at most 1024 \
                bytes and free of control characters.",
            input_schema: rename_project_schema,
            handler: rename_project,
        },
        ToolSpec {
            name: "delete_project",
            description: "Delete a project. This cannot be undone: the project's \
                assets, their layers, palettes and history go with it. A project \
                that still has assets is refused (project.not_empty) unless you \
                pass force: true; an empty one is deleted without it.",
            input_schema: delete_project_schema,
            handler: delete_project,
        },
        ToolSpec {
            name: "rename_asset",
            description: "Rename an asset. Renaming an animation's first frame \
                renames the whole animation; a later frame cannot be renamed on its \
                own (animation.frame_name).",
            input_schema: rename_asset_schema,
            handler: rename_asset,
        },
        ToolSpec {
            name: "delete_asset",
            description: "Delete an asset. This cannot be undone. Deleting an \
                animation's first frame deletes the whole animation; deleting a \
                later frame removes just that frame.",
            input_schema: delete_asset_schema,
            handler: delete_asset,
        },
        ToolSpec {
            name: "list_references",
            description: "List the reference images stored on an asset: id, name, \
                size, palette, the detected pixel grid and any warnings from \
                conforming. Use the ids with read_reference, extract_palette, \
                pixelize_reference or delete_reference.",
            input_schema: asset_only_schema,
            handler: list_references,
        },
        ToolSpec {
            name: "delete_reference",
            description: "Delete one reference image from an asset. This cannot be \
                undone.",
            input_schema: delete_reference_schema,
            handler: delete_reference,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::host::{Notice, RecordingHost};
    use crate::mcp::tools::call;
    use crate::store::{AssetId, Reference, Store};

    struct Fixture {
        host: RecordingHost,
        session: Session,
        project: Uuid,
        hero: AssetId,
    }

    fn fixture() -> Fixture {
        let mut store = Store::memory().unwrap();
        let project = store.project_create("demo", "32bit", "topdown").unwrap();
        let hero = store
            .asset_create(project.id, "hero", "prop", 4, 4)
            .unwrap()
            .id;
        Fixture {
            host: RecordingHost::new(store),
            session: Session::new("s-1"),
            project: project.id,
            hero,
        }
    }

    fn run(f: &Fixture, tool: &str, args: Value) -> ToolResult {
        call(&f.host, &f.session, tool, args)
    }

    fn hero(f: &Fixture) -> String {
        f.hero.0.to_string()
    }

    #[test]
    fn rename_project_renames_it() {
        let f = fixture();
        let args = json!({ "projectId": f.project.to_string(), "name": "renamed" });
        let out = run(&f, "rename_project", args).unwrap();
        assert_eq!(out["project"]["name"], "renamed");
        let list = run(&f, "list_projects", json!({})).unwrap();
        assert_eq!(list["projects"][0]["name"], "renamed");
    }

    #[test]
    fn rename_project_refuses_bad_input() {
        let f = fixture();
        let id = f.project.to_string();
        let bad = run(
            &f,
            "rename_project",
            json!({ "projectId": id, "name": "  " }),
        );
        assert_eq!(bad.unwrap_err().code, "document.invalid_name");
        let missing = json!({ "projectId": Uuid::now_v7().to_string(), "name": "x" });
        assert_eq!(
            run(&f, "rename_project", missing).unwrap_err().code,
            "project.not_found"
        );
        let malformed = json!({ "projectId": "nope", "name": "x" });
        assert_eq!(
            run(&f, "rename_project", malformed).unwrap_err().code,
            "project.not_found"
        );
        let incomplete = json!({ "projectId": id });
        assert_eq!(
            run(&f, "rename_project", incomplete).unwrap_err().code,
            "args.invalid"
        );
    }

    #[test]
    fn delete_project_removes_an_empty_project_without_force() {
        let f = fixture();
        let empty = with_store(&f.host, |store| {
            store.project_create("empty", "32bit", "topdown")
        })
        .unwrap()
        .id;
        let out = run(
            &f,
            "delete_project",
            json!({ "projectId": empty.to_string() }),
        )
        .unwrap();
        assert_eq!(out["assetsDeleted"], 0);
        let list = run(&f, "list_projects", json!({})).unwrap();
        assert_eq!(list["projects"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn delete_project_with_assets_needs_force() {
        let f = fixture();
        let id = f.project.to_string();
        let refused = run(&f, "delete_project", json!({ "projectId": id })).unwrap_err();
        assert_eq!(refused.code, "project.not_empty");
        assert!(refused.hint.contains("force"));
        let explicit = json!({ "projectId": id, "force": false });
        assert_eq!(
            run(&f, "delete_project", explicit).unwrap_err().code,
            "project.not_empty"
        );
        let kept = with_store(&f.host, |s| s.asset_list(f.project)).unwrap();
        assert_eq!(kept.len(), 1);

        let out = run(
            &f,
            "delete_project",
            json!({ "projectId": id, "force": true }),
        )
        .unwrap();
        assert_eq!(out["assetsDeleted"], 1);
        assert!(with_store(&f.host, |s| s.project_read(f.project)).is_err());
    }

    #[test]
    fn delete_project_refuses_unknown_and_malformed_ids() {
        let f = fixture();
        let unknown = json!({ "projectId": Uuid::now_v7().to_string(), "force": true });
        assert_eq!(
            run(&f, "delete_project", unknown).unwrap_err().code,
            "project.not_found"
        );
        assert_eq!(
            run(&f, "delete_project", json!({ "projectId": "x" }))
                .unwrap_err()
                .code,
            "project.not_found"
        );
    }

    #[test]
    fn destructive_tools_say_they_cannot_be_undone() {
        let specs = tools();
        for name in ["delete_project", "delete_asset", "delete_reference"] {
            let spec = specs.iter().find(|s| s.name == name).unwrap();
            assert!(spec.description.contains("cannot be undone"), "{name}");
        }
        let spec = specs.iter().find(|s| s.name == "delete_project").unwrap();
        assert!(spec.description.contains("force: true"));
    }

    #[test]
    fn rename_asset_renames_and_announces_it() {
        let f = fixture();
        let out = run(
            &f,
            "rename_asset",
            json!({ "assetId": hero(&f), "name": "knight" }),
        )
        .unwrap();
        assert_eq!(out["asset"]["name"], "knight");
        assert!(f.host.notices().contains(&Notice::Changed(f.hero)));
    }

    #[test]
    fn rename_asset_renames_an_animation_and_refuses_a_later_frame() {
        let f = fixture();
        let added = run(&f, "add_frame", json!({ "assetId": hero(&f) })).unwrap();
        let frame = added["frame"].as_str().unwrap().to_string();
        let refused = run(&f, "rename_asset", json!({ "assetId": frame, "name": "x" }));
        assert_eq!(refused.unwrap_err().code, "animation.frame_name");
        let renamed = json!({ "assetId": hero(&f), "name": "knight" });
        run(&f, "rename_asset", renamed).unwrap();
        let anim = run(&f, "read_animation", json!({ "assetId": hero(&f) })).unwrap();
        assert!(anim.to_string().contains("knight"));
    }

    #[test]
    fn rename_asset_refuses_bad_name_unknown_and_malformed_id() {
        let f = fixture();
        let bad = json!({ "assetId": hero(&f), "name": "" });
        assert_eq!(
            run(&f, "rename_asset", bad).unwrap_err().code,
            "document.invalid_name"
        );
        let unknown = json!({ "assetId": Uuid::now_v7().to_string(), "name": "x" });
        assert_eq!(
            run(&f, "rename_asset", unknown).unwrap_err().code,
            "asset.not_found"
        );
        let malformed = json!({ "assetId": "x", "name": "x" });
        assert_eq!(
            run(&f, "rename_asset", malformed).unwrap_err().code,
            "asset.not_found"
        );
    }

    #[test]
    fn delete_asset_deletes_it() {
        let f = fixture();
        let out = run(&f, "delete_asset", json!({ "assetId": hero(&f) })).unwrap();
        assert_eq!(out["deleted"], json!(f.hero.0));
        assert!(with_store(&f.host, |s| s.asset_list(f.project))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn delete_asset_on_a_later_frame_keeps_the_animation_and_announces_it() {
        let f = fixture();
        let added = run(&f, "add_frame", json!({ "assetId": hero(&f) })).unwrap();
        let frame = added["frame"].as_str().unwrap().to_string();
        run(&f, "delete_asset", json!({ "assetId": frame })).unwrap();
        let left = with_store(&f.host, |s| s.asset_list(f.project)).unwrap();
        assert_eq!(left.len(), 1);
        assert!(f
            .host
            .notices()
            .iter()
            .any(|n| matches!(n, Notice::Animation(a) if a.frames.len() == 1)));
    }

    #[test]
    fn delete_asset_refuses_unknown_and_malformed_ids() {
        let f = fixture();
        let unknown = json!({ "assetId": Uuid::now_v7().to_string() });
        assert_eq!(
            run(&f, "delete_asset", unknown).unwrap_err().code,
            "asset.not_found"
        );
        assert_eq!(
            run(&f, "delete_asset", json!({ "assetId": "x" }))
                .unwrap_err()
                .code,
            "asset.not_found"
        );
    }

    fn add_reference(f: &Fixture) -> Uuid {
        let id = Uuid::now_v7();
        with_store(&f.host, |store| {
            store.reference_write(Reference {
                id,
                asset_id: f.hero,
                name: "picture".into(),
                source_png: vec![1],
                conformed: None,
                conform_meta: None,
                created_at: 1,
            })
        })
        .unwrap();
        id
    }

    #[test]
    fn list_and_delete_reference_round_trip() {
        let f = fixture();
        let asset = json!({ "assetId": hero(&f) });
        let none = run(&f, "list_references", asset.clone()).unwrap();
        assert!(none["references"].as_array().unwrap().is_empty());
        let reference = add_reference(&f);
        let listed = run(&f, "list_references", asset.clone()).unwrap();
        assert_eq!(listed["references"][0]["id"], json!(reference));
        let delete = json!({ "assetId": hero(&f), "referenceId": reference.to_string() });
        run(&f, "delete_reference", delete).unwrap();
        let after = run(&f, "list_references", asset).unwrap();
        assert!(after["references"].as_array().unwrap().is_empty());
    }

    #[test]
    fn list_and_delete_reference_refuse_what_does_not_exist() {
        let f = fixture();
        assert_eq!(
            run(&f, "list_references", json!({})).unwrap_err().code,
            "asset.not_open"
        );
        let unknown = json!({ "assetId": Uuid::now_v7().to_string() });
        assert_eq!(
            run(&f, "list_references", unknown).unwrap_err().code,
            "asset.not_found"
        );
        let missing = json!({ "assetId": hero(&f), "referenceId": Uuid::now_v7().to_string() });
        assert_eq!(
            run(&f, "delete_reference", missing).unwrap_err().code,
            "reference.not_found"
        );
        let malformed = json!({ "assetId": hero(&f), "referenceId": "x" });
        assert_eq!(
            run(&f, "delete_reference", malformed).unwrap_err().code,
            "reference.not_found"
        );
    }
}
