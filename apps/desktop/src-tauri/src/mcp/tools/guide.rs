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

//! The manual as a tool.
//!
//! Resources are the right shape for a client that understands them, but a tool
//! is the one surface every client supports, so the same documents are also
//! readable through `tools/call`. This module is that second door; the text
//! itself lives in [`crate::mcp::guide`].

use super::super::error::ToolError;
use super::super::guide;
use super::super::host::DocumentHost;
use super::super::session::Session;
use super::{parse, ToolResult, ToolSpec};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadGuideArgs {
    topic: Option<String>,
}

fn read_guide_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "topic": {
                "type": "string",
                "enum": guide::topics(),
                "default": guide::DEFAULT_TOPIC,
                "description": "Which document: overview first, then the one a \
                    step or a failed gate names."
            }
        },
        "required": [],
        "additionalProperties": false
    })
}

fn read_guide(_host: &dyn DocumentHost, _session: &Session, args: Value) -> ToolResult {
    let args: ReadGuideArgs = parse(args)?;
    let topic = args.topic.as_deref().unwrap_or(guide::DEFAULT_TOPIC);
    let guide = guide::find(topic).ok_or_else(|| {
        ToolError::new(
            "args.invalid",
            format!("'{topic}' is not a guide topic"),
            format!(
                "The topics are {}; call read_guide with one of those.",
                guide::topics().join(", ")
            ),
        )
    })?;
    Ok(json!({
        "topic": guide.topic,
        "title": guide.title,
        "text": guide.text,
        "topics": guide::topics(),
    }))
}

/// The guide tool, first in the catalogue so it is the first thing a client
/// listing tools sees.
pub fn tools() -> Vec<ToolSpec> {
    vec![ToolSpec {
        name: "read_guide",
        description: "The operating manual: how to draw a sprite here, step by step, \
            with the palette rules, recipes and fixes for failed gates. Read overview \
            before your first drawing call; read the others when a step or a gate \
            needs them.",
        input_schema: read_guide_schema,
        handler: read_guide,
    }]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::host::{DocumentHost, HeadlessHost};
    use crate::mcp::session::Session;
    use crate::store::Store;
    use serde_json::json;

    fn host() -> HeadlessHost {
        HeadlessHost::new(Store::memory().expect("in-memory store"))
    }

    fn read(h: &dyn DocumentHost, args: Value) -> ToolResult {
        let session = Session::new("t");
        read_guide(h, &session, args)
    }

    #[test]
    fn no_topic_gives_the_overview() {
        let h = host();
        let value = read(&h, json!({})).expect("default topic reads");
        assert_eq!(value["topic"], "overview");
        assert_eq!(value["title"], guide::GUIDES[0].title);
        assert!(value["text"]
            .as_str()
            .expect("text is a string")
            .starts_with("---\nname: bitwright-pixel-art"));
        assert_eq!(value["topics"].as_array().expect("topics").len(), 5);
    }

    #[test]
    fn an_explicit_topic_reads_that_document() {
        let h = host();
        for topic in guide::topics() {
            let value = read(&h, json!({ "topic": topic })).expect("known topic reads");
            assert_eq!(value["topic"], topic);
            assert!(!value["title"].as_str().unwrap().is_empty());
            assert!(value["text"].as_str().unwrap().contains('\n'));
        }
    }

    #[test]
    fn an_unknown_topic_is_refused_with_the_list_of_topics() {
        let h = host();
        let error = read(&h, json!({ "topic": "shaders" })).unwrap_err();
        assert_eq!(error.code, "args.invalid");
        assert!(error.message.contains("shaders"), "{}", error.message);
        assert!(error.hint.contains("overview"), "{}", error.hint);
        assert!(error.hint.contains("troubleshooting"), "{}", error.hint);
    }

    #[test]
    fn the_schema_offers_exactly_the_known_topics() {
        let schema = read_guide_schema();
        let enum_ = schema["properties"]["topic"]["enum"]
            .as_array()
            .expect("topic enum");
        assert_eq!(enum_.len(), 5);
        assert_eq!(enum_[0], "overview");
        assert_eq!(schema["properties"]["topic"]["default"], "overview");
    }
}
