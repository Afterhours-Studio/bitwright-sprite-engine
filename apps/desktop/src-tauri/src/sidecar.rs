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

//! Lifecycle management for the Python sidecar.
//!
//! The sidecar binds its own loopback port and prints a handshake line on
//! standard output naming that port. The shell reads it rather than guessing,
//! which is what keeps two running copies of the application from colliding.
//! Everything else the process writes goes to standard error and is logged.
//!
//! The protocol is documented in `docs/architecture/ipc-protocol.md`.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::preferences;

/// Base name of the frozen engine.
const SIDECAR_NAME: &str = "bitwright-sidecar";

/// The target this shell was built for.
///
/// Set by `tauri-build`. The sidecar directory carries the same triple, so a
/// bundle can never pick up a binary frozen for a different target.
const TARGET_TRIPLE: &str = env!("TAURI_ENV_TARGET_TRIPLE");

/// How long the sidecar has to print its handshake before startup is failed.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);

/// How long a graceful shutdown is given before the process is terminated.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

/// Header the engine expects its token in.
pub const TOKEN_HEADER: &str = "X-Bitwright-Token";

/// Emitted once the sidecar is serving requests.
pub const EVENT_READY: &str = "sidecar://ready";

/// Emitted when the sidecar fails to start, or exits while the app is running.
pub const EVENT_FAILED: &str = "sidecar://failed";

/// A failure in the sidecar lifecycle.
///
/// Every variant carries a stable reason code, which the frontend looks up in
/// the `errors` translation namespace. The user sees a message in their own
/// language rather than a Rust error string.
#[derive(Debug, thiserror::Error)]
pub enum SidecarError {
    /// The bundled executable could not be started.
    #[error("sidecar.spawn_failed")]
    SpawnFailed(String),
    /// The process started but never printed its handshake.
    #[error("sidecar.startup_timeout")]
    StartupTimeout,
    /// The process exited on its own while the application was running.
    #[error("sidecar.exited")]
    Exited(Option<i32>),
    /// A request was made before the sidecar was ready.
    #[error("sidecar.not_ready")]
    NotReady,
}

impl SidecarError {
    /// Returns the stable reason code the frontend translates.
    pub fn code(&self) -> &'static str {
        match self {
            Self::SpawnFailed(_) => "sidecar.spawn_failed",
            Self::StartupTimeout => "sidecar.startup_timeout",
            Self::Exited(_) => "sidecar.exited",
            Self::NotReady => "sidecar.not_ready",
        }
    }
}

/// The handshake line the sidecar prints on standard output.
#[derive(Debug, Deserialize)]
struct Handshake {
    event: String,
    port: u16,
    token: String,
    version: String,
}

/// What the frontend needs to know about the sidecar.
///
/// The token is deliberately absent. This type is serialized straight to the
/// webview, and a token that reaches the webview is a token a compromised page
/// can use. It lives in [`Credentials`] instead, which never leaves Rust.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
    /// True once the handshake has been read and the API is reachable.
    pub ready: bool,
    /// Loopback port the API is listening on. Zero until ready.
    pub port: u16,
    /// Engine version reported in the handshake. Empty until ready.
    pub version: String,
    /// Stable reason code when the sidecar is not running. Empty otherwise.
    pub error: String,
    /// English detail for logs. Not shown to the user.
    pub detail: String,
}

/// How to reach the engine, including the secret that authenticates a call.
///
/// Deliberately not `Serialize`, so that it cannot be returned from a command
/// by accident.
#[derive(Debug, Clone)]
pub struct Credentials {
    /// Base URL of the engine API.
    pub base_url: String,
    /// Token to send in the `X-Bitwright-Token` header.
    pub token: String,
}

impl SidecarStatus {
    /// Returns the base URL of the sidecar API.
    ///
    /// # Errors
    ///
    /// Returns [`SidecarError::NotReady`] when the handshake has not arrived.
    pub fn base_url(&self) -> Result<String, SidecarError> {
        if !self.ready {
            return Err(SidecarError::NotReady);
        }
        Ok(format!("http://127.0.0.1:{}", self.port))
    }
}

/// Owns the child process and its status.
///
/// Managed by Tauri, so any command can read the status through the app handle.
#[derive(Default)]
pub struct SidecarManager {
    status: Mutex<SidecarStatus>,
    child: Mutex<Option<CommandChild>>,
    token: Mutex<String>,
}

impl SidecarManager {
    /// Returns a snapshot of the current status.
    pub fn status(&self) -> SidecarStatus {
        self.lock_status().clone()
    }

    fn lock_status(&self) -> MutexGuard<'_, SidecarStatus> {
        // A panic while holding the lock would leave the status unreadable and
        // the window blank. Recovering the guard keeps the app usable.
        self.status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_child(&self) -> MutexGuard<'_, Option<CommandChild>> {
        self.child
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_token(&self) -> MutexGuard<'_, String> {
        self.token
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Returns the URL and the token needed to call the engine.
    ///
    /// # Errors
    ///
    /// Returns [`SidecarError::NotReady`] when the handshake has not arrived.
    pub fn credentials(&self) -> Result<Credentials, SidecarError> {
        let base_url = self.status().base_url()?;
        let token = self.lock_token().clone();

        if token.is_empty() {
            return Err(SidecarError::NotReady);
        }

        Ok(Credentials { base_url, token })
    }

    fn set_ready(&self, port: u16, token: String, version: String) {
        *self.lock_token() = token;

        let mut status = self.lock_status();
        status.ready = true;
        status.port = port;
        status.version = version;
        status.error.clear();
        status.detail.clear();
    }

    fn set_failed(&self, error: &SidecarError, detail: String) {
        self.lock_token().clear();

        let mut status = self.lock_status();
        status.ready = false;
        status.port = 0;
        status.error = error.code().to_string();
        status.detail = detail;
    }
}

/// How the engine is going to be started.
struct EngineProgram {
    /// The executable to run.
    program: PathBuf,
    /// Arguments that come before the ones every launch passes.
    args: Vec<String>,
    /// `PYTHONPATH` to set, when running from source.
    python_path: Option<PathBuf>,
    /// Whether this is the frozen bundle rather than the source tree.
    frozen: bool,
}

/// Returns the engine to run, preferring the source tree in a debug build.
///
/// A debug build runs `python -m bitwright_engine` out of the engine's own
/// virtual environment, and only falls back to the frozen bundle when that
/// environment is not there. That is not a convenience: with the frozen bundle
/// as the only option, every change to a Python file needs a full PyInstaller
/// freeze before it can be seen, and until someone remembers to run it the
/// application keeps running the previous build while the source says
/// otherwise. That failure is silent and it has already cost real time here -
/// an About box reporting a version that no longer existed, a missing Pillow,
/// and a credential store that reported itself absent because the freeze
/// predated the dependency. Running from source cannot go stale.
///
/// A release build always uses the frozen bundle, since there is no source tree
/// and no interpreter on a user's machine.
///
/// # Errors
///
/// Returns [`SidecarError::SpawnFailed`] when neither is available.
fn engine_program<R: Runtime>(app: &AppHandle<R>) -> Result<EngineProgram, SidecarError> {
    if cfg!(debug_assertions) {
        if let Some(program) = source_program() {
            return Ok(program);
        }
        log::warn!("no engine virtual environment found, falling back to the frozen bundle");
    }

    let directory = format!("{SIDECAR_NAME}-{TARGET_TRIPLE}");
    let executable = if cfg!(target_os = "windows") {
        format!("{directory}.exe")
    } else {
        directory.clone()
    };
    let relative = format!("binaries/{directory}/{executable}");

    if let Ok(path) = app.path().resolve(&relative, BaseDirectory::Resource) {
        if path.is_file() {
            return Ok(frozen_program(path));
        }
    }

    // In development the crate is built in place and the resource directory may
    // not have been populated yet, so the build output is used directly.
    let in_tree = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(&relative);
    if in_tree.is_file() {
        return Ok(frozen_program(in_tree));
    }

    Err(SidecarError::SpawnFailed(format!(
        "no engine found: no virtual environment, and no bundle at {relative}.          Run scripts/setup-dev.ps1, or scripts/build-sidecar.py"
    )))
}

/// Describes a launch of the frozen bundle.
fn frozen_program(program: PathBuf) -> EngineProgram {
    EngineProgram {
        program,
        args: Vec::new(),
        python_path: None,
        frozen: true,
    }
}

/// Describes a launch from the engine source tree, when one is available.
///
/// Both the interpreter and the package have to be there. A virtual environment
/// with no engine in it would start Python and fail on the import, which is a
/// worse failure than falling back to the bundle.
fn source_program() -> Option<EngineProgram> {
    let engine = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/engine")
        .canonicalize()
        .ok()?;

    let interpreter = if cfg!(target_os = "windows") {
        engine.join(".venv/Scripts/python.exe")
    } else {
        engine.join(".venv/bin/python")
    };

    if !interpreter.is_file() || !engine.join("bitwright_engine/__main__.py").is_file() {
        return None;
    }

    Some(EngineProgram {
        program: interpreter,
        args: vec!["-m".into(), "bitwright_engine".into()],
        // Set explicitly rather than relying on the package being installed
        // into the environment: an editable install that has gone stale would
        // otherwise import an older copy from site-packages.
        python_path: Some(engine),
        frozen: false,
    })
}

/// Starts the sidecar and watches it for the lifetime of the application.
///
/// Returns as soon as the process has been spawned. Readiness arrives later,
/// as the [`EVENT_READY`] event; a failure arrives as [`EVENT_FAILED`] with the
/// reason code. Startup is asynchronous so that the window paints immediately
/// and can show its own progress, rather than the platform showing a frozen
/// window while Python starts.
///
/// # Errors
///
/// Returns [`SidecarError::SpawnFailed`] when the bundled executable cannot be
/// started at all, which usually means a broken installation.
pub fn spawn<R: Runtime>(app: &AppHandle<R>) -> Result<(), SidecarError> {
    let engine = engine_program(app)?;
    log::info!(
        "engine: {} ({})",
        engine.program.display(),
        if engine.frozen { "frozen" } else { "source" }
    );

    let command = app
        .shell()
        .command(engine.program)
        .args(engine.args)
        // The engine watches this process and exits with it. Without that a
        // crash here would leave Python holding the GPU, and the next launch
        // would fail to allocate for a reason the user cannot see.
        .args(["--parent-pid", &std::process::id().to_string()])
        // Port zero asks the sidecar to take any free port and report it back.
        .env("BITWRIGHT_PORT", "0")
        .env("BITWRIGHT_HOST", "127.0.0.1")
        .env("BITWRIGHT_LOG_LEVEL", "INFO");

    let command = match engine.python_path {
        Some(path) => command.env("PYTHONPATH", path.to_string_lossy().into_owned()),
        None => command,
    };

    // The engine keeps no configuration of its own, so the data root the user
    // chose is remembered here and handed back on every launch. Without it a
    // model cache moved off a full system drive would silently return to it.
    let command = match preferences::load(app).data_root {
        Some(root) => {
            log::info!("data root from preferences: {root}");
            command.env("BITWRIGHT_DATA_ROOT", root)
        }
        None => command,
    };

    let (mut events, child) = command
        .spawn()
        .map_err(|error| SidecarError::SpawnFailed(error.to_string()))?;

    let manager = app.state::<SidecarManager>();
    *manager.lock_child() = Some(child);

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let manager = handle.state::<SidecarManager>();
        let deadline = tokio::time::Instant::now() + STARTUP_TIMEOUT;

        loop {
            let event = tokio::select! {
                event = events.recv() => event,
                _ = tokio::time::sleep_until(deadline), if !manager.status().ready => {
                    log::error!("sidecar did not report readiness within {STARTUP_TIMEOUT:?}");
                    fail(&handle, &SidecarError::StartupTimeout, String::new());
                    return;
                }
            };

            let Some(event) = event else {
                // The channel closed without a Terminated event, which means
                // the process is gone.
                if manager.status().ready {
                    fail(
                        &handle,
                        &SidecarError::Exited(None),
                        "output stream closed".into(),
                    );
                }
                return;
            };

            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    if let Some(handshake) = parse_handshake(text.trim()) {
                        // The token is never logged. Logs are read by support,
                        // pasted into issues, and synced into backups.
                        log::info!(
                            "sidecar ready: port={} version={}",
                            handshake.port,
                            handshake.version
                        );
                        manager.set_ready(handshake.port, handshake.token, handshake.version);
                        let _ = handle.emit(EVENT_READY, manager.status());
                    } else if !text.trim().is_empty() {
                        log::debug!("sidecar stdout: {}", text.trim());
                    }
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    if !text.trim().is_empty() {
                        log::info!("sidecar: {}", text.trim());
                    }
                }
                CommandEvent::Error(message) => {
                    log::error!("sidecar error: {message}");
                    fail(
                        &handle,
                        &SidecarError::SpawnFailed(message.clone()),
                        message,
                    );
                    return;
                }
                CommandEvent::Terminated(payload) => {
                    log::error!("sidecar exited with code {:?}", payload.code);
                    let detail = format!("exit code {:?}", payload.code);
                    fail(&handle, &SidecarError::Exited(payload.code), detail);
                    return;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Records a failure and tells the frontend, so the user sees a real message
/// rather than an application that silently does nothing.
fn fail<R: Runtime>(app: &AppHandle<R>, error: &SidecarError, detail: String) {
    let manager = app.state::<SidecarManager>();
    manager.set_failed(error, detail);
    let _ = app.emit(EVENT_FAILED, manager.status());
}

/// Stops the sidecar, giving it a chance to finish in-flight work first.
///
/// The shutdown endpoint asks the server to drain and exit. The process is
/// terminated only if it is still alive after [`SHUTDOWN_GRACE`], so a
/// generation that is midway through writing its result is not cut off.
pub fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    let manager = app.state::<SidecarManager>();

    if let Ok(credentials) = manager.credentials() {
        let request = reqwest::Client::new()
            .post(format!("{}/shutdown", credentials.base_url))
            .header(TOKEN_HEADER, &credentials.token)
            .timeout(SHUTDOWN_GRACE)
            .send();

        let drained = tauri::async_runtime::block_on(async move {
            match request.await {
                Ok(response) => response.status().is_success(),
                Err(error) => {
                    log::warn!("graceful shutdown request failed: {error}");
                    false
                }
            }
        });

        if drained {
            tauri::async_runtime::block_on(tokio::time::sleep(SHUTDOWN_GRACE));
        }
    }

    if let Some(child) = manager.lock_child().take() {
        // Killing an already exited process is a no-op that reports an error,
        // which is why this is logged rather than surfaced.
        if let Err(error) = child.kill() {
            log::debug!("sidecar was already gone: {error}");
        }
    }

    manager.lock_token().clear();

    let mut status = manager.lock_status();
    status.ready = false;
    status.port = 0;
}

/// Parses a handshake line, returning `None` for anything else on the stream.
fn parse_handshake(line: &str) -> Option<Handshake> {
    let handshake: Handshake = serde_json::from_str(line).ok()?;
    let usable = handshake.event == "ready" && handshake.port != 0 && !handshake.token.is_empty();
    usable.then_some(handshake)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_valid_handshake() {
        let handshake =
            parse_handshake(r#"{"event":"ready","port":51234,"token":"s3cret","version":"0.0.3"}"#)
                .unwrap();
        assert_eq!(handshake.port, 51234);
        assert_eq!(handshake.token, "s3cret");
        assert_eq!(handshake.version, "0.0.3");
    }

    #[test]
    fn rejects_a_handshake_without_a_token() {
        let line = r#"{"event":"ready","port":51234,"token":"","version":"0.0.3"}"#;
        assert!(parse_handshake(line).is_none());
    }

    #[test]
    fn ignores_log_lines() {
        assert!(parse_handshake("INFO loading model").is_none());
        assert!(parse_handshake("").is_none());
    }

    #[test]
    fn rejects_a_handshake_without_a_port() {
        let line = r#"{"event":"ready","port":0,"token":"s3cret","version":"0.0.3"}"#;
        assert!(parse_handshake(line).is_none());
    }

    #[test]
    fn rejects_an_unrelated_json_object() {
        let line = r#"{"event":"progress","port":51234,"token":"s3cret","version":"0.0.3"}"#;
        assert!(parse_handshake(line).is_none());
    }

    #[test]
    fn base_url_requires_readiness() {
        let status = SidecarStatus::default();
        assert!(status.base_url().is_err());

        let ready = SidecarStatus {
            ready: true,
            port: 51234,
            ..SidecarStatus::default()
        };
        assert_eq!(ready.base_url().unwrap(), "http://127.0.0.1:51234");
    }
}
