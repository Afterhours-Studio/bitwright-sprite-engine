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

//! The MCP protocol handler: `tools/list` and `tools/call` over the tool
//! surface in [`crate::mcp::tools`].
//!
//! The handler knows nothing about what any tool does. It maps the catalogue to
//! the wire shape rmcp expects, dispatches a call through `tools::call`, and
//! reports the outcome as a tool-level result so the caller can read the
//! message. The only thing it adds is the observer hook the HTTP transport uses
//! to keep its session table current.

use crate::mcp::host::DocumentHost;
use crate::mcp::session::Session;
use crate::mcp::tools;
use rmcp::handler::server::ServerHandler;
use rmcp::model::{
    CallToolRequestParams, CallToolResult, ContentBlock, Implementation, ListToolsResult,
    PaginatedRequestParams, ServerCapabilities, ServerInfo, Tool,
};
use rmcp::service::{RequestContext, RoleServer};
use rmcp::ErrorData;
use std::sync::Arc;

/// Called after every tool call, with the session id and the tool name — the
/// HTTP server uses it to keep its session table current.
pub type ToolObserver = Arc<dyn Fn(&str, &str) + Send + Sync>;

/// The instructions an agent reads once, at initialize.
const INSTRUCTIONS: &str = "Bitwright is a pixel art editor. Start with list_projects and \
open_asset, read get_style_rules before drawing, work through the steps with get_step, \
check_step and advance_step, and read_canvas after every few writes.";

/// One MCP session, bound to a host and a session record.
#[derive(Clone)]
pub struct BitwrightServer {
    host: Arc<dyn DocumentHost>,
    session: Arc<Session>,
    observer: Option<ToolObserver>,
}

impl BitwrightServer {
    pub fn new(
        host: Arc<dyn DocumentHost>,
        session: Arc<Session>,
        observer: Option<ToolObserver>,
    ) -> Self {
        Self {
            host,
            session,
            observer,
        }
    }

    pub fn session(&self) -> &Arc<Session> {
        &self.session
    }
}

impl ServerHandler for BitwrightServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("bitwright", env!("CARGO_PKG_VERSION")))
            .with_instructions(INSTRUCTIONS)
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let mut result = ListToolsResult::default();
        result.tools = tool_list();
        Ok(result)
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let name = request.name.to_string();
        let args = request
            .arguments
            .map(serde_json::Value::Object)
            .unwrap_or(serde_json::Value::Null);

        let host = Arc::clone(&self.host);
        let session = Arc::clone(&self.session);
        let tool_name = name.clone();
        let result = tokio::task::spawn_blocking(move || {
            run_tool(host.as_ref(), session.as_ref(), &tool_name, args)
        })
        .await;

        let result = match result {
            Ok(result) => result,
            Err(error) => CallToolResult::error(vec![ContentBlock::text(
                serde_json::to_string(&serde_json::json!({
                    "code": "server.worker_failed",
                    "message": error.to_string(),
                    "hint": "Try the call again; the worker thread may have panicked.",
                }))
                .unwrap_or_else(|_| "{}".to_owned()),
            )]),
        };

        if let Some(observer) = &self.observer {
            observer(&self.session.id, &name);
        }

        Ok(result)
    }
}

/// The catalogue, mapped to the wire shape `tools/list` returns.
pub fn tool_list() -> Vec<Tool> {
    tools::catalogue()
        .into_iter()
        .map(|spec| {
            let schema = (spec.input_schema)();
            let object = schema.as_object().cloned().unwrap_or_default();
            Tool::new(spec.name, spec.description, object)
        })
        .collect()
}

/// Runs one tool and turns its outcome into a caller-visible result.
pub fn run_tool(
    host: &dyn DocumentHost,
    session: &Session,
    name: &str,
    args: serde_json::Value,
) -> CallToolResult {
    match tools::call(host, session, name, args) {
        Ok(value) => CallToolResult::success(vec![ContentBlock::text(
            serde_json::to_string_pretty(&value).unwrap_or_else(|_| "null".to_owned()),
        )]),
        Err(error) => CallToolResult::error(vec![ContentBlock::text(
            serde_json::to_string(&error).unwrap_or_else(|_| "{}".to_owned()),
        )]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::host::HeadlessHost;
    use bitwright::store::Store;

    fn host() -> Arc<dyn DocumentHost> {
        Arc::new(HeadlessHost::new(Store::memory().expect("in-memory store")))
    }

    fn text_of(result: &CallToolResult) -> String {
        match result.content.first() {
            Some(ContentBlock::Text(text)) => text.text.clone(),
            _ => panic!("expected one text content block"),
        }
    }

    #[test]
    fn tool_list_matches_the_catalogue() {
        let catalogue = tools::catalogue();
        let listed = tool_list();
        assert_eq!(listed.len(), catalogue.len());
        for (tool, spec) in listed.iter().zip(catalogue.iter()) {
            assert_eq!(tool.name, spec.name);
            assert_eq!(tool.description.as_deref(), Some(spec.description));
            let expected = (spec.input_schema)();
            assert_eq!(tool.input_schema.as_ref(), expected.as_object().unwrap());
        }
    }

    #[test]
    fn list_projects_succeeds() {
        let host = host();
        let session = Session::new("test-session");
        let result = run_tool(
            host.as_ref(),
            &session,
            "list_projects",
            serde_json::Value::Null,
        );
        assert_eq!(result.is_error, Some(false));
        let value: serde_json::Value =
            serde_json::from_str(&text_of(&result)).expect("result text is JSON");
        assert!(value
            .get("projects")
            .and_then(serde_json::Value::as_array)
            .is_some());
    }

    #[test]
    fn unknown_tool_is_an_error() {
        let host = host();
        let session = Session::new("test-session");
        let result = run_tool(
            host.as_ref(),
            &session,
            "no_such_tool",
            serde_json::Value::Null,
        );
        assert_eq!(result.is_error, Some(true));
        let value: serde_json::Value =
            serde_json::from_str(&text_of(&result)).expect("result text is JSON");
        assert_eq!(value["code"], "tool.unknown");
    }

    #[test]
    fn get_info_names_bitwright_and_enables_tools() {
        let server = BitwrightServer::new(host(), Arc::new(Session::new("test-session")), None);
        let info = server.get_info();
        assert_eq!(info.server_info.name, "bitwright");
        assert!(info.capabilities.tools.is_some());
        assert!(info.instructions.is_some());
    }
}
