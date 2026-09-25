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

//! Animation: frames, their order, their timing and the playback mode.
//!
//! A frame is an ordinary asset, so every drawing tool already works on one;
//! these tools only arrange the row of frames. Each change is announced
//! through the host so a timeline in the window follows the agent, and adding
//! a frame opens it in the session, because drawing on it is always the next
//! thing an agent does.

use super::super::error::ToolError;
use super::super::host::{with_store, DocumentHost};
use super::super::session::Session;
use super::{asset_id, parse, resolve_asset, ToolResult, ToolSpec};
use crate::commands::animation::{renamed_frames, touched};
use crate::store::{Animation, AssetId, Store};
use serde::Deserialize;
use serde_json::{json, Value};

/// The duration bounds, as the schema states them; the store enforces them.
const MIN_MS: u32 = 10;
const MAX_MS: u32 = 10_000;
const PLAYBACKS: [&str; 3] = ["forward", "reverse", "pingpong"];

fn asset_property() -> Value {
    json!({
        "type": "string",
        "format": "uuid",
        "description": "Any frame of the animation; defaults to the session's open asset."
    })
}

fn frame_property() -> Value {
    json!({
        "type": "string",
        "format": "uuid",
        "description": "The frame's asset id, from read_animation."
    })
}

fn ms_property() -> Value {
    json!({ "type": "integer", "minimum": MIN_MS, "maximum": MAX_MS })
}

/// Runs one change to an animation and announces the result.
///
/// Adding, deleting or moving a frame renumbers the names of the frames after
/// it, so each renamed frame is announced as changed too, the way the
/// window's own frame commands do; a header or a home list showing one of
/// those frames would otherwise keep the old name.
fn change(
    host: &dyn DocumentHost,
    anchor: AssetId,
    work: impl FnOnce(&mut Store) -> crate::store::Result<Animation>,
) -> Result<Animation, ToolError> {
    let (animation, renamed) = with_store(host, |store| {
        let before = store.animation_read(anchor)?;
        let after = work(store)?;
        let renamed = renamed_frames(&before, &after)
            .into_iter()
            .map(|id| Ok((id, touched(store, id)?)))
            .collect::<crate::store::Result<Vec<_>>>()?;
        Ok((after, renamed))
    })?;
    host.animation_changed(&animation);
    for (id, result) in &renamed {
        host.changed(*id, result);
    }
    Ok(animation)
}

fn position_of(animation: &Animation, frame: AssetId) -> Option<usize> {
    animation
        .frames
        .iter()
        .position(|candidate| candidate.asset_id == frame)
}

// ---------------------------------------------------------------------------
// read_animation
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadArgs {
    asset_id: Option<String>,
}

fn read_schema() -> Value {
    json!({
        "type": "object",
        "properties": { "assetId": asset_property() },
        "required": [],
        "additionalProperties": false
    })
}

fn read_animation(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: ReadArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let animation = with_store(host, |store| store.animation_read(asset))?;
    Ok(json!(animation))
}

// ---------------------------------------------------------------------------
// add_frame
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AddArgs {
    asset_id: Option<String>,
    #[serde(default = "default_copy")]
    copy: bool,
}

fn default_copy() -> bool {
    true
}

fn add_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": {
                "type": "string",
                "format": "uuid",
                "description": "The frame to insert after; defaults to the session's open asset."
            },
            "copy": {
                "type": "boolean",
                "default": true,
                "description": "true copies the frame's layers, palette and step; \
                    false starts an empty frame with the same palette."
            }
        },
        "required": [],
        "additionalProperties": false
    })
}

fn add_frame(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: AddArgs = parse(args)?;
    let after = resolve_asset(session, args.asset_id.as_deref())?;
    let actor = session.actor();
    let animation = change(host, after, |store| {
        store.frame_add_as(after, args.copy, &actor)
    })?;
    // The store inserts right after `after`, so the new frame is its
    // successor in the row it returns.
    let frame = position_of(&animation, after)
        .and_then(|index| animation.frames.get(index + 1))
        .map(|frame| frame.asset_id)
        .ok_or_else(|| {
            ToolError::new(
                "animation.frame_missing",
                "the new frame is not in the animation the store returned",
                "Call read_animation to see the frames as they are now.",
            )
        })?;
    session.set_current_asset(frame);
    host.opened(frame);
    Ok(json!({ "animation": animation, "frame": frame }))
}

// ---------------------------------------------------------------------------
// delete_frame
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FrameArgs {
    asset_id: String,
}

fn frame_schema() -> Value {
    json!({
        "type": "object",
        "properties": { "assetId": frame_property() },
        "required": ["assetId"],
        "additionalProperties": false
    })
}

fn delete_frame(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: FrameArgs = parse(args)?;
    let frame = asset_id(&args.asset_id)?;
    let (before, animation, renamed) = with_store(host, |store| {
        let before = store.animation_read(frame)?;
        let after = store.frame_delete(frame)?;
        let renamed = renamed_frames(&before, &after)
            .into_iter()
            .map(|id| Ok((id, touched(store, id)?)))
            .collect::<crate::store::Result<Vec<_>>>()?;
        Ok((before, after, renamed))
    })?;
    host.animation_changed(&animation);
    for (id, result) in &renamed {
        host.changed(*id, result);
    }
    // A session left holding a deleted asset would fail its next call, so it
    // moves to the frame that took the deleted one's place, as the window does.
    if session.current_asset() == Some(frame) {
        let index = position_of(&before, frame).unwrap_or(0);
        if let Some(neighbour) = animation
            .frames
            .get(index.min(animation.frames.len().saturating_sub(1)))
        {
            session.set_current_asset(neighbour.asset_id);
            host.opened(neighbour.asset_id);
        }
    }
    Ok(json!(animation))
}

// ---------------------------------------------------------------------------
// move_frame
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MoveArgs {
    asset_id: String,
    to: u32,
}

fn move_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": frame_property(),
            "to": {
                "type": "integer",
                "minimum": 0,
                "description": "The new position, from 0; past the end means last."
            }
        },
        "required": ["assetId", "to"],
        "additionalProperties": false
    })
}

fn move_frame(host: &dyn DocumentHost, _session: &Session, args: Value) -> ToolResult {
    let args: MoveArgs = parse(args)?;
    let frame = asset_id(&args.asset_id)?;
    let animation = change(host, frame, |store| store.frame_move(frame, args.to))?;
    Ok(json!(animation))
}

// ---------------------------------------------------------------------------
// set_frame_duration
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FrameDurationArgs {
    asset_id: String,
    ms: u32,
}

fn frame_duration_schema() -> Value {
    json!({
        "type": "object",
        "properties": { "assetId": frame_property(), "ms": ms_property() },
        "required": ["assetId", "ms"],
        "additionalProperties": false
    })
}

fn set_frame_duration(host: &dyn DocumentHost, _session: &Session, args: Value) -> ToolResult {
    let args: FrameDurationArgs = parse(args)?;
    let frame = asset_id(&args.asset_id)?;
    let animation = change(host, frame, |store| {
        store.frame_set_duration(frame, args.ms)
    })?;
    Ok(json!(animation))
}

// ---------------------------------------------------------------------------
// set_animation_duration
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AnimationDurationArgs {
    asset_id: Option<String>,
    ms: u32,
}

fn animation_duration_schema() -> Value {
    json!({
        "type": "object",
        "properties": { "assetId": asset_property(), "ms": ms_property() },
        "required": ["ms"],
        "additionalProperties": false
    })
}

fn set_animation_duration(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: AnimationDurationArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let animation = change(host, asset, |store| {
        store.animation_set_duration(asset, args.ms)
    })?;
    Ok(json!(animation))
}

// ---------------------------------------------------------------------------
// set_playback
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlaybackArgs {
    asset_id: Option<String>,
    mode: String,
}

fn playback_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": asset_property(),
            "mode": { "type": "string", "enum": PLAYBACKS }
        },
        "required": ["mode"],
        "additionalProperties": false
    })
}

fn set_playback(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: PlaybackArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let animation = change(host, asset, |store| {
        store.animation_set_playback(asset, &args.mode)
    })?;
    Ok(json!(animation))
}

// ---------------------------------------------------------------------------
// catalogue
// ---------------------------------------------------------------------------

pub fn tools() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "read_animation",
            description: "The frames of the animation this asset belongs to, in order, \
                with each frame's asset id, duration, name and step, and the playback \
                mode. A lone sprite is an animation of one frame.",
            input_schema: read_schema,
            handler: read_animation,
        },
        ToolSpec {
            name: "add_frame",
            description: "Add a frame right after this one and open it. copy (default \
                true) starts it as a copy of this frame's layers, palette and step — \
                change only what moves. Returns { animation, frame }.",
            input_schema: add_schema,
            handler: add_frame,
        },
        ToolSpec {
            name: "delete_frame",
            description: "Delete one frame. The last frame is refused. Deleting the \
                first frame makes the next one the first.",
            input_schema: frame_schema,
            handler: delete_frame,
        },
        ToolSpec {
            name: "move_frame",
            description: "Move a frame to position to (from 0; past the end means last).",
            input_schema: move_schema,
            handler: move_frame,
        },
        ToolSpec {
            name: "set_frame_duration",
            description: "How long one frame is shown, 10 to 10000 ms.",
            input_schema: frame_duration_schema,
            handler: set_frame_duration,
        },
        ToolSpec {
            name: "set_animation_duration",
            description: "Give every frame the same duration, 10 to 10000 ms: 125 is 8 FPS.",
            input_schema: animation_duration_schema,
            handler: set_animation_duration,
        },
        ToolSpec {
            name: "set_playback",
            description: "How the animation loops: forward, reverse or pingpong.",
            input_schema: playback_schema,
            handler: set_playback,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::host::{Notice, RecordingHost};
    use crate::mcp::tools::call;
    use crate::raster::{Palette, PaletteSlot};

    struct Fixture {
        host: RecordingHost,
        session: Session,
        hero: AssetId,
    }

    /// A 4×4 prop with one painted pixel, open in the session.
    fn fixture() -> Fixture {
        let mut store = Store::memory().unwrap();
        let project = store.project_create("demo", "hd2d").unwrap();
        let hero = store
            .asset_create(project.id, "hero", "prop", 4, 4)
            .unwrap()
            .id;
        store
            .palette_write(
                hero,
                Palette {
                    slots: vec![PaletteSlot {
                        index: 1,
                        rgba: [200, 40, 40, 255],
                        name: Some("red".into()),
                        ramp: None,
                        step: None,
                    }],
                    ramps: vec![],
                },
            )
            .unwrap();
        let document = store.asset_open(hero).unwrap();
        let mut layer = document.layers[0].clone();
        layer.buffer.data[0] = 1;
        store.layer_write(hero, layer).unwrap();
        let session = Session::new("anim");
        session.set_current_asset(hero);
        Fixture {
            host: RecordingHost::new(store),
            session,
            hero,
        }
    }

    fn id(value: &Value) -> AssetId {
        asset_id(value.as_str().expect("an asset id string")).unwrap()
    }

    fn run(fx: &Fixture, tool: &str, args: Value) -> ToolResult {
        call(&fx.host, &fx.session, tool, args)
    }

    fn frames(animation: &Value) -> Vec<AssetId> {
        animation["frames"]
            .as_array()
            .unwrap()
            .iter()
            .map(|frame| id(&frame["assetId"]))
            .collect()
    }

    fn animations(fx: &Fixture) -> Vec<Animation> {
        fx.host
            .notices()
            .into_iter()
            .filter_map(|notice| match notice {
                Notice::Animation(animation) => Some(animation),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn read_animation_defaults_to_the_session_asset_and_announces_nothing() {
        let fx = fixture();
        let animation = run(&fx, "read_animation", json!({})).unwrap();
        assert_eq!(frames(&animation), vec![fx.hero]);
        assert_eq!(animation["playback"], "forward");
        assert_eq!(animation["frames"][0]["durationMs"], 125);
        assert!(fx.host.notices().is_empty());
    }

    #[test]
    fn read_animation_without_an_open_asset_is_asset_not_open() {
        let fx = fixture();
        let fresh = Session::new("fresh");
        let error = call(&fx.host, &fresh, "read_animation", json!({})).unwrap_err();
        assert_eq!(error.code, "asset.not_open");
    }

    #[test]
    fn read_animation_of_an_unknown_asset_is_asset_not_found() {
        let fx = fixture();
        let unknown = uuid::Uuid::now_v7().to_string();
        let error = run(&fx, "read_animation", json!({ "assetId": unknown })).unwrap_err();
        assert_eq!(error.code, "asset.not_found");
        let error = run(&fx, "read_animation", json!({ "assetId": "hero" })).unwrap_err();
        assert_eq!(error.code, "asset.not_found");
    }

    #[test]
    fn add_frame_copies_by_default_and_opens_the_new_frame() {
        let fx = fixture();
        let result = run(&fx, "add_frame", json!({})).unwrap();
        let frame = id(&result["frame"]);
        assert_eq!(frames(&result["animation"]), vec![fx.hero, frame]);
        assert_eq!(result["animation"]["frames"][1]["name"], "hero #2");
        assert_eq!(fx.session.current_asset(), Some(frame));

        let store = fx.host.store();
        let store = store.lock().unwrap();
        let copy = store.asset_open(frame).unwrap();
        assert_eq!(copy.layers[0].buffer.data[0], 1, "copy is the default");
        let log = store.op_log(frame).unwrap();
        assert!(log.iter().all(|op| op.actor == fx.session.actor()));

        let notices = fx.host.notices();
        assert!(notices.contains(&Notice::Opened(frame)));
        let announced = animations(&fx);
        assert_eq!(announced.len(), 1);
        assert_eq!(announced[0].frames.len(), 2);
    }

    #[test]
    fn add_frame_blank_inserts_after_the_named_frame() {
        let fx = fixture();
        let second = id(&run(&fx, "add_frame", json!({})).unwrap()["frame"]);
        let hero = fx.hero.0.to_string();
        let result = run(&fx, "add_frame", json!({ "assetId": hero, "copy": false })).unwrap();
        let blank = id(&result["frame"]);
        assert_eq!(frames(&result["animation"]), vec![fx.hero, blank, second]);
        assert_eq!(fx.session.current_asset(), Some(blank));
        let store = fx.host.store();
        let store = store.lock().unwrap();
        let document = store.asset_open(blank).unwrap();
        assert!(document.layers.iter().all(|layer| layer
            .buffer
            .data
            .iter()
            .all(|&index| index == 0)));
    }

    #[test]
    fn add_frame_refuses_unknown_arguments() {
        let fx = fixture();
        let error = run(&fx, "add_frame", json!({ "duplicate": true })).unwrap_err();
        assert_eq!(error.code, "args.invalid");
        assert!(animations(&fx).is_empty());
    }

    #[test]
    fn delete_frame_refuses_the_last_frame_and_announces_nothing() {
        let fx = fixture();
        let hero = fx.hero.0.to_string();
        let error = run(&fx, "delete_frame", json!({ "assetId": hero })).unwrap_err();
        assert_eq!(error.code, "animation.last_frame");
        assert!(animations(&fx).is_empty());
    }

    #[test]
    fn delete_frame_requires_an_asset_id() {
        let fx = fixture();
        let error = run(&fx, "delete_frame", json!({})).unwrap_err();
        assert_eq!(error.code, "args.invalid");
    }

    #[test]
    fn deleting_the_open_frame_moves_the_session_to_the_one_in_its_place() {
        let fx = fixture();
        let second = id(&run(&fx, "add_frame", json!({})).unwrap()["frame"]);
        let third = id(&run(&fx, "add_frame", json!({})).unwrap()["frame"]);
        fx.session.set_current_asset(second);
        let result = run(
            &fx,
            "delete_frame",
            json!({ "assetId": second.0.to_string() }),
        )
        .unwrap();
        assert_eq!(frames(&result), vec![fx.hero, third]);
        assert_eq!(fx.session.current_asset(), Some(third));
        assert_eq!(fx.host.notices().last(), Some(&Notice::Opened(third)));

        // The last frame falls back to the one before it.
        let result = run(
            &fx,
            "delete_frame",
            json!({ "assetId": third.0.to_string() }),
        )
        .unwrap();
        assert_eq!(frames(&result), vec![fx.hero]);
        assert_eq!(fx.session.current_asset(), Some(fx.hero));
    }

    #[test]
    fn deleting_another_frame_leaves_the_session_where_it_was() {
        let fx = fixture();
        let second = id(&run(&fx, "add_frame", json!({})).unwrap()["frame"]);
        fx.session.set_current_asset(fx.hero);
        let before = fx.host.notices().len();
        run(
            &fx,
            "delete_frame",
            json!({ "assetId": second.0.to_string() }),
        )
        .unwrap();
        assert_eq!(fx.session.current_asset(), Some(fx.hero));
        let after = fx.host.notices();
        assert_eq!(after.len(), before + 1);
        assert!(matches!(after.last(), Some(Notice::Animation(a)) if a.frames.len() == 1));
    }

    #[test]
    fn move_frame_reorders_and_announces() {
        let fx = fixture();
        let second = id(&run(&fx, "add_frame", json!({})).unwrap()["frame"]);
        let result = run(
            &fx,
            "move_frame",
            json!({ "assetId": second.0.to_string(), "to": 0 }),
        )
        .unwrap();
        assert_eq!(frames(&result), vec![second, fx.hero]);
        assert_eq!(result["rootId"], json!(second.0));
        assert_eq!(animations(&fx).last().unwrap().root_id, second);
    }

    #[test]
    fn move_frame_needs_a_position() {
        let fx = fixture();
        let hero = fx.hero.0.to_string();
        let error = run(&fx, "move_frame", json!({ "assetId": hero })).unwrap_err();
        assert_eq!(error.code, "args.invalid");
        let error = run(&fx, "move_frame", json!({ "assetId": hero, "to": -1 })).unwrap_err();
        assert_eq!(error.code, "args.invalid");
    }

    #[test]
    fn set_frame_duration_changes_one_frame() {
        let fx = fixture();
        let second = id(&run(&fx, "add_frame", json!({})).unwrap()["frame"]);
        let result = run(
            &fx,
            "set_frame_duration",
            json!({ "assetId": second.0.to_string(), "ms": 250 }),
        )
        .unwrap();
        assert_eq!(result["frames"][0]["durationMs"], 125);
        assert_eq!(result["frames"][1]["durationMs"], 250);
        assert_eq!(animations(&fx).last().unwrap().frames[1].duration_ms, 250);
    }

    #[test]
    fn set_frame_duration_outside_the_range_is_refused_with_a_hint() {
        let fx = fixture();
        let hero = fx.hero.0.to_string();
        let error = run(
            &fx,
            "set_frame_duration",
            json!({ "assetId": hero, "ms": 5 }),
        )
        .unwrap_err();
        assert_eq!(error.code, "animation.invalid_duration");
        assert!(error.hint.contains("10000"), "{}", error.hint);
        assert!(animations(&fx).is_empty());
    }

    #[test]
    fn set_animation_duration_defaults_to_the_session_and_times_every_frame() {
        let fx = fixture();
        run(&fx, "add_frame", json!({})).unwrap();
        let result = run(&fx, "set_animation_duration", json!({ "ms": 83 })).unwrap();
        for frame in result["frames"].as_array().unwrap() {
            assert_eq!(frame["durationMs"], 83);
        }
        let error = run(&fx, "set_animation_duration", json!({ "ms": 20000 })).unwrap_err();
        assert_eq!(error.code, "animation.invalid_duration");
        let error = run(&fx, "set_animation_duration", json!({})).unwrap_err();
        assert_eq!(error.code, "args.invalid");
    }

    #[test]
    fn set_playback_defaults_to_the_session_and_refuses_an_unknown_mode() {
        let fx = fixture();
        // A lone sprite keeps its mode for when it gains frames.
        let lone = run(&fx, "set_playback", json!({ "mode": "pingpong" })).unwrap();
        assert_eq!(lone["playback"], "pingpong");
        run(&fx, "add_frame", json!({})).unwrap();
        let result = run(&fx, "set_playback", json!({ "mode": "pingpong" })).unwrap();
        assert_eq!(result["playback"], "pingpong");
        assert_eq!(animations(&fx).last().unwrap().playback, "pingpong");
        let error = run(&fx, "set_playback", json!({ "mode": "bounce" })).unwrap_err();
        assert_eq!(error.code, "animation.invalid_playback");
        assert!(error.hint.contains("pingpong"));
    }

    #[test]
    fn deleting_the_root_announces_every_frame_it_renamed() {
        let fx = fixture();
        run(&fx, "add_frame", json!({ "assetId": fx.hero })).unwrap();
        let three = run(&fx, "add_frame", json!({})).unwrap();
        let survivors: Vec<_> = frames(&three["animation"]).into_iter().skip(1).collect();
        let before = fx.host.notices().len();
        run(&fx, "delete_frame", json!({ "assetId": fx.hero })).unwrap();
        let changed: Vec<_> = fx.host.notices()[before..]
            .iter()
            .filter_map(|notice| match notice {
                Notice::Changed(id) => Some(*id),
                _ => None,
            })
            .collect();
        // Both survivors move up a place, so both take a new name.
        for frame in survivors {
            assert!(
                changed.contains(&frame),
                "{frame:?} was renamed but not announced"
            );
        }
    }

    #[test]
    fn every_tool_is_registered_with_an_object_schema() {
        let names: Vec<_> = crate::mcp::tools::catalogue()
            .into_iter()
            .map(|spec| spec.name)
            .collect();
        for spec in tools() {
            assert!(
                names.contains(&spec.name),
                "{} is not registered",
                spec.name
            );
            assert_eq!((spec.input_schema)()["type"], "object");
        }
    }
}
