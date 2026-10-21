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

//! The workflow: step state, gates, advance and step selection.
//!
//! Two steps matter at once. `step` is the furthest step reached; every step
//! before it has passed. `activeStep` is the step being viewed and drawn in,
//! which `revisit_step` can move back to any passed step without locking or
//! un-passing anything. Editing an earlier layer marks the passed steps after
//! it `needsRecheck`, and the next `advance_step` re-runs those first.

use super::super::error::ToolError;
use super::super::host::{with_store, DocumentHost};
use super::super::session::Session;
use super::{parse, resolve_asset, ToolResult, ToolSpec};
use crate::store::StepState;
use serde::Deserialize;
use serde_json::{json, Value};

// ---------------------------------------------------------------------------
// get_step
// ---------------------------------------------------------------------------

fn get_step_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" }
        },
        "required": [],
        "additionalProperties": false
    })
}

const EXPECTS: &[(&str, &str)] = &[
    ("reference", "Import a reference, or skip to palette."),
    ("palette", "Set ramps with set_palette; they must pass the style's hue-shift and ramp-length rules."),
    ("silhouette", "Paste the filled shape into the silhouette layer in one slot: one connected region that reads at 1x."),
    ("flats", "Fill each material's base slot inside the silhouette, unshaded."),
    ("shadow", "Place core and deep shadow with shade, from the light direction in the style rules."),
    ("light", "Place lit planes with shade target light."),
    ("outline", "Derive the outline with the outline tool; selective by default."),
    ("detail", "Add interior features on the detail layer."),
    ("accent", "Add the rim light and the few highest-contrast marks."),
    ("cleanup", "Anti-alias interior edges and remove stray pixels."),
    ("variation", "Fork palette variations with create_variation."),
];

/// What a `single` line style asks of the steps whose job it changes.
const EXPECTS_SINGLE: &[(&str, &str)] = &[
    ("outline", "Trace the whole silhouette edge in one line slot with the outline tool (from: silhouette); inner contour lines in the same slot are allowed."),
    ("flats", "Fill each material's base slot inside the line, unshaded. Pixels under the line may stay empty."),
];

fn expects(step: &str, line_mode: &str) -> String {
    let single = if line_mode == "single" {
        EXPECTS_SINGLE.iter().find(|(name, _)| *name == step)
    } else {
        None
    };
    single
        .or_else(|| EXPECTS.iter().find(|(name, _)| *name == step))
        .map(|(_, desc)| (*desc).to_string())
        .unwrap_or_default()
}

/// The step state as every workflow tool reports it.
fn state_json(state: &StepState) -> Value {
    json!({
        "step": state.step,
        "activeStep": state.active_step,
        "lineMode": state.line_mode,
        "order": state.order,
        "needsRecheck": state.needs_recheck,
        "visibleRoles": state.visible_roles,
        "canAdvance": state.can_advance,
        "expects": expects(&state.active_step, &state.line_mode),
        "gate": state.gate,
    })
}

fn get_step(host: &dyn DocumentHost, _session: &Session, args: Value) -> ToolResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Args {
        asset_id: Option<String>,
    }
    let args: Args = parse(args)?;
    let id = resolve_asset(_session, args.asset_id.as_deref())?;
    let state = with_store(host, |store| store.step_state(id))?;
    Ok(state_json(&state))
}

// ---------------------------------------------------------------------------
// check_step
// ---------------------------------------------------------------------------

fn check_step_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" }
        },
        "required": [],
        "additionalProperties": false
    })
}

fn check_step(host: &dyn DocumentHost, _session: &Session, args: Value) -> ToolResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Args {
        asset_id: Option<String>,
    }
    let args: Args = parse(args)?;
    let id = resolve_asset(_session, args.asset_id.as_deref())?;
    let state = with_store(host, |store| store.step_state(id))?;
    let mut report = serde_json::to_value(&state.gate)
        .map_err(|e| ToolError::new("gate.serialize_failed", e.to_string(), "Report this bug."))?;
    report["activeStep"] = json!(state.active_step);
    report["needsRecheck"] = json!(state.needs_recheck);
    Ok(report)
}

// ---------------------------------------------------------------------------
// advance_step
// ---------------------------------------------------------------------------

fn advance_step_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "force": { "type": "boolean", "default": false }
        },
        "required": [],
        "additionalProperties": false
    })
}

fn advance_step(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Args {
        asset_id: Option<String>,
        force: Option<bool>,
    }
    let args: Args = parse(args)?;
    let id = resolve_asset(session, args.asset_id.as_deref())?;
    let force = args.force.unwrap_or(false);
    let actor = session.actor();
    let (state, result) = with_store(host, |store| store.step_advance_as(id, &actor, force))
        .map_err(|e| {
            if e.code == "step.gate_failed" {
                ToolError::new(
                    "step.gate_failed",
                    format!("gate failed: {}", e.message),
                    "Fix the failing checks (check_step shows where), or pass force: true only if a person asked you to override the gate.",
                )
            } else if e.code == "step.recheck_failed" {
                ToolError::new(
                    "step.recheck_failed",
                    format!("a re-checked step no longer passes: {}", e.message),
                    "An earlier layer was edited after these steps passed. Call revisit_step for the named step, check_step to see where, fix it, then advance again; or pass force: true only if a person asked you to override.",
                )
            } else if e.code == "step.complete" {
                ToolError::new(
                    "step.complete",
                    e.message,
                    "This asset is at its last step.",
                )
            } else {
                e
            }
        })?;
    host.step_changed(id, &state.gate);
    let mut reply = state_json(&state);
    reply["rechecked"] = json!(state.rechecked);
    reply["seq"] = json!(result.seq);
    Ok(reply)
}

// ---------------------------------------------------------------------------
// revisit_step
// ---------------------------------------------------------------------------

fn revisit_step_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "step": {
                "type": "string",
                "description": "A step at or before the furthest one (get_step's step). Naming the furthest step returns the view to it."
            }
        },
        "required": ["step"],
        "additionalProperties": false
    })
}

fn revisit_step(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Args {
        asset_id: Option<String>,
        step: String,
    }
    let args: Args = parse(args)?;
    let id = resolve_asset(session, args.asset_id.as_deref())?;
    let actor = session.actor();
    let (state, result) = with_store(host, |store| store.step_revisit(id, &args.step, &actor))?;
    host.step_changed(id, &state.gate);
    let mut reply = state_json(&state);
    reply["seq"] = json!(result.seq);
    Ok(reply)
}

// ---------------------------------------------------------------------------
// catalogue
// ---------------------------------------------------------------------------

pub fn tools() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "get_step",
            description: "Where this asset is in the workflow: step (the furthest \
                step reached; every step before it passed), activeStep (the step \
                being viewed and drawn in), the style's lineMode and step order, \
                needsRecheck (passed steps an earlier edit asks to check again), \
                visibleRoles (the layers the canvas shows at this view), canAdvance, \
                what the active step expects, and its gate.",
            input_schema: get_step_schema,
            handler: get_step,
        },
        ToolSpec {
            name: "check_step",
            description: "Evaluate the active step's gate now, without advancing. \
                Every check is measured from the pixels; hints name coordinates. \
                Also reports activeStep and needsRecheck.",
            input_schema: check_step_schema,
            handler: check_step,
        },
        ToolSpec {
            name: "advance_step",
            description: "Move the furthest step on if its gate passes. Steps marked \
                needsRecheck run their gates first and are reported in rechecked; \
                one that fails refuses the advance as step.recheck_failed. The view \
                moves to the new furthest step.",
            input_schema: advance_step_schema,
            handler: advance_step,
        },
        ToolSpec {
            name: "revisit_step",
            description: "Select a step at or before the furthest one to view and \
                draw in. A view change only: the layers of later steps are hidden, \
                not erased, later steps stay passed and nothing locks. Drawing then \
                goes to that step's layer; editing it marks the passed steps after \
                it needsRecheck. Name the furthest step to return to it.",
            input_schema: revisit_step_schema,
            handler: revisit_step,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::host::HeadlessHost;
    use crate::mcp::session::Session;
    use crate::store::Store;

    fn setup() -> (HeadlessHost, Session) {
        let host = HeadlessHost::new(Store::memory().unwrap());
        let session = Session::new("test");
        (host, session)
    }

    fn create_project_and_asset(host: &HeadlessHost, session: &Session) -> String {
        let project_id =
            super::super::call(host, session, "create_project", json!({ "name": "Test" })).unwrap()
                ["project"]["id"]
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
                "width": 32,
                "height": 32,
            }),
        )
        .unwrap()["asset"]["id"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn get_step_reports_reference_for_new_asset() {
        let (host, session) = setup();
        let asset_id = create_project_and_asset(&host, &session);
        let result =
            super::super::call(&host, &session, "get_step", json!({ "assetId": asset_id }))
                .unwrap();
        assert_eq!(result["step"].as_str().unwrap(), "reference");
        assert_eq!(
            result["expects"].as_str().unwrap(),
            "Import a reference, or skip to palette."
        );
        assert!(result["gate"].is_object());
    }

    #[test]
    fn check_step_returns_gate_report() {
        let (host, session) = setup();
        let asset_id = create_project_and_asset(&host, &session);
        let result = super::super::call(
            &host,
            &session,
            "check_step",
            json!({ "assetId": asset_id }),
        )
        .unwrap();
        assert_eq!(result["step"].as_str().unwrap(), "reference");
        assert!(result["checks"].is_array());
    }

    #[test]
    fn advance_step_advances_from_reference() {
        let (host, session) = setup();
        let asset_id = create_project_and_asset(&host, &session);
        let gate = super::super::call(
            &host,
            &session,
            "check_step",
            json!({ "assetId": asset_id }),
        )
        .unwrap();
        let passes = gate["pass"].as_bool().unwrap();
        let result = if passes {
            super::super::call(
                &host,
                &session,
                "advance_step",
                json!({ "assetId": asset_id }),
            )
        } else {
            super::super::call(
                &host,
                &session,
                "advance_step",
                json!({ "assetId": asset_id, "force": true }),
            )
        };
        let result = result.unwrap();
        assert_eq!(result["step"].as_str().unwrap(), "palette");
        assert!(result["gate"].is_object());
        assert!(result["seq"].is_number());
    }

    #[test]
    fn advance_step_refused_without_force_records_forced_when_overridden() {
        let (host, session) = setup();
        let asset_id = create_project_and_asset(&host, &session);
        let gate = super::super::call(
            &host,
            &session,
            "check_step",
            json!({ "assetId": asset_id }),
        )
        .unwrap();
        if gate["pass"].as_bool().unwrap() {
            super::super::call(
                &host,
                &session,
                "advance_step",
                json!({ "assetId": asset_id }),
            )
            .unwrap();
        }
        let err = super::super::call(
            &host,
            &session,
            "advance_step",
            json!({ "assetId": asset_id }),
        )
        .unwrap_err();
        assert_eq!(err.code, "step.gate_failed");
        assert!(err.hint.contains("check_step"));
        assert!(err.hint.contains("force: true"));
        let result = super::super::call(
            &host,
            &session,
            "advance_step",
            json!({ "assetId": asset_id, "force": true }),
        )
        .unwrap();
        assert!(result["step"].is_string());
    }

    #[test]
    fn advance_step_forced_records_a_forced_actor_in_the_op_log() {
        let (host, session) = setup();
        let asset_id = create_project_and_asset(&host, &session);
        super::super::call(
            &host,
            &session,
            "advance_step",
            json!({ "assetId": asset_id, "force": true }),
        )
        .unwrap();
        let id = resolve_asset(&session, Some(&asset_id)).unwrap();
        let log = with_store(&host, |store| store.op_log(id)).unwrap();
        let last = log.last().unwrap();
        assert!(last.actor.ends_with("(forced)"), "actor was {}", last.actor);
        assert_eq!(last.kind, "step_advance");
    }

    #[test]
    fn revisit_step_selects_an_earlier_step_without_moving_the_furthest() {
        let (host, session) = setup();
        let asset_id = create_project_and_asset(&host, &session);
        super::super::call(
            &host,
            &session,
            "advance_step",
            json!({ "assetId": asset_id, "force": true }),
        )
        .unwrap();
        let result = super::super::call(
            &host,
            &session,
            "revisit_step",
            json!({ "assetId": asset_id, "step": "reference" }),
        )
        .unwrap();
        assert_eq!(result["step"], "palette");
        assert_eq!(result["activeStep"], "reference");
        assert_eq!(result["gate"]["step"], "reference");
        assert!(result["seq"].is_number());
        let state = super::super::call(&host, &session, "get_step", json!({ "assetId": asset_id }))
            .unwrap();
        assert_eq!(state["step"], "palette");
        assert_eq!(state["activeStep"], "reference");
        // Naming the furthest step returns the view to it.
        let result = super::super::call(
            &host,
            &session,
            "revisit_step",
            json!({ "assetId": asset_id, "step": "palette" }),
        )
        .unwrap();
        assert_eq!(result["activeStep"], "palette");
    }

    #[test]
    fn revisit_step_refuses_a_step_not_reached() {
        let (host, session) = setup();
        let asset_id = create_project_and_asset(&host, &session);
        let err = super::super::call(
            &host,
            &session,
            "revisit_step",
            json!({ "assetId": asset_id, "step": "palette" }),
        )
        .unwrap_err();
        assert_eq!(err.code, "document.invalid_step");
    }

    #[test]
    fn get_step_reports_the_view_the_order_and_the_marks() {
        let (host, session) = setup();
        let asset_id = create_project_and_asset(&host, &session);
        let result =
            super::super::call(&host, &session, "get_step", json!({ "assetId": asset_id }))
                .unwrap();
        assert_eq!(result["activeStep"], "reference");
        assert_eq!(result["lineMode"], "derived");
        assert_eq!(result["order"][6], "outline");
        assert_eq!(result["needsRecheck"], json!([]));
        assert!(result["visibleRoles"].is_array());
        assert_eq!(result["canAdvance"], true);
        let check = super::super::call(
            &host,
            &session,
            "check_step",
            json!({ "assetId": asset_id }),
        )
        .unwrap();
        assert_eq!(check["activeStep"], "reference");
        assert_eq!(check["needsRecheck"], json!([]));
    }

    #[test]
    fn a_single_line_project_orders_the_outline_after_the_silhouette() {
        let (host, session) = setup();
        let project = super::super::call(
            &host,
            &session,
            "create_project",
            json!({ "name": "Chibi", "lineMode": "single", "proportions": "chibi" }),
        )
        .unwrap()["project"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let asset = super::super::call(
            &host,
            &session,
            "create_asset",
            json!({ "projectId": project, "name": "Hero", "kind": "character" }),
        )
        .unwrap()["asset"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let state =
            super::super::call(&host, &session, "get_step", json!({ "assetId": asset })).unwrap();
        assert_eq!(state["lineMode"], "single");
        assert_eq!(state["order"][3], "outline");
        assert_eq!(state["order"][4], "flats");
        let rules = super::super::call(
            &host,
            &session,
            "get_style_rules",
            json!({ "assetId": asset }),
        )
        .unwrap();
        assert_eq!(rules["lineMode"], "single");
        assert_eq!(rules["rules"]["lineMode"], "single");
        // Back to derived through set_style_rules, which keeps the era.
        let changed = super::super::call(
            &host,
            &session,
            "set_style_rules",
            json!({ "assetId": asset, "lineMode": "derived" }),
        )
        .unwrap();
        assert_eq!(changed["lineMode"], "derived");
        assert_eq!(changed["era"], "32bit");
        assert!(changed.get("eraChanged").is_none());
        let err = super::super::call(
            &host,
            &session,
            "create_project",
            json!({ "name": "Bad", "lineMode": "dotted" }),
        )
        .unwrap_err();
        assert_eq!(err.code, "args.invalid");
    }
}
