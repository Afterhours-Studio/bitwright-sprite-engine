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

//! Finding the agents already on this machine, and pointing them here.
//!
//! Each client keeps its servers in a JSON file of its own. This module reads
//! that file, changes only the `mcpServers.bitwright` entry, and writes it back
//! without disturbing anything else the person or another tool put there. The
//! work is done by plain functions that take a path and an endpoint, so the
//! whole thing can be exercised against a temporary directory; the Tauri
//! commands at the bottom only resolve the real paths and read the live
//! endpoint from the running server.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};

use crate::mcp::server::McpServerState;

/// The key every client uses for the map of servers it knows.
const SERVERS_KEY: &str = "mcpServers";

/// The key this engine claims inside that map.
const ENTRY_KEY: &str = "bitwright";

/// The argument Claude Desktop passes to a stdio server it launches.
const STDIO_FLAG: &str = "--mcp-stdio";

/// One of the agents this module knows how to configure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum McpClientId {
    /// Anthropic's command-line agent.
    ClaudeCode,
    /// The Cursor editor.
    Cursor,
    /// Anthropic's desktop application.
    ClaudeDesktop,
}

impl McpClientId {
    /// Every client, in the order the settings panel shows them.
    pub const ALL: [Self; 3] = [Self::ClaudeCode, Self::Cursor, Self::ClaudeDesktop];

    /// The name a person reads.
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::ClaudeCode => "Claude Code",
            Self::Cursor => "Cursor",
            Self::ClaudeDesktop => "Claude Desktop",
        }
    }
}

/// What a client needs in order to reach this engine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    /// The streamable HTTP address, `http://127.0.0.1:<port>/mcp`.
    pub url: String,
    /// The bearer token the server checks.
    pub token: String,
    /// The executable Claude Desktop should launch for a stdio session.
    pub executable: PathBuf,
}

/// One client as the settings panel sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpClient {
    /// Which client this is.
    pub id: McpClientId,
    /// The name a person reads.
    pub name: String,
    /// Whether the client looks installed on this machine.
    pub detected: bool,
    /// The file this module reads and writes.
    pub config_path: String,
    /// Whether `mcpServers.bitwright` is already present.
    pub registered: bool,
}

/// A refusal the settings panel can switch on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientError {
    /// A stable code, such as `client.config_invalid`.
    pub code: String,
    /// The detail, which names the file involved.
    pub message: String,
}

impl ClientError {
    /// The file exists but is not JSON this module is willing to rewrite.
    fn config_invalid(path: &Path, error: &serde_json::Error) -> Self {
        Self {
            code: "client.config_invalid".to_string(),
            message: format!("{} is not valid JSON: {error}", path.display()),
        }
    }

    /// The file parsed, but a key this module needs has the wrong shape.
    fn wrong_shape(path: &Path) -> Self {
        Self {
            code: "client.config_invalid".to_string(),
            message: format!(
                "{} has a {SERVERS_KEY} that is not an object",
                path.display()
            ),
        }
    }

    /// The file could not be read or written.
    fn io(path: &Path, error: &io::Error) -> Self {
        Self {
            code: "client.io".to_string(),
            message: format!("{}: {error}", path.display()),
        }
    }

    /// The value could not be rendered as JSON.
    fn serialize(path: &Path, error: &serde_json::Error) -> Self {
        Self {
            code: "client.config_invalid".to_string(),
            message: format!("{} could not be written: {error}", path.display()),
        }
    }
}

impl std::fmt::Display for ClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for ClientError {}

/// Where a client keeps its configuration, and the directory that says it is
/// installed.
///
/// `None` when the platform has no home or configuration directory to speak of.
#[must_use]
pub fn locations(id: McpClientId) -> Option<(PathBuf, PathBuf)> {
    let home = dirs::home_dir()?;
    let config = dirs::config_dir()?;
    Some(locations_in(id, &home, &config))
}

/// Where a client keeps its configuration, given the home and configuration
/// directories to resolve against.
#[must_use]
pub fn locations_in(id: McpClientId, home: &Path, config: &Path) -> (PathBuf, PathBuf) {
    match id {
        McpClientId::ClaudeCode => {
            let dir = home.join(".claude");
            (home.join(".claude.json"), dir)
        }
        McpClientId::Cursor => {
            let dir = home.join(".cursor");
            (dir.join("mcp.json"), dir)
        }
        McpClientId::ClaudeDesktop => {
            let dir = config.join("Claude");
            (dir.join("claude_desktop_config.json"), dir)
        }
    }
}

/// Whether a client looks installed: its file or its directory is there.
#[must_use]
pub fn is_detected(config_path: &Path, config_dir: &Path) -> bool {
    config_path.exists() || config_dir.exists()
}

/// Whether `mcpServers.bitwright` is present.
///
/// # Errors
///
/// Returns [`ClientError`] with code `client.config_invalid` when the file
/// exists but does not parse.
pub fn is_registered(config_path: &Path) -> Result<bool, ClientError> {
    let config = read_config(config_path)?;
    Ok(config
        .get(SERVERS_KEY)
        .and_then(|servers| servers.get(ENTRY_KEY))
        .is_some())
}

/// Adds or replaces this engine's entry, leaving every other key alone.
///
/// # Errors
///
/// Returns [`ClientError`] when the file does not parse, when `mcpServers` is
/// not an object, or when the file cannot be written.
pub fn register(
    config_path: &Path,
    id: McpClientId,
    endpoint: &Endpoint,
) -> Result<(), ClientError> {
    let mut config = read_config(config_path)?;
    let root = config
        .as_object_mut()
        .ok_or_else(|| ClientError::wrong_shape(config_path))?;

    let servers = root
        .entry(SERVERS_KEY.to_string())
        .or_insert_with(|| json!({}));
    let servers = servers
        .as_object_mut()
        .ok_or_else(|| ClientError::wrong_shape(config_path))?;
    servers.insert(ENTRY_KEY.to_string(), entry_for(id, endpoint));

    write_config(config_path, &config)
}

/// Removes this engine's entry, leaving every other key alone.
///
/// A file that is not there, or that has no entry to remove, is left exactly as
/// it was.
///
/// # Errors
///
/// Returns [`ClientError`] when the file does not parse or cannot be written.
pub fn unregister(config_path: &Path) -> Result<(), ClientError> {
    if !config_path.exists() {
        return Ok(());
    }

    let mut config = read_config(config_path)?;
    let removed = config
        .get_mut(SERVERS_KEY)
        .and_then(|servers| servers.as_object_mut())
        .is_some_and(|servers| servers.remove(ENTRY_KEY).is_some());

    if removed {
        write_config(config_path, &config)?;
    }
    Ok(())
}

/// A pretty-printed snippet for a client this module does not know.
#[must_use]
pub fn manual_config(endpoint: &Endpoint) -> String {
    let snippet = json!({ SERVERS_KEY: { ENTRY_KEY: http_entry(endpoint) } });
    serde_json::to_string_pretty(&snippet).unwrap_or_else(|_| snippet.to_string())
}

/// The entry a client expects, which differs by how it reaches the server.
fn entry_for(id: McpClientId, endpoint: &Endpoint) -> Value {
    match id {
        McpClientId::ClaudeCode => http_entry(endpoint),
        McpClientId::Cursor => json!({
            "url": endpoint.url,
            "headers": { "Authorization": format!("Bearer {}", endpoint.token) },
        }),
        McpClientId::ClaudeDesktop => json!({
            "command": endpoint.executable.to_string_lossy(),
            "args": [STDIO_FLAG],
        }),
    }
}

/// The streamable HTTP entry, with the type Claude Code wants spelled out.
fn http_entry(endpoint: &Endpoint) -> Value {
    json!({
        "type": "http",
        "url": endpoint.url,
        "headers": { "Authorization": format!("Bearer {}", endpoint.token) },
    })
}

/// Reads a client's file, treating a missing or empty one as an empty object.
///
/// # Errors
///
/// Returns [`ClientError`] with code `client.config_invalid` when the file
/// exists and does not parse, or `client.io` when it cannot be read.
fn read_config(path: &Path) -> Result<Value, ClientError> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(json!({})),
        Err(error) => return Err(ClientError::io(path, &error)),
    };

    if text.trim().is_empty() {
        return Ok(json!({}));
    }

    serde_json::from_str(&text).map_err(|error| ClientError::config_invalid(path, &error))
}

/// Writes a client's file atomically, keeping a backup the first time.
///
/// The bytes go to a temporary file beside the destination and are then renamed
/// over it, so a process that dies mid-write leaves the previous file intact.
/// The previous file is copied to a `.bak` beside it the first time this module
/// changes it, and that backup is never overwritten afterwards.
///
/// # Errors
///
/// Returns [`ClientError`] when the directory cannot be created, or the file
/// cannot be serialized, backed up, written or renamed.
fn write_config(path: &Path, value: &Value) -> Result<(), ClientError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| ClientError::io(path, &error))?;
    }

    let body = serde_json::to_string_pretty(value)
        .map_err(|error| ClientError::serialize(path, &error))?;

    let backup = backup_path(path);
    if path.exists() && !backup.exists() {
        fs::copy(path, &backup).map_err(|error| ClientError::io(path, &error))?;
    }

    let temporary = temporary_path(path);
    fs::write(&temporary, body).map_err(|error| ClientError::io(path, &error))?;
    fs::rename(&temporary, path).map_err(|error| ClientError::io(path, &error))
}

/// The `.bak` file that sits beside a client's configuration.
fn backup_path(path: &Path) -> PathBuf {
    sibling(path, ".bak")
}

/// The temporary file a write goes through before it replaces the real one.
fn temporary_path(path: &Path) -> PathBuf {
    sibling(path, ".tmp")
}

/// A path beside `path` whose file name carries `suffix`.
fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    path.with_file_name(name)
}

/// Describes one client, resolving its real paths.
///
/// A file that cannot be parsed is reported as not registered rather than
/// failing the whole list; registering it will surface the parse error.
///
/// # Errors
///
/// Returns a message when the platform has no home or configuration directory.
pub fn describe(id: McpClientId) -> Result<McpClient, String> {
    let (home, config) = (
        dirs::home_dir().ok_or_else(|| {
            format!(
                "client.unsupported: no configuration directory for {}",
                id.name()
            )
        })?,
        dirs::config_dir().ok_or_else(|| {
            format!(
                "client.unsupported: no configuration directory for {}",
                id.name()
            )
        })?,
    );
    describe_in(id, &home, &config)
}

/// [`describe`]'s body, taking the home and configuration directories to
/// resolve against instead of reading them from the platform, the same way
/// [`locations_in`] does for [`locations`]. This is what makes `describe`
/// exercisable against a temporary directory instead of the real, live
/// configuration a person's machine happens to have.
fn describe_in(id: McpClientId, home: &Path, config: &Path) -> Result<McpClient, String> {
    let (config_path, config_dir) = locations_in(id, home, config);

    Ok(McpClient {
        id,
        name: id.name().to_string(),
        detected: is_detected(&config_path, &config_dir),
        config_path: config_path.to_string_lossy().into_owned(),
        registered: is_registered(&config_path).unwrap_or(false),
    })
}

/// The endpoint a client needs, read from the running server.
///
/// # Errors
///
/// Returns a message when the server is not running, or when the path of the
/// running executable cannot be read.
fn endpoint_from<R: Runtime>(app: &AppHandle<R>) -> Result<Endpoint, String> {
    let (url, token) = app.state::<McpServerState>().endpoint().ok_or_else(|| {
        "mcp.server_off: start the MCP server before configuring a client".to_string()
    })?;

    let executable =
        std::env::current_exe().map_err(|error| format!("client.executable: {error}"))?;

    Ok(Endpoint {
        url,
        token,
        executable,
    })
}

/// Lists the clients this module knows, with their detection and registration.
///
/// # Errors
///
/// Returns a message when the platform has no home or configuration directory.
#[tauri::command]
pub async fn mcp_clients() -> Result<Vec<McpClient>, String> {
    McpClientId::ALL.into_iter().map(describe).collect()
}

/// Points one client at this engine.
///
/// # Errors
///
/// Returns a message when the server is not running, when the client's file
/// does not parse, or when it cannot be written.
#[tauri::command]
pub async fn mcp_client_register<R: Runtime>(
    app: AppHandle<R>,
    id: McpClientId,
) -> Result<McpClient, String> {
    let endpoint = endpoint_from(&app)?;
    let (config_path, _) = locations(id).ok_or_else(|| {
        format!(
            "client.unsupported: no configuration directory for {}",
            id.name()
        )
    })?;

    register(&config_path, id, &endpoint).map_err(|error| error.to_string())?;
    describe(id)
}

/// Takes this engine back out of one client.
///
/// # Errors
///
/// Returns a message when the client's file does not parse or cannot be written.
#[tauri::command]
pub async fn mcp_client_unregister(id: McpClientId) -> Result<McpClient, String> {
    let (config_path, _) = locations(id).ok_or_else(|| {
        format!(
            "client.unsupported: no configuration directory for {}",
            id.name()
        )
    })?;

    unregister(&config_path).map_err(|error| error.to_string())?;
    describe(id)
}

/// A snippet for a client this module does not know.
///
/// # Errors
///
/// Returns a message when the server is not running.
#[tauri::command]
pub async fn mcp_manual_config<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let endpoint = endpoint_from(&app)?;
    Ok(manual_config(&endpoint))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// A fresh directory under the system temporary directory.
    fn temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the clock is after the epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "bitwright-clients-{label}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("a temporary directory can be made");
        path
    }

    #[test]
    fn locations_in_detects_only_present_clients() {
        let home = temp_dir("home");
        let config = temp_dir("config");

        for id in McpClientId::ALL {
            let (path, dir) = locations_in(id, &home, &config);
            assert!(!is_detected(&path, &dir), "{} is absent", id.name());
        }

        let claude_dir = home.join(".claude");
        fs::create_dir_all(&claude_dir).expect("the claude directory can be made");

        let (path, dir) = locations_in(McpClientId::ClaudeCode, &home, &config);
        assert_eq!(dir, claude_dir);
        assert!(is_detected(&path, &dir), "claude code is detected");

        for id in [McpClientId::Cursor, McpClientId::ClaudeDesktop] {
            let (path, dir) = locations_in(id, &home, &config);
            assert!(!is_detected(&path, &dir), "{} is absent", id.name());
        }

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&config).ok();
    }

    /// The endpoint the tests configure clients with.
    fn endpoint() -> Endpoint {
        Endpoint {
            url: "http://127.0.0.1:4321/mcp".to_string(),
            token: "abc123".to_string(),
            executable: PathBuf::from("/opt/bitwright/bitwright"),
        }
    }

    /// Reads a file back as JSON.
    fn read(path: &Path) -> Value {
        let text = fs::read_to_string(path).expect("the file was written");
        serde_json::from_str(&text).expect("the file is JSON")
    }

    #[test]
    fn register_and_unregister_round_trip_for_every_client() {
        for id in McpClientId::ALL {
            let dir = temp_dir(id.name());
            let path = dir.join("config.json");

            assert!(!is_registered(&path).expect("a missing file is not registered"));
            register(&path, id, &endpoint()).expect("registering writes the file");
            assert!(is_registered(&path).expect("the entry is there"));
            unregister(&path).expect("unregistering rewrites the file");
            assert!(!is_registered(&path).expect("the entry is gone"));

            fs::remove_dir_all(&dir).ok();
        }
    }

    #[test]
    fn each_client_gets_the_entry_its_launcher_expects() {
        let endpoint = endpoint();
        let dir = temp_dir("shapes");

        let code = dir.join("claude-code.json");
        register(&code, McpClientId::ClaudeCode, &endpoint).expect("claude code is written");
        let entry = read(&code)["mcpServers"]["bitwright"].clone();
        assert_eq!(entry["type"], "http");
        assert_eq!(entry["url"], endpoint.url);
        assert_eq!(entry["headers"]["Authorization"], "Bearer abc123");

        let cursor = dir.join("cursor.json");
        register(&cursor, McpClientId::Cursor, &endpoint).expect("cursor is written");
        let entry = read(&cursor)["mcpServers"]["bitwright"].clone();
        assert!(entry.get("type").is_none());
        assert_eq!(entry["url"], endpoint.url);
        assert_eq!(entry["headers"]["Authorization"], "Bearer abc123");

        let desktop = dir.join("claude-desktop.json");
        register(&desktop, McpClientId::ClaudeDesktop, &endpoint).expect("desktop is written");
        let entry = read(&desktop)["mcpServers"]["bitwright"].clone();
        assert_eq!(entry["command"], "/opt/bitwright/bitwright");
        assert_eq!(entry["args"][0], "--mcp-stdio");
        assert!(entry.get("url").is_none());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unrelated_keys_survive_a_register_and_an_unregister() {
        let dir = temp_dir("keys");
        let path = dir.join("config.json");
        fs::write(
            &path,
            r#"{"theme":"dark","mcpServers":{"other":{"url":"http://x"}},"nested":{"a":[1,2]}}"#,
        )
        .expect("the fixture is written");

        register(&path, McpClientId::Cursor, &endpoint()).expect("registering keeps the rest");
        let value = read(&path);
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["mcpServers"]["other"]["url"], "http://x");
        assert_eq!(value["nested"]["a"][1], 2);
        assert!(value["mcpServers"]["bitwright"].is_object());

        unregister(&path).expect("unregistering keeps the rest");
        let value = read(&path);
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["mcpServers"]["other"]["url"], "http://x");
        assert_eq!(value["nested"]["a"][1], 2);
        assert!(value["mcpServers"].get("bitwright").is_none());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn invalid_json_is_refused_and_left_untouched() {
        let dir = temp_dir("invalid");
        let path = dir.join("config.json");
        let broken = "{ this is not json";
        fs::write(&path, broken).expect("the fixture is written");

        let error = register(&path, McpClientId::ClaudeCode, &endpoint())
            .expect_err("a broken file is refused");
        assert_eq!(error.code, "client.config_invalid");
        assert!(
            error.message.contains(&path.display().to_string()),
            "the message names the path: {}",
            error.message
        );
        assert_eq!(fs::read_to_string(&path).expect("still there"), broken);

        let error = unregister(&path).expect_err("a broken file is refused");
        assert_eq!(error.code, "client.config_invalid");
        assert_eq!(fs::read_to_string(&path).expect("still there"), broken);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_first_change_keeps_a_backup_of_the_previous_file() {
        let dir = temp_dir("backup");
        let path = dir.join("config.json");
        fs::write(&path, r#"{"theme":"dark"}"#).expect("the fixture is written");

        register(&path, McpClientId::Cursor, &endpoint()).expect("registering writes the file");
        let backup = backup_path(&path);
        assert!(backup.exists(), "the previous file was kept");
        assert_eq!(
            fs::read_to_string(&backup).expect("the backup is readable"),
            r#"{"theme":"dark"}"#
        );

        register(&path, McpClientId::Cursor, &endpoint()).expect("a second write succeeds");
        assert_eq!(
            fs::read_to_string(&backup).expect("the backup is readable"),
            r#"{"theme":"dark"}"#,
            "the backup is not overwritten"
        );

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_manual_snippet_carries_the_live_url_and_token() {
        let endpoint = endpoint();
        let snippet = manual_config(&endpoint);
        let value: Value = serde_json::from_str(&snippet).expect("the snippet is JSON");

        assert_eq!(value["mcpServers"]["bitwright"]["type"], "http");
        assert_eq!(value["mcpServers"]["bitwright"]["url"], endpoint.url);
        assert_eq!(
            value["mcpServers"]["bitwright"]["headers"]["Authorization"],
            "Bearer abc123"
        );
        assert!(snippet.contains('\n'), "the snippet is pretty-printed");

        let other = Endpoint {
            url: "http://127.0.0.1:9999/mcp".to_string(),
            token: "zzz".to_string(),
            executable: PathBuf::from("/bin/bitwright"),
        };
        let snippet = manual_config(&other);
        assert!(snippet.contains("http://127.0.0.1:9999/mcp"));
        assert!(snippet.contains("Bearer zzz"));
    }

    #[test]
    fn a_client_is_detected_when_its_file_or_directory_exists() {
        let dir = temp_dir("detect");
        let config = dir.join("config.json");
        let config_dir = dir.join("nested");

        assert!(!is_detected(&config, &config_dir));
        fs::create_dir_all(&config_dir).expect("the directory is made");
        assert!(is_detected(&config, &config_dir));
        fs::remove_dir_all(&config_dir).expect("the directory is removed");
        fs::write(&config, "{}").expect("the file is written");
        assert!(is_detected(&config, &config_dir));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unregistering_a_missing_file_writes_nothing() {
        let dir = temp_dir("missing");
        let path = dir.join("config.json");

        unregister(&path).expect("a missing file is not an error");
        assert!(!path.exists(), "no file is created");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_empty_file_is_treated_as_an_empty_object() {
        let dir = temp_dir("empty");
        let path = dir.join("config.json");
        fs::write(&path, "   \n").expect("the fixture is written");

        register(&path, McpClientId::Cursor, &endpoint()).expect("registering writes the file");
        assert!(is_registered(&path).expect("the entry is there"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn registering_creates_the_directory_it_needs() {
        let dir = temp_dir("nested");
        let path = dir.join("a").join("b").join("config.json");

        register(&path, McpClientId::ClaudeCode, &endpoint()).expect("the parents are made");
        assert!(path.exists());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_client_serializes_with_camel_case_fields() {
        let client = McpClient {
            id: McpClientId::ClaudeDesktop,
            name: "Claude Desktop".to_string(),
            detected: true,
            config_path: "/tmp/claude_desktop_config.json".to_string(),
            registered: false,
        };
        let value = serde_json::to_value(&client).expect("a client is serializable");
        assert_eq!(value["id"], "claude-desktop");
        assert_eq!(value["name"], "Claude Desktop");
        assert_eq!(value["detected"], true);
        assert_eq!(value["configPath"], "/tmp/claude_desktop_config.json");
        assert_eq!(value["registered"], false);
    }

    #[test]
    fn describe_in_reports_each_known_client_against_a_temp_config_dir() {
        let home = temp_dir("describe-home");
        let config = temp_dir("describe-config");

        for id in McpClientId::ALL {
            let described = describe_in(id, &home, &config).expect("a temp location resolves");
            assert_eq!(described.id, id);
            assert_eq!(described.name, id.name());
            assert!(!described.detected, "{} starts undetected", id.name());
            assert!(!described.registered, "{} starts unregistered", id.name());
            let (expected_path, _) = locations_in(id, &home, &config);
            assert_eq!(described.config_path, expected_path.to_string_lossy());
        }

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&config).ok();
    }

    #[test]
    fn describe_in_reflects_detection_and_registration_after_a_register() {
        let home = temp_dir("describe-register-home");
        let config = temp_dir("describe-register-config");

        for id in McpClientId::ALL {
            let (config_path, _) = locations_in(id, &home, &config);
            register(&config_path, id, &endpoint()).expect("registering writes the file");
            let described = describe_in(id, &home, &config).expect("a temp location resolves");
            assert!(described.detected, "{} is now detected", id.name());
            assert!(described.registered, "{} is now registered", id.name());
        }

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&config).ok();
    }

    #[test]
    fn every_client_id_round_trips_through_serde() {
        for id in McpClientId::ALL {
            let value = serde_json::to_value(id).expect("an id is serializable");
            let back: McpClientId = serde_json::from_value(value).expect("an id is deserializable");
            assert_eq!(back, id);
        }
        assert_eq!(
            serde_json::to_value(McpClientId::ClaudeCode).expect("serializable"),
            "claude-code"
        );
    }
}
