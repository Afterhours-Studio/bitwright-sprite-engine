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

//! What a tool may touch, and nothing else.
//!
//! A tool is written once and run under two very different hosts: the Tauri
//! process, where a commit has to repaint a window someone is watching, and a
//! headless stdio process, where there is no window at all. The trait is the
//! seam. Everything a tool returns is produced from the store, so the only
//! thing a host is allowed to add is notification.

use super::error::ToolError;
use crate::commands::document::{
    self, DocumentState, PaletteEvent, StepEvent, EVENT_PALETTE, EVENT_STEP,
};
use crate::store::{AssetId, GateReport, OpResult, Result, Store};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Runtime};

/// The event the renderer listens for to bring an asset forward.
pub const EVENT_OPENED: &str = "document://opened";

/// The store, plus the ways a document can announce that it moved.
pub trait DocumentHost: Send + Sync {
    fn store(&self) -> Arc<Mutex<Store>>;
    /// After a pixel commit.
    fn changed(&self, asset: AssetId, result: &OpResult);
    fn palette_changed(&self, asset: AssetId);
    fn step_changed(&self, asset: AssetId, gate: &GateReport);
    /// Bring it up in the window.
    fn opened(&self, asset: AssetId);
    fn activity(&self, session: &str, tool: &str, asset: AssetId);
}

/// Takes the lock the store is held behind and runs one unit of work on it.
///
/// Every tool reaches the database through here so that a poisoned lock fails
/// as `store.lock_failed` rather than as a panic in the middle of a write an
/// agent has already been told about.
pub fn with_store<T>(
    host: &dyn DocumentHost,
    work: impl FnOnce(&mut Store) -> Result<T>,
) -> std::result::Result<T, ToolError> {
    let arc = host.store();
    let mut store = arc.lock().map_err(|_| {
        ToolError::new(
            "store.lock_failed",
            "document store lock was poisoned",
            "Try the call again; the lock will have been released.",
        )
    })?;
    work(&mut store).map_err(ToolError::from)
}

/// The host that runs inside the application window.
pub struct TauriHost<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> TauriHost<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }

    fn state(&self) -> tauri::State<'_, DocumentState> {
        use tauri::Manager;
        self.app.state::<DocumentState>()
    }
}

impl<R: Runtime> DocumentHost for TauriHost<R> {
    fn store(&self) -> Arc<Mutex<Store>> {
        self.state().store()
    }

    fn changed(&self, asset: AssetId, result: &OpResult) {
        document::notify_changed(&self.app, &self.state(), asset, result);
    }

    fn palette_changed(&self, asset: AssetId) {
        let _ = self
            .app
            .emit(EVENT_PALETTE, PaletteEvent { asset_id: asset });
    }

    fn step_changed(&self, asset: AssetId, gate: &GateReport) {
        let _ = self.app.emit(
            EVENT_STEP,
            StepEvent {
                asset_id: asset,
                step: gate.step.clone(),
                gate: gate.clone(),
            },
        );
    }

    fn opened(&self, asset: AssetId) {
        let _ = self
            .app
            .emit(EVENT_OPENED, serde_json::json!({ "assetId": asset }));
    }

    fn activity(&self, session: &str, tool: &str, asset: AssetId) {
        document::agent_activity(&self.app, session.to_owned(), tool.to_owned(), asset);
    }
}

/// The host for stdio and for tests: it drives the document and tells nobody.
pub struct HeadlessHost {
    store: Arc<Mutex<Store>>,
}

impl HeadlessHost {
    pub fn new(store: Store) -> Self {
        Self {
            store: Arc::new(Mutex::new(store)),
        }
    }
}

impl DocumentHost for HeadlessHost {
    fn store(&self) -> Arc<Mutex<Store>> {
        Arc::clone(&self.store)
    }

    fn changed(&self, _asset: AssetId, _result: &OpResult) {}
    fn palette_changed(&self, _asset: AssetId) {}
    fn step_changed(&self, _asset: AssetId, _gate: &GateReport) {}
    fn opened(&self, _asset: AssetId) {}
    fn activity(&self, _session: &str, _tool: &str, _asset: AssetId) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn with_store_returns_closures_value() {
        let host = HeadlessHost::new(Store::memory().unwrap());
        let value = with_store(&host, |store| {
            let _ = store;
            Ok(42_i32)
        })
        .unwrap();
        assert_eq!(value, 42);
    }

    #[test]
    fn app_error_from_closure_becomes_tool_error() {
        let host = HeadlessHost::new(Store::memory().unwrap());
        let err = with_store(&host, |_| -> Result<()> {
            Err::<_, crate::store::AppError>(crate::store::AppError::new(
                "document.not_found",
                "no such asset",
            ))
        })
        .unwrap_err();
        assert_eq!(err.code, "asset.not_found");
    }

    #[test]
    fn poisoned_lock_returns_lock_failed() {
        let host = HeadlessHost::new(Store::memory().unwrap());
        let arc = host.store();
        let handle = std::thread::spawn(move || {
            let _guard = arc.lock().unwrap();
            panic!("intentional");
        });
        let _ = handle.join();
        let err = with_store(&host, |_| Ok(())).unwrap_err();
        assert_eq!(err.code, "store.lock_failed");
    }
}
