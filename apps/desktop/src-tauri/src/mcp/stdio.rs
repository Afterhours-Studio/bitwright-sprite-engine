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
//! There is no token here: the trust boundary is the process that spawned this
//! one, which already had the right to run the binary. Every failure is printed
//! to stderr — stdout carries protocol frames and nothing else.

use crate::mcp::handler::BitwrightServer;
use crate::mcp::host::HeadlessHost;
use crate::mcp::session::Session;
use bitwright::store::Store;
use rmcp::service::ServiceExt;
use std::path::Path;
use std::process::ExitCode;
use std::sync::Arc;

/// Serves MCP over stdin/stdout until stdin closes.
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
        let store = match Store::open(store_path) {
            Ok(store) => store,
            Err(error) => {
                eprintln!("failed to open the document store: {error}");
                return ExitCode::FAILURE;
            }
        };

        let host: Arc<dyn crate::mcp::host::DocumentHost> = Arc::new(HeadlessHost::new(store));
        let session = Arc::new(Session::new(uuid::Uuid::now_v7().to_string()));
        let server = BitwrightServer::new(host, session, None);

        let running = match server.serve(rmcp::transport::stdio()).await {
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
    })
}
