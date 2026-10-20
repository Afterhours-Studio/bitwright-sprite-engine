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

//! MCP over stdin/stdout, for a client that spawned this process.
//!
//! Claude Desktop and Codex launch their servers as child processes, so their
//! entry is `bitwright --mcp-stdio`. Left to itself that process would open
//! the document store on its own and draw into it headless: the pixels land in
//! the same SQLite file, but the open window is never told, so a person
//! watching the app sees nothing until they reload. That is not what anyone
//! registering Claude Desktop wants.
//!
//! So this process first looks for the running app. When `mcp.json` in the
//! data root says the HTTP transport is on, and something answers on its port,
//! the process becomes a bridge: every JSON-RPC line from stdin is POSTed to
//! the app's loopback endpoint, and every message that comes back, whether as
//! plain JSON or as server-sent events, is written to stdout as one line. The
//! app's own server handles the call, through the same host as any HTTP
//! client, so the drawing appears live in the open document and the session
//! shows up in Settings. Only when the app is not running (or its transport is
//! off, or the port answers with something that is not Bitwright) does this
//! process fall back to serving the store headless, as before.
//!
//! There is no token here: the trust boundary is the process that spawned this
//! one, which already had the right to run the binary, and the loopback
//! endpoint it bridges to asks for none. Every failure is printed to stderr —
//! stdout carries protocol frames and nothing else.

use crate::mcp::config::{self, Transport};
use crate::mcp::handler::BitwrightServer;
use crate::mcp::host::{DocumentHost, HeadlessHost};
use crate::mcp::server::endpoint_url;
use crate::mcp::session::Session;
use bitwright::store::Store;
use rmcp::service::ServiceExt;
use serde_json::{json, Value};
use std::net::Ipv4Addr;
use std::path::Path;
use std::process::ExitCode;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// How long the check for a running app may take before giving up on it.
const PROBE_TIMEOUT: Duration = Duration::from_millis(500);

/// How long calls still in flight when stdin closes may take to finish.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(10);

/// The header the streamable HTTP transport names a session with.
const SESSION_HEADER: &str = "mcp-session-id";

/// The header that carries the protocol version agreed at initialize.
const PROTOCOL_HEADER: &str = "mcp-protocol-version";

/// Serves MCP over stdin/stdout until stdin closes.
///
/// Bridges to the running app when there is one, and serves the store at
/// `store_path` headless otherwise. The app's settings are looked for beside
/// the store, which is where the shell keeps them.
pub fn run(store_path: &Path) -> ExitCode {
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("failed to start the MCP runtime: {error}");
            return ExitCode::FAILURE;
        }
    };

    runtime.block_on(async {
        let mut stdin = tokio::io::BufReader::new(tokio::io::stdin());
        let mut replay = String::new();

        let data_dir = store_path.parent().unwrap_or(Path::new("."));
        if let Some(url) = live_endpoint(data_dir).await {
            // The client speaks first, with `initialize`. Forwarding that one
            // message is the real test of whether the app is there: a port
            // that accepts a connection may still belong to something else.
            match stdin.read_line(&mut replay).await {
                Ok(0) => return ExitCode::SUCCESS,
                Ok(_) => {}
                Err(error) => {
                    eprintln!("failed to read from stdin: {error}");
                    return ExitCode::FAILURE;
                }
            }

            let bridge = Bridge::new(url.clone(), tokio::io::stdout());
            match bridge.open(replay.trim()).await {
                Ok(()) => {
                    eprintln!("bridging MCP stdio to the running app at {url}");
                    bridge.run(stdin).await;
                    return ExitCode::SUCCESS;
                }
                Err(error) => {
                    eprintln!("the app at {url} did not answer ({error}); serving headless");
                }
            }
        }

        serve_headless(store_path, replay, stdin).await
    })
}

/// The app's endpoint, when its settings say HTTP is on and the port answers.
async fn live_endpoint(data_dir: &Path) -> Option<String> {
    let settings = config::peek(data_dir)?;
    if settings.transport != Transport::Http {
        return None;
    }
    let port = settings.port?;

    let connect = tokio::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port));
    match tokio::time::timeout(PROBE_TIMEOUT, connect).await {
        Ok(Ok(_)) => Some(endpoint_url(port)),
        _ => None,
    }
}

/// Serves the store headless, as the app would with no window to tell.
///
/// `replay` is whatever was already read from stdin while looking for the app;
/// it is put back in front of the rest so the headless server sees the whole
/// conversation from the first line.
async fn serve_headless<R>(store_path: &Path, replay: String, rest: R) -> ExitCode
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let store = match Store::open(store_path) {
        Ok(store) => store,
        Err(error) => {
            eprintln!("failed to open the document store: {error}");
            return ExitCode::FAILURE;
        }
    };

    let host: Arc<dyn DocumentHost> = Arc::new(HeadlessHost::new(store));
    let session = Arc::new(Session::new(uuid::Uuid::now_v7().to_string()));
    let server = BitwrightServer::new(host, session, None);

    let reader = std::io::Cursor::new(replay.into_bytes()).chain(rest);
    let running = match server.serve((reader, tokio::io::stdout())).await {
        Ok(running) => running,
        Err(error) => {
            eprintln!("failed to serve MCP over stdio: {error}");
            return ExitCode::FAILURE;
        }
    };

    if let Err(error) = running.waiting().await {
        eprintln!("MCP stdio session ended with an error: {error}");
        return ExitCode::FAILURE;
    }

    ExitCode::SUCCESS
}

/// Why a POST to the app did not produce an answer.
#[derive(Debug)]
enum BridgeError {
    /// The app no longer knows the session, because it was restarted.
    SessionGone,
    /// Anything else: the app is gone, or answered with an error.
    Failed(String),
}

impl std::fmt::Display for BridgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SessionGone => write!(f, "the session is no longer known"),
            Self::Failed(message) => write!(f, "{message}"),
        }
    }
}

/// Carries JSON-RPC between a stdio client and the app's HTTP endpoint.
struct Bridge<W> {
    http: reqwest::Client,
    url: String,
    /// The session the app assigned at initialize.
    session: Mutex<Option<String>>,
    /// The protocol version agreed at initialize, sent back on every request.
    protocol: Mutex<Option<String>>,
    /// The client's `initialize` request and `initialized` notification, kept
    /// so a session lost to an app restart can be opened again transparently.
    handshake: Mutex<Vec<String>>,
    /// Serialises reopening, so two calls that both find the session gone
    /// open one new session between them, not two.
    reopening: tokio::sync::Mutex<()>,
    /// Where messages for the client go, one JSON document per line.
    out: tokio::sync::Mutex<W>,
}

impl<W: AsyncWrite + Unpin + Send + 'static> Bridge<W> {
    fn new(url: String, out: W) -> Self {
        // No proxy: a system proxy setting must never see loopback traffic.
        // No overall timeout: a tool call may legitimately take a while.
        let http = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(Duration::from_secs(2))
            .build()
            .unwrap_or_default();
        Self {
            http,
            url,
            session: Mutex::new(None),
            protocol: Mutex::new(None),
            handshake: Mutex::new(Vec::new()),
            reopening: tokio::sync::Mutex::new(()),
            out: tokio::sync::Mutex::new(out),
        }
    }

    /// Forwards the client's `initialize` and checks that Bitwright answered.
    ///
    /// Nothing reaches the client until the answer has been checked, so a
    /// failure here leaves the conversation untouched for the headless
    /// fallback to take over.
    async fn open(&self, initialize: &str) -> Result<(), BridgeError> {
        let request: Value = serde_json::from_str(initialize)
            .map_err(|error| BridgeError::Failed(format!("not JSON: {error}")))?;
        if request.get("method").and_then(Value::as_str) != Some("initialize") {
            return Err(BridgeError::Failed(
                "the first message was not initialize".into(),
            ));
        }
        let id = request.get("id").cloned().unwrap_or(Value::Null);

        let messages = self.post(initialize, Some(&id), false).await?;
        let answer = messages
            .iter()
            .find(|message| message.get("id") == Some(&id))
            .and_then(|message| message.get("result"))
            .filter(|result| result.get("serverInfo").is_some())
            .ok_or_else(|| BridgeError::Failed("no initialize result".into()))?;

        if let Some(version) = answer.get("protocolVersion").and_then(Value::as_str) {
            *lock(&self.protocol) = Some(version.to_string());
        }
        lock(&self.handshake).push(initialize.to_string());
        for message in &messages {
            self.write(message).await;
        }
        Ok(())
    }

    /// Relays stdin to the app until stdin closes, then ends the session.
    async fn run<R: AsyncBufRead + Unpin>(self, mut input: R) {
        let bridge = Arc::new(self);
        let mut calls = tokio::task::JoinSet::new();
        let mut line = String::new();

        loop {
            line.clear();
            match input.read_line(&mut line).await {
                Ok(0) => break,
                Ok(_) => {}
                Err(error) => {
                    eprintln!("failed to read from stdin: {error}");
                    break;
                }
            }
            let text = line.trim().to_string();
            if text.is_empty() {
                continue;
            }

            let Ok(message) = serde_json::from_str::<Value>(&text) else {
                eprintln!("ignoring a line that is not JSON");
                continue;
            };
            let method = message.get("method").and_then(Value::as_str);
            if method == Some("notifications/initialized") {
                lock(&bridge.handshake).push(text.clone());
            }

            if method.is_some() && message.get("id").is_some() {
                // A request can take as long as the tool it calls; running it
                // on its own task keeps a cancellation or a second call from
                // queueing behind it.
                let bridge = Arc::clone(&bridge);
                calls.spawn(async move { bridge.relay(&text, &message).await });
            } else {
                // Notifications and the client's answers are quick, and
                // relaying them in order keeps `initialized` ahead of any
                // request that follows it.
                bridge.relay(&text, &message).await;
            }

            while calls.try_join_next().is_some() {}
        }

        // Stdin closing usually means the client has gone, but a client that
        // writes its last request and then closes its end still reads the
        // answer, so calls in flight get a short grace before being dropped.
        let drain = async { while calls.join_next().await.is_some() {} };
        if tokio::time::timeout(SHUTDOWN_GRACE, drain).await.is_err() {
            calls.shutdown().await;
        }
        bridge.close().await;
    }

    /// Sends one message on, reopening the session once if the app was
    /// restarted, and answers a request with an error when the app is gone.
    async fn relay(&self, text: &str, message: &Value) {
        let id = message
            .get("method")
            .is_some()
            .then(|| message.get("id"))
            .flatten();

        let mut outcome = self.post(text, id, true).await;
        if matches!(outcome, Err(BridgeError::SessionGone)) {
            outcome = match self.reopen().await {
                Ok(()) => self.post(text, id, true).await,
                Err(error) => Err(error),
            };
        }

        if let Err(error) = outcome {
            eprintln!("the app did not take a message: {error}");
            if let Some(id) = id {
                self.write(&json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": -32603,
                        "message": format!(
                            "Bitwright did not answer ({error}). Is the app still open? \
                             Restart this MCP server to reconnect."
                        ),
                    },
                }))
                .await;
            }
        }
    }

    /// Opens a new session by replaying the client's handshake, unless another
    /// call already did while this one waited.
    async fn reopen(&self) -> Result<(), BridgeError> {
        let stale = lock(&self.session).clone();
        let _guard = self.reopening.lock().await;
        if *lock(&self.session) != stale {
            return Ok(());
        }

        *lock(&self.session) = None;
        let handshake = lock(&self.handshake).clone();
        for (index, message) in handshake.iter().enumerate() {
            let id = (index == 0)
                .then(|| serde_json::from_str::<Value>(message).ok())
                .flatten()
                .and_then(|value| value.get("id").cloned());
            // The replayed answers are for a question the client already had
            // answered, so they are read and dropped.
            self.post(message, id.as_ref(), false).await?;
        }
        Ok(())
    }

    /// POSTs one message and gathers what comes back.
    ///
    /// With `forward`, each message is written to the client as it arrives and
    /// nothing is returned; without, they are collected. When `until` names a
    /// request id, reading stops at that request's answer, so a stream the
    /// server keeps open cannot hold the call.
    async fn post(
        &self,
        body: &str,
        until: Option<&Value>,
        forward: bool,
    ) -> Result<Vec<Value>, BridgeError> {
        let session = lock(&self.session).clone();
        let protocol = lock(&self.protocol).clone();

        let mut request = self
            .http
            .post(&self.url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(
                reqwest::header::ACCEPT,
                "application/json, text/event-stream",
            )
            .body(body.to_string());
        if let Some(session) = &session {
            request = request.header(SESSION_HEADER, session);
        }
        if let Some(protocol) = &protocol {
            request = request.header(PROTOCOL_HEADER, protocol);
        }

        let mut response = request
            .send()
            .await
            .map_err(|error| BridgeError::Failed(error.to_string()))?;

        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND && session.is_some() {
            return Err(BridgeError::SessionGone);
        }
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(BridgeError::Failed(format!("HTTP {status}: {detail}")));
        }
        if let Some(assigned) = response
            .headers()
            .get(SESSION_HEADER)
            .and_then(|value| value.to_str().ok())
        {
            *lock(&self.session) = Some(assigned.to_string());
        }
        if status == reqwest::StatusCode::ACCEPTED {
            return Ok(Vec::new());
        }

        let is_stream = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("text/event-stream"));

        let mut collected = Vec::new();
        let mut parser = SseParser::default();
        let mut whole = Vec::new();
        loop {
            let chunk = response
                .chunk()
                .await
                .map_err(|error| BridgeError::Failed(error.to_string()))?;
            let Some(chunk) = chunk else { break };

            if !is_stream {
                whole.extend_from_slice(&chunk);
                continue;
            }
            let mut done = false;
            for data in parser.feed(&chunk) {
                let Ok(message) = serde_json::from_str::<Value>(&data) else {
                    continue;
                };
                done |= answers(&message, until);
                if forward {
                    self.write(&message).await;
                } else {
                    collected.push(message);
                }
            }
            if done {
                break;
            }
        }

        if !is_stream && !whole.is_empty() {
            let value: Value = serde_json::from_slice(&whole)
                .map_err(|error| BridgeError::Failed(format!("not JSON: {error}")))?;
            let messages = match value {
                Value::Array(items) => items,
                other => vec![other],
            };
            for message in messages {
                if forward {
                    self.write(&message).await;
                } else {
                    collected.push(message);
                }
            }
        }

        Ok(collected)
    }

    /// Ends the session on the app's side, so it leaves the Settings list now
    /// rather than whenever the app next notices.
    async fn close(&self) {
        let Some(session) = lock(&self.session).clone() else {
            return;
        };
        let _ = self
            .http
            .delete(&self.url)
            .header(SESSION_HEADER, session)
            .send()
            .await;
    }

    /// Writes one message to the client as a single line.
    async fn write(&self, message: &Value) {
        let mut line = message.to_string();
        line.push('\n');
        let mut out = self.out.lock().await;
        if out.write_all(line.as_bytes()).await.is_err() || out.flush().await.is_err() {
            eprintln!("failed to write to stdout");
        }
    }
}

/// Whether `message` is the answer to the request with id `until`.
fn answers(message: &Value, until: Option<&Value>) -> bool {
    let Some(until) = until else { return false };
    message.get("id") == Some(until)
        && message.get("method").is_none()
        && (message.get("result").is_some() || message.get("error").is_some())
}

/// Locks a mutex, ignoring poisoning: the values behind it are plain strings.
fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Splits a server-sent event stream into the data of each event.
///
/// Bytes arrive in whatever chunks the network delivers, so a line, or a
/// character, may be cut anywhere; the parser keeps the unfinished tail until
/// the rest arrives. Events with no data, such as the priming event the server
/// sends first, are skipped.
#[derive(Default)]
struct SseParser {
    /// Bytes after the last complete line.
    pending: Vec<u8>,
    /// The data lines of the event being read.
    data: Vec<String>,
}

impl SseParser {
    /// Takes the next chunk and returns the data of every event it completed.
    fn feed(&mut self, chunk: &[u8]) -> Vec<String> {
        self.pending.extend_from_slice(chunk);
        let mut events = Vec::new();

        while let Some(end) = self.pending.iter().position(|byte| *byte == b'\n') {
            let raw: Vec<u8> = self.pending.drain(..=end).collect();
            let line = String::from_utf8_lossy(&raw);
            let line = line.trim_end_matches(['\n', '\r']);

            if line.is_empty() {
                let data = self.data.join("\n");
                self.data.clear();
                if !data.trim().is_empty() {
                    events.push(data);
                }
            } else if let Some(value) = line.strip_prefix("data:") {
                self.data
                    .push(value.strip_prefix(' ').unwrap_or(value).to_string());
            }
        }

        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::server::router;
    use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
    use rmcp::transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService,
    };

    #[test]
    fn the_parser_joins_events_split_across_chunks() {
        let mut parser = SseParser::default();
        assert!(parser.feed(b"id: 0\nretry: 3000\ndata:\n\n").is_empty());
        assert!(parser.feed(b"data: {\"a\":").is_empty());
        assert_eq!(parser.feed(b"1}\r\n\r\n"), vec!["{\"a\":1}".to_string()]);
        assert_eq!(
            parser.feed(b"data: one\ndata: two\n\ndata: {}\n\n"),
            vec!["one\ntwo".to_string(), "{}".to_string()]
        );
    }

    #[test]
    fn only_the_awaited_answer_ends_a_read() {
        let id = json!(3);
        assert!(answers(&json!({"id": 3, "result": {}}), Some(&id)));
        assert!(answers(&json!({"id": 3, "error": {}}), Some(&id)));
        assert!(!answers(&json!({"id": 4, "result": {}}), Some(&id)));
        assert!(!answers(
            &json!({"id": 3, "method": "sampling/createMessage"}),
            Some(&id)
        ));
        assert!(!answers(&json!({"id": 3, "result": {}}), None));
    }

    /// Serves the real MCP surface over loopback HTTP, behind the real guard,
    /// against an in-memory store.
    async fn spawn_app() -> String {
        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind a loopback port");
        let port = listener.local_addr().expect("the bound address").port();
        let host: Arc<dyn DocumentHost> =
            Arc::new(HeadlessHost::new(Store::memory().expect("a store")));
        let service = StreamableHttpService::new(
            move || {
                let session = Arc::new(Session::new(uuid::Uuid::now_v7().to_string()));
                Ok(BitwrightServer::new(Arc::clone(&host), session, None))
            },
            Arc::new(LocalSessionManager::default()),
            StreamableHttpServerConfig::default(),
        );
        let app = router(service, port);
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        endpoint_url(port)
    }

    const INITIALIZE: &str = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}"#;

    #[tokio::test]
    async fn the_bridge_carries_a_session_to_the_running_app() {
        let url = spawn_app().await;
        let (client_end, bridge_end) = tokio::io::duplex(1 << 20);
        let bridge = Bridge::new(url, bridge_end);

        bridge.open(INITIALIZE).await.expect("the app answers");
        assert!(lock(&bridge.session).is_some(), "a session was assigned");

        let input = concat!(
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
            "\n",
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#,
            "\n",
        );
        bridge.run(input.as_bytes()).await;

        let mut lines = Vec::new();
        let mut reader = tokio::io::BufReader::new(client_end);
        loop {
            let mut line = String::new();
            let read = tokio::time::timeout(Duration::from_secs(5), reader.read_line(&mut line))
                .await
                .expect("the bridge wrote in time")
                .expect("readable");
            if read == 0 {
                break;
            }
            let message: Value = serde_json::from_str(line.trim()).expect("one JSON per line");
            let done = message["id"] == 2;
            lines.push(message);
            if done {
                break;
            }
        }

        assert_eq!(lines[0]["id"], 1);
        assert_eq!(lines[0]["result"]["serverInfo"]["name"], "bitwright");
        let tools = lines
            .iter()
            .find(|message| message["id"] == 2)
            .expect("tools/list was answered");
        assert!(
            tools["result"]["tools"]
                .as_array()
                .is_some_and(|tools| !tools.is_empty()),
            "{tools}"
        );
    }

    #[tokio::test]
    async fn the_bridge_refuses_a_port_that_is_not_bitwright() {
        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind a loopback port");
        let port = listener.local_addr().expect("the bound address").port();
        let app = axum::Router::new().route("/mcp", axum::routing::post(|| async { "{}" }));
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let bridge = Bridge::new(endpoint_url(port), tokio::io::sink());
        assert!(bridge.open(INITIALIZE).await.is_err());
    }

    #[tokio::test]
    async fn nothing_listening_means_no_live_endpoint() {
        let dir = std::env::temp_dir().join(format!("bitwright-stdio-{}", uuid::Uuid::now_v7()));
        assert_eq!(live_endpoint(&dir).await, None, "no settings file");

        // A port that was just free: bind it, note it, let it go.
        let port = {
            let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("bind");
            listener.local_addr().expect("address").port()
        };
        config::save(
            &dir,
            &config::McpConfig {
                transport: Transport::Http,
                port: Some(port),
            },
        )
        .expect("saved");
        assert_eq!(live_endpoint(&dir).await, None, "nothing answers");

        config::save(
            &dir,
            &config::McpConfig {
                transport: Transport::Off,
                port: Some(port),
            },
        )
        .expect("saved");
        assert_eq!(live_endpoint(&dir).await, None, "transport is off");

        std::fs::remove_dir_all(&dir).ok();
    }
}
