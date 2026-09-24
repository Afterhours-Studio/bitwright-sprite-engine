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

//! The Tauri shell.
//!
//! Owns the window, the custom decorations, the background effect, and the
//! lifetime of the Python sidecar. It holds no generation logic of its own.

// Keep the console window from appearing behind the app on Windows release
// builds, while leaving it available in development for logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod commands;
use bitwright::{raster, store};
mod engine;
mod mcp;
mod preferences;
mod reference;
mod sidecar;

use std::process::ExitCode;

use tauri::{Manager, RunEvent, WebviewWindow};

use commands::{VibrancyManager, VibrancyState};
use sidecar::SidecarManager;

fn main() -> ExitCode {
    // A client that spawned this process is asking for MCP over stdin/stdout
    // instead of a window. Nothing may reach stdout on this path: every frame
    // there is protocol. `stdio::run` prints failures to stderr only.
    if std::env::args().any(|argument| argument == "--mcp-stdio") {
        return mcp_stdio();
    }

    tauri::Builder::default()
        // Without this every log::info! and log::warn! in the shell is
        // discarded, including the ones reporting that the sidecar failed to
        // start. The crate only records lines once something installs a
        // logger, and nothing did.
        // The builder already writes to stdout and to the log directory.
        // `.target()` appends rather than replaces, so naming those two again
        // is what made every line appear twice.
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        // Only for the directory picker on the Settings screen: the user has
        // to be able to point gigabytes of weights at a volume with room.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(SidecarManager::default())
        .manage(VibrancyManager::default())
        .invoke_handler(commands::handler())
        .setup(|app| {
            let root = preferences::load(app.handle())
                .data_root
                .map(std::path::PathBuf::from)
                .or_else(|| std::env::var_os("BITWRIGHT_DATA_ROOT").map(std::path::PathBuf::from))
                .unwrap_or(app.path().app_local_data_dir()?);
            std::fs::create_dir_all(&root)?;
            app.manage(commands::document::DocumentState::new(store::Store::open(
                root.join("bitwright.db"),
            )?));
            app.manage(mcp::server::McpServerState::new(root.clone())?);

            // The window must appear whether or not the MCP server starts, so
            // the failure is logged rather than propagated. `start` does
            // nothing at all when the saved transport is `off`.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = mcp::server::start(&handle).await {
                    log::error!("could not start the MCP server: {error}");
                }
            });

            let window = app
                .get_webview_window("main")
                .expect("the main window is declared in tauri.conf.json");

            let vibrancy = apply_window_effect(&window);
            log::info!(
                "window effect: applied={} effect={} reason={}",
                vibrancy.applied,
                vibrancy.effect,
                vibrancy.reason
            );
            app.state::<VibrancyManager>().set(vibrancy);

            if let Err(error) = sidecar::spawn(app.handle()) {
                // Startup continues. The frontend has already been told, and
                // shows the failure with a retry rather than an empty window.
                log::error!("could not start the sidecar: {error}");
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                commands::shutdown_sidecar(app);
            }
        });

    ExitCode::SUCCESS
}

/// Serves MCP over stdin/stdout, without a window.
///
/// Resolves the data root the same way the window path does, so a client that
/// spawns this binary sees the documents the app has been editing.
fn mcp_stdio() -> ExitCode {
    let Some(root) = preferences::data_root_without_app() else {
        eprintln!("no configuration or data directory on this platform");
        return ExitCode::FAILURE;
    };

    if let Err(error) = std::fs::create_dir_all(&root) {
        eprintln!("cannot create {}: {error}", root.display());
        return ExitCode::FAILURE;
    }

    mcp::stdio::run(&root.join("bitwright.db"))
}

/// Applies the platform's background effect to the main window.
///
/// Failure is never fatal. The returned state tells the frontend which token
/// set to use, so a window with no effect still renders on opaque surfaces
/// rather than showing unreadable text over a transparent background.
fn apply_window_effect(window: &WebviewWindow) -> VibrancyState {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

        // UnderWindowBackground tints from the desktop behind the window,
        // which is what makes the chrome read as part of the system rather
        // than as a painted rectangle. The sidebar material is applied to the
        // sidebar element by the frontend, through its own effect view.
        match apply_vibrancy(
            window,
            NSVisualEffectMaterial::UnderWindowBackground,
            Some(NSVisualEffectState::Active),
            None,
        ) {
            Ok(()) => VibrancyState {
                applied: true,
                effect: "vibrancy".into(),
                reason: String::new(),
            },
            Err(error) => {
                log::warn!("vibrancy unavailable: {error}");
                VibrancyState {
                    applied: false,
                    effect: String::new(),
                    reason: "vibrancy.apply_failed".into(),
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, apply_mica};

        // Mica is a Windows 11 effect. On Windows 10 the only option is
        // acrylic, which repaints the whole window while it is being dragged
        // and makes the drag visibly stutter, so it is off unless asked for.
        match apply_mica(window, None) {
            Ok(()) => {
                return VibrancyState {
                    applied: true,
                    effect: "mica".into(),
                    reason: String::new(),
                }
            }
            Err(error) => log::info!("mica unavailable, this is expected on Windows 10: {error}"),
        }

        if std::env::var("BITWRIGHT_VIBRANCY").as_deref() != Ok("acrylic") {
            return VibrancyState {
                applied: false,
                effect: String::new(),
                reason: "vibrancy.windows10_opt_in".into(),
            };
        }

        match apply_acrylic(window, None) {
            Ok(()) => VibrancyState {
                applied: true,
                effect: "acrylic".into(),
                reason: String::new(),
            },
            Err(error) => {
                log::warn!("acrylic unavailable: {error}");
                VibrancyState {
                    applied: false,
                    effect: String::new(),
                    reason: "vibrancy.apply_failed".into(),
                }
            }
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        // No compositor-independent way to blur behind a window exists on
        // Linux, so the opaque token set is the only correct choice.
        let _ = window;
        VibrancyState {
            applied: false,
            effect: String::new(),
            reason: "vibrancy.unsupported_platform".into(),
        }
    }
}
