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
//! Two decisions belong here. Whether the server is listening at all, and on
//! which port, because both have to be known before the window is drawn so the
//! shell can show the same address that the server binds. The third is the
//! bearer token clients present, which is generated once and then kept, so a
//! client paired yesterday still works today.
//!
//! The file is one small JSON document in a directory the caller resolves;
//! this module deliberately knows nothing about where the platform keeps its
//! configuration, which keeps every function here testable against a scratch
//! directory. A missing or malformed file is not an error worth refusing to
//! start over, so both cases produce a fresh config with a new token that is
//! written straight back: what the server ends up using is therefore always
//! what is on disk.

use std::fs;
use std::io;
use std::path::Path;

use rand::RngCore;
use serde::{Deserialize, Serialize};

/// Name of the settings file inside the directory the caller resolves.
pub const FILE_NAME: &str = "mcp.json";

/// Extension of the file a save is written to before it replaces the real one.
const TEMPORARY_EXTENSION: &str = "json.tmp";

/// Number of random bytes behind a token, rendered as twice this many hex
/// characters.
const TOKEN_BYTES: usize = 32;

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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfig {
    /// Whether the server listens, and how.
    #[serde(default)]
    pub transport: Transport,

    /// The port to bind. `None` means any free loopback port will do, which is
    /// the behaviour of a server that was never given one.
    #[serde(default)]
    pub port: Option<u16>,

    /// Secret every client has to present. Never empty in practice: a file
    /// without one does not parse and so is replaced.
    pub token: String,
}

impl McpConfig {
    /// A config for a server that has never been configured: default
    /// transport, no chosen port, and a token nobody has seen before.
    fn fresh() -> Self {
        Self {
            transport: Transport::default(),
            port: None,
            token: new_token(),
        }
    }
}

/// Reads `<dir>/mcp.json`.
///
/// A file that does not exist, or exists but does not parse, is replaced by a
/// fresh config with a new token, which is saved before it is returned; the
/// caller always gets a config that matches what is on disk. A file that
/// exists but cannot be read at all (permissions, a locked volume) is reported
/// rather than worked around, because overwriting it would throw away a token
/// a client may still be using.
///
/// # Errors
///
/// Returns the underlying failure when an existing file cannot be read, or
/// when a replacement has to be written and cannot be.
pub fn load(dir: &Path) -> io::Result<McpConfig> {
    let path = dir.join(FILE_NAME);

    match fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<McpConfig>(&text) {
            Ok(config) if is_well_formed_token(&config.token) => Ok(config),
            Ok(config) => {
                log::warn!(
                    "{} holds a token that is not 64 lowercase hex characters, replacing it",
                    path.display()
                );
                let config = McpConfig {
                    token: new_token(),
                    ..config
                };
                save(dir, &config)?;
                Ok(config)
            }
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

/// Whether a stored token is exactly 64 lowercase hex characters.
///
/// A file that holds anything else — an empty string, a truncated paste, a
/// token from an older format — is treated the way a malformed file is: the
/// token is replaced, because `token_matches("", "")` would otherwise let a
/// bare `Authorization: Bearer ` through.
fn is_well_formed_token(token: &str) -> bool {
    token.len() == TOKEN_BYTES * 2
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Builds a fresh config, puts it on disk, and hands it back.
fn write_fresh(dir: &Path) -> io::Result<McpConfig> {
    let config = McpConfig::fresh();
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

/// A new 32-byte random token, written as 64 lowercase hex characters.
///
/// Hex rather than the raw bytes so the token survives being pasted into a
/// client's configuration and carried in an HTTP header, neither of which has
/// any business carrying arbitrary bytes.
pub fn new_token() -> String {
    let mut bytes = [0u8; TOKEN_BYTES];
    rand::rng().fill_bytes(&mut bytes);

    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut token = String::with_capacity(TOKEN_BYTES * 2);
    for byte in bytes {
        token.push(char::from(DIGITS[usize::from(byte >> 4)]));
        token.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    token
}

/// Throws the token away and puts a new one in its place, saving the result.
///
/// What was on disk is read first, so the transport and port the user chose
/// survive; only the secret changes. Clients holding the old token are locked
/// out from this moment on, which is the point.
///
/// # Errors
///
/// Returns the underlying failure from [`load`] or [`save`].
pub fn regenerate_token(dir: &Path) -> io::Result<McpConfig> {
    let mut config = load(dir)?;
    config.token = new_token();
    save(dir, &config)?;
    Ok(config)
}

/// Compares a token a client presented with the one on file.
///
/// Every byte of the expected token is examined regardless of where a
/// difference is found, so the time taken says nothing about how much of a
/// guess was right. A length mismatch is reported as no match, but the scan
/// still runs rather than ending at the first difference.
#[must_use]
pub fn token_matches(expected: &str, given: &str) -> bool {
    let expected = expected.as_bytes();
    let given = given.as_bytes();
    let lengths_match = expected.len() == given.len();

    let mut difference = 0u8;
    for index in 0..expected.len().max(given.len()) {
        let left = expected.get(index).copied().unwrap_or(0);
        let right = given.get(index).copied().unwrap_or(0);
        difference |= left ^ right;
    }

    lengths_match && difference == 0
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
        fs::remove_dir_all(&dir).expect("remove the scratch directory");
        result
    }

    fn config_with(transport: Transport, port: Option<u16>) -> McpConfig {
        McpConfig {
            transport,
            port,
            token: new_token(),
        }
    }

    fn is_lowercase_hex(value: &str) -> bool {
        !value.is_empty()
            && value.len() % 2 == 0
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
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
    fn a_first_load_creates_the_file_with_a_new_token() {
        in_scratch(|dir| {
            let config = load(dir).expect("a first load always succeeds");

            assert_eq!(config.transport, Transport::Http);
            assert_eq!(config.port, None);
            assert_eq!(config.token.len(), TOKEN_BYTES * 2);
            assert!(is_lowercase_hex(&config.token));

            let text = fs::read_to_string(dir.join(FILE_NAME)).expect("the file has to be there");
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
    fn a_second_load_returns_the_same_token() {
        in_scratch(|dir| {
            let first = load(dir).unwrap();
            let second = load(dir).unwrap();

            assert_eq!(first, second);
            assert!(token_matches(&first.token, &second.token));
            assert_eq!(names(dir), vec![PathBuf::from(FILE_NAME)]);
        });
    }

    #[test]
    fn a_corrupt_file_yields_a_fresh_config_and_is_replaced() {
        in_scratch(|dir| {
            fs::create_dir_all(dir).unwrap();
            fs::write(dir.join(FILE_NAME), "{ this is not json").unwrap();

            let config = load(dir).unwrap();
            assert_eq!(config.transport, Transport::Http);
            assert_eq!(config.port, None);
            assert_eq!(config.token.len(), TOKEN_BYTES * 2);
            assert!(is_lowercase_hex(&config.token));

            assert_eq!(
                load(dir).unwrap(),
                config,
                "the replacement has to survive a reload"
            );
        });
    }

    #[test]
    fn a_file_with_no_token_is_treated_as_corrupt() {
        in_scratch(|dir| {
            fs::create_dir_all(dir).unwrap();
            fs::write(dir.join(FILE_NAME), r#"{"transport":"off","port":4599}"#).unwrap();

            let config = load(dir).unwrap();
            assert_eq!(
                config.transport,
                Transport::Http,
                "a fresh config starts listening"
            );
            assert_eq!(config.port, None);
            assert!(is_lowercase_hex(&config.token));
        });
    }

    #[test]
    fn an_empty_token_is_replaced_with_a_fresh_one() {
        in_scratch(|dir| {
            fs::create_dir_all(dir).unwrap();
            fs::write(dir.join(FILE_NAME), r#"{"token":""}"#).unwrap();

            let config = load(dir).unwrap();
            assert_eq!(config.token.len(), TOKEN_BYTES * 2);
            assert!(is_lowercase_hex(&config.token));
            assert_eq!(
                load(dir).unwrap(),
                config,
                "the replacement has to survive a reload"
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

    #[test]
    fn regenerating_the_token_changes_it_and_persists_the_new_one() {
        in_scratch(|dir| {
            let before = load(dir).unwrap();

            let after = regenerate_token(dir).unwrap();
            assert_ne!(before.token, after.token);
            assert_eq!(after.token.len(), TOKEN_BYTES * 2);
            assert!(is_lowercase_hex(&after.token));
            assert_eq!(after.transport, before.transport);
            assert_eq!(after.port, before.port);

            assert_eq!(
                load(dir).unwrap(),
                after,
                "the new token has to be the one on disk"
            );
            assert!(!token_matches(&after.token, &before.token));
        });
    }

    #[test]
    fn regenerating_keeps_a_port_the_user_chose() {
        in_scratch(|dir| {
            save(dir, &config_with(Transport::Off, Some(4_599))).unwrap();

            let config = regenerate_token(dir).unwrap();
            assert_eq!(config.transport, Transport::Off);
            assert_eq!(config.port, Some(4_599));
        });
    }

    #[test]
    fn regenerating_a_server_that_is_not_there_yet_gives_it_a_token() {
        in_scratch(|dir| {
            let config = regenerate_token(dir).unwrap();
            assert!(is_lowercase_hex(&config.token));
            assert_eq!(load(dir).unwrap(), config);
        });
    }

    #[test]
    fn tokens_are_matched_exactly() {
        let token = new_token();
        assert!(token_matches(&token, &token));

        let mut near_miss = token.clone();
        let last = near_miss.pop().expect("a token is not empty");
        near_miss.push(if last == '0' { '1' } else { '0' });
        assert!(!token_matches(&token, &near_miss));

        let mut first_byte_wrong = String::from(&token[1..]);
        first_byte_wrong.insert(0, if token.starts_with('0') { '1' } else { '0' });
        assert!(!token_matches(&token, &first_byte_wrong));
    }

    #[test]
    fn a_length_difference_is_not_a_match() {
        assert!(!token_matches("abcdef", "abc"));
        assert!(!token_matches("abc", "abcdef"));
        assert!(!token_matches("", "a"));
        assert!(!token_matches("a", ""));
        assert!(token_matches("", ""));
        assert!(token_matches("abc", "abc"));
    }

    #[test]
    fn successive_tokens_are_different() {
        let mut seen = std::collections::BTreeSet::new();
        for _ in 0..32 {
            let token = new_token();
            assert!(seen.insert(token.clone()), "a repeated token: {token}");
        }
    }
}
