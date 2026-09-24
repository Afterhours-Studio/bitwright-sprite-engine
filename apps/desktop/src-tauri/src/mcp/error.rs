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

//! Errors the way an agent sees them.
//!
//! The store and the raster speak in codes written for the window, which turns
//! a message into a dialog box. An agent needs something else: a code it can
//! switch on, the detail that says what was refused, and a hint that names the
//! call to make instead. This module is that translation.

use bitwright::store::AppError;

/// A refusal an agent can act on.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ToolError {
    pub code: String,
    pub message: String,
    pub hint: String,
}

impl ToolError {
    pub fn new(code: &str, message: impl Into<String>, hint: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            hint: hint.into(),
        }
    }
}

impl std::fmt::Display for ToolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for ToolError {}

/// The hint that goes with a code this catalogue does not know.
const UNKNOWN_HINT: &str = "Read the message; it names what the engine refused.";

impl From<AppError> for ToolError {
    fn from(error: AppError) -> Self {
        let AppError { code, detail } = error;
        // Only the codes an agent hits often are named here. Everything else
        // keeps its code so the caller can still switch on it, and gets the
        // generic hint rather than a guess about what the engine wanted.
        let (code, hint): (&str, &str) = match code.as_str() {
            "document.not_found" | "reference.not_found" => (
                "asset.not_found",
                "Call list_assets and use one of the ids it returns.",
            ),
            "document.invalid_role" | "document.layer_not_found" => (
                "layer.unknown_role",
                "Layers are named by role, and there are only nine: silhouette, \
 flats, shadow-core, shadow-deep, light, outline, detail, rim, accent.",
            ),
            "document.layer_locked" => (
                "layer.locked",
                "The person locked this layer in the window. Draw on another \
 layer, or ask them to unlock it.",
            ),
            "palette.unknown_slot" | "grid.unrepresentable_slot" => (
                "slot.out_of_range",
                "Call describe_palette to see which slots this palette has, then \
 use one of those.",
            ),
            "grid.invalid_character" => (
                "grid.bad_character",
                "A cell is one character: '.' is 0, A-Z are 1-26, a-z are 27-52, \
 and 0-9 are 53-62.",
            ),
            "grid.too_large" => (
                "bounds.outside",
                "Stay inside the canvas; read_canvas reports its size.",
            ),
            "palette.invalid_ramp" => (
                "palette.rule_violation",
                "Fix the ramp named in the message so it obeys the style rules, \
 then call set_palette again.",
            ),
            "step.gate_failed" => (
                "step.gate_failed",
                "Run check_step to see which checks failed, fix those, then step \
 again.",
            ),
            other => (other, UNKNOWN_HINT),
        };
        Self {
            code: code.to_string(),
            message: detail,
            hint: hint.to_string(),
        }
    }
}

/// What a tool returns: JSON the caller can read, or a refusal it can act on.
pub type ToolResult = Result<serde_json::Value, ToolError>;

#[cfg(test)]
mod tests {
    use super::*;

    /// The store phrases its detail per code, so a test can check that the
    /// detail survived the translation by looking for the code inside it.
    fn store_error(code: &str) -> AppError {
        AppError::new(code, format!("{code} was refused by the engine"))
    }

    fn translated(code: &str) -> ToolError {
        ToolError::from(store_error(code))
    }

    #[test]
    fn missing_documents_and_references_become_asset_not_found() {
        for code in ["document.not_found", "reference.not_found"] {
            let error = translated(code);
            assert_eq!(error.code, "asset.not_found");
            assert_eq!(error.message, format!("{code} was refused by the engine"));
            assert_eq!(
                error.hint,
                "Call list_assets and use one of the ids it returns."
            );
        }
    }

    #[test]
    fn bad_roles_and_missing_layers_list_the_nine_names() {
        for code in ["document.invalid_role", "document.layer_not_found"] {
            let error = translated(code);
            assert_eq!(error.code, "layer.unknown_role");
            assert_eq!(error.message, format!("{code} was refused by the engine"));
            for role in [
                "silhouette",
                "flats",
                "shadow-core",
                "shadow-deep",
                "light",
                "outline",
                "detail",
                "rim",
                "accent",
            ] {
                assert!(
                    error.hint.contains(role),
                    "the hint for {code} must name {role}, got: {}",
                    error.hint
                );
            }
        }
    }

    #[test]
    fn a_locked_layer_says_who_locked_it_and_what_to_do() {
        let error = translated("document.layer_locked");
        assert_eq!(error.code, "layer.locked");
        assert_eq!(
            error.message,
            "document.layer_locked was refused by the engine"
        );
        assert!(error.hint.contains("locked this layer in the window"));
        assert!(error.hint.contains("another"));
    }

    #[test]
    fn unknown_and_unrepresentable_slots_point_at_describe_palette() {
        for code in ["palette.unknown_slot", "grid.unrepresentable_slot"] {
            let error = translated(code);
            assert_eq!(error.code, "slot.out_of_range");
            assert_eq!(error.message, format!("{code} was refused by the engine"));
            assert!(error.hint.contains("describe_palette"));
        }
    }

    #[test]
    fn a_bad_grid_character_spells_out_the_ranges() {
        let error = translated("grid.invalid_character");
        assert_eq!(error.code, "grid.bad_character");
        assert_eq!(
            error.message,
            "grid.invalid_character was refused by the engine"
        );
        assert!(error.hint.contains("'.' is 0"));
        assert!(error.hint.contains("A-Z are 1-26"));
        assert!(error.hint.contains("a-z are 27-52"));
        assert!(error.hint.contains("0-9 are 53-62"));
    }

    #[test]
    fn an_oversized_grid_points_at_read_canvas() {
        let error = translated("grid.too_large");
        assert_eq!(error.code, "bounds.outside");
        assert_eq!(error.message, "grid.too_large was refused by the engine");
        assert!(error.hint.contains("read_canvas"));
    }

    #[test]
    fn an_invalid_ramp_says_fix_it_and_call_set_palette_again() {
        let error = translated("palette.invalid_ramp");
        assert_eq!(error.code, "palette.rule_violation");
        assert_eq!(
            error.message,
            "palette.invalid_ramp was refused by the engine"
        );
        assert!(error.hint.contains("set_palette"));
    }

    #[test]
    fn a_failed_gate_keeps_its_code_and_points_at_check_step() {
        let error = translated("step.gate_failed");
        assert_eq!(error.code, "step.gate_failed");
        assert_eq!(error.message, "step.gate_failed was refused by the engine");
        assert!(error.hint.contains("check_step"));
    }

    #[test]
    fn a_code_this_catalogue_does_not_know_passes_through() {
        let error = translated("weights.missing");
        assert_eq!(error.code, "weights.missing");
        assert_eq!(error.message, "weights.missing was refused by the engine");
        assert_eq!(error.hint, UNKNOWN_HINT);
    }

    #[test]
    fn every_mapped_code_gets_a_hint_worth_reading() {
        let codes = [
            "document.not_found",
            "reference.not_found",
            "document.invalid_role",
            "document.layer_not_found",
            "document.layer_locked",
            "palette.unknown_slot",
            "grid.unrepresentable_slot",
            "grid.invalid_character",
            "grid.too_large",
            "palette.invalid_ramp",
            "step.gate_failed",
            "weights.missing",
        ];
        for code in codes {
            let error = translated(code);
            assert!(!error.hint.trim().is_empty(), "{code} got an empty hint");
            assert!(
                error.hint.ends_with('.'),
                "{code} got a hint that is not a sentence: {}",
                error.hint
            );
            assert!(!error.message.is_empty(), "{code} lost its detail");
        }
    }

    #[test]
    fn display_shows_the_code_and_the_message_but_not_the_hint() {
        let error = ToolError::new("layer.locked", "layer 3 is locked", "draw elsewhere");
        assert_eq!(error.to_string(), "layer.locked: layer 3 is locked");
    }

    #[test]
    fn new_keeps_what_it_is_given() {
        let error = ToolError::new("grid.bad_character", "no such cell", "use '.'");
        assert_eq!(error.code, "grid.bad_character");
        assert_eq!(error.message, "no such cell");
        assert_eq!(error.hint, "use '.'");
    }

    #[test]
    fn a_tool_error_is_an_std_error() {
        fn boxed() -> Box<dyn std::error::Error> {
            Box::new(ToolError::from(AppError::new(
                "grid.too_large",
                "128x128 will not fit",
            )))
        }
        assert_eq!(boxed().to_string(), "bounds.outside: 128x128 will not fit");
    }

    #[test]
    fn serializes_with_all_three_fields_for_the_wire() {
        let error = ToolError::from(AppError::new(
            "document.layer_locked",
            "locked by the person",
        ));
        let json = serde_json::to_value(&error).expect("a ToolError is serializable");
        assert_eq!(json["code"], "layer.locked");
        assert_eq!(json["message"], "locked by the person");
        assert_eq!(json["hint"], error.hint);
        let round: ToolResult = Ok(json);
        assert!(round.is_ok());
    }
}
