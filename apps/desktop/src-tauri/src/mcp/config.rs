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

//! What the MCP server remembers about how it was last left configured.
//!
//! Two decisions belong here: whether the server is listening at all, and on
//! which port. Both have to be known before the window is drawn so the shell
//! can show the same address that the server binds, and the port is kept so a
//! client configured yesterday still finds the server today.
//!
//! There is no secret in here any more. The server binds loopback only and
//! refuses anything a browser could send (see `server.rs`), so every process
//! that can reach it already runs on this machine and could open the document
//! store directly; a token guarded nothing that was not already reachable,
//! and only made every client harder to configure. Files written by older
//! versions still carry a `token` field, which is ignored on load and dropped
//! on the next save.
//!
//! The file is one small JSON document in a directory the caller resolves;
//! this module deliberately knows nothing about where the platform keeps its
//! configuration, which keeps every function here testable against a scratch
//! directory. A missing or malformed file is not an error worth refusing to
//! start over, so both cases produce a fresh config that is written straight
//! back: what the server ends up using is therefore always what is on disk.

use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// Name of the settings file inside the directory the caller resolves.
pub const FILE_NAME: &str = "mcp.json";

/// Extension of the file a save is written to before it replaces the real one.
const TEMPORARY_EXTENSION: &str = "json.tmp";

/// Whether the server is listening, and how.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    /// Answer agents over loopback HTTP.
    #[default]
    Http,
    /// Bind nothing. The tool surface stays unavailable until this is turned
    /// back on.
    Off,
}

/// The persisted settings of the server.
///
/// Unknown fields are ignored rather than refused, which is what lets a file
/// that still holds the bearer token of an older version load unchanged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpConfig {
    /// Whether the server listens, and how.
    #[serde(default)]
    pub transport: Transport,

    /// The port to bind. `None` means any free loopback port will do, which is
    /// the behaviour of a server that was never given one.
    #[serde(default)]
    pub port: Option<u16>,
}

/// Reads `<dir>/mcp.json`.
///
/// A file that does not exist, or exists but does not parse, is replaced by a
/// fresh config, which is saved before it is returned; the caller always gets a
/// config that matches what is on disk. A file that exists but cannot be read
/// at all (permissions, a locked volume) is reported rather than worked around,
/// because overwriting it would throw away a port a client may still be using.
///
/// # Errors
///
/// Returns the underlying failure when an existing file cannot be read, or
/// when a replacement has to be written and cannot be.
pub fn load(dir: &Path) -> io::Result<McpConfig> {
    let path = dir.join(FILE_NAME);

    match fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<McpConfig>(&text) {
            Ok(config) => Ok(config),
            Err(error) => {
                log::warn!("ignoring malformed {}: {error}", path.display());
                write_fresh(dir)
            }
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            log::debug!(
                "{} is not there yet, starting with a fresh config",
                path.display()
            );
            write_fresh(dir)
        }
        Err(error) => Err(error),
    }
}

/// Reads `<dir>/mcp.json` without ever writing it.
///
/// For the stdio process, which only wants to know where the running app
/// listens and must not create or repair the app's settings behind its back.
/// `None` when the file is missing, unreadable or malformed.
#[must_use]
pub fn peek(dir: &Path) -> Option<McpConfig> {
    let text = fs::read_to_string(dir.join(FILE_NAME)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Builds a fresh config, puts it on disk, and hands it back.
fn write_fresh(dir: &Path) -> io::Result<McpConfig> {
    let config = McpConfig::default();
    save(dir, &config)?;
    Ok(config)
}

/// Writes `<dir>/mcp.json` as pretty JSON, creating the directory when needed.
///
/// The bytes go to a temporary file beside the destination and are then renamed
/// over it, so a process that dies mid-write leaves the previous file intact
/// rather than a truncated one the next launch would have to discard.
///
/// # Errors
///
/// Returns the underlying failure when the directory cannot be created, or the
/// file cannot be written or renamed.
pub fn save(dir: &Path, config: &McpConfig) -> io::Result<()> {
    fs::create_dir_all(dir)?;

    let path = dir.join(FILE_NAME);
    let body = serde_json::to_string_pretty(config)?;
    let temporary = path.with_extension(TEMPORARY_EXTENSION);

    fs::write(&temporary, body)?;
    fs::rename(&temporary, &path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Runs `body` against a scratch directory under the system temp directory
    /// and removes the directory again afterwards. Nothing is created up front:
    /// a config written from scratch is expected to make its own directory.
    fn in_scratch<T>(body: impl FnOnce(&Path) -> T) -> T {
        let dir = std::env::temp_dir().join(format!("bitwright-mcp-{}", uuid::Uuid::now_v7()));
        let result = body(&dir);
        if dir.exists() {
            fs::remove_dir_all(&dir).expect("remove the scratch directory");
        }
        result
    }

    fn config_with(transport: Transport, port: Option<u16>) -> McpConfig {
        McpConfig { transport, port }
    }

    /// Every name in the scratch directory, to check a save leaves nothing else
    /// behind.
    fn names(dir: &Path) -> Vec<PathBuf> {
        let mut names: Vec<PathBuf> = fs::read_dir(dir)
            .expect("read the scratch directory")
            .map(|entry| entry.expect("read an entry").file_name().into())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn a_first_load_creates_the_file() {
        in_scratch(|dir| {
            let config = load(dir).expect("a first load always succeeds");

            assert_eq!(config.transport, Transport::Http);
            assert_eq!(config.port, None);

            let text = fs::read_to_string(dir.join(FILE_NAME)).expect("the file has to be there");
            assert!(!text.contains("token"), "{text}");
            let on_disk: McpConfig =
                serde_json::from_str(&text).expect("what we wrote has to parse");
            assert_eq!(on_disk, config);
            assert_eq!(names(dir), vec![PathBuf::from(FILE_NAME)]);
        });
    }

    #[test]
    fn a_first_load_creates_the_directory_it_needs() {
        in_scratch(|dir| {
            let nested = dir.join("deeper");
            assert!(!nested.exists());

            load(&nested).expect("a missing directory is not fatal");
            assert!(nested.join(FILE_NAME).is_file());
        });
    }

    #[test]
    fn a_corrupt_file_yields_a_fresh_config_and_is_replaced() {
        in_scratch(|dir| {
            fs::create_dir_all(dir).unwrap();
            fs::write(dir.join(FILE_NAME), "{ this is not json").unwrap();

            let config = load(dir).unwrap();
            assert_eq!(config, McpConfig::default());
            assert_eq!(
                load(dir).unwrap(),
                config,
                "the replacement has to survive a reload"
            );
        });
    }

    #[test]
    fn a_file_from_an_older_version_with_a_token_still_loads() {
        in_scratch(|dir| {
            fs::create_dir_all(dir).unwrap();
            fs::write(
                dir.join(FILE_NAME),
                r#"{"transport":"off","port":4599,"token":"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"}"#,
            )
            .unwrap();

            let config = load(dir).unwrap();
            assert_eq!(config, config_with(Transport::Off, Some(4_599)));

            save(dir, &config).unwrap();
            let text = fs::read_to_string(dir.join(FILE_NAME)).unwrap();
            assert!(!text.contains("token"), "the token is dropped: {text}");
        });
    }

    #[test]
    fn a_file_without_a_token_keeps_its_choices() {
        in_scratch(|dir| {
            fs::create_dir_all(dir).unwrap();
            fs::write(dir.join(FILE_NAME), r#"{"transport":"off","port":4599}"#).unwrap();

            assert_eq!(load(dir).unwrap(), config_with(Transport::Off, Some(4_599)));
        });
    }

    #[test]
    fn peek_reads_without_writing() {
        in_scratch(|dir| {
            assert_eq!(peek(dir), None);
            assert!(!dir.exists(), "peek creates nothing");

            save(dir, &config_with(Transport::Http, Some(5_123))).unwrap();
            assert_eq!(peek(dir), Some(config_with(Transport::Http, Some(5_123))));

            fs::write(dir.join(FILE_NAME), "{ broken").unwrap();
            assert_eq!(peek(dir), None);
            assert_eq!(
                fs::read_to_string(dir.join(FILE_NAME)).unwrap(),
                "{ broken",
                "a broken file is left alone"
            );
        });
    }

    #[test]
    fn a_chosen_transport_and_port_survive_a_round_trip() {
        in_scratch(|dir| {
            let config = config_with(Transport::Off, Some(4_599));
            save(dir, &config).unwrap();

            let text = fs::read_to_string(dir.join(FILE_NAME)).unwrap();
            assert!(text.contains("\"transport\": \"off\""), "{text}");
            assert!(text.contains("\"port\": 4599"), "{text}");
            assert_eq!(load(dir).unwrap(), config);
        });
    }

    #[test]
    fn an_absent_port_stays_absent() {
        in_scratch(|dir| {
            let config = config_with(Transport::Http, None);
            save(dir, &config).unwrap();

            let text = fs::read_to_string(dir.join(FILE_NAME)).unwrap();
            assert!(text.contains("\"port\": null"), "{text}");
            assert_eq!(load(dir).unwrap(), config);
        });
    }

    #[test]
    fn a_save_leaves_no_temporary_file_behind() {
        in_scratch(|dir| {
            save(dir, &config_with(Transport::Http, None)).unwrap();
            assert_eq!(names(dir), vec![PathBuf::from(FILE_NAME)]);

            save(dir, &config_with(Transport::Off, Some(8_080))).unwrap();
            assert_eq!(names(dir), vec![PathBuf::from(FILE_NAME)]);
        });
    }

    #[test]
    fn a_save_overwrites_the_previous_config() {
        in_scratch(|dir| {
            let first = config_with(Transport::Http, Some(1_234));
            save(dir, &first).unwrap();
            let second = config_with(Transport::Off, Some(5_678));
            save(dir, &second).unwrap();

            assert_eq!(load(dir).unwrap(), second);
            assert_ne!(load(dir).unwrap(), first);
        });
    }
}
