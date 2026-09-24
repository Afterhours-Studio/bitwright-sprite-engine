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

//! History: undo, redo and the op log.

use super::super::error::ToolError;
use super::super::host::{with_store, DocumentHost};
use super::super::session::Session;
use super::{parse, resolve_asset, summary, ToolResult, ToolSpec};
use serde::Deserialize;
use serde_json::{json, Value};

// ---------------------------------------------------------------------------
// undo
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UndoArgs {
    asset_id: Option<String>,
    #[serde(default = "default_one")]
    count: u32,
}

fn default_one() -> u32 {
    1
}

fn undo_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "count": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
                "default": 1
            }
        },
        "required": [],
        "additionalProperties": false
    })
}

fn undo_handler(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: UndoArgs = parse(args)?;
    if args.count == 0 || args.count > 100 {
        return Err(ToolError::new(
            "args.invalid",
            format!("count must be 1..=100, got {}", args.count),
            "Pass a count between 1 and 100.",
        ));
    }
    let id = resolve_asset(session, args.asset_id.as_deref())?;
    let actor = session.actor();
    let mut done = 0u32;
    let mut last_summary: Option<Value> = None;
    for _ in 0..args.count {
        match with_store(host, |store| store.undo(id, &actor)) {
            Ok(result) => {
                let s = summary(&result);
                host.changed(id, &result);
                last_summary = Some(s);
                done += 1;
            }
            Err(err) => {
                if err.code == "document.nothing_to_undo" {
                    break;
                }
                return Err(err);
            }
        }
    }
    Ok(json!({ "done": done, "last": last_summary }))
}

// ---------------------------------------------------------------------------
// redo
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RedoArgs {
    asset_id: Option<String>,
    #[serde(default = "default_one")]
    count: u32,
}

fn redo_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "count": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
                "default": 1
            }
        },
        "required": [],
        "additionalProperties": false
    })
}

fn redo_handler(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: RedoArgs = parse(args)?;
    if args.count == 0 || args.count > 100 {
        return Err(ToolError::new(
            "args.invalid",
            format!("count must be 1..=100, got {}", args.count),
            "Pass a count between 1 and 100.",
        ));
    }
    let id = resolve_asset(session, args.asset_id.as_deref())?;
    let actor = session.actor();
    let mut done = 0u32;
    let mut last_summary: Option<Value> = None;
    for _ in 0..args.count {
        match with_store(host, |store| store.redo(id, &actor)) {
            Ok(result) => {
                let s = summary(&result);
                host.changed(id, &result);
                last_summary = Some(s);
                done += 1;
            }
            Err(err) => {
                if err.code == "document.nothing_to_redo" {
                    break;
                }
                return Err(err);
            }
        }
    }
    Ok(json!({ "done": done, "last": last_summary }))
}

// ---------------------------------------------------------------------------
// read_history
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadHistoryArgs {
    asset_id: Option<String>,
    #[serde(default = "default_limit")]
    limit: u32,
}

fn default_limit() -> u32 {
    50
}

fn read_history_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 500,
                "default": 50
            }
        },
        "required": [],
        "additionalProperties": false
    })
}

fn read_history_handler(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: ReadHistoryArgs = parse(args)?;
    if args.limit == 0 || args.limit > 500 {
        return Err(ToolError::new(
            "args.invalid",
            format!("limit must be 1..=500, got {}", args.limit),
            "Pass a limit between 1 and 500.",
        ));
    }
    let id = resolve_asset(session, args.asset_id.as_deref())?;
    let records = with_store(host, |store| store.op_log(id))?;
    let limit = args.limit as usize;
    let ops: Vec<Value> = records
        .iter()
        .rev()
        .take(limit)
        .map(|r| {
            json!({
                "seq": r.seq,
                "kind": r.kind,
                "layer": r.layer_role.as_ref().map(|role| role.0),
                "actor": r.actor,
                "at": r.at,
            })
        })
        .collect();
    Ok(json!({ "ops": ops }))
}

// ---------------------------------------------------------------------------
// Catalogue entry
// ---------------------------------------------------------------------------

pub fn tools() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "undo",
            description: "Undo your last edits, or the person's: it is one history. \
                count defaults to 1.",
            input_schema: undo_schema,
            handler: undo_handler,
        },
        ToolSpec {
            name: "redo",
            description: "Redo what undo undid.",
            input_schema: redo_schema,
            handler: redo_handler,
        },
        ToolSpec {
            name: "read_history",
            description: "Recent edits, newest first, with who made each. How you \
                find out what happened since you last looked.",
            input_schema: read_history_schema,
            handler: read_history_handler,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::host::HeadlessHost;
    use crate::mcp::session::Session;
    use crate::raster::document_ops::Op;
    use crate::raster::ops;
    use crate::raster::LayerRole;
    use crate::raster::{IndexedBuffer, Palette, PaletteSlot};
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
        .unwrap()["asset"]["id"]
            .as_str()
            .unwrap()
            .to_string()
    }

    fn setup_palette(host: &HeadlessHost, id: crate::store::AssetId) {
        host.store()
            .lock()
            .unwrap()
            .palette_write(
                id,
                Palette {
                    slots: vec![
                        PaletteSlot {
                            index: 1,
                            rgba: [100, 80, 60, 255],
                            name: None,
                            ramp: None,
                            step: None,
                        },
                        PaletteSlot {
                            index: 2,
                            rgba: [140, 120, 100, 255],
                            name: None,
                            ramp: None,
                            step: None,
                        },
                    ],
                    ramps: vec![],
                },
            )
            .unwrap();
    }

    fn write_two_ops(host: &HeadlessHost, id: crate::store::AssetId) {
        let op1 = Op::SetPixels {
            layer: LayerRole("silhouette"),
            pixels: vec![ops::Pixel {
                x: 0,
                y: 0,
                slot: 1,
            }],
        };
        let op2 = Op::SetPixels {
            layer: LayerRole("silhouette"),
            pixels: vec![ops::Pixel {
                x: 1,
                y: 0,
                slot: 2,
            }],
        };
        host.store()
            .lock()
            .unwrap()
            .write_ops(id, vec![op1], "user")
            .unwrap();
        host.store()
            .lock()
            .unwrap()
            .write_ops(id, vec![op2], "user")
            .unwrap();
    }

    fn op_count(host: &HeadlessHost, id: crate::store::AssetId) -> usize {
        host.store().lock().unwrap().op_log(id).unwrap().len()
    }

    fn last_seq(host: &HeadlessHost, id: crate::store::AssetId) -> i64 {
        host.store()
            .lock()
            .unwrap()
            .op_log(id)
            .unwrap()
            .last()
            .unwrap()
            .seq
    }

    fn layer_buffer(host: &HeadlessHost, id: crate::store::AssetId) -> IndexedBuffer {
        host.store()
            .lock()
            .unwrap()
            .layer_read(id, LayerRole("silhouette"))
            .unwrap()
            .buffer
    }

    #[test]
    fn undo_one_reverts_the_last_op() {
        let (host, session) = setup();
        let asset_id_str = create_project_and_asset(&host, &session);
        let id = crate::mcp::tools::asset_id(&asset_id_str).unwrap();
        session.set_current_asset(id);
        setup_palette(&host, id);
        write_two_ops(&host, id);

        let before = layer_buffer(&host, id);
        assert_eq!(before.get(0, 0), 1);
        assert_eq!(before.get(1, 0), 2);

        let expected = last_seq(&host, id) + 1;
        let result = super::super::call(&host, &session, "undo", json!({ "count": 1 })).unwrap();
        assert_eq!(result["done"].as_u64().unwrap(), 1);
        assert!(result["last"].is_object());
        assert_eq!(result["last"]["seq"].as_i64().unwrap(), expected);

        let after = layer_buffer(&host, id);
        assert_eq!(after.get(1, 0), 0, "the undone op's pixel is gone");
        assert_eq!(after.get(0, 0), 1, "the earlier op's pixel remains");
    }

    #[test]
    fn undo_more_than_available_stops_at_boundary() {
        let (host, session) = setup();
        let asset_id_str = create_project_and_asset(&host, &session);
        let id = crate::mcp::tools::asset_id(&asset_id_str).unwrap();
        session.set_current_asset(id);
        setup_palette(&host, id);
        write_two_ops(&host, id);

        let total = op_count(&host, id) as u32;
        super::super::call(&host, &session, "undo", json!({ "count": total })).unwrap();

        let result = super::super::call(&host, &session, "undo", json!({ "count": 5 })).unwrap();
        assert_eq!(result["done"].as_u64().unwrap(), 0);
        assert!(result["last"].is_null());
    }

    #[test]
    fn undo_count_one_of_two_left_reports_done_one() {
        let (host, session) = setup();
        let asset_id_str = create_project_and_asset(&host, &session);
        let id = crate::mcp::tools::asset_id(&asset_id_str).unwrap();
        session.set_current_asset(id);
        setup_palette(&host, id);
        write_two_ops(&host, id);

        let total = op_count(&host, id) as u32;
        super::super::call(&host, &session, "undo", json!({ "count": total - 1 })).unwrap();
        let result = super::super::call(&host, &session, "undo", json!({ "count": 5 })).unwrap();
        assert_eq!(result["done"].as_u64().unwrap(), 1);
        assert!(result["last"].is_object());
    }

    #[test]
    fn redo_restores_undone_op() {
        let (host, session) = setup();
        let asset_id_str = create_project_and_asset(&host, &session);
        let id = crate::mcp::tools::asset_id(&asset_id_str).unwrap();
        session.set_current_asset(id);
        setup_palette(&host, id);
        write_two_ops(&host, id);

        let before = layer_buffer(&host, id);
        assert_eq!(before.get(0, 0), 1);
        assert_eq!(before.get(1, 0), 2);

        super::super::call(&host, &session, "undo", json!({ "count": 1 })).unwrap();
        assert_eq!(
            layer_buffer(&host, id).get(1, 0),
            0,
            "undo removed the last op's pixel"
        );

        let expected = last_seq(&host, id) + 1;
        let result = super::super::call(&host, &session, "redo", json!({ "count": 1 })).unwrap();
        assert_eq!(result["done"].as_u64().unwrap(), 1);
        assert!(result["last"].is_object());
        assert_eq!(result["last"]["seq"].as_i64().unwrap(), expected);

        let after = layer_buffer(&host, id);
        assert_eq!(after.get(0, 0), before.get(0, 0));
        assert_eq!(after.get(1, 0), before.get(1, 0));
    }

    #[test]
    fn read_history_is_newest_first_and_excludes_payload() {
        let (host, session) = setup();
        let asset_id_str = create_project_and_asset(&host, &session);
        let id = crate::mcp::tools::asset_id(&asset_id_str).unwrap();
        session.set_current_asset(id);
        setup_palette(&host, id);
        write_two_ops(&host, id);

        let result =
            super::super::call(&host, &session, "read_history", json!({ "limit": 50 })).unwrap();
        let total = op_count(&host, id) as i64;
        let ops = result["ops"].as_array().unwrap();
        assert_eq!(ops.len(), total as usize);
        assert_eq!(ops[0]["seq"].as_i64().unwrap(), total);
        assert_eq!(ops[1]["seq"].as_i64().unwrap(), total - 1);
        assert!(ops[0].get("payload").is_none());
        assert!(ops[0].get("inverse").is_none());
        assert_eq!(ops[0]["layer"].as_str().unwrap(), "silhouette");
        assert_eq!(ops[0]["actor"].as_str().unwrap(), "user");
        assert!(ops[0]["at"].is_number());
    }

    #[test]
    fn undo_count_zero_is_args_invalid() {
        let (host, session) = setup();
        let asset_id_str = create_project_and_asset(&host, &session);
        let id = crate::mcp::tools::asset_id(&asset_id_str).unwrap();
        session.set_current_asset(id);

        let err = super::super::call(&host, &session, "undo", json!({ "count": 0 })).unwrap_err();
        assert_eq!(err.code, "args.invalid");
    }

    #[test]
    fn undo_count_101_is_args_invalid() {
        let (host, session) = setup();
        let asset_id_str = create_project_and_asset(&host, &session);
        let id = crate::mcp::tools::asset_id(&asset_id_str).unwrap();
        session.set_current_asset(id);

        let err = super::super::call(&host, &session, "undo", json!({ "count": 101 })).unwrap_err();
        assert_eq!(err.code, "args.invalid");
    }

    #[test]
    fn redo_count_zero_is_args_invalid() {
        let (host, session) = setup();
        let asset_id_str = create_project_and_asset(&host, &session);
        let id = crate::mcp::tools::asset_id(&asset_id_str).unwrap();
        session.set_current_asset(id);

        let err = super::super::call(&host, &session, "redo", json!({ "count": 0 })).unwrap_err();
        assert_eq!(err.code, "args.invalid");
    }

    #[test]
    fn redo_count_101_is_args_invalid() {
        let (host, session) = setup();
        let asset_id_str = create_project_and_asset(&host, &session);
        let id = crate::mcp::tools::asset_id(&asset_id_str).unwrap();
        session.set_current_asset(id);

        let err = super::super::call(&host, &session, "redo", json!({ "count": 101 })).unwrap_err();
        assert_eq!(err.code, "args.invalid");
    }

    #[test]
    fn read_history_limit_zero_is_args_invalid() {
        let (host, session) = setup();
        let asset_id_str = create_project_and_asset(&host, &session);
        let id = crate::mcp::tools::asset_id(&asset_id_str).unwrap();
        session.set_current_asset(id);

        let err =
            super::super::call(&host, &session, "read_history", json!({ "limit": 0 })).unwrap_err();
        assert_eq!(err.code, "args.invalid");
    }

    #[test]
    fn read_history_limit_501_is_args_invalid() {
        let (host, session) = setup();
        let asset_id_str = create_project_and_asset(&host, &session);
        let id = crate::mcp::tools::asset_id(&asset_id_str).unwrap();
        session.set_current_asset(id);

        let err = super::super::call(&host, &session, "read_history", json!({ "limit": 501 }))
            .unwrap_err();
        assert_eq!(err.code, "args.invalid");
    }

    #[test]
    fn undo_first_call_nothing_to_undo_returns_done_zero() {
        let (host, session) = setup();
        let asset_id_str = create_project_and_asset(&host, &session);
        let id = crate::mcp::tools::asset_id(&asset_id_str).unwrap();
        session.set_current_asset(id);

        let result = super::super::call(&host, &session, "undo", json!(null)).unwrap();
        assert_eq!(result["done"].as_u64().unwrap(), 0);
        assert!(result["last"].is_null());
    }

    #[test]
    fn redo_first_call_nothing_to_redo_returns_done_zero() {
        let (host, session) = setup();
        let asset_id_str = create_project_and_asset(&host, &session);
        let id = crate::mcp::tools::asset_id(&asset_id_str).unwrap();
        session.set_current_asset(id);

        let result = super::super::call(&host, &session, "redo", json!(null)).unwrap();
        assert_eq!(result["done"].as_u64().unwrap(), 0);
        assert!(result["last"].is_null());
    }
}
