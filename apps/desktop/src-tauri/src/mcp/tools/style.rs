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

//! Editing a style: `set_style_rules`, the writing half of `get_style_rules`.
//!
//! The edit is the store's `style_set_rules_as`, which the window's
//! `style_set_rules` command calls too, so the validation, the move to the
//! `custom` era and the log entry are one behaviour whoever asks. What the
//! tool adds is resolving which style is meant and telling the window.

use super::super::error::ToolError;
use super::super::host::{with_store, DocumentHost};
use super::super::session::Session;
use super::{asset_id, parse, ToolResult, ToolSpec};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetStyleRulesArgs {
    project_id: Option<String>,
    asset_id: Option<String>,
    scope: Option<String>,
    rules: Option<Value>,
    proportions: Option<String>,
    line_mode: Option<String>,
}

fn set_style_rules_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "projectId": {
                "type": "string",
                "format": "uuid",
                "description": "The project whose style to edit. Defaults to the project of assetId or of the open asset."
            },
            "assetId": { "type": "string", "format": "uuid" },
            "scope": {
                "type": "string",
                "enum": ["project", "asset"],
                "description": "project (the default) edits the style every asset of the project reads; asset gives this one asset a style of its own."
            },
            "rules": {
                "type": "object",
                "description": "A partial StyleRules, as get_style_rules returns it: only the fields you send change, and an object merges key by key (rampSteps: { max: 4 } keeps min)."
            },
            "proportions": { "type": "string", "enum": ["standard", "chibi"] },
            "lineMode": {
                "type": "string",
                "enum": ["derived", "single"],
                "description": "derived: the outline step comes after light and derives its colours from the fills. single: one line slot drawn right after the silhouette, above every fill. Same as rules.lineMode; neither moves the era."
            }
        },
        "required": [],
        "additionalProperties": false
    })
}

fn set_style_rules(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let mut args: SetStyleRulesArgs = parse(args)?;
    if args.rules.is_none() && args.proportions.is_none() && args.line_mode.is_none() {
        return Err(ToolError::new(
            "args.invalid",
            "nothing to change",
            "Send rules (a partial StyleRules), proportions, lineMode, or any of them.",
        ));
    }
    // lineMode is a field of the rules; the top-level argument is the short
    // way to send it, and it lands in the same patch.
    if let Some(line_mode) = args.line_mode.take() {
        let mut patch = args.rules.take().unwrap_or_else(|| json!({}));
        match patch.as_object_mut() {
            Some(object) => {
                object.insert("lineMode".into(), json!(line_mode));
            }
            None => {
                return Err(ToolError::new(
                    "style.invalid_rules",
                    "rules must be an object",
                    "Send rules as a partial StyleRules object.",
                ))
            }
        }
        args.rules = Some(patch);
    }
    let scope = args.scope.as_deref().unwrap_or("project");
    if !["project", "asset"].contains(&scope) {
        return Err(ToolError::new(
            "args.invalid",
            format!("scope {scope} is not project or asset"),
            "scope is project (the default) or asset.",
        ));
    }
    let asset = match args.asset_id.as_deref() {
        Some(value) => Some(asset_id(value)?),
        None => session.current_asset(),
    };
    let project = match args.project_id.as_deref() {
        Some(value) => Some(Uuid::parse_str(value).map_err(|_| {
            ToolError::new(
                "project.not_found",
                format!("{value} does not name a project"),
                "Call list_projects for valid ids.",
            )
        })?),
        None => None,
    };
    if scope == "asset" && asset.is_none() {
        return Err(ToolError::new(
            "asset.not_open",
            "scope asset needs an asset, and none is open in this session",
            "Pass assetId, or call open_asset first.",
        ));
    }
    if project.is_none() && asset.is_none() {
        return Err(ToolError::new(
            "asset.not_open",
            "no project or asset named, and no asset is open in this session",
            "Pass projectId or assetId, or call open_asset first.",
        ));
    }
    let (change, project, step) = with_store(host, |store| {
        let project = match (project, asset) {
            (Some(project), _) => project,
            (None, Some(asset)) => store.asset_read(asset)?.project_id,
            (None, None) => unreachable!("refused above"),
        };
        let target = if scope == "asset" { asset } else { None };
        let change = store.style_set_rules_as(
            project,
            target,
            args.rules.as_ref(),
            args.proportions.as_deref(),
            &session.actor(),
        )?;
        // The gates read the new rules at once, so an asset someone is
        // watching gets its report again.
        let step = match asset {
            Some(asset) if store.asset_read(asset)?.project_id == project => {
                Some((asset, store.step_state(asset)?))
            }
            _ => None,
        };
        Ok((change, project, step))
    })
    .map_err(|error| {
        if error.code == "style.invalid_rules" || error.code == "style.invalid_proportions" {
            ToolError::new(
                &error.code,
                error.message,
                "Send only fields get_style_rules returns, with bands low then high: \
                 maxSlots 2..62, rampSteps 2..8, outline full/selective/none, a known \
                 lightDirection, lineMode derived/single, canvas sizes a buffer can be \
                 made at; proportions standard or chibi.",
            )
        } else if error.code == "asset.not_found" && args.project_id.is_some() && scope == "project"
        {
            ToolError::new(
                "project.not_found",
                error.message,
                "Call list_projects for valid ids.",
            )
        } else {
            error
        }
    })?;
    if let Some((asset, state)) = &step {
        host.step_changed(*asset, &state.gate);
    }
    host.projects_changed();
    let style = &change.style;
    let mut result = json!({
        "projectId": project,
        "scope": scope,
        "styleId": style.id,
        "era": style.era,
        "view": style.view,
        "proportions": style.proportions,
        "lineMode": style.rules.line_mode,
        "forked": change.forked,
        "rules": style.rules,
    });
    if let Some(was) = &change.era_was {
        result["eraChanged"] = json!({ "from": was, "to": "custom" });
        result["note"] = json!(format!(
            "These rules are no longer the {was} era's, so the style is now custom."
        ));
    }
    Ok(result)
}

pub fn tools() -> Vec<ToolSpec> {
    vec![ToolSpec {
        name: "set_style_rules",
        description: "Change the style rules the gates check against, and the body \
            proportions (standard or chibi). Partial: send only what changes, as \
            get_style_rules shows it; objects merge key by key. Validated: a band that \
            runs backwards, an unknown field or a value no gate can measure is refused \
            and nothing is written. By default it edits the project's style; scope: \
            asset gives one asset its own style (the first time, a copy of the \
            project's), leaving the rest of the project alone. Changing the rules of a \
            style that is not custom moves its era to custom, and the result says so \
            in eraChanged; proportions and lineMode never change the era. lineMode \
            (derived or single) reorders the steps: single puts the outline right \
            after the silhouette. Logged under this session.",
        input_schema: set_style_rules_schema,
        handler: set_style_rules,
    }]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::host::{Notice, RecordingHost};
    use crate::mcp::tools::call;
    use crate::store::{AssetId, Store};

    struct Fixture {
        host: RecordingHost,
        session: Session,
        project: Uuid,
        hero: AssetId,
    }

    fn fixture() -> Fixture {
        let mut store = Store::memory().unwrap();
        let project = store.project_create("demo", "16bit", "topdown").unwrap();
        let hero = store
            .asset_create(project.id, "hero", "character", 8, 8)
            .unwrap()
            .id;
        Fixture {
            host: RecordingHost::new(store),
            session: Session::new("s-1"),
            project: project.id,
            hero,
        }
    }

    fn run(f: &Fixture, args: Value) -> ToolResult {
        call(&f.host, &f.session, "set_style_rules", args)
    }

    #[test]
    fn a_partial_edit_moves_the_era_to_custom_and_says_so() {
        let f = fixture();
        let out = run(
            &f,
            json!({ "projectId": f.project.to_string(), "rules": { "maxSlots": 12 } }),
        )
        .unwrap();
        assert_eq!(out["era"], "custom");
        assert_eq!(out["eraChanged"]["from"], "16bit");
        assert_eq!(out["rules"]["maxSlots"], 12);
        assert_eq!(out["rules"]["rampSteps"]["min"], 3);
        assert!(f.host.notices().contains(&Notice::Projects));
        let read = call(
            &f.host,
            &f.session,
            "get_style_rules",
            json!({ "assetId": f.hero.0.to_string() }),
        )
        .unwrap();
        assert_eq!(read["rules"]["maxSlots"], 12);
        assert_eq!(read["era"], "custom");
        let log = with_store(&f.host, |s| s.project_log(f.project)).unwrap();
        assert_eq!(log.last().unwrap().actor, "agent:s-1");
    }

    #[test]
    fn proportions_alone_keep_the_era_and_show_in_the_reads() {
        let f = fixture();
        f.session.set_current_asset(f.hero);
        let out = run(&f, json!({ "proportions": "chibi" })).unwrap();
        assert_eq!(out["era"], "16bit");
        assert!(out.get("eraChanged").is_none());
        let read = call(&f.host, &f.session, "get_style_rules", json!({})).unwrap();
        assert_eq!(read["proportions"], "chibi");
        assert!(read["proportionsGuidance"]
            .as_str()
            .unwrap()
            .contains("18..48"));
        let list = call(&f.host, &f.session, "list_projects", json!({})).unwrap();
        assert_eq!(list["projects"][0]["style"]["proportions"], "chibi");
        assert!(f.host.notices().contains(&Notice::Step(f.hero)));
    }

    #[test]
    fn an_asset_scope_edit_leaves_the_project_style_alone() {
        let f = fixture();
        let out = run(
            &f,
            json!({ "assetId": f.hero.0.to_string(), "scope": "asset", "rules": { "maxSlots": 8 } }),
        )
        .unwrap();
        assert_eq!(out["scope"], "asset");
        assert_eq!(out["forked"], true);
        let project = with_store(&f.host, |s| s.project_rules(f.project)).unwrap();
        assert_eq!(project.max_slots, 16);
        let read = call(
            &f.host,
            &f.session,
            "get_style_rules",
            json!({ "assetId": f.hero.0.to_string() }),
        )
        .unwrap();
        assert_eq!(read["styleScope"], "asset");
        assert_eq!(read["rules"]["maxSlots"], 8);
    }

    #[test]
    fn bad_edits_are_refused_with_a_hint_and_write_nothing() {
        let f = fixture();
        let id = f.project.to_string();
        for (args, code) in [
            (json!({ "projectId": id }), "args.invalid"),
            (
                json!({ "projectId": id, "rules": { "maxSlots": 0 } }),
                "style.invalid_rules",
            ),
            (
                json!({ "projectId": id, "rules": { "rampSteps": { "min": 5, "max": 3 } } }),
                "style.invalid_rules",
            ),
            (
                json!({ "projectId": id, "rules": { "slots": 3 } }),
                "style.invalid_rules",
            ),
            (
                json!({ "projectId": id, "proportions": "heroic" }),
                "style.invalid_proportions",
            ),
            (
                json!({ "projectId": id, "scope": "world", "proportions": "chibi" }),
                "args.invalid",
            ),
            (json!({ "proportions": "chibi" }), "asset.not_open"),
            (
                json!({ "projectId": Uuid::now_v7().to_string(), "proportions": "chibi" }),
                "project.not_found",
            ),
        ] {
            let error = run(&f, args.clone()).unwrap_err();
            assert_eq!(error.code, code, "{args}");
            assert!(!error.hint.is_empty());
        }
        let rules = with_store(&f.host, |s| s.project_rules(f.project)).unwrap();
        assert_eq!(rules.max_slots, 16);
    }
}
