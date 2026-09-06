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

use std::path::Path;
use std::process::Command as ProcessCommand;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Runtime, State, Window};
use tauri_plugin_dialog::DialogExt;

use crate::engine::{self, EngineError, Method};
use crate::preferences;
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

/// Starts downloading a model's weights.
///
/// The engine answers immediately and fetches in the background; the frontend
/// follows the transfer by re-reading the model list.
///
/// # Errors
///
/// Returns `models.unknown` when the id is not a plain identifier, and the
/// engine's reason code when the call fails, including `models.unknown` for an
/// id the registry does not hold and `models.already_downloading` when a
/// transfer for that model is already running.
#[tauri::command]
pub async fn engine_download_model<R: Runtime>(
    app: AppHandle<R>,
    model_id: String,
) -> Result<Value, CommandError> {
    let path = model_action_path(&model_id, "download")?;
    Ok(engine::call(&app, Method::Post, &path, None).await?)
}

/// Stops a download and deletes the bytes it had transferred.
///
/// Destructive, and deliberately distinct from pausing: what has arrived is
/// removed, so downloading again starts from the beginning.
///
/// # Errors
///
/// Returns `models.unknown` when the id is not a plain identifier, and the
/// engine's reason code when the call fails.
#[tauri::command]
pub async fn engine_cancel_download<R: Runtime>(
    app: AppHandle<R>,
    model_id: String,
) -> Result<Value, CommandError> {
    let path = model_action_path(&model_id, "cancel")?;
    Ok(engine::call(&app, Method::Post, &path, None).await?)
}

/// Stops a download and keeps the bytes it had transferred.
///
/// Destroys nothing. `engine_download_model` continues from where this
/// stopped, including after the application has been closed and reopened.
///
/// # Errors
///
/// Returns `models.unknown` when the id is not a plain identifier, and the
/// engine's reason code when the call fails.
#[tauri::command]
pub async fn engine_pause_download<R: Runtime>(
    app: AppHandle<R>,
    model_id: String,
) -> Result<Value, CommandError> {
    let path = model_action_path(&model_id, "pause")?;
    Ok(engine::call(&app, Method::Post, &path, None).await?)
}

/// Lists configured providers, the built-in catalogue, and where keys are kept.
///
/// No response from any provider command carries an API key. The engine accepts
/// one and never returns it, so there is nothing here to redact.
///
/// # Errors
///
/// Returns the engine's reason code when the call fails.
#[tauri::command]
pub async fn engine_providers<R: Runtime>(app: AppHandle<R>) -> Result<Value, CommandError> {
    Ok(engine::call(&app, Method::Get, "/v1/providers", None).await?)
}

/// Creates a provider, or replaces an existing one.
///
/// The body carries the API key on its way in. It is passed through and never
/// logged.
///
/// # Errors
///
/// Returns the engine's reason code when the call fails.
#[tauri::command]
pub async fn engine_save_provider<R: Runtime>(
    app: AppHandle<R>,
    request: Value,
) -> Result<Value, CommandError> {
    Ok(engine::call(&app, Method::Post, "/v1/providers/save", Some(request)).await?)
}

/// Deletes a provider and the credential stored for it.
///
/// # Errors
///
/// Returns `backend.remote.provider_unknown` when the id is not a plain
/// identifier, and the engine's reason code when the call fails.
#[tauri::command]
pub async fn engine_remove_provider<R: Runtime>(
    app: AppHandle<R>,
    provider_id: String,
) -> Result<Value, CommandError> {
    let path = provider_action_path(&provider_id, "remove")?;
    Ok(engine::call(&app, Method::Post, &path, None).await?)
}

/// Selects the provider that serves generation.
///
/// # Errors
///
/// Returns `backend.remote.provider_unknown` when the id is not a plain
/// identifier, and the engine's reason code when the call fails.
#[tauri::command]
pub async fn engine_activate_provider<R: Runtime>(
    app: AppHandle<R>,
    provider_id: String,
) -> Result<Value, CommandError> {
    let path = provider_action_path(&provider_id, "activate")?;
    Ok(engine::call(&app, Method::Post, &path, None).await?)
}

/// Runs one connection test against a stored provider.
///
/// Answers whether or not the endpoint did: a refused key is the result, not a
/// failure of this call.
///
/// # Errors
///
/// Returns `backend.remote.provider_unknown` when the id is not a plain
/// identifier, and the engine's reason code when the call fails.
#[tauri::command]
pub async fn engine_test_provider<R: Runtime>(
    app: AppHandle<R>,
    provider_id: String,
) -> Result<Value, CommandError> {
    let path = provider_action_path(&provider_id, "test")?;
    Ok(engine::call(&app, Method::Post, &path, None).await?)
}

/// Builds the path for an action on one provider.
///
/// The id comes from the frontend and goes into a URL path, so it is checked
/// against the shape an identifier has rather than trusted, exactly as a model
/// id is. Provider ids are `p` followed by sixteen hex characters, which
/// `is_plain_identifier` already accepts.
///
/// # Errors
///
/// Returns `backend.remote.provider_unknown` when the id is not a plain
/// identifier.
fn provider_action_path(provider_id: &str, action: &str) -> Result<String, CommandError> {
    if !is_plain_identifier(provider_id) {
        return Err(CommandError::new(
            "backend.remote.provider_unknown",
            format!("invalid provider id: {provider_id}"),
        ));
    }

    Ok(format!("/v1/providers/{provider_id}/{action}"))
}

/// Deletes a model's weights from this machine.
///
/// # Errors
///
/// Returns `models.unknown` when the id is not a plain identifier, and the
/// engine's reason code when the call fails.
#[tauri::command]
pub async fn engine_remove_model<R: Runtime>(
    app: AppHandle<R>,
    model_id: String,
) -> Result<Value, CommandError> {
    let path = model_action_path(&model_id, "remove")?;
    Ok(engine::call(&app, Method::Post, &path, None).await?)
}

/// Builds the path for an action on one model.
///
/// The id comes from the frontend and goes into a URL path, so it is checked
/// against the shape a registry id has rather than trusted, exactly as the
/// backend kind is. The engine validates it again; this stops a crafted value
/// from steering the request at a path that was never meant to be reachable.
///
/// # Errors
///
/// Returns `models.unknown` when the id is not a plain identifier.
fn model_action_path(model_id: &str, action: &str) -> Result<String, CommandError> {
    if !is_plain_identifier(model_id) {
        return Err(CommandError::new(
            "models.unknown",
            format!("invalid model id: {model_id}"),
        ));
    }

    Ok(format!("/v1/models/{model_id}/{action}"))
}

/// The longest identifier accepted. Real model and provider ids are far
/// shorter than this.
const MAX_IDENTIFIER: usize = 64;

/// Reports whether a value is a plain identifier.
///
/// Registry ids are ASCII words joined by hyphens or underscores, such as
/// `sd15-base`. Anything else, and in particular a slash, a dot, a percent
/// escape, or a query separator, is not an id and is refused.
fn is_plain_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_IDENTIFIER
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
}

/// The runtime builds the engine knows how to install.
///
/// `auto` is not a build: it asks the engine to pick whichever suits the GPU
/// this shell probed for.
const RUNTIME_ACCELERATORS: [&str; 4] = ["auto", "cuda", "mps", "cpu"];

/// Reports whether the GPU runtime is installed, and what installing it costs.
///
/// The GPU probe runs here rather than in the engine. It is the shell that
/// already knows how to ask the driver, and it does so without loading any
/// machine learning framework, so the answer is passed along instead of being
/// worked out a second time on the Python side.
///
/// # Errors
///
/// Returns the engine's reason code when the call fails.
#[tauri::command]
pub async fn engine_runtime_info<R: Runtime>(app: AppHandle<R>) -> Result<Value, CommandError> {
    let path = format!("/v1/runtime?gpu={}", probed_gpu_kind());
    Ok(engine::call(&app, Method::Get, &path, None).await?)
}

/// Starts installing the GPU runtime in the background.
///
/// The engine answers as soon as the transfer is running; the frontend follows
/// it by re-reading the runtime state.
///
/// # Errors
///
/// Returns `runtime.unknown_variant` when the accelerator is not one of the
/// known builds, and the engine's reason code when the call fails, including
/// `runtime.already_installing`, `runtime.already_installed` and
/// `runtime.insufficient_space`.
#[tauri::command]
pub async fn engine_runtime_install<R: Runtime>(
    app: AppHandle<R>,
    accelerator: String,
) -> Result<Value, CommandError> {
    // Checked against the known values rather than trusted, exactly as a
    // backend kind is. The engine validates it again; neither side relies on
    // the other's check.
    if !is_plain_identifier(&accelerator) || !RUNTIME_ACCELERATORS.contains(&accelerator.as_str()) {
        return Err(CommandError::new(
            "runtime.unknown_variant",
            format!("unknown runtime accelerator: {accelerator}"),
        ));
    }

    let body = json!({ "accelerator": accelerator, "gpu": probed_gpu_kind() });
    Ok(engine::call(&app, Method::Post, "/v1/runtime/install", Some(body)).await?)
}

/// Asks a running install to stop.
///
/// # Errors
///
/// Returns the engine's reason code when the call fails.
/// Adds the pinned packages the installed runtime is missing.
///
/// Only the difference is fetched. A package added to the manifest after a
/// runtime was installed would otherwise cost a full reinstall, which for this
/// runtime is gigabytes to add megabytes.
///
/// # Errors
///
/// Returns the engine's reason code when the call fails.
#[tauri::command]
pub async fn engine_runtime_repair<R: Runtime>(app: AppHandle<R>) -> Result<Value, CommandError> {
    Ok(engine::call(&app, Method::Post, "/v1/runtime/repair", None).await?)
}

#[tauri::command]
pub async fn engine_runtime_cancel<R: Runtime>(app: AppHandle<R>) -> Result<Value, CommandError> {
    Ok(engine::call(&app, Method::Post, "/v1/runtime/cancel", None).await?)
}

/// Deletes the installed GPU runtime.
///
/// # Errors
///
/// Returns the engine's reason code when the call fails, including
/// `runtime.busy_installing` and `runtime.not_installed`.
#[tauri::command]
pub async fn engine_runtime_remove<R: Runtime>(app: AppHandle<R>) -> Result<Value, CommandError> {
    Ok(engine::call(&app, Method::Post, "/v1/runtime/remove", None).await?)
}

/// Returns the GPU family this machine has, as a value safe to put in a URL.
///
/// The probe's `kind` is written by this file and is one of three words, but it
/// is checked anyway before it is interpolated into a query string, because the
/// rule here is that nothing reaches a URL unchecked.
fn probed_gpu_kind() -> String {
    let kind = probe_gpu().kind;
    if is_plain_identifier(&kind) {
        kind
    } else {
        "none".to_string()
    }
}

/// The longest storage path accepted.
///
/// Well past every platform's own limit, so a real path is never refused here,
/// while a value long enough to be an attempt at something else is.
const MAX_STORAGE_PATH: usize = 4096;

/// Reports where downloaded data is kept, and how much room is left there.
///
/// # Errors
///
/// Returns the engine's reason code when the call fails.
#[tauri::command]
pub async fn storage_info<R: Runtime>(app: AppHandle<R>) -> Result<Value, CommandError> {
    Ok(engine::call(&app, Method::Get, "/v1/storage", None).await?)
}

/// Checks a directory without adopting it.
///
/// The engine creates it if it is missing and proves it writable by writing a
/// file and removing it again, then reports the free space on its volume, so
/// the interface can warn before a four gigabyte download onto a volume with
/// one gigabyte left.
///
/// # Errors
///
/// Returns `storage.path_empty`, `storage.path_not_absolute`, or
/// `storage.path_too_long` for a path that is not worth sending, and the
/// engine's reason code when the directory itself is refused.
#[tauri::command]
pub async fn storage_validate<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<Value, CommandError> {
    let checked = checked_storage_path(&path)?;
    let body = json!({ "path": checked });
    Ok(engine::call(&app, Method::Post, "/v1/storage/validate", Some(body)).await?)
}

/// Moves where downloaded data is kept, and remembers the choice.
///
/// Nothing on disk is moved. Weights already downloaded stay at the old
/// location; the response names them so the interface can say so.
///
/// The engine is told first. Only a location it accepted is written to the
/// preferences file, so a launch can never come up pointed at a directory that
/// was refused.
///
/// # Errors
///
/// Returns a `storage.*` code for a path that is not worth sending, the
/// engine's reason code when the directory is refused or a download is in
/// flight, and `storage.not_remembered` when the location is in use for this
/// session but could not be written to the preferences file.
#[tauri::command]
pub async fn storage_set_root<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<Value, CommandError> {
    let checked = checked_storage_path(&path)?;
    let body = json!({ "path": checked });
    let outcome = engine::call(&app, Method::Post, "/v1/storage", Some(body)).await?;

    remember_root(&app, Some(root_of(&outcome).unwrap_or(checked)))?;
    Ok(outcome)
}

/// Goes back to the engine's own per-user default location.
///
/// # Errors
///
/// Returns the engine's reason code when the default is refused or a download
/// is in flight, and `storage.not_remembered` when the choice could not be
/// cleared from the preferences file.
#[tauri::command]
pub async fn storage_reset_root<R: Runtime>(app: AppHandle<R>) -> Result<Value, CommandError> {
    let outcome = engine::call(&app, Method::Post, "/v1/storage/default", None).await?;

    remember_root(&app, None)?;
    Ok(outcome)
}

/// Opens the system's own directory picker.
///
/// # Errors
///
/// Returns `storage.picker_failed` when the dialog could not be shown, or was
/// closed in a way that lost its answer.
#[tauri::command]
pub async fn storage_pick_directory<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<String>, CommandError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();

    // The callback form, not the blocking one: on macOS and Linux the dialog
    // has to run on the main thread, and a command never does.
    app.dialog().file().pick_folder(move |picked| {
        let _ = sender.send(picked);
    });

    let picked = receiver.await.map_err(|error| {
        CommandError::new("storage.picker_failed", format!("no answer: {error}"))
    })?;

    // A path the platform hands back as a content URI has no filesystem path,
    // and cannot hold gigabytes of weights, so it is treated as no answer.
    Ok(picked
        .and_then(|file| file.into_path().ok())
        .map(|path| path.display().to_string()))
}

/// Writes the chosen root to the preferences file.
///
/// # Errors
///
/// Returns `storage.not_remembered`, which says the location applies to this
/// session but will not survive a restart.
fn remember_root<R: Runtime>(app: &AppHandle<R>, root: Option<String>) -> Result<(), CommandError> {
    preferences::set_data_root(app, root).map_err(|error| {
        log::warn!("the storage location could not be remembered: {error}");
        CommandError::new("storage.not_remembered", error.to_string())
    })
}

/// Reads the root the engine reported adopting.
///
/// The engine normalises the path, and that normalised form is what must be
/// remembered: it is the one the next launch will be started with.
fn root_of(outcome: &Value) -> Option<String> {
    outcome
        .get("current")?
        .get("root")?
        .as_str()
        .map(str::to_string)
}

/// Checks a storage path before it is sent to the engine.
///
/// The path is the user's own, and goes into a request body rather than a URL,
/// so this is not about escaping. It refuses the values that cannot describe a
/// directory at all, for the same reason a model id is checked before it is put
/// into a path: the engine validates it again, and neither side trusts the
/// other's check.
///
/// # Errors
///
/// Returns `storage.path_empty`, `storage.path_too_long`,
/// `storage.path_invalid`, or `storage.path_not_absolute`.
fn checked_storage_path(path: &str) -> Result<String, CommandError> {
    let trimmed = path.trim();

    if trimmed.is_empty() {
        return Err(CommandError::new(
            "storage.path_empty",
            "the storage path is empty".to_string(),
        ));
    }

    if trimmed.len() > MAX_STORAGE_PATH {
        return Err(CommandError::new(
            "storage.path_too_long",
            format!("the storage path is {} bytes", trimmed.len()),
        ));
    }

    // A control character cannot appear in a directory name on any supported
    // platform, and a NUL in particular truncates the path at the first
    // system call that takes it.
    if trimmed.chars().any(char::is_control) {
        return Err(CommandError::new(
            "storage.path_invalid",
            "the storage path contains a control character".to_string(),
        ));
    }

    if !Path::new(trimmed).is_absolute() {
        return Err(CommandError::new(
            "storage.path_not_absolute",
            format!("the storage path is relative: {trimmed}"),
        ));
    }

    Ok(trimmed.to_string())
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

/// Returns the application's own version, as declared in `Cargo.toml`.
///
/// The About panel shows this beside the engine version. Without it, a frozen
/// sidecar reporting an old version reads as the application being out of
/// date, and the real mismatch stays invisible.
#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
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
        engine_download_model,
        engine_cancel_download,
        engine_remove_model,
        engine_pause_download,
        engine_providers,
        engine_save_provider,
        engine_remove_provider,
        engine_activate_provider,
        engine_test_provider,
        engine_runtime_info,
        engine_runtime_install,
        engine_runtime_repair,
        engine_runtime_cancel,
        engine_runtime_remove,
        storage_info,
        storage_validate,
        storage_set_root,
        storage_reset_root,
        storage_pick_directory,
        vibrancy_state,
        platform_info,
        app_version,
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
    fn builds_a_path_for_a_registry_id() {
        assert_eq!(
            model_action_path("sd15-base", "download").unwrap(),
            "/v1/models/sd15-base/download"
        );
        assert_eq!(
            model_action_path("rembg_u2net", "cancel").unwrap(),
            "/v1/models/rembg_u2net/cancel"
        );
        assert_eq!(
            model_action_path("sdxl-base", "pause").unwrap(),
            "/v1/models/sdxl-base/pause"
        );
    }

    #[test]
    fn refuses_an_id_that_is_not_a_plain_identifier() {
        for id in [
            "",
            "../backends/cuda/select",
            "sd15 base",
            "sd15/base",
            "sd15%2Fbase",
            "sd15?x=1",
            &"a".repeat(MAX_IDENTIFIER + 1),
        ] {
            let error = model_action_path(id, "download").unwrap_err();
            assert_eq!(error.code, "models.unknown");
        }
    }

    /// An absolute directory on the platform the test is running on.
    ///
    /// Written with forward slashes on purpose: Windows accepts them, and a
    /// backslash in a test literal is one escape away from asserting on a
    /// string nobody meant to write.
    const ABSOLUTE: &str = if cfg!(target_os = "windows") {
        "D:/bitwright/models"
    } else {
        "/mnt/data/bitwright"
    };

    #[test]
    fn accepts_an_absolute_directory() {
        assert_eq!(checked_storage_path(ABSOLUTE).unwrap(), ABSOLUTE);
    }

    #[test]
    fn trims_the_padding_around_a_pasted_path() {
        let padded = format!("  {ABSOLUTE}  ");
        assert_eq!(checked_storage_path(&padded).unwrap(), ABSOLUTE);
    }

    #[test]
    fn refuses_a_path_that_cannot_name_a_directory() {
        assert_eq!(
            checked_storage_path("").unwrap_err().code,
            "storage.path_empty"
        );
        assert_eq!(
            checked_storage_path("   ").unwrap_err().code,
            "storage.path_empty"
        );
        assert_eq!(
            checked_storage_path("models/weights").unwrap_err().code,
            "storage.path_not_absolute"
        );
        assert_eq!(
            checked_storage_path(&"a".repeat(MAX_STORAGE_PATH + 1))
                .unwrap_err()
                .code,
            "storage.path_too_long"
        );
    }

    #[test]
    fn refuses_a_path_carrying_a_control_character() {
        // A NUL truncates the path at the first system call that takes it, so
        // the directory that ends up written to is not the one that was shown.
        let sneaky = format!("{ABSOLUTE}\u{0}/models");
        assert_eq!(
            checked_storage_path(&sneaky).unwrap_err().code,
            "storage.path_invalid"
        );
    }

    #[test]
    fn reads_the_root_the_engine_adopted() {
        let outcome = serde_json::json!({
            "current": { "root": ABSOLUTE },
            "previous": { "root": "/home/someone" },
        });
        assert_eq!(root_of(&outcome).as_deref(), Some(ABSOLUTE));
        assert!(root_of(&serde_json::json!({ "current": {} })).is_none());
        assert!(root_of(&serde_json::json!({})).is_none());
    }

    #[test]
    fn the_probed_gpu_kind_is_always_safe_in_a_url() {
        let kind = probed_gpu_kind();
        assert!(is_plain_identifier(&kind));
        assert!(["cuda", "metal", "none"].contains(&kind.as_str()));
    }

    #[test]
    fn refuses_a_runtime_accelerator_that_is_not_a_known_build() {
        for value in [
            "",
            "cuda; rm",
            "../models",
            "gpu",
            &"a".repeat(MAX_IDENTIFIER + 1),
        ] {
            assert!(
                !is_plain_identifier(value) || !RUNTIME_ACCELERATORS.contains(&value),
                "{value} should not be accepted as a runtime accelerator"
            );
        }
        for value in RUNTIME_ACCELERATORS {
            assert!(is_plain_identifier(value));
        }
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
