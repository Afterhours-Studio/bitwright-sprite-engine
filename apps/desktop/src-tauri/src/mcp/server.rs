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
//! any page the user's browser happens to have open: a request carrying an
//! `Origin` header is refused outright, and everything else has to present the
//! bearer token from the settings file. Nothing here is registered with the
//! application; the shell wires the commands and the managed state up.

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
    /// The bearer token a client has to present.
    pub token: String,
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
            url: port.map(|port| format!("http://127.0.0.1:{port}/mcp")),
            token: inner.config.token.clone(),
            sessions,
        }
    }

    /// The address and token a client needs, when the server is running.
    pub fn endpoint(&self) -> Option<(String, String)> {
        let inner = self.lock();
        let running = inner.running.as_ref()?;
        Some((
            format!("http://127.0.0.1:{}/mcp", running.port),
            inner.config.token.clone(),
        ))
    }

    /// Locks the guarded state, ignoring a poisoned lock rather than refusing
    /// to answer.
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
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

    let (transport, saved_port, token, sessions) = {
        let inner = state.lock();
        if inner.running.is_some() {
            drop(inner);
            return Ok(state.status());
        }
        (
            inner.config.transport,
            inner.config.port,
            inner.config.token.clone(),
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

    let server_config = StreamableHttpServerConfig::default();
    let cancel_token = server_config.cancellation_token.clone();
    let service = StreamableHttpService::new(
        factory,
        Arc::new(LocalSessionManager::default()),
        server_config,
    );
    let app_router = router(service, token);

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
    token: String,
) -> Router {
    Router::new()
        .nest_service("/mcp", service)
        .layer(middleware::from_fn_with_state(token, guard))
}

/// Refuses browser origins and anything without the right bearer token.
async fn guard(State(token): State<String>, request: Request, next: Next) -> Response {
    if let Err(status) = authorize(request.headers(), &token) {
        return status.into_response();
    }

    next.run(request).await
}

/// The decision the guard makes, split out so it can be tested directly.
fn authorize(headers: &HeaderMap, token: &str) -> Result<(), StatusCode> {
    if headers.contains_key(header::ORIGIN) {
        return Err(StatusCode::FORBIDDEN);
    }

    let presented = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));

    match presented {
        Some(presented) if config::token_matches(token, presented) => Ok(()),
        _ => Err(StatusCode::UNAUTHORIZED),
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

/// Replaces the token, restarting the server when it was running.
///
/// # Errors
///
/// Returns a message when the settings cannot be saved or the server cannot be
/// restarted.
#[tauri::command]
pub async fn mcp_regenerate_token<R: Runtime>(app: AppHandle<R>) -> Result<McpStatus, String> {
    let was_running = { app.state::<McpServerState>().lock().running.is_some() };
    if was_running {
        stop(&app).await?;
    }

    {
        let state = app.state::<McpServerState>();
        let mut inner = state.lock();
        let config =
            config::regenerate_token(&inner.data_dir).map_err(|error| error.to_string())?;
        inner.config = config;
    }

    if was_running {
        start(&app).await
    } else {
        Ok(app.state::<McpServerState>().status())
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
    fn an_origin_header_is_forbidden() {
        let token = config::new_token();
        let bearer = format!("Bearer {token}");
        let headers = headers_with(&[
            ("origin", "http://evil.example"),
            ("authorization", &bearer),
        ]);

        let status = authorize(&headers, &token).expect_err("an origin is refused");
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[test]
    fn a_missing_token_is_unauthorized() {
        let token = config::new_token();
        let status = authorize(&HeaderMap::new(), &token).expect_err("a token is required");
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn a_wrong_token_is_unauthorized() {
        let token = config::new_token();
        let bearer = format!("Bearer {}", config::new_token());
        let headers = headers_with(&[("authorization", &bearer)]);

        let status = authorize(&headers, &token).expect_err("a wrong token is refused");
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn a_token_without_the_bearer_scheme_is_unauthorized() {
        let token = config::new_token();
        let headers = headers_with(&[("authorization", &token)]);

        let status = authorize(&headers, &token).expect_err("the scheme is required");
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn the_right_token_passes() {
        let token = config::new_token();
        let bearer = format!("Bearer {token}");
        let headers = headers_with(&[("authorization", &bearer)]);

        assert!(authorize(&headers, &token).is_ok());
    }

    /// Serves a trivial handler behind the guard on a real loopback port.
    async fn spawn_guarded(token: String) -> (String, tokio::task::JoinHandle<()>) {
        let app = Router::new()
            .route("/mcp", post(|| async { "ok" }))
            .layer(middleware::from_fn_with_state(token, guard));
        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind a loopback port");
        let port = listener.local_addr().expect("the bound address").port();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("serve the router");
        });

        (format!("http://127.0.0.1:{port}/mcp"), server)
    }

    #[tokio::test]
    async fn the_guard_runs_in_front_of_the_router() {
        let token = config::new_token();
        let (url, _server) = spawn_guarded(token.clone()).await;
        let client = reqwest::Client::new();

        let forbidden = client
            .post(&url)
            .header("Origin", "http://evil.example")
            .send()
            .await
            .expect("a response");
        assert_eq!(forbidden.status(), 403);

        let missing = client.post(&url).send().await.expect("a response");
        assert_eq!(missing.status(), 401);

        let wrong = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", config::new_token()))
            .send()
            .await
            .expect("a response");
        assert_eq!(wrong.status(), 401);

        let allowed = client
            .post(&url)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await
            .expect("a response");
        assert_eq!(allowed.status(), 200);
        assert_eq!(allowed.text().await.expect("a body"), "ok");
    }

    #[test]
    fn status_serialises_camel_case_fields() {
        let status = McpStatus {
            transport: Transport::Http,
            running: true,
            port: Some(1_234),
            url: Some("http://127.0.0.1:1234/mcp".to_string()),
            token: "abc".to_string(),
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
        assert_eq!(json["token"], "abc");
        assert_eq!(json["sessions"][0]["id"], "session");
        assert_eq!(json["sessions"][0]["connectedAt"], 1);
        assert_eq!(json["sessions"][0]["lastToolAt"], 2);
        assert_eq!(json["sessions"][0]["lastTool"], "draw");
    }
}
