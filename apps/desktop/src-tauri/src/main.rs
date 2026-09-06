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

mod commands;
mod engine;
mod preferences;
mod sidecar;

use tauri::{Emitter, Manager, RunEvent, WebviewWindow};

use commands::{GpuReport, VibrancyManager, VibrancyState};
use sidecar::SidecarManager;

/// Emitted when the GPU probe finishes, so the frontend can warn about a
/// missing driver without blocking the first paint.
const EVENT_GPU: &str = "startup://gpu";

fn main() {
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
        // Only for the directory picker on the Settings screen: the user has
        // to be able to point gigabytes of weights at a volume with room.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(SidecarManager::default())
        .manage(VibrancyManager::default())
        .invoke_handler(commands::handler())
        .setup(|app| {
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

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let report: GpuReport = commands::check_gpu();
                log::info!(
                    "gpu probe: kind={} available={} code={} detail={}",
                    report.kind,
                    report.available,
                    report.code,
                    report.detail
                );
                let _ = handle.emit(EVENT_GPU, report);
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build the application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                commands::shutdown_sidecar(app);
            }
        });
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
