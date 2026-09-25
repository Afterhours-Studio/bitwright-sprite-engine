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

//! Tauri commands exposing animation frames (`Store::animation_*`,
//! `Store::frame_*`) to the window. Every change is announced on
//! `document://animation`, so a timeline stays live whoever made it.

use crate::commands::document::{run, DocumentState, EVENT_ANIMATION};
use crate::store::{Animation, AssetId, Result};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, State};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationEvent {
    pub root_id: AssetId,
    pub animation: Animation,
}

/// Announces an animation after its change committed. The MCP host calls
/// this too, so an agent adding frames moves the same timeline.
pub fn emit_animation<R: Runtime>(app: &AppHandle<R>, animation: &Animation) {
    let event = AnimationEvent {
        root_id: animation.root_id,
        animation: animation.clone(),
    };
    if let Err(error) = app.emit(EVENT_ANIMATION, event) {
        log::warn!("{EVENT_ANIMATION} failed after the animation committed: {error}");
    }
}

async fn change<R: Runtime>(
    app: &AppHandle<R>,
    state: &DocumentState,
    work: impl FnOnce(&mut crate::store::Store) -> Result<Animation> + Send + 'static,
) -> Result<Animation> {
    let animation = run(state, work).await?;
    emit_animation(app, &animation);
    Ok(animation)
}

#[tauri::command]
pub async fn animation_read(
    state: State<'_, DocumentState>,
    asset_id: AssetId,
) -> Result<Animation> {
    run(&state, move |s| s.animation_read(asset_id)).await
}

#[tauri::command]
pub async fn frame_add<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    copy: bool,
) -> Result<Animation> {
    change(&app, &state, move |s| {
        s.frame_add_as(asset_id, copy, "user")
    })
    .await
}

#[tauri::command]
pub async fn frame_delete<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    asset_id: AssetId,
) -> Result<Animation> {
    change(&app, &state, move |s| s.frame_delete(asset_id)).await
}

#[tauri::command]
pub async fn frame_move<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    to: u32,
) -> Result<Animation> {
    change(&app, &state, move |s| s.frame_move(asset_id, to)).await
}

#[tauri::command]
pub async fn frame_set_duration<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    ms: u32,
) -> Result<Animation> {
    change(&app, &state, move |s| s.frame_set_duration(asset_id, ms)).await
}

#[tauri::command]
pub async fn animation_set_duration<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    ms: u32,
) -> Result<Animation> {
    change(&app, &state, move |s| {
        s.animation_set_duration(asset_id, ms)
    })
    .await
}

#[tauri::command]
pub async fn animation_set_playback<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    mode: String,
) -> Result<Animation> {
    change(&app, &state, move |s| {
        s.animation_set_playback(asset_id, &mode)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    #[test]
    fn the_event_carries_the_root_and_the_whole_animation_in_camel_case() {
        let mut store = Store::memory().unwrap();
        let project = store.project_create("p", "hd2d").unwrap().id;
        let hero = store
            .asset_create(project, "hero", "prop", 4, 4)
            .unwrap()
            .id;
        let animation = store.frame_add(hero, false).unwrap();
        let wire = serde_json::to_value(AnimationEvent {
            root_id: animation.root_id,
            animation,
        })
        .unwrap();
        assert_eq!(wire["rootId"], serde_json::json!(hero.0));
        assert_eq!(wire["animation"]["rootId"], serde_json::json!(hero.0));
        assert_eq!(wire["animation"]["playback"], "forward");
        let frame = &wire["animation"]["frames"][1];
        assert_eq!(frame["durationMs"], 125);
        assert_eq!(frame["position"], 1);
        assert_eq!(frame["name"], "hero #2");
        assert!(frame.get("assetId").is_some() && frame.get("updatedAt").is_some());
    }
}
