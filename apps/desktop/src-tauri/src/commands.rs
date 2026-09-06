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

//! Commands the frontend calls.
//!
//! Every command returns a `Result` whose error carries a stable reason code.
//! The frontend translates that code, so no English string from this file
//! reaches the user.

use std::process::Command as ProcessCommand;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Runtime, State, Window};

use crate::engine::{self, EngineError, Method};
use crate::sidecar::{SidecarManager, SidecarStatus};

/// An error returned to the frontend.
///
/// Serialized as `{ "code": "...", "detail": "..." }`. Only `code` is shown to
/// the user, after translation; `detail` is for logs and bug reports.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    code: String,
    detail: String,
}

impl CommandError {
    /// Builds an error from a stable reason code and an English detail.
    pub fn new(code: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            detail: detail.into(),
        }
    }
}

impl From<EngineError> for CommandError {
    fn from(error: EngineError) -> Self {
        Self::new(error.code, error.detail)
    }
}

/// Which window effect was applied, if any.
///
/// The frontend must not guess. It reads this and sets `data-vibrancy` on the
/// root element, which selects either the opaque or the translucent token set.
/// Guessing would leave text on a transparent surface when the effect silently
/// failed to apply.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VibrancyState {
    /// True when a background effect is active on the main window.
    pub applied: bool,
    /// Effect name: `mica`, `acrylic`, `vibrancy`, or empty when none.
    pub effect: String,
    /// Stable reason code when no effect was applied. Empty otherwise.
    pub reason: String,
}

/// Holds the vibrancy result decided during setup.
#[derive(Default)]
pub struct VibrancyManager(pub Mutex<VibrancyState>);

impl VibrancyManager {
    /// Records the outcome of applying a window effect.
    pub fn set(&self, state: VibrancyState) {
        let mut slot = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *slot = state;
    }

    /// Returns the recorded outcome.
    pub fn get(&self) -> VibrancyState {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}

/// What the frontend needs in order to lay out the title bar.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    /// Target operating system: `macos`, `windows`, or `linux`.
    pub os: String,
    /// True when the system draws the window buttons itself, as macOS does
    /// with its traffic lights. The frontend draws its own when this is false.
    pub system_window_controls: bool,
}

/// The result of probing for a usable GPU.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuReport {
    /// Driver family found: `cuda`, `metal`, or `none`.
    pub kind: String,
    /// True when a GPU that the engine can use was found.
    pub available: bool,
    /// Stable reason code. `gpu.ok` when available.
    pub code: String,
    /// Device name or diagnostic detail, for logs.
    pub detail: String,
}

/// Returns the sidecar's current status.
///
/// The frontend calls this on mount, because the ready event may have fired
/// before the webview finished loading.
#[tauri::command]
pub fn sidecar_status(manager: State<'_, SidecarManager>) -> SidecarStatus {
    manager.status()
}

/// Lists every backend, its availability, and its capabilities.
///
/// # Errors
///
/// Returns the engine's reason code when the call fails.
#[tauri::command]
pub async fn engine_backends<R: Runtime>(app: AppHandle<R>) -> Result<Value, CommandError> {
    Ok(engine::call(&app, Method::Get, "/v1/backends", None).await?)
}

/// Switches the active backend.
///
/// The kind is put into the path, so it is checked against the known values
/// here rather than trusted. The engine validates it again; this stops a
/// crafted value from reaching a path it was never meant to.
///
/// # Errors
///
/// Returns `backend.unknown_kind` for an unrecognised kind, and the engine's
/// reason code when the call fails.
#[tauri::command]
pub async fn engine_select_backend<R: Runtime>(
    app: AppHandle<R>,
    kind: String,
) -> Result<Value, CommandError> {
    if !matches!(kind.as_str(), "cuda" | "mps" | "remote") {
        return Err(CommandError::new(
            "backend.unknown_kind",
            format!("unknown backend kind: {kind}"),
        ));
    }

    let path = format!("/v1/backends/{kind}/select");
    Ok(engine::call(&app, Method::Post, &path, None).await?)
}

/// Generates sprites.
///
/// # Errors
///
/// Returns the engine's reason code when generation fails.
#[tauri::command]
pub async fn engine_generate<R: Runtime>(
    app: AppHandle<R>,
    request: Value,
) -> Result<Value, CommandError> {
    Ok(engine::call(&app, Method::Post, "/v1/generate", Some(request)).await?)
}

/// Lists registered models with their licences and cache state.
///
/// # Errors
///
/// Returns the engine's reason code when the call fails.
#[tauri::command]
pub async fn engine_models<R: Runtime>(app: AppHandle<R>) -> Result<Value, CommandError> {
    Ok(engine::call(&app, Method::Get, "/v1/models", None).await?)
}

/// Returns which window background effect was applied during setup.
#[tauri::command]
pub fn vibrancy_state(manager: State<'_, VibrancyManager>) -> VibrancyState {
    manager.get()
}

/// Returns the platform facts the title bar layout depends on.
#[tauri::command]
pub fn platform_info() -> PlatformInfo {
    PlatformInfo {
        os: current_os().to_string(),
        // macOS keeps drawing its traffic lights over the client area, so the
        // frontend must leave room for them instead of drawing its own.
        system_window_controls: cfg!(target_os = "macos"),
    }
}

/// Probes for a GPU the engine can use.
///
/// Called during startup so that a missing driver is reported as a specific
/// message, rather than as a backend that is mysteriously unselectable.
#[tauri::command]
pub fn check_gpu() -> GpuReport {
    probe_gpu()
}

/// Minimizes the main window.
///
/// # Errors
///
/// Returns `window.command_failed` when the platform rejects the request.
#[tauri::command]
pub fn window_minimize<R: Runtime>(window: Window<R>) -> Result<(), CommandError> {
    window.minimize().map_err(window_error)
}

/// Maximizes the main window, or restores it when it is already maximized.
///
/// Tauri exposes no single toggle, so the state is read first. Double clicking
/// the title bar goes through here, which is why the new state is returned:
/// the frontend swaps the button's icon and label from it.
///
/// # Errors
///
/// Returns `window.command_failed` when the platform rejects the request.
#[tauri::command]
pub fn window_toggle_maximize<R: Runtime>(window: Window<R>) -> Result<bool, CommandError> {
    let maximized = window.is_maximized().map_err(window_error)?;

    if maximized {
        window.unmaximize().map_err(window_error)?;
    } else {
        window.maximize().map_err(window_error)?;
    }

    Ok(!maximized)
}

/// Reports whether the main window is maximized.
///
/// # Errors
///
/// Returns `window.command_failed` when the platform rejects the request.
#[tauri::command]
pub fn window_is_maximized<R: Runtime>(window: Window<R>) -> Result<bool, CommandError> {
    window.is_maximized().map_err(window_error)
}

/// Closes the main window, which shuts the application down.
///
/// # Errors
///
/// Returns `window.command_failed` when the platform rejects the request.
#[tauri::command]
pub fn window_close<R: Runtime>(window: Window<R>) -> Result<(), CommandError> {
    window.close().map_err(window_error)
}

/// Converts a window failure into a translatable command error.
fn window_error(error: tauri::Error) -> CommandError {
    CommandError::new("window.command_failed", error.to_string())
}

/// Registers every command with the builder.
pub fn handler<R: Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        sidecar_status,
        engine_backends,
        engine_select_backend,
        engine_generate,
        engine_models,
        vibrancy_state,
        platform_info,
        check_gpu,
        window_minimize,
        window_toggle_maximize,
        window_is_maximized,
        window_close,
    ]
}

/// Stops the sidecar. Called from the exit handler in `main`.
pub fn shutdown_sidecar<R: Runtime>(app: &AppHandle<R>) {
    crate::sidecar::shutdown(app);
}

/// Returns the target operating system as the frontend names it.
pub fn current_os() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

/// Probes for a GPU without loading any machine learning framework.
///
/// Metal is part of every macOS version the application supports, so it is
/// reported directly. Elsewhere the NVIDIA management tool is the cheapest
/// reliable signal that a working driver is installed; absence of it means
/// generation will have to run remotely.
fn probe_gpu() -> GpuReport {
    if cfg!(target_os = "macos") {
        return GpuReport {
            kind: "metal".into(),
            available: true,
            code: "gpu.ok".into(),
            detail: "Metal".into(),
        };
    }

    match ProcessCommand::new("nvidia-smi")
        .args(["--query-gpu=name", "--format=csv,noheader"])
        .output()
    {
        Ok(output) if output.status.success() => {
            let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if name.is_empty() {
                GpuReport {
                    kind: "none".into(),
                    available: false,
                    code: "gpu.no_device".into(),
                    detail: "nvidia-smi reported no devices".into(),
                }
            } else {
                GpuReport {
                    kind: "cuda".into(),
                    available: true,
                    code: "gpu.ok".into(),
                    detail: name,
                }
            }
        }
        Ok(output) => GpuReport {
            kind: "none".into(),
            available: false,
            code: "gpu.driver_error".into(),
            detail: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        },
        Err(error) => GpuReport {
            kind: "none".into(),
            available: false,
            code: "gpu.driver_missing".into(),
            detail: error.to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_info_matches_the_build_target() {
        let info = platform_info();
        assert_eq!(info.os, current_os());
        assert_eq!(info.system_window_controls, cfg!(target_os = "macos"));
    }

    #[test]
    fn gpu_probe_always_reports_a_code() {
        let report = probe_gpu();
        assert!(!report.code.is_empty());
        assert_eq!(report.available, report.code == "gpu.ok");
    }

    #[test]
    fn vibrancy_manager_round_trips() {
        let manager = VibrancyManager::default();
        assert!(!manager.get().applied);

        manager.set(VibrancyState {
            applied: true,
            effect: "mica".into(),
            reason: String::new(),
        });
        assert_eq!(manager.get().effect, "mica");
    }
}
