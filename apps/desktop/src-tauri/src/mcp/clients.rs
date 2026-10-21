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
//! Each client keeps its servers in a file of its own: JSON with an
//! `mcpServers` map for most, TOML with `[mcp_servers.<name>]` tables for
//! Codex. This module reads that file, changes only the `bitwright` entry, and
//! writes it back without disturbing anything else the person or another tool
//! put there. The work is done by plain functions that take a path and an
//! endpoint, so the whole thing can be exercised against a temporary
//! directory; the Tauri commands at the bottom only resolve the real paths and
//! read the live endpoint from the running server.
//!
//! Each client gets the entry shape it reads. Claude Code, Cursor and Windsurf
//! speak streamable HTTP and get the loopback URL. Claude Desktop and Codex
//! launch servers as child processes and get `bitwright --mcp-stdio`, which
//! bridges to the running app when it is open (see `stdio.rs`), so their
//! entries stay valid whatever port the app later binds.
//!
//! Claude Desktop needs one more thing. It keeps its own preferences in the
//! same `claude_desktop_config.json`, holds a copy in memory while it runs, and
//! writes that copy back whenever a preference changes, which silently drops
//! an entry written behind its back. So the row reports whether Claude Desktop
//! is running, and the panel asks for a full quit and reopen, and re-reads the
//! file when the window regains focus so a lost entry shows as lost.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};

use crate::mcp::server::McpServerState;

/// The key the JSON clients use for the map of servers they know.
const SERVERS_KEY: &str = "mcpServers";

/// The table Codex keeps its servers under.
const TOML_SERVERS_TABLE: &str = "mcp_servers";

/// The key this engine claims inside that map.
const ENTRY_KEY: &str = "bitwright";

/// The argument a client passes to a stdio server it launches.
const STDIO_FLAG: &str = "--mcp-stdio";

/// One of the agents this module knows how to configure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum McpClientId {
    /// Anthropic's command-line agent.
    ClaudeCode,
    /// Anthropic's desktop application.
    ClaudeDesktop,
    /// The Cursor editor.
    Cursor,
    /// The Windsurf editor.
    Windsurf,
    /// OpenAI's command-line agent.
    Codex,
}

/// How a client reaches the server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Launch {
    /// It connects to the loopback URL, which needs the server running.
    Http,
    /// It spawns `bitwright --mcp-stdio` itself.
    Stdio,
}

impl McpClientId {
    /// Every client, in the order the settings panel shows them.
    pub const ALL: [Self; 5] = [
        Self::ClaudeCode,
        Self::ClaudeDesktop,
        Self::Cursor,
        Self::Windsurf,
        Self::Codex,
    ];

    /// The name a person reads.
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::ClaudeCode => "Claude Code",
            Self::ClaudeDesktop => "Claude Desktop",
            Self::Cursor => "Cursor",
            Self::Windsurf => "Windsurf",
            Self::Codex => "Codex",
        }
    }

    /// How this client reaches the server.
    #[must_use]
    pub fn launch(self) -> Launch {
        match self {
            Self::ClaudeCode | Self::Cursor | Self::Windsurf => Launch::Http,
            Self::ClaudeDesktop | Self::Codex => Launch::Stdio,
        }
    }

    /// Whether the client's file is TOML rather than JSON.
    fn is_toml(self) -> bool {
        matches!(self, Self::Codex)
    }
}

/// What a client needs in order to reach this engine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    /// The streamable HTTP address, `http://127.0.0.1:<port>/mcp`, when the
    /// server is running. A stdio client does not need it.
    pub url: Option<String>,
    /// The executable a stdio client should launch.
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
    /// How it reaches the server.
    pub launch: Launch,
    /// Whether the client looks installed on this machine.
    pub detected: bool,
    /// The file this module reads and writes.
    pub config_path: String,
    /// Whether the `bitwright` entry is present in that file right now.
    pub registered: bool,
    /// Whether the client is running and has to be fully quit and reopened to
    /// load the entry. Only ever true for Claude Desktop, the one client that
    /// rewrites its file from memory.
    pub needs_restart: bool,
    /// Whether a stdio client is still launching an older build of the
    /// launcher copy because it holds that file open. Quitting the client lets
    /// the next app start replace the copy.
    pub launcher_stale: bool,
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
    /// The file exists but is not JSON or TOML this module is willing to
    /// rewrite.
    fn config_invalid(path: &Path, error: &dyn std::fmt::Display) -> Self {
        Self {
            code: "client.config_invalid".to_string(),
            message: format!("{} does not parse: {error}", path.display()),
        }
    }

    /// The file parsed, but a key this module needs has the wrong shape.
    fn wrong_shape(path: &Path, key: &str) -> Self {
        Self {
            code: "client.config_invalid".to_string(),
            message: format!("{} has a {key} that is not a table", path.display()),
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

    /// An HTTP client was asked for while nothing is listening.
    fn server_off() -> Self {
        Self {
            code: "mcp.server_off".to_string(),
            message: "start the MCP server before configuring an HTTP client".to_string(),
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
///
/// `config` is the platform's configuration directory: `%APPDATA%` on
/// Windows, `~/Library/Application Support` on macOS and `~/.config` on Linux,
/// which is where Claude Desktop keeps its folder on each.
#[must_use]
pub fn locations_in(id: McpClientId, home: &Path, config: &Path) -> (PathBuf, PathBuf) {
    match id {
        McpClientId::ClaudeCode => (home.join(".claude.json"), home.join(".claude")),
        McpClientId::ClaudeDesktop => {
            let dir = config.join("Claude");
            (dir.join("claude_desktop_config.json"), dir)
        }
        McpClientId::Cursor => {
            let dir = home.join(".cursor");
            (dir.join("mcp.json"), dir)
        }
        McpClientId::Windsurf => {
            let dir = home.join(".codeium").join("windsurf");
            (dir.join("mcp_config.json"), dir)
        }
        McpClientId::Codex => {
            let dir = home.join(".codex");
            (dir.join("config.toml"), dir)
        }
    }
}

/// Whether a client looks installed: its file or its directory is there.
#[must_use]
pub fn is_detected(config_path: &Path, config_dir: &Path) -> bool {
    config_path.exists() || config_dir.exists()
}

/// Whether the `bitwright` entry is present.
///
/// # Errors
///
/// Returns [`ClientError`] with code `client.config_invalid` when the file
/// exists but does not parse.
pub fn is_registered(config_path: &Path, id: McpClientId) -> Result<bool, ClientError> {
    if id.is_toml() {
        let document = read_toml(config_path)?;
        return Ok(document
            .get(TOML_SERVERS_TABLE)
            .and_then(toml_edit::Item::as_table_like)
            .is_some_and(|servers| servers.contains_key(ENTRY_KEY)));
    }

    let config = read_json(config_path)?;
    Ok(config
        .get(SERVERS_KEY)
        .and_then(|servers| servers.get(ENTRY_KEY))
        .is_some())
}

/// Adds or replaces this engine's entry, leaving every other key alone.
///
/// # Errors
///
/// Returns [`ClientError`] when an HTTP client is asked for without a URL,
/// when the file does not parse, when the server map is not a table, or when
/// the file cannot be written.
pub fn register(
    config_path: &Path,
    id: McpClientId,
    endpoint: &Endpoint,
) -> Result<(), ClientError> {
    if id.launch() == Launch::Http && endpoint.url.is_none() {
        return Err(ClientError::server_off());
    }

    if id.is_toml() {
        return register_toml(config_path, endpoint);
    }

    let mut config = read_json(config_path)?;
    let root = config
        .as_object_mut()
        .ok_or_else(|| ClientError::wrong_shape(config_path, "root"))?;

    let servers = root
        .entry(SERVERS_KEY.to_string())
        .or_insert_with(|| json!({}));
    let servers = servers
        .as_object_mut()
        .ok_or_else(|| ClientError::wrong_shape(config_path, SERVERS_KEY))?;
    servers.insert(ENTRY_KEY.to_string(), entry_for(id, endpoint));

    write_json(config_path, &config)
}

/// Removes this engine's entry, leaving every other key alone.
///
/// A file that is not there, or that has no entry to remove, is left exactly as
/// it was.
///
/// # Errors
///
/// Returns [`ClientError`] when the file does not parse or cannot be written.
pub fn unregister(config_path: &Path, id: McpClientId) -> Result<(), ClientError> {
    if !config_path.exists() {
        return Ok(());
    }

    if id.is_toml() {
        let mut document = read_toml(config_path)?;
        let removed = document
            .get_mut(TOML_SERVERS_TABLE)
            .and_then(toml_edit::Item::as_table_like_mut)
            .is_some_and(|servers| servers.remove(ENTRY_KEY).is_some());
        if removed {
            write_text(config_path, &document.to_string())?;
        }
        return Ok(());
    }

    let mut config = read_json(config_path)?;
    let removed = config
        .get_mut(SERVERS_KEY)
        .and_then(|servers| servers.as_object_mut())
        .is_some_and(|servers| servers.remove(ENTRY_KEY).is_some());

    if removed {
        write_json(config_path, &config)?;
    }
    Ok(())
}

/// Folder under the data root that holds the launcher copy.
const LAUNCHER_DIR: &str = "mcp";

/// The stable copy of the executable that stdio clients launch.
///
/// A client keeps `bitwright --mcp-stdio` alive for as long as it runs, and on
/// Windows a running executable cannot be replaced. Pointing clients at the
/// app's own file would make every rebuild or update fail while one is open,
/// so they get this copy instead. It needs nothing beside it: `stdio.rs`
/// resolves the data root, settings and `mcp.json` from the user's directories,
/// never from the executable's folder.
#[must_use]
pub fn launcher_path(data_root: &Path) -> PathBuf {
    let name = if cfg!(windows) {
        "bitwright-mcp.exe"
    } else {
        "bitwright-mcp"
    };
    data_root.join(LAUNCHER_DIR).join(name)
}

/// What [`sync_launcher`] found and did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LauncherSync {
    /// The copy was missing or different and has been replaced.
    Copied,
    /// The copy already matches the running executable.
    Current,
    /// The copy differs but is in use, so the old one was kept.
    Locked,
}

/// Whether two files look like the same build: same size and modified time.
fn same_build(source: &Path, copy: &Path) -> bool {
    let (Ok(a), Ok(b)) = (fs::metadata(source), fs::metadata(copy)) else {
        return false;
    };
    a.len() == b.len()
        && match (a.modified(), b.modified()) {
            (Ok(x), Ok(y)) => x == y,
            _ => false,
        }
}

/// Copies `source` to `dest` via a temporary file and a rename, so a failure
/// never leaves a half-written launcher, and gives it the source's modified
/// time so [`same_build`] recognises it next time.
fn copy_launcher(source: &Path, dest: &Path) -> io::Result<()> {
    let temporary = sibling(dest, ".new");
    let result = (|| {
        fs::copy(source, &temporary)?;
        let modified = fs::metadata(source)?.modified()?;
        fs::OpenOptions::new()
            .write(true)
            .open(&temporary)?
            .set_modified(modified)?;
        fs::rename(&temporary, dest)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

/// Brings the launcher copy up to date with `source`.
///
/// # Errors
///
/// Returns [`ClientError`] only when there is no copy at all and one cannot be
/// made. A copy that cannot be replaced because it is in use is not an error:
/// the old one keeps working and the result is [`LauncherSync::Locked`].
pub fn sync_launcher(source: &Path, dest: &Path) -> Result<LauncherSync, ClientError> {
    sync_launcher_with(source, dest, copy_launcher)
}

/// [`sync_launcher`] with the copy step injected, so a locked file can be
/// simulated on any platform.
fn sync_launcher_with(
    source: &Path,
    dest: &Path,
    copy: impl FnOnce(&Path, &Path) -> io::Result<()>,
) -> Result<LauncherSync, ClientError> {
    if same_build(source, dest) {
        return Ok(LauncherSync::Current);
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|error| ClientError::io(parent, &error))?;
    }
    match copy(source, dest) {
        Ok(()) => Ok(LauncherSync::Copied),
        Err(_) if dest.exists() => Ok(LauncherSync::Locked),
        Err(error) => Err(ClientError::io(dest, &error)),
    }
}

/// The `command` of this engine's entry, when there is one.
fn entry_command(config_path: &Path, id: McpClientId) -> Option<String> {
    if id.is_toml() {
        let document = read_toml(config_path).ok()?;
        return document
            .get(TOML_SERVERS_TABLE)?
            .as_table_like()?
            .get(ENTRY_KEY)?
            .as_table_like()?
            .get("command")?
            .as_str()
            .map(str::to_string);
    }
    let config = read_json(config_path).ok()?;
    config
        .get(SERVERS_KEY)?
        .get(ENTRY_KEY)?
        .get("command")?
        .as_str()
        .map(str::to_string)
}

/// Keeps every registered stdio client pointed at the launcher copy.
///
/// Runs at app start. Refreshes the copy when any stdio client is registered,
/// and rewrites an entry that still names the app's own executable (how older
/// versions registered it). Only the `bitwright` entry is touched. Returns the
/// ids whose entry was rewritten.
pub fn refresh_stdio_registrations(
    source: &Path,
    data_root: &Path,
    home: &Path,
    config: &Path,
) -> Vec<McpClientId> {
    let launcher = launcher_path(data_root);
    let endpoint = Endpoint {
        url: None,
        executable: launcher.clone(),
    };
    let mut rewritten = Vec::new();
    let mut synced = false;

    for id in McpClientId::ALL
        .into_iter()
        .filter(|id| id.launch() == Launch::Stdio)
    {
        let (config_path, _) = locations_in(id, home, config);
        if !is_registered(&config_path, id).unwrap_or(false) {
            continue;
        }
        if !synced {
            synced = true;
            if let Err(error) = sync_launcher(source, &launcher) {
                log::warn!("could not prepare the MCP launcher: {error}");
                return rewritten;
            }
        }
        let current = entry_command(&config_path, id);
        if current.as_deref() != Some(&*launcher.to_string_lossy()) {
            match register(&config_path, id, &endpoint) {
                Ok(()) => rewritten.push(id),
                Err(error) => log::warn!("could not update {}: {error}", id.name()),
            }
        }
    }
    rewritten
}

/// Refreshes stdio registrations against the real platform directories.
pub fn refresh_stdio_registrations_for_platform(data_root: &Path) {
    let (Some(home), Some(config), Ok(source)) = (
        dirs::home_dir(),
        dirs::config_dir(),
        std::env::current_exe(),
    ) else {
        return;
    };
    for id in refresh_stdio_registrations(&source, data_root, &home, &config) {
        log::info!("{} now launches the stable MCP launcher", id.name());
    }
}

/// A pretty-printed snippet for a client this module does not know.
///
/// The HTTP form, because nearly every client reads it, with no credential in
/// it because the server asks for none.
#[must_use]
pub fn manual_config(url: &str) -> String {
    let snippet = json!({ SERVERS_KEY: { ENTRY_KEY: { "type": "http", "url": url } } });
    serde_json::to_string_pretty(&snippet).unwrap_or_else(|_| snippet.to_string())
}

/// The JSON entry a client expects, which differs by how it reaches the
/// server and which key it reads the address from.
fn entry_for(id: McpClientId, endpoint: &Endpoint) -> Value {
    let url = endpoint.url.clone().unwrap_or_default();
    match id {
        // Claude Code wants the transport spelled out.
        McpClientId::ClaudeCode => json!({ "type": "http", "url": url }),
        McpClientId::Cursor => json!({ "url": url }),
        // Windsurf reads a remote server's address from `serverUrl`.
        McpClientId::Windsurf => json!({ "serverUrl": url }),
        McpClientId::ClaudeDesktop | McpClientId::Codex => json!({
            "command": endpoint.executable.to_string_lossy(),
            "args": [STDIO_FLAG],
        }),
    }
}

/// Writes `[mcp_servers.bitwright]` into a Codex file, keeping every other
/// table, key, comment and blank line exactly as they were.
fn register_toml(config_path: &Path, endpoint: &Endpoint) -> Result<(), ClientError> {
    let mut document = read_toml(config_path)?;

    let servers = document
        .as_table_mut()
        .entry(TOML_SERVERS_TABLE)
        .or_insert_with(|| {
            // Implicit, so only the `[mcp_servers.bitwright]` header is
            // written and no empty `[mcp_servers]` appears above it.
            let mut table = toml_edit::Table::new();
            table.set_implicit(true);
            toml_edit::Item::Table(table)
        })
        .as_table_mut()
        .ok_or_else(|| ClientError::wrong_shape(config_path, TOML_SERVERS_TABLE))?;

    let mut entry = toml_edit::Table::new();
    entry.insert(
        "command",
        toml_edit::value(endpoint.executable.to_string_lossy().as_ref()),
    );
    let mut args = toml_edit::Array::new();
    args.push(STDIO_FLAG);
    entry.insert("args", toml_edit::value(args));
    servers.insert(ENTRY_KEY, toml_edit::Item::Table(entry));

    write_text(config_path, &document.to_string())
}

/// Reads the text of a client's file, treating a missing one as empty.
fn read_text(path: &Path) -> Result<String, ClientError> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(ClientError::io(path, &error)),
    }
}

/// Reads a JSON client's file, treating a missing or empty one as an empty
/// object.
///
/// # Errors
///
/// Returns [`ClientError`] with code `client.config_invalid` when the file
/// exists and does not parse, or `client.io` when it cannot be read.
fn read_json(path: &Path) -> Result<Value, ClientError> {
    let text = read_text(path)?;
    if text.trim().is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(&text).map_err(|error| ClientError::config_invalid(path, &error))
}

/// Reads Codex's TOML file, treating a missing or empty one as an empty
/// document. A file that does not parse is refused rather than overwritten.
fn read_toml(path: &Path) -> Result<toml_edit::DocumentMut, ClientError> {
    let text = read_text(path)?;
    if text.trim().is_empty() {
        return Ok(toml_edit::DocumentMut::new());
    }
    text.parse::<toml_edit::DocumentMut>()
        .map_err(|error| ClientError::config_invalid(path, &error))
}

/// Renders a JSON client's file and writes it.
fn write_json(path: &Path, value: &Value) -> Result<(), ClientError> {
    let body = serde_json::to_string_pretty(value)
        .map_err(|error| ClientError::serialize(path, &error))?;
    write_text(path, &body)
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
/// cannot be backed up, written or renamed.
fn write_text(path: &Path, body: &str) -> Result<(), ClientError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| ClientError::io(path, &error))?;
    }

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

/// Whether an executable path belongs to Claude Desktop rather than to the
/// Claude Code command line, which on Windows is also called `claude.exe`.
///
/// Claude Desktop is an Electron app, so its executable sits beside a
/// `resources/app.asar`; the Squirrel install also lives under
/// `AnthropicClaude`, and the Store install under `WindowsApps`, where the
/// folder may not be listable, so those names count on their own.
#[must_use]
pub fn is_claude_desktop_executable(path: &Path) -> bool {
    let lower = path.to_string_lossy().to_ascii_lowercase();
    if lower.contains("anthropicclaude")
        || (lower.contains("windowsapps") && lower.contains("claude"))
    {
        return true;
    }
    path.parent()
        .is_some_and(|dir| dir.join("resources").join("app.asar").is_file())
}

/// Whether Claude Desktop is running right now.
///
/// Asked of the operating system each time the list is read, because the
/// answer changes the advice on the row. Any failure to ask reads as not
/// running, which only drops a hint; it never blocks a registration.
#[must_use]
pub fn claude_desktop_running() -> bool {
    #[cfg(target_os = "windows")]
    {
        windows_claude_desktop_running()
    }
    #[cfg(not(target_os = "windows"))]
    {
        // The desktop app's process is `Claude`; the command line is `claude`,
        // and `pgrep -x` is case-sensitive, so the two do not collide.
        std::process::Command::new("pgrep")
            .args(["-x", "Claude"])
            .output()
            .is_ok_and(|output| output.status.success())
    }
}

/// The Windows half of [`claude_desktop_running`].
///
/// `tasklist` answers quickly and settles the common case, nothing called
/// `claude.exe` at all. Only when something is, PowerShell is asked for the
/// paths, because the image name alone cannot tell the desktop app from the
/// command line.
#[cfg(target_os = "windows")]
fn windows_claude_desktop_running() -> bool {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    /// Keeps a console window from flashing up for each child process.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let listed = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq claude.exe", "/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    let Ok(listed) = listed else {
        return false;
    };
    if !String::from_utf8_lossy(&listed.stdout)
        .to_ascii_lowercase()
        .contains("claude.exe")
    {
        return false;
    }

    let paths = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-Process -Name claude -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    let Ok(paths) = paths else {
        return false;
    };
    String::from_utf8_lossy(&paths.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .any(|line| is_claude_desktop_executable(Path::new(line)))
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
    let unsupported = || {
        format!(
            "client.unsupported: no configuration directory for {}",
            id.name()
        )
    };
    let home = dirs::home_dir().ok_or_else(unsupported)?;
    let config = dirs::config_dir().ok_or_else(unsupported)?;
    let running = id == McpClientId::ClaudeDesktop && claude_desktop_running();
    let stale = launcher_is_stale(id);
    Ok(describe_in(id, &home, &config, running, stale))
}

/// [`describe`]'s body, taking the home and configuration directories to
/// resolve against instead of reading them from the platform, and whether the
/// client is running instead of asking, so it can be exercised against a
/// temporary directory instead of the configuration a person's machine
/// happens to have.
fn describe_in(
    id: McpClientId,
    home: &Path,
    config: &Path,
    running: bool,
    launcher_stale: bool,
) -> McpClient {
    let (config_path, config_dir) = locations_in(id, home, config);

    McpClient {
        id,
        name: id.name().to_string(),
        launch: id.launch(),
        detected: is_detected(&config_path, &config_dir),
        config_path: config_path.to_string_lossy().into_owned(),
        registered: is_registered(&config_path, id).unwrap_or(false),
        needs_restart: running || launcher_stale,
        launcher_stale,
    }
}

/// Whether a stdio client's launcher copy lags the running build.
fn launcher_is_stale(id: McpClientId) -> bool {
    if id.launch() != Launch::Stdio {
        return false;
    }
    let (Some(root), Ok(exe)) = (
        crate::preferences::data_root_without_app(),
        std::env::current_exe(),
    ) else {
        return false;
    };
    let launcher = launcher_path(&root);
    launcher.exists() && !same_build(&exe, &launcher)
}

/// The endpoint a client needs, read from the running server.
///
/// The URL is absent while the server is stopped, which only matters to the
/// HTTP clients; [`register`] refuses those then.
///
/// # Errors
///
/// Returns a message when the path of the running executable cannot be read.
fn endpoint_from<R: Runtime>(app: &AppHandle<R>) -> Result<Endpoint, String> {
    let url = app.state::<McpServerState>().endpoint();
    let source = std::env::current_exe().map_err(|error| format!("client.executable: {error}"))?;
    let root = crate::preferences::data_root_without_app()
        .ok_or_else(|| "client.unsupported: no data directory".to_string())?;
    // Stdio clients launch a stable copy, never the app's own file, which a
    // running client would lock against rebuilds and updates.
    let executable = launcher_path(&root);
    sync_launcher(&source, &executable).map_err(|error| error.to_string())?;
    Ok(Endpoint { url, executable })
}

/// Runs blocking file and process work off the async runtime's workers.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("client.io: {error}"))?
}

/// Lists the clients this module knows, with their detection and registration.
///
/// Read fresh from disk every time, never cached: the panel calls this when it
/// mounts and when the window regains focus, so an entry another program
/// removed shows as removed.
///
/// # Errors
///
/// Returns a message when the platform has no home or configuration directory.
#[tauri::command]
pub async fn mcp_clients() -> Result<Vec<McpClient>, String> {
    blocking(|| McpClientId::ALL.into_iter().map(describe).collect()).await
}

/// Points one client at this engine.
///
/// # Errors
///
/// Returns a message when an HTTP client is asked for while the server is not
/// running, when the client's file does not parse, or when it cannot be
/// written.
#[tauri::command]
pub async fn mcp_client_register<R: Runtime>(
    app: AppHandle<R>,
    id: McpClientId,
) -> Result<McpClient, String> {
    let endpoint = endpoint_from(&app)?;
    blocking(move || {
        let (config_path, _) = locations(id).ok_or_else(|| {
            format!(
                "client.unsupported: no configuration directory for {}",
                id.name()
            )
        })?;
        register(&config_path, id, &endpoint).map_err(|error| error.to_string())?;
        describe(id)
    })
    .await
}

/// Takes this engine back out of one client.
///
/// # Errors
///
/// Returns a message when the client's file does not parse or cannot be written.
#[tauri::command]
pub async fn mcp_client_unregister(id: McpClientId) -> Result<McpClient, String> {
    blocking(move || {
        let (config_path, _) = locations(id).ok_or_else(|| {
            format!(
                "client.unsupported: no configuration directory for {}",
                id.name()
            )
        })?;
        unregister(&config_path, id).map_err(|error| error.to_string())?;
        describe(id)
    })
    .await
}

/// A snippet for a client this module does not know.
///
/// # Errors
///
/// Returns a message when the server is not running.
#[tauri::command]
pub async fn mcp_manual_config<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let url = app
        .state::<McpServerState>()
        .endpoint()
        .ok_or_else(|| ClientError::server_off().to_string())?;
    Ok(manual_config(&url))
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

    /// The file name a test uses for a client, with the extension it reads.
    fn file_for(id: McpClientId) -> &'static str {
        if id.is_toml() {
            "config.toml"
        } else {
            "config.json"
        }
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

        for id in McpClientId::ALL
            .into_iter()
            .filter(|id| *id != McpClientId::ClaudeCode)
        {
            let (path, dir) = locations_in(id, &home, &config);
            assert!(!is_detected(&path, &dir), "{} is absent", id.name());
        }

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&config).ok();
    }

    #[test]
    fn the_new_clients_live_where_they_read_from() {
        let home = PathBuf::from("/home/someone");
        let config = PathBuf::from("/home/someone/.config");

        let (windsurf, _) = locations_in(McpClientId::Windsurf, &home, &config);
        assert_eq!(
            windsurf,
            home.join(".codeium")
                .join("windsurf")
                .join("mcp_config.json")
        );
        let (codex, _) = locations_in(McpClientId::Codex, &home, &config);
        assert_eq!(codex, home.join(".codex").join("config.toml"));
    }

    /// The endpoint the tests configure clients with.
    fn endpoint() -> Endpoint {
        Endpoint {
            url: Some("http://127.0.0.1:4321/mcp".to_string()),
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
            let path = dir.join(file_for(id));

            assert!(!is_registered(&path, id).expect("a missing file is not registered"));
            register(&path, id, &endpoint()).expect("registering writes the file");
            assert!(is_registered(&path, id).expect("the entry is there"));
            unregister(&path, id).expect("unregistering rewrites the file");
            assert!(!is_registered(&path, id).expect("the entry is gone"));

            fs::remove_dir_all(&dir).ok();
        }
    }

    #[test]
    fn each_client_gets_the_entry_its_launcher_expects_with_no_token() {
        let endpoint = endpoint();
        let dir = temp_dir("shapes");

        let code = dir.join("claude-code.json");
        register(&code, McpClientId::ClaudeCode, &endpoint).expect("claude code is written");
        let entry = read(&code)["mcpServers"]["bitwright"].clone();
        assert_eq!(entry["type"], "http");
        assert_eq!(entry["url"], "http://127.0.0.1:4321/mcp");
        assert!(entry.get("headers").is_none());

        let cursor = dir.join("cursor.json");
        register(&cursor, McpClientId::Cursor, &endpoint).expect("cursor is written");
        let entry = read(&cursor)["mcpServers"]["bitwright"].clone();
        assert!(entry.get("type").is_none());
        assert_eq!(entry["url"], "http://127.0.0.1:4321/mcp");
        assert!(entry.get("headers").is_none());

        let windsurf = dir.join("windsurf.json");
        register(&windsurf, McpClientId::Windsurf, &endpoint).expect("windsurf is written");
        let entry = read(&windsurf)["mcpServers"]["bitwright"].clone();
        assert_eq!(entry["serverUrl"], "http://127.0.0.1:4321/mcp");
        assert!(entry.get("headers").is_none());

        let desktop = dir.join("claude-desktop.json");
        register(&desktop, McpClientId::ClaudeDesktop, &endpoint).expect("desktop is written");
        let entry = read(&desktop)["mcpServers"]["bitwright"].clone();
        assert_eq!(entry["command"], "/opt/bitwright/bitwright");
        assert_eq!(entry["args"][0], "--mcp-stdio");
        assert!(entry.get("url").is_none());

        let codex = dir.join("config.toml");
        register(&codex, McpClientId::Codex, &endpoint).expect("codex is written");
        let text = fs::read_to_string(&codex).expect("the file was written");
        let document: toml_edit::DocumentMut = text.parse().expect("the file is TOML");
        let entry = &document["mcp_servers"]["bitwright"];
        assert_eq!(entry["command"].as_str(), Some("/opt/bitwright/bitwright"));
        assert_eq!(
            entry["args"]
                .as_array()
                .and_then(|args| args.get(0))
                .and_then(toml_edit::Value::as_str),
            Some("--mcp-stdio")
        );
        assert!(text.contains("[mcp_servers.bitwright]"), "{text}");
        assert!(!text.contains("[mcp_servers]\n"), "{text}");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_stdio_client_registers_while_the_server_is_off() {
        let dir = temp_dir("stdio-off");
        let off = Endpoint {
            url: None,
            executable: PathBuf::from("/opt/bitwright/bitwright"),
        };

        for id in [McpClientId::ClaudeDesktop, McpClientId::Codex] {
            let path = dir.join(file_for(id));
            register(&path, id, &off).expect("a stdio client needs no running server");
            assert!(is_registered(&path, id).expect("the entry is there"));
        }

        for id in [
            McpClientId::ClaudeCode,
            McpClientId::Cursor,
            McpClientId::Windsurf,
        ] {
            let path = dir.join(format!("{}.json", id.name()));
            let error = register(&path, id, &off).expect_err("an http client needs a url");
            assert_eq!(error.code, "mcp.server_off");
            assert!(!path.exists(), "nothing is written");
        }

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

        unregister(&path, McpClientId::Cursor).expect("unregistering keeps the rest");
        let value = read(&path);
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["mcpServers"]["other"]["url"], "http://x");
        assert_eq!(value["nested"]["a"][1], 2);
        assert!(value["mcpServers"].get("bitwright").is_none());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn codex_keeps_its_other_tables_and_comments() {
        let dir = temp_dir("codex-keys");
        let path = dir.join("config.toml");
        let original =
            "# my settings\nmodel = \"o4\"\n\n[mcp_servers.other]\ncommand = \"other\"\n";
        fs::write(&path, original).expect("the fixture is written");

        register(&path, McpClientId::Codex, &endpoint()).expect("registering keeps the rest");
        let text = fs::read_to_string(&path).expect("readable");
        assert!(
            text.starts_with("# my settings\nmodel = \"o4\"\n"),
            "{text}"
        );
        assert!(
            text.contains("[mcp_servers.other]\ncommand = \"other\""),
            "{text}"
        );
        assert!(text.contains("[mcp_servers.bitwright]"), "{text}");

        unregister(&path, McpClientId::Codex).expect("unregistering keeps the rest");
        let text = fs::read_to_string(&path).expect("readable");
        assert!(!text.contains("bitwright"), "{text}");
        assert!(text.contains("[mcp_servers.other]"), "{text}");
        assert!(text.starts_with("# my settings"), "{text}");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn invalid_files_are_refused_and_left_untouched() {
        let dir = temp_dir("invalid");
        for (id, name, broken) in [
            (McpClientId::ClaudeCode, "config.json", "{ this is not json"),
            (McpClientId::Codex, "config.toml", "[[ this is not toml"),
        ] {
            let path = dir.join(name);
            fs::write(&path, broken).expect("the fixture is written");

            let error = register(&path, id, &endpoint()).expect_err("a broken file is refused");
            assert_eq!(error.code, "client.config_invalid");
            assert!(
                error.message.contains(&path.display().to_string()),
                "the message names the path: {}",
                error.message
            );
            assert_eq!(fs::read_to_string(&path).expect("still there"), broken);

            let error = unregister(&path, id).expect_err("a broken file is refused");
            assert_eq!(error.code, "client.config_invalid");
            assert_eq!(fs::read_to_string(&path).expect("still there"), broken);
        }

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
    fn the_manual_snippet_carries_the_live_url_and_no_token() {
        let snippet = manual_config("http://127.0.0.1:4321/mcp");
        let value: Value = serde_json::from_str(&snippet).expect("the snippet is JSON");

        assert_eq!(value["mcpServers"]["bitwright"]["type"], "http");
        assert_eq!(
            value["mcpServers"]["bitwright"]["url"],
            "http://127.0.0.1:4321/mcp"
        );
        assert!(value["mcpServers"]["bitwright"].get("headers").is_none());
        assert!(snippet.contains('\n'), "the snippet is pretty-printed");
        assert!(manual_config("http://127.0.0.1:9999/mcp").contains("9999"));
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
        for id in McpClientId::ALL {
            let path = dir.join(file_for(id));
            unregister(&path, id).expect("a missing file is not an error");
            assert!(!path.exists(), "no file is created");
        }

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_empty_file_is_treated_as_empty() {
        let dir = temp_dir("empty");
        for id in [McpClientId::Cursor, McpClientId::Codex] {
            let path = dir.join(file_for(id));
            fs::write(&path, "   \n").expect("the fixture is written");

            register(&path, id, &endpoint()).expect("registering writes the file");
            assert!(is_registered(&path, id).expect("the entry is there"));
        }

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
            launch: Launch::Stdio,
            detected: true,
            config_path: "/tmp/claude_desktop_config.json".to_string(),
            registered: false,
            needs_restart: true,
            launcher_stale: false,
        };
        let value = serde_json::to_value(&client).expect("a client is serializable");
        assert_eq!(value["id"], "claude-desktop");
        assert_eq!(value["name"], "Claude Desktop");
        assert_eq!(value["launch"], "stdio");
        assert_eq!(value["detected"], true);
        assert_eq!(value["configPath"], "/tmp/claude_desktop_config.json");
        assert_eq!(value["registered"], false);
        assert_eq!(value["needsRestart"], true);
    }

    #[test]
    fn describe_in_reports_each_known_client_against_a_temp_config_dir() {
        let home = temp_dir("describe-home");
        let config = temp_dir("describe-config");

        for id in McpClientId::ALL {
            let described = describe_in(id, &home, &config, false, false);
            assert_eq!(described.id, id);
            assert_eq!(described.name, id.name());
            assert_eq!(described.launch, id.launch());
            assert!(!described.detected, "{} starts undetected", id.name());
            assert!(!described.registered, "{} starts unregistered", id.name());
            assert!(!described.needs_restart);
            let (expected_path, _) = locations_in(id, &home, &config);
            assert_eq!(described.config_path, expected_path.to_string_lossy());
        }

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&config).ok();
    }

    #[test]
    fn describe_in_rereads_the_file_so_a_removed_entry_shows_as_removed() {
        let home = temp_dir("describe-register-home");
        let config = temp_dir("describe-register-config");

        for id in McpClientId::ALL {
            let (config_path, _) = locations_in(id, &home, &config);
            register(&config_path, id, &endpoint()).expect("registering writes the file");
            let described = describe_in(id, &home, &config, false, false);
            assert!(described.detected, "{} is now detected", id.name());
            assert!(described.registered, "{} is now registered", id.name());
        }

        // What Claude Desktop does while it runs: write its in-memory copy,
        // which has no entry, over the file.
        let (desktop, _) = locations_in(McpClientId::ClaudeDesktop, &home, &config);
        fs::write(&desktop, r#"{"preferences":{"quickEntry":true}}"#).expect("overwritten");
        let described = describe_in(McpClientId::ClaudeDesktop, &home, &config, true, false);
        assert!(!described.registered, "the lost entry is not reported");
        assert!(described.needs_restart);

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&config).ok();
    }

    #[test]
    fn the_desktop_app_is_told_apart_from_the_command_line() {
        let dir = temp_dir("exe");
        let electron = dir.join("app-1.0.0");
        fs::create_dir_all(electron.join("resources")).expect("made");
        fs::write(electron.join("resources").join("app.asar"), "").expect("written");
        assert!(is_claude_desktop_executable(&electron.join("claude.exe")));

        let cli = dir.join(".local").join("bin");
        fs::create_dir_all(&cli).expect("made");
        assert!(!is_claude_desktop_executable(&cli.join("claude.exe")));

        assert!(is_claude_desktop_executable(Path::new(
            r"C:\Users\x\AppData\Local\AnthropicClaude\app-0.9\claude.exe"
        )));
        assert!(is_claude_desktop_executable(Path::new(
            r"C:\Program Files\WindowsApps\Claude_1.0_x64__abc\app\claude.exe"
        )));

        fs::remove_dir_all(&dir).ok();
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
        assert_eq!(
            serde_json::to_value(McpClientId::Windsurf).expect("serializable"),
            "windsurf"
        );
        assert_eq!(
            serde_json::to_value(McpClientId::Codex).expect("serializable"),
            "codex"
        );
    }

    fn fake_exe(dir: &Path, bytes: &[u8]) -> PathBuf {
        let path = dir.join("bitwright-app.exe");
        fs::write(&path, bytes).expect("the fixture is written");
        path
    }

    #[test]
    fn the_launcher_is_copied_when_missing_and_skipped_when_identical() {
        let dir = temp_dir("launcher-copy");
        let source = fake_exe(&dir, b"build one");
        let dest = launcher_path(&dir.join("data"));

        assert_eq!(sync_launcher(&source, &dest).unwrap(), LauncherSync::Copied);
        assert_eq!(fs::read(&dest).unwrap(), b"build one");
        assert_eq!(
            sync_launcher(&source, &dest).unwrap(),
            LauncherSync::Current
        );

        fs::write(&source, b"build number two").unwrap();
        assert_eq!(sync_launcher(&source, &dest).unwrap(), LauncherSync::Copied);
        assert_eq!(fs::read(&dest).unwrap(), b"build number two");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_locked_launcher_keeps_the_old_copy_and_reports_it() {
        let dir = temp_dir("launcher-locked");
        let source = fake_exe(&dir, b"old");
        let dest = launcher_path(&dir.join("data"));
        sync_launcher(&source, &dest).unwrap();

        fs::write(&source, b"a newer build").unwrap();
        let outcome = sync_launcher_with(&source, &dest, |_, _| {
            Err(io::Error::new(io::ErrorKind::PermissionDenied, "in use"))
        });
        assert_eq!(outcome.unwrap(), LauncherSync::Locked);
        assert_eq!(fs::read(&dest).unwrap(), b"old");

        // With no copy at all, a failed copy is a real error.
        fs::remove_file(&dest).unwrap();
        let outcome = sync_launcher_with(&source, &dest, |_, _| {
            Err(io::Error::new(io::ErrorKind::PermissionDenied, "no"))
        });
        assert!(outcome.is_err());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_stale_entry_is_rewritten_to_the_launcher_and_other_servers_are_untouched() {
        let dir = temp_dir("launcher-rewrite");
        let (home, config) = (dir.join("home"), dir.join("config"));
        let data = dir.join("data");
        let source = fake_exe(&dir, b"build");

        let (desktop, _) = locations_in(McpClientId::ClaudeDesktop, &home, &config);
        fs::create_dir_all(desktop.parent().unwrap()).unwrap();
        fs::write(
            &desktop,
            r#"{"theme":"dark","mcpServers":{"other":{"command":"other","args":["x"]},"bitwright":{"command":"/old/bitwright.exe","args":["--mcp-stdio"]}}}"#,
        )
        .unwrap();

        let (codex, _) = locations_in(McpClientId::Codex, &home, &config);
        fs::create_dir_all(codex.parent().unwrap()).unwrap();
        fs::write(
            &codex,
            "[mcp_servers.other]
command = \"other\"

[mcp_servers.bitwright]
command = \"/old/bitwright\"
args = [\"--mcp-stdio\"]
",
        )
        .unwrap();

        let rewritten = refresh_stdio_registrations(&source, &data, &home, &config);
        assert_eq!(
            rewritten,
            vec![McpClientId::ClaudeDesktop, McpClientId::Codex]
        );

        let launcher = launcher_path(&data);
        assert!(launcher.is_file());
        let value = read(&desktop);
        assert_eq!(
            value["mcpServers"]["bitwright"]["command"].as_str(),
            Some(&*launcher.to_string_lossy())
        );
        assert_eq!(value["mcpServers"]["other"]["command"], "other");
        assert_eq!(value["theme"], "dark");
        let text = fs::read_to_string(&codex).unwrap();
        assert!(text.contains(
            "[mcp_servers.other]
command = \"other\""
        ));
        assert!(!text.contains("/old/bitwright"));

        // A second start has nothing left to rewrite.
        assert!(refresh_stdio_registrations(&source, &data, &home, &config).is_empty());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn nothing_is_copied_when_no_stdio_client_is_registered() {
        let dir = temp_dir("launcher-none");
        let source = fake_exe(&dir, b"build");
        let data = dir.join("data");
        let rewritten = refresh_stdio_registrations(&source, &data, &dir.join("h"), &dir.join("c"));
        assert!(rewritten.is_empty());
        assert!(!launcher_path(&data).exists());
        fs::remove_dir_all(&dir).ok();
    }
}
