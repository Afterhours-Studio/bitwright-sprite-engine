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

//! The client the shell uses to call the engine.
//!
//! The webview does not reach the engine directly. It calls a command here, and
//! this module adds the token. Two reasons:
//!
//! 1. A token the webview holds is a token any script running in the webview
//!    holds, and the whole point of the token is that only the shell has it.
//! 2. The engine refuses any request carrying an `Origin`, which a webview
//!    always sends. That refusal is what stops a web page from reaching the
//!    engine through DNS rebinding, and it means the webview cannot be a
//!    client even if we wanted it to be.
//!
//! Every call is a fixed method and path. Nothing here takes a path from the
//! frontend, so a compromised page cannot aim a request at an endpoint that was
//! never meant to be reachable.

use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};

use crate::sidecar::{SidecarManager, TOKEN_HEADER};

/// How long a call to the engine may take.
///
/// Generous, because a generation on a cold model can take minutes. A stuck
/// request still fails rather than hanging the interface forever.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);

/// A failed call to the engine, carrying a code the frontend translates.
#[derive(Debug)]
pub struct EngineError {
    /// Stable reason code.
    pub code: String,
    /// English detail, for logs.
    pub detail: String,
}

impl EngineError {
    fn new(code: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            detail: detail.into(),
        }
    }
}

/// The error body the engine returns for a failure.
#[derive(serde::Deserialize)]
struct ErrorBody {
    code: Option<String>,
    detail: Option<String>,
}

/// Which HTTP method a call uses.
#[derive(Clone, Copy)]
pub enum Method {
    Get,
    Post,
}

/// Calls the engine and returns the decoded body.
///
/// # Errors
///
/// Returns `sidecar.not_ready` before the handshake, `network.unreachable`
/// when the request cannot be made, and whatever code the engine returned when
/// it refuses.
pub async fn call<R: Runtime>(
    app: &AppHandle<R>,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, EngineError> {
    let credentials = app
        .state::<SidecarManager>()
        .credentials()
        .map_err(|error| EngineError::new(error.code(), error.to_string()))?;

    let url = format!("{}{path}", credentials.base_url);
    let client = reqwest::Client::new();

    let request = match method {
        Method::Get => client.get(&url),
        Method::Post => client.post(&url),
    }
    .header(TOKEN_HEADER, &credentials.token)
    .timeout(REQUEST_TIMEOUT);

    let request = match body {
        Some(payload) => request.json(&payload),
        None => request,
    };

    let response = request.send().await.map_err(|error| {
        // The URL is left out on purpose: it carries no secret, but a log line
        // naming the port invites someone to try reaching it by hand.
        log::warn!("engine request to {path} failed: {error}");
        EngineError::new("network.unreachable", error.to_string())
    })?;

    let status = response.status();
    let payload: Value = response.json().await.map_err(|error| {
        EngineError::new(
            "network.unreachable",
            format!("malformed response: {error}"),
        )
    })?;

    if status.is_success() {
        return Ok(payload);
    }

    Err(engine_error(status.as_u16(), payload))
}

/// Turns a failed response into a translatable error.
///
/// A backend failure carries `code`; a rejected request carries `detail`, which
/// is where the routes put their reason codes.
fn engine_error(status: u16, payload: Value) -> EngineError {
    let body: ErrorBody = serde_json::from_value(payload).unwrap_or(ErrorBody {
        code: None,
        detail: None,
    });

    let code = body
        .code
        .or(body.detail)
        .unwrap_or_else(|| "unknown".to_string());

    log::warn!("engine returned {status}: {code}");
    EngineError::new(code, format!("engine responded {status}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_the_code_field() {
        let payload = serde_json::json!({ "code": "backend.unavailable", "message": "no" });
        assert_eq!(engine_error(503, payload).code, "backend.unavailable");
    }

    #[test]
    fn falls_back_to_the_detail_field() {
        let payload = serde_json::json!({ "detail": "auth.invalid_token" });
        assert_eq!(engine_error(401, payload).code, "auth.invalid_token");
    }

    #[test]
    fn reports_unknown_for_an_unrecognised_body() {
        let payload = serde_json::json!({ "unexpected": true });
        assert_eq!(engine_error(500, payload).code, "unknown");
    }
}
