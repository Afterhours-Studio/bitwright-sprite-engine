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

//! Choices the shell has to remember between launches.
//!
//! The engine reads no configuration file of its own, by design: it is spawned
//! fresh on every launch by this process, which controls its environment, and a
//! file there would be a third place for a setting to hide. A value that lives
//! only in the engine process is therefore gone at the next launch.
//!
//! The webview cannot hold it either. `localStorage` is where the theme and the
//! language live, but Rust cannot read it, and the data root has to be known
//! before the sidecar is spawned, which happens before the webview has loaded.
//!
//! So it lives here: one small JSON file in the platform configuration
//! directory, written by the shell and read back at spawn time. Keys this
//! version does not know about are preserved on write, so a preference added
//! elsewhere is not dropped by a save from here.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};

/// Name of the preferences file inside the configuration directory.
const FILE_NAME: &str = "preferences.json";

/// Extension of the file a save is written to before it replaces the real one.
const TEMPORARY_EXTENSION: &str = "json.tmp";

/// Everything the shell remembers for the next launch.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    /// Where downloaded data is kept. `None` means the engine's own per-user
    /// default, which is the behaviour before anyone changed anything.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_root: Option<String>,

    /// Keys written by a different version, or a different part of the shell.
    /// Carried through untouched so that saving one preference cannot delete
    /// another.
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}

/// Returns the preferences file path, or `None` when the platform has no
/// configuration directory to put it in.
fn file_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|directory| directory.join(FILE_NAME))
}

/// Reads the preferences.
///
/// A missing or unreadable file is not an error: it means nothing has been
/// chosen yet, and the defaults apply. A corrupt file is reported in the log
/// and then ignored, because refusing to start over a malformed preference
/// would leave the user with no way in.
pub fn load<R: Runtime>(app: &AppHandle<R>) -> Preferences {
    let Some(path) = file_path(app) else {
        return Preferences::default();
    };

    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Preferences::default(),
        Err(error) => {
            log::warn!("cannot read {}: {error}", path.display());
            return Preferences::default();
        }
    };

    match serde_json::from_str(&text) {
        Ok(preferences) => preferences,
        Err(error) => {
            log::warn!("ignoring malformed {}: {error}", path.display());
            Preferences::default()
        }
    }
}

/// Writes the preferences.
///
/// The file is written beside its destination and then renamed over it, so a
/// process that dies mid-write leaves the previous file intact rather than a
/// truncated one that the next launch would have to ignore.
///
/// # Errors
///
/// Returns the underlying failure when the directory cannot be created, or the
/// file cannot be written or renamed.
pub fn save<R: Runtime>(app: &AppHandle<R>, preferences: &Preferences) -> io::Result<()> {
    let path = file_path(app).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "this platform has no configuration directory",
        )
    })?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let body = serde_json::to_string_pretty(preferences)?;
    let temporary = path.with_extension(TEMPORARY_EXTENSION);

    fs::write(&temporary, body)?;
    fs::rename(&temporary, &path)
}

/// Remembers where downloaded data is kept.
///
/// `None` clears the choice, which puts the engine back on its own per-user
/// default at the next launch.
///
/// # Errors
///
/// Returns the underlying failure when the file cannot be written.
pub fn set_data_root<R: Runtime>(app: &AppHandle<R>, root: Option<String>) -> io::Result<()> {
    let mut preferences = load(app);
    preferences.data_root = root;
    save(app, &preferences)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_keys_it_does_not_know_about() {
        let stored = r#"{"dataRoot":"D:\\bitwright","futureSetting":42}"#;
        let preferences: Preferences = serde_json::from_str(stored).unwrap();
        assert_eq!(preferences.data_root.as_deref(), Some("D:\\bitwright"));

        let written = serde_json::to_string(&preferences).unwrap();
        assert!(written.contains("futureSetting"));
        assert!(written.contains("dataRoot"));
    }

    #[test]
    fn omits_a_root_that_was_never_chosen() {
        let written = serde_json::to_string(&Preferences::default()).unwrap();
        assert_eq!(written, "{}");
    }

    #[test]
    fn reads_a_file_with_no_root() {
        let preferences: Preferences = serde_json::from_str("{}").unwrap();
        assert!(preferences.data_root.is_none());
    }
}
