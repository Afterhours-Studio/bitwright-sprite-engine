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

//! The operating manual, compiled into the server.
//!
//! The skill pack under `skills/bitwright-pixel-art/` is the same text an agent
//! needs whatever client it is driving: the loop, the step table, the palette
//! rules, the worked recipes and the fixes for a failed gate. Installing it into
//! one client's skills folder serves one client, so the server carries it
//! instead — embedded with `include_str!` so the binary is self-contained and a
//! checkout with a different install path behaves identically.
//!
//! Two surfaces read this table: the `read_guide` tool in
//! [`crate::mcp::tools::guide`], which every client supports, and the MCP
//! resources the handler lists in [`crate::mcp::handler`]. Both take the topic
//! strings below, and both resolve them through [`find`], so a topic that exists
//! in one exists in the other.

/// One document of the manual.
pub struct Guide {
    /// The name a caller passes: `overview`, `workflow`, and so on.
    pub topic: &'static str,
    /// What the document calls itself, for a client to show a person.
    pub title: &'static str,
    /// The markdown, embedded at compile time.
    pub text: &'static str,
}

/// The whole manual, in the order an agent should read it.
pub const GUIDES: [Guide; 5] = [
    Guide {
        topic: "overview",
        title: "Drawing in Bitwright",
        text: include_str!("../../../../../skills/bitwright-pixel-art/SKILL.md"),
    },
    Guide {
        topic: "workflow",
        title: "The step workflow and its gates",
        text: include_str!("../../../../../skills/bitwright-pixel-art/references/workflow.md"),
    },
    Guide {
        topic: "palette",
        title: "Palette rules and ramp construction",
        text: include_str!("../../../../../skills/bitwright-pixel-art/references/palette.md"),
    },
    Guide {
        topic: "recipes",
        title: "Worked recipes",
        text: include_str!("../../../../../skills/bitwright-pixel-art/references/recipes.md"),
    },
    Guide {
        topic: "troubleshooting",
        title: "Failure modes and how to fix them",
        text: include_str!(
            "../../../../../skills/bitwright-pixel-art/references/troubleshooting.md"
        ),
    },
];

/// The topic an agent gets when it asks for no topic.
pub const DEFAULT_TOPIC: &str = "overview";

/// Looks one topic up.
pub fn find(topic: &str) -> Option<&'static Guide> {
    GUIDES.iter().find(|guide| guide.topic == topic)
}

/// The resource URI a topic is served under.
pub fn uri(topic: &str) -> String {
    format!("bitwright://guide/{topic}")
}

/// Every topic, in reading order — what a tool error lists when a caller asks
/// for a document that does not exist.
pub fn topics() -> Vec<&'static str> {
    GUIDES.iter().map(|guide| guide.topic).collect()
}

/// The known URIs, for the message of a failed `resources/read`.
pub fn uris() -> Vec<String> {
    GUIDES.iter().map(|guide| uri(guide.topic)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_manual_has_the_five_topics_in_reading_order() {
        assert_eq!(
            topics(),
            vec![
                "overview",
                "workflow",
                "palette",
                "recipes",
                "troubleshooting"
            ]
        );
    }

    #[test]
    fn every_document_arrived_with_text_and_a_title() {
        for guide in GUIDES.iter() {
            assert!(
                !guide.title.trim().is_empty(),
                "{} has no title",
                guide.topic
            );
            assert!(
                guide.text.len() > 500,
                "{} carried only {} bytes into the binary",
                guide.topic,
                guide.text.len()
            );
        }
    }

    #[test]
    fn find_resolves_a_known_topic_and_refuses_an_unknown_one() {
        assert_eq!(find("palette").expect("palette").topic, "palette");
        assert_eq!(find("overview").expect("overview").topic, DEFAULT_TOPIC);
        assert!(find("Palettes").is_none());
        assert!(find("").is_none());
    }

    #[test]
    fn uris_are_namespaced_by_topic() {
        assert_eq!(uri("workflow"), "bitwright://guide/workflow");
        assert_eq!(uris().len(), GUIDES.len());
        assert_eq!(uris()[0], uri(DEFAULT_TOPIC));
    }
}
