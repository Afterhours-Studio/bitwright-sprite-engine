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

pub mod document;

use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Runtime, State, Window};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

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

/// Returns the sidecar's current status.
///
/// The frontend calls this on mount, because the ready event may have fired
/// before the webview finished loading.
#[tauri::command]
pub fn sidecar_status(manager: State<'_, SidecarManager>) -> SidecarStatus {
    manager.status()
}

/// Lists the sprites already on disk, newest first.
///
/// # Errors
///
/// Returns the engine's reason code when the call fails.
#[tauri::command]
pub async fn engine_sprites<R: Runtime>(app: AppHandle<R>) -> Result<Value, CommandError> {
    Ok(engine::call(&app, Method::Get, "/v1/sprites", None).await?)
}

/// Deletes one sprite from disk.
///
/// # Errors
///
/// Returns `sprites.unknown` when the name is not a plain file name, and the
/// engine's reason code when the call fails.
#[tauri::command]
pub async fn engine_remove_sprite<R: Runtime>(
    app: AppHandle<R>,
    name: String,
) -> Result<Value, CommandError> {
    // A sprite is named by its file, which is generated rather than typed, so
    // it is checked the same way an identifier is before it reaches a URL.
    if !is_sprite_name(&name) {
        return Err(CommandError::new(
            "sprites.unknown",
            format!("invalid sprite name: {name}"),
        ));
    }

    Ok(engine::call(
        &app,
        Method::Post,
        &format!("/v1/sprites/{name}/remove"),
        None,
    )
    .await?)
}

/// Writes a painted sprite beside the one it was painted from.
///
/// `name` is the sprite that was painted on, not the file to write. The engine
/// derives the edited copy's name from a file it already owns, so no name that
/// arrives here decides where the bytes land; this check is the same one
/// deleting a sprite makes, and for the same reason.
///
/// # Errors
///
/// Returns `sprites.unknown` when the name is not a plain sprite file name,
/// and the engine's reason code when the call fails.
#[tauri::command]
pub async fn engine_save_sprite_edit<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    image: String,
) -> Result<Value, CommandError> {
    if !is_sprite_name(&name) {
        return Err(CommandError::new(
            "sprites.unknown",
            format!("invalid sprite name: {name}"),
        ));
    }

    let body = json!({ "image": image });
    Ok(engine::call(
        &app,
        Method::Post,
        &format!("/v1/sprites/{name}/edit"),
        Some(body),
    )
    .await?)
}

/// Reports whether a value is a sprite file name.
///
/// The generated names are digits, hyphens and the `.png` suffix. Anything
/// else, and in particular a separator or a dot segment, is not one.
fn is_sprite_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_SPRITE_NAME
        && value.ends_with(".png")
        && value
            .trim_end_matches(".png")
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

/// Corrects one sprite that already exists.
///
/// # Errors
///
/// Returns the engine's reason code when the call fails.
#[tauri::command]
pub async fn engine_conform<R: Runtime>(
    app: AppHandle<R>,
    request: Value,
) -> Result<Value, CommandError> {
    Ok(engine::call(&app, Method::Post, "/v1/conform", Some(request)).await?)
}

/// Bounds sprite names before they are placed in a request URL.
const MAX_SPRITE_NAME: usize = 64;

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

/// Hosts an external link is allowed to reach.
///
/// An allowlist rather than a scheme check. A command that opens whatever URL
/// the interface hands it is a command that opens whatever anything able to
/// reach the interface hands it, and the only links this application needs are
/// its own project and its licence.
const ALLOWED_HOSTS: [&str; 2] = ["github.com", "www.gnu.org"];

/// Opens one of the application's directories in the system file manager.
///
/// Directories only. A file passed to the system opener is launched through
/// its association, which turns "show me where my sprites are" into "run
/// this", so anything that is not a directory is refused.
///
/// # Errors
///
/// Returns `shell.not_a_directory` when the path is not an existing directory,
/// and `shell.open_failed` when the platform refuses to open it.
#[tauri::command]
pub fn open_directory<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), CommandError> {
    let target = Path::new(&path);
    if !target.is_dir() {
        return Err(CommandError::new("shell.not_a_directory", path));
    }

    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|error| CommandError::new("shell.open_failed", error.to_string()))
}

/// Opens an external link in the user's browser.
///
/// # Errors
///
/// Returns `shell.url_not_allowed` when the link is not https on an allowed
/// host, and `shell.open_failed` when the platform refuses to open it.
#[tauri::command]
pub fn open_external<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), CommandError> {
    let parsed = url::Url::parse(&url)
        .map_err(|error| CommandError::new("shell.url_not_allowed", error.to_string()))?;

    let allowed = parsed.scheme() == "https"
        && parsed
            .host_str()
            .is_some_and(|host| ALLOWED_HOSTS.contains(&host));
    if !allowed {
        return Err(CommandError::new("shell.url_not_allowed", url));
    }

    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| CommandError::new("shell.open_failed", error.to_string()))
}

/// Registers every command with the builder.
pub fn handler<R: Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        document::project_list,
        document::project_create,
        document::project_rename,
        document::project_delete,
        document::asset_list,
        document::asset_create,
        document::asset_rename,
        document::asset_delete,
        document::asset_open,
        document::style_read,
        document::document_composite,
        document::document_read_layer,
        document::document_write_ops,
        document::document_undo,
        document::document_redo,
        document::palette_read,
        document::palette_write,
        document::step_state,
        document::step_check,
        document::step_advance,
        document::step_revisit,
        sidecar_status,
        engine_conform,
        engine_sprites,
        engine_remove_sprite,
        engine_save_sprite_edit,
        storage_info,
        storage_validate,
        storage_set_root,
        storage_reset_root,
        storage_pick_directory,
        vibrancy_state,
        platform_info,
        app_version,
        window_minimize,
        window_toggle_maximize,
        window_is_maximized,
        window_close,
        open_directory,
        open_external,
        crate::mcp::server::mcp_status,
        crate::mcp::server::mcp_set_transport,
        crate::mcp::server::mcp_regenerate_token,
        crate::mcp::clients::mcp_clients,
        crate::mcp::clients::mcp_client_register,
        crate::mcp::clients::mcp_client_unregister,
        crate::mcp::clients::mcp_manual_config,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_info_matches_the_build_target() {
        let info = platform_info();
        assert_eq!(info.os, current_os());
        assert_eq!(info.system_window_controls, cfg!(target_os = "macos"));
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
