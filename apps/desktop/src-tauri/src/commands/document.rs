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

//! Both the window and the MCP transport use this service, so committing an
//! edit and notifying listeners cannot drift into two different behaviours.

use crate::raster::Op;
use crate::raster::{self, IndexedBuffer, LayerRole, Palette, RgbaImage};
use crate::store::{
    AppError, Asset, AssetId, Document, GateReport, OpResult, Project, Result, StepState, Store,
    Style,
};
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use uuid::Uuid;

pub const EVENT_CHANGED: &str = "document://changed";
pub const EVENT_PALETTE: &str = "document://palette";
pub const EVENT_STEP: &str = "document://step";
pub const EVENT_AGENT_ACTIVITY: &str = "agent://activity";
pub const EVENT_AGENT_SESSION: &str = "agent://session";
const FRAME: Duration = Duration::from_millis(16);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedEvent {
    pub asset_id: AssetId,
    pub roles: Vec<LayerRole>,
    pub seq: i64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaletteEvent {
    pub asset_id: AssetId,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepEvent {
    pub asset_id: AssetId,
    pub step: String,
    pub gate: GateReport,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActivityEvent {
    pub session_id: String,
    pub tool: String,
    pub asset_id: AssetId,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionEvent {
    pub session_id: String,
    pub state: String,
}

#[derive(Default)]
struct Pending {
    scheduled: bool,
    changes: BTreeMap<Uuid, ChangedEvent>,
    last_seq: BTreeMap<Uuid, i64>,
}
impl Pending {
    fn push(&mut self, id: AssetId, result: &OpResult) -> bool {
        let latest = self.last_seq.entry(id.0).or_default();
        *latest = (*latest).max(result.seq);
        let event = self.changes.entry(id.0).or_insert(ChangedEvent {
            asset_id: id,
            roles: vec![],
            seq: *latest,
        });
        event.roles.extend(&result.roles);
        event.roles.sort();
        event.roles.dedup();
        event.seq = *latest;
        let schedule = !self.scheduled;
        self.scheduled = true;
        schedule
    }
}

pub struct DocumentState {
    store: Arc<Mutex<Store>>,
    pending: Arc<Mutex<Pending>>,
}
impl DocumentState {
    pub fn new(store: Store) -> Self {
        Self {
            store: Arc::new(Mutex::new(store)),
            pending: Arc::new(Mutex::new(Pending::default())),
        }
    }
    pub fn store(&self) -> Arc<Mutex<Store>> {
        self.store.clone()
    }
}

async fn run<T: Send + 'static>(
    state: &DocumentState,
    work: impl FnOnce(&mut Store) -> Result<T> + Send + 'static,
) -> Result<T> {
    let store = state.store.clone();
    // SQLite can wait on a writer in another process. It belongs on a blocking
    // worker, never on the webview thread or the async event timer.
    tauri::async_runtime::spawn_blocking(move || {
        let mut store = store
            .lock()
            .map_err(|_| AppError::new("store.lock_failed", "document store lock was poisoned"))?;
        work(&mut store)
    })
    .await
    .map_err(|e| AppError::new("store.worker_failed", e.to_string()))?
}

pub fn notify_changed<R: Runtime>(
    app: &AppHandle<R>,
    state: &DocumentState,
    id: AssetId,
    result: &OpResult,
) {
    let mut pending = state.pending.lock().unwrap_or_else(|e| e.into_inner());
    if !pending.push(id, result) {
        return;
    }
    let queue = state.pending.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FRAME).await;
        let mut pending = queue.lock().unwrap_or_else(|e| e.into_inner());
        // Holding this short lock through emission keeps consecutive frames in
        // sequence even when commits arrive while a frame is being flushed.
        for (_, event) in std::mem::take(&mut pending.changes) {
            if let Err(error) = app.emit(EVENT_CHANGED, event) {
                log::warn!("document change event failed: {error}");
            }
        }
        pending.scheduled = false;
    });
}
fn emit<R: Runtime, T: Serialize + Clone>(app: &AppHandle<R>, event: &str, payload: T) {
    if let Err(error) = app.emit(event, payload) {
        log::warn!("{event} failed after the document committed: {error}");
    }
}
fn step_event<R: Runtime>(app: &AppHandle<R>, id: AssetId, gate: GateReport) {
    emit(
        app,
        EVENT_STEP,
        StepEvent {
            asset_id: id,
            step: gate.step.clone(),
            gate,
        },
    );
}

/// The actor is supplied by the transport, not by an untrusted drawing payload.
pub async fn write_ops<R: Runtime>(
    app: &AppHandle<R>,
    asset_id: AssetId,
    ops: Vec<Op>,
    actor: String,
) -> Result<OpResult> {
    let state = app.state::<DocumentState>();
    let result = run(&state, move |store| store.write_ops(asset_id, ops, &actor)).await?;
    notify_changed(app, &state, asset_id, &result);
    Ok(result)
}

/// MCP calls this when work starts; document edits themselves use `write_ops`.
pub fn agent_activity<R: Runtime>(
    app: &AppHandle<R>,
    session_id: String,
    tool: String,
    asset_id: AssetId,
) {
    emit(
        app,
        EVENT_AGENT_ACTIVITY,
        AgentActivityEvent {
            session_id,
            tool,
            asset_id,
        },
    );
}
pub fn agent_session<R: Runtime>(app: &AppHandle<R>, session_id: String, state: String) {
    emit(
        app,
        EVENT_AGENT_SESSION,
        AgentSessionEvent { session_id, state },
    );
}

#[tauri::command]
pub async fn project_list(state: State<'_, DocumentState>) -> Result<Vec<Project>> {
    run(&state, |s| s.project_list()).await
}
#[tauri::command]
pub async fn project_create(
    state: State<'_, DocumentState>,
    name: String,
    preset: String,
) -> Result<Project> {
    run(&state, move |s| s.project_create(&name, &preset)).await
}
#[tauri::command]
pub async fn project_rename(
    state: State<'_, DocumentState>,
    id: Uuid,
    name: String,
) -> Result<Project> {
    run(&state, move |s| s.project_rename(id, &name)).await
}
#[tauri::command]
pub async fn project_delete(state: State<'_, DocumentState>, id: Uuid) -> Result<()> {
    run(&state, move |s| s.project_delete(id)).await
}
#[tauri::command]
pub async fn asset_list(state: State<'_, DocumentState>, project_id: Uuid) -> Result<Vec<Asset>> {
    run(&state, move |s| s.asset_list(project_id)).await
}
#[tauri::command]
pub async fn asset_create(
    state: State<'_, DocumentState>,
    project_id: Uuid,
    name: String,
    kind: String,
    w: u16,
    h: u16,
) -> Result<Asset> {
    run(&state, move |s| {
        s.asset_create(project_id, &name, &kind, w, h)
    })
    .await
}
#[tauri::command]
pub async fn asset_rename<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    id: AssetId,
    name: String,
) -> Result<Asset> {
    let (asset, seq) = run(&state, move |s| {
        let asset = s.asset_rename(id, &name)?;
        let seq = s.op_log(id)?.last().map_or(0, |op| op.seq);
        Ok((asset, seq))
    })
    .await?;
    notify_changed(
        &app,
        &state,
        id,
        &OpResult {
            changed: 0,
            bounds: None,
            roles: vec![],
            seq,
        },
    );
    Ok(asset)
}
#[tauri::command]
pub async fn asset_delete(state: State<'_, DocumentState>, id: AssetId) -> Result<()> {
    run(&state, move |s| s.asset_delete(id)).await
}
#[tauri::command]
pub async fn asset_open(state: State<'_, DocumentState>, id: AssetId) -> Result<Document> {
    run(&state, move |s| s.asset_open(id)).await
}
/// The style a document is judged against, which is where the canvas tier and
/// every gate band come from. Without it the interface cannot ask a project
/// what size of canvas its style wants before creating an asset.
#[tauri::command]
pub async fn style_read(state: State<'_, DocumentState>, id: Uuid) -> Result<Style> {
    run(&state, move |s| s.style_read(id)).await
}
#[tauri::command]
pub async fn document_composite(
    state: State<'_, DocumentState>,
    asset_id: AssetId,
) -> Result<RgbaImage> {
    run(&state, move |s| {
        let d = s.asset_open(asset_id)?;
        Ok(raster::composite(
            d.asset.width,
            d.asset.height,
            &d.layers,
            &d.palette,
        )?)
    })
    .await
}
#[tauri::command]
pub async fn document_read_layer(
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    role: LayerRole,
) -> Result<IndexedBuffer> {
    run(&state, move |s| Ok(s.layer_read(asset_id, role)?.buffer)).await
}
#[tauri::command]
pub async fn document_write_ops<R: Runtime>(
    app: AppHandle<R>,
    asset_id: AssetId,
    ops: Vec<Op>,
) -> Result<OpResult> {
    write_ops(&app, asset_id, ops, "user".into()).await
}

async fn travel<R: Runtime>(
    app: &AppHandle<R>,
    state: &DocumentState,
    id: AssetId,
    redo: bool,
) -> Result<OpResult> {
    let (result, palette_changed, gate) = run(state, move |s| {
        let before = s.asset_open(id)?;
        let result = if redo {
            s.redo(id, "user")?
        } else {
            s.undo(id, "user")?
        };
        let after = s.asset_open(id)?;
        let gate = if before.asset.step != after.asset.step {
            Some(s.step_check(id))
        } else {
            None
        };
        Ok((result, before.palette != after.palette, gate))
    })
    .await?;
    notify_changed(app, state, id, &result);
    if palette_changed {
        emit(app, EVENT_PALETTE, PaletteEvent { asset_id: id });
    }
    if let Some(gate) = gate {
        match gate {
            Ok(gate) => step_event(app, id, gate),
            Err(error) => log::warn!("gate reevaluation failed after undo committed: {error}"),
        }
    }
    Ok(result)
}
#[tauri::command]
pub async fn document_undo<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    asset_id: AssetId,
) -> Result<OpResult> {
    travel(&app, &state, asset_id, false).await
}
#[tauri::command]
pub async fn document_redo<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    asset_id: AssetId,
) -> Result<OpResult> {
    travel(&app, &state, asset_id, true).await
}
#[tauri::command]
pub async fn palette_read(state: State<'_, DocumentState>, asset_id: AssetId) -> Result<Palette> {
    run(&state, move |s| s.palette_read(asset_id)).await
}
#[tauri::command]
pub async fn palette_write<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    palette: Palette,
) -> Result<Palette> {
    let (palette, result) = run(&state, move |s| s.palette_write(asset_id, palette)).await?;
    notify_changed(&app, &state, asset_id, &result);
    emit(&app, EVENT_PALETTE, PaletteEvent { asset_id });
    Ok(palette)
}
#[tauri::command]
pub async fn step_state(state: State<'_, DocumentState>, asset_id: AssetId) -> Result<StepState> {
    run(&state, move |s| s.step_state(asset_id)).await
}
#[tauri::command]
pub async fn step_check<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    asset_id: AssetId,
) -> Result<GateReport> {
    let report = run(&state, move |s| s.step_check(asset_id)).await?;
    step_event(&app, asset_id, report.clone());
    Ok(report)
}
#[tauri::command]
pub async fn step_advance<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    force: bool,
) -> Result<StepState> {
    let (step, result) = run(&state, move |s| s.step_advance_as(asset_id, "user", force)).await?;
    notify_changed(&app, &state, asset_id, &result);
    step_event(&app, asset_id, step.gate.clone());
    Ok(step)
}
#[tauri::command]
pub async fn step_revisit<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    step: String,
) -> Result<StepState> {
    let (state_after, result) =
        run(&state, move |s| s.step_revisit(asset_id, &step, "user")).await?;
    notify_changed(&app, &state, asset_id, &result);
    step_event(&app, asset_id, state_after.gate.clone());
    Ok(state_after)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_burst_has_one_frame_and_unions_roles_per_asset() {
        let a = AssetId(Uuid::now_v7());
        let b = AssetId(Uuid::now_v7());
        let mut pending = Pending::default();
        let result = |seq, roles| OpResult {
            changed: 1,
            bounds: None,
            seq,
            roles,
        };
        assert!(pending.push(a, &result(1, vec![LayerRole("silhouette")])));
        assert!(!pending.push(
            a,
            &result(3, vec![LayerRole("flats"), LayerRole("silhouette")])
        ));
        assert!(!pending.push(b, &result(2, vec![LayerRole("outline")])));
        assert_eq!(pending.changes.len(), 2);
        let event = &pending.changes[&a.0];
        assert_eq!(event.seq, 3);
        assert_eq!(
            event.roles,
            vec![LayerRole("flats"), LayerRole("silhouette")]
        );
        let wire = serde_json::to_value(event).unwrap();
        assert_eq!(wire.as_object().unwrap().len(), 3);
        assert!(wire.get("assetId").is_some());
        assert!(wire.get("pixels").is_none());
        pending.changes.clear();
        pending.scheduled = false;
        assert!(pending.push(a, &result(2, vec![LayerRole("detail")])));
        assert_eq!(pending.changes[&a.0].seq, 3);
    }
}
