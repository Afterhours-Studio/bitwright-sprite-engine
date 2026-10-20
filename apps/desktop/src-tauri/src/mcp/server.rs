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

//! The loopback HTTP face of the MCP server, and the commands that drive it.
//!
//! The transport is rmcp's streamable HTTP service mounted at `/mcp` behind a
//! small guard. The guard exists because a loopback listener is reachable from
//! any page the user's browser happens to have open. Two checks close that:
//! a request carrying an `Origin` header is refused outright (a browser always
//! sends one on a cross-site fetch, a local MCP client never does), and the
//! `Host` header has to name this listener as `127.0.0.1:<port>` or
//! `localhost:<port>`, which is what defeats DNS rebinding, where a page on a
//! hostile name that resolves to 127.0.0.1 would otherwise count as same-site.
//!
//! There is no bearer token. The listener binds 127.0.0.1 only, so whatever
//! reaches it is already a process on this machine, and such a process can
//! open the document store directly; a token added a step to every client's
//! setup and protected nothing those processes could not already reach.
//!
//! Nothing here is registered with the application; the shell wires the
//! commands and the managed state up.

use std::collections::HashMap;
use std::io;
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::Router;
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

use crate::commands::document::agent_session;
use crate::mcp::config::{self, McpConfig, Transport};
use crate::mcp::handler::{BitwrightServer, ToolObserver};
use crate::mcp::host::{DocumentHost, TauriHost};
use crate::mcp::session::Session;

/// One MCP session the server is currently serving.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    /// The uuid v7 the transport assigned when the session was created.
    pub id: String,
    /// Milliseconds since the Unix epoch when the session connected.
    pub connected_at: i64,
    /// When the last tool call arrived, if any has.
    pub last_tool_at: Option<i64>,
    /// The name of the last tool called, if any has been.
    pub last_tool: Option<String>,
}

/// What the shell shows about the server, and what a client needs to reach it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    /// Whether the server listens, and how.
    pub transport: Transport,
    /// Whether a listener is bound right now.
    pub running: bool,
    /// The port actually bound, when running.
    pub port: Option<u16>,
    /// The address a client should connect to, when running.
    pub url: Option<String>,
    /// The sessions currently connected.
    pub sessions: Vec<SessionInfo>,
}

/// The listener and the machinery that stops it.
struct Running {
    /// The port the listener is bound to.
    port: u16,
    /// Cancels the streamable HTTP service and the graceful shutdown.
    cancel: Box<dyn Fn() + Send + Sync>,
    /// The task serving the listener; dropped to detach it after cancelling.
    _join: tauri::async_runtime::JoinHandle<()>,
}

/// Everything the state guards.
struct Inner {
    /// The directory the settings file lives in.
    data_dir: PathBuf,
    /// The settings as they are on disk.
    config: McpConfig,
    /// The running listener, when there is one.
    running: Option<Running>,
    /// The sessions currently connected, shared with the service factory.
    sessions: Arc<Mutex<HashMap<String, SessionInfo>>>,
}

/// The managed state behind the MCP commands.
pub struct McpServerState {
    inner: Mutex<Inner>,
}

impl McpServerState {
    /// Loads the settings from `data_dir`, creating a fresh file when needed.
    ///
    /// # Errors
    ///
    /// Returns the underlying failure when the settings file cannot be read or
    /// a replacement cannot be written.
    pub fn new(data_dir: PathBuf) -> io::Result<Self> {
        let config = config::load(&data_dir)?;
        Ok(Self {
            inner: Mutex::new(Inner {
                data_dir,
                config,
                running: None,
                sessions: Arc::new(Mutex::new(HashMap::new())),
            }),
        })
    }

    /// A snapshot of the server for the shell.
    pub fn status(&self) -> McpStatus {
        let inner = self.lock();
        let port = inner.running.as_ref().map(|running| running.port);
        let mut sessions: Vec<SessionInfo> =
            lock_sessions(&inner.sessions).values().cloned().collect();
        sessions.sort_by(|left, right| {
            left.connected_at
                .cmp(&right.connected_at)
                .then_with(|| left.id.cmp(&right.id))
        });

        McpStatus {
            transport: inner.config.transport,
            running: inner.running.is_some(),
            port,
            url: port.map(endpoint_url),
            sessions,
        }
    }

    /// The address a client needs, when the server is running.
    pub fn endpoint(&self) -> Option<String> {
        let inner = self.lock();
        inner
            .running
            .as_ref()
            .map(|running| endpoint_url(running.port))
    }

    /// Locks the guarded state, ignoring a poisoned lock rather than refusing
    /// to answer.
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// The streamable HTTP address of a listener on `port`.
#[must_use]
pub fn endpoint_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/mcp")
}

/// Locks the session table, ignoring a poisoned lock.
fn lock_sessions(
    sessions: &Mutex<HashMap<String, SessionInfo>>,
) -> MutexGuard<'_, HashMap<String, SessionInfo>> {
    sessions
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Milliseconds since the Unix epoch, or zero if the clock is before it.
fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

/// Removes a session from the table and tells the shell it went away.
///
/// Held by the observer of the server that serves the session, so it runs when
/// rmcp drops that server at the end of the session.
struct SessionGuard<R: Runtime> {
    app: AppHandle<R>,
    sessions: Arc<Mutex<HashMap<String, SessionInfo>>>,
    id: String,
}

impl<R: Runtime> Drop for SessionGuard<R> {
    fn drop(&mut self) {
        lock_sessions(&self.sessions).remove(&self.id);
        agent_session(&self.app, self.id.clone(), "disconnected".to_string());
    }
}

/// Binds the saved port, falling back to any free loopback port.
async fn bind(port: Option<u16>) -> io::Result<tokio::net::TcpListener> {
    if let Some(port) = port {
        match tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await {
            Ok(listener) => return Ok(listener),
            Err(error) => log::warn!("mcp port {port} is not available: {error}"),
        }
    }

    tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await
}

/// Starts the server if the saved transport asks for it.
///
/// Binds the saved port, or any free loopback port when that one is taken or
/// none was saved, and writes the port actually bound back to the settings so
/// the next launch shows the same address. A server that is already running is
/// left alone.
///
/// # Errors
///
/// Returns a message when the settings cannot be saved or no loopback port can
/// be bound.
pub async fn start<R: Runtime>(app: &AppHandle<R>) -> Result<McpStatus, String> {
    let state = app.state::<McpServerState>();

    let (transport, saved_port, sessions) = {
        let inner = state.lock();
        if inner.running.is_some() {
            drop(inner);
            return Ok(state.status());
        }
        (
            inner.config.transport,
            inner.config.port,
            inner.sessions.clone(),
        )
    };

    if transport == Transport::Off {
        return Ok(state.status());
    }

    let listener = bind(saved_port).await.map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();

    {
        let mut inner = state.lock();
        inner.config.port = Some(port);
        config::save(&inner.data_dir, &inner.config).map_err(|error| error.to_string())?;
    }

    let factory = {
        let app = app.clone();
        let sessions = sessions.clone();
        move || {
            let id = uuid::Uuid::now_v7().to_string();
            let connected_at = now_millis();
            lock_sessions(&sessions).insert(
                id.clone(),
                SessionInfo {
                    id: id.clone(),
                    connected_at,
                    last_tool_at: None,
                    last_tool: None,
                },
            );
            agent_session(&app, id.clone(), "connected".to_string());

            let session_guard = Arc::new(SessionGuard {
                app: app.clone(),
                sessions: sessions.clone(),
                id: id.clone(),
            });
            let observer: ToolObserver = {
                let session_guard = session_guard.clone();
                Arc::new(move |_session_id: &str, tool: &str| {
                    if let Some(info) =
                        lock_sessions(&session_guard.sessions).get_mut(&session_guard.id)
                    {
                        info.last_tool_at = Some(now_millis());
                        info.last_tool = Some(tool.to_string());
                    }
                })
            };

            let session = Arc::new(Session::new(id));
            let host: Arc<dyn DocumentHost> = Arc::new(TauriHost::new(app.clone()));
            Ok(BitwrightServer::new(host, session, Some(observer)))
        }
    };

    // rmcp checks the Host header too; narrowing its list to this exact
    // listener keeps the two checks saying the same thing.
    let server_config =
        StreamableHttpServerConfig::default().with_allowed_hosts(allowed_hosts(port));
    let cancel_token = server_config.cancellation_token.clone();
    let service = StreamableHttpService::new(
        factory,
        Arc::new(LocalSessionManager::default()),
        server_config,
    );
    let app_router = router(service, port);

    let shutdown_token = cancel_token.clone();
    let shutdown = async move { shutdown_token.cancelled_owned().await };
    let join = tauri::async_runtime::spawn(async move {
        if let Err(error) = axum::serve(listener, app_router)
            .with_graceful_shutdown(shutdown)
            .await
        {
            log::error!("the mcp http server stopped: {error}");
        }
    });

    {
        let mut inner = state.lock();
        inner.running = Some(Running {
            port,
            cancel: Box::new(move || cancel_token.cancel()),
            _join: join,
        });
    }

    Ok(state.status())
}

/// Stops the server if it is running.
///
/// # Errors
///
/// Never fails today; the signature matches the commands that call it.
pub async fn stop<R: Runtime>(app: &AppHandle<R>) -> Result<McpStatus, String> {
    let state = app.state::<McpServerState>();
    let running = { state.lock().running.take() };
    if let Some(running) = running {
        (running.cancel)();
    }

    Ok(state.status())
}

/// Mounts the MCP service at `/mcp` behind the guard.
pub fn router(
    service: StreamableHttpService<BitwrightServer, LocalSessionManager>,
    port: u16,
) -> Router {
    Router::new()
        .nest_service("/mcp", service)
        .layer(middleware::from_fn_with_state(port, guard))
}

/// The `Host` values a request to the listener on `port` may carry.
fn allowed_hosts(port: u16) -> [String; 2] {
    [format!("127.0.0.1:{port}"), format!("localhost:{port}")]
}

/// Refuses browser origins and requests addressed to any other host.
async fn guard(State(port): State<u16>, request: Request, next: Next) -> Response {
    if let Err(status) = authorize(request.headers(), port) {
        return status.into_response();
    }

    next.run(request).await
}

/// The decision the guard makes, split out so it can be tested directly.
///
/// Both refusals are 403: neither is something a client could fix by
/// presenting a credential, because there is none to present.
fn authorize(headers: &HeaderMap, port: u16) -> Result<(), StatusCode> {
    if headers.contains_key(header::ORIGIN) {
        return Err(StatusCode::FORBIDDEN);
    }

    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .map(str::to_ascii_lowercase);

    match host {
        Some(host) if allowed_hosts(port).contains(&host) => Ok(()),
        _ => Err(StatusCode::FORBIDDEN),
    }
}

/// Reports what the server is doing.
///
/// # Errors
///
/// Never fails today; the signature matches the other commands.
#[tauri::command]
pub async fn mcp_status<R: Runtime>(app: AppHandle<R>) -> Result<McpStatus, String> {
    Ok(app.state::<McpServerState>().status())
}

/// Saves the chosen transport, then starts or stops the server to match.
///
/// # Errors
///
/// Returns a message when the settings cannot be saved or the server cannot be
/// started.
#[tauri::command]
pub async fn mcp_set_transport<R: Runtime>(
    app: AppHandle<R>,
    transport: Transport,
) -> Result<McpStatus, String> {
    {
        let state = app.state::<McpServerState>();
        let mut inner = state.lock();
        inner.config.transport = transport;
        config::save(&inner.data_dir, &inner.config).map_err(|error| error.to_string())?;
    }

    match transport {
        Transport::Off => stop(&app).await,
        Transport::Http => start(&app).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderName;
    use axum::routing::post;

    fn headers_with(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in pairs {
            headers.insert(
                HeaderName::from_bytes(name.as_bytes()).expect("a header name"),
                value.parse().expect("a header value"),
            );
        }
        headers
    }

    #[test]
    fn an_origin_header_is_forbidden_even_with_a_good_host() {
        let headers = headers_with(&[
            ("origin", "http://evil.example"),
            ("host", "127.0.0.1:4321"),
        ]);

        let status = authorize(&headers, 4_321).expect_err("an origin is refused");
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[test]
    fn a_loopback_host_on_the_right_port_passes() {
        for host in ["127.0.0.1:4321", "localhost:4321", "LocalHost:4321"] {
            let headers = headers_with(&[("host", host)]);
            assert!(authorize(&headers, 4_321).is_ok(), "{host} is allowed");
        }
    }

    #[test]
    fn a_rebound_hostname_is_forbidden() {
        let headers = headers_with(&[("host", "evil.example:4321")]);
        let status = authorize(&headers, 4_321).expect_err("a foreign host is refused");
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[test]
    fn a_loopback_host_on_another_port_is_forbidden() {
        for host in ["127.0.0.1:9999", "localhost", "127.0.0.1"] {
            let headers = headers_with(&[("host", host)]);
            let status = authorize(&headers, 4_321).expect_err("the port has to match");
            assert_eq!(status, StatusCode::FORBIDDEN, "{host}");
        }
    }

    #[test]
    fn a_missing_host_is_forbidden() {
        let status = authorize(&HeaderMap::new(), 4_321).expect_err("a host is required");
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    /// Serves a trivial handler behind the guard on a real loopback port.
    async fn spawn_guarded() -> (u16, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind a loopback port");
        let port = listener.local_addr().expect("the bound address").port();
        let app = Router::new()
            .route("/mcp", post(|| async { "ok" }))
            .layer(middleware::from_fn_with_state(port, guard));
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("serve the router");
        });

        (port, server)
    }

    #[tokio::test]
    async fn the_guard_runs_in_front_of_the_router() {
        let (port, _server) = spawn_guarded().await;
        let url = endpoint_url(port);
        let client = reqwest::Client::new();

        let forbidden = client
            .post(&url)
            .header("Origin", "http://evil.example")
            .send()
            .await
            .expect("a response");
        assert_eq!(forbidden.status(), 403);

        let rebound = client
            .post(&url)
            .header("Host", format!("evil.example:{port}"))
            .send()
            .await
            .expect("a response");
        assert_eq!(rebound.status(), 403);

        // No credential of any kind: a plain loopback request is let through.
        let allowed = client.post(&url).send().await.expect("a response");
        assert_eq!(allowed.status(), 200);
        assert_eq!(allowed.text().await.expect("a body"), "ok");

        let by_name = client
            .post(format!("http://localhost:{port}/mcp"))
            .send()
            .await;
        // `localhost` may resolve to ::1 first on some machines, where nothing
        // listens; only check the answer when the request got through at all.
        if let Ok(response) = by_name {
            assert_eq!(response.status(), 200);
        }
    }

    /// A fresh directory under the system temporary directory.
    fn temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("the clock is after the epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "bitwright-mcp-server-{label}-{}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("a temporary directory can be made");
        path
    }

    #[test]
    fn a_freshly_loaded_server_state_reports_stopped_with_no_sessions() {
        // `McpServerState` is constructible with nothing but a data directory
        // — no live Tauri `App`/`AppHandle` is required — so its status can be
        // exercised as a unit test directly, against a temporary settings
        // file rather than a real one.
        let dir = temp_dir("status");
        let state = McpServerState::new(dir.clone()).expect("a fresh settings file loads");

        let status = state.status();
        assert!(!status.running);
        assert_eq!(status.port, None);
        assert_eq!(status.url, None);
        assert!(status.sessions.is_empty());
        assert_eq!(state.endpoint(), None);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_settings_file_with_an_old_token_still_loads() {
        let dir = temp_dir("old-token");
        std::fs::write(
            dir.join(config::FILE_NAME),
            r#"{"transport":"http","port":4599,"token":"abc"}"#,
        )
        .expect("the fixture is written");

        let state = McpServerState::new(dir.clone()).expect("an old file loads");
        assert_eq!(state.status().transport, Transport::Http);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn status_serialises_camel_case_fields_and_carries_no_token() {
        let status = McpStatus {
            transport: Transport::Http,
            running: true,
            port: Some(1_234),
            url: Some(endpoint_url(1_234)),
            sessions: vec![SessionInfo {
                id: "session".to_string(),
                connected_at: 1,
                last_tool_at: Some(2),
                last_tool: Some("draw".to_string()),
            }],
        };

        let json = serde_json::to_value(&status).expect("a status serialises");
        assert_eq!(json["transport"], "http");
        assert_eq!(json["running"], true);
        assert_eq!(json["port"], 1_234);
        assert_eq!(json["url"], "http://127.0.0.1:1234/mcp");
        assert!(json.get("token").is_none());
        assert_eq!(json["sessions"][0]["id"], "session");
        assert_eq!(json["sessions"][0]["connectedAt"], 1);
        assert_eq!(json["sessions"][0]["lastToolAt"], 2);
        assert_eq!(json["sessions"][0]["lastTool"], "draw");
    }
}
