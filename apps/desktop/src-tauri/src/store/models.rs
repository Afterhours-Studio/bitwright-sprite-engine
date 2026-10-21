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

//! These wire types keep database column names out of the renderer's contract.

use crate::raster::gates::{GateCheck, GateMetrics};
use crate::raster::ops::Bounds;
use crate::raster::{Layer, Palette, StyleRules};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssetId(pub Uuid);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub style_id: Option<Uuid>,
    /// The era and view of the project's default style, so a listing can show
    /// and filter them without reading each style. `None` with no style.
    pub era: Option<String>,
    pub view: Option<String>,
    /// The body proportions of that style: `standard` or `chibi`.
    pub proportions: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Style {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub name: String,
    /// One of [`crate::raster::palette::ERAS`]: colour and outline limits.
    pub era: String,
    /// One of [`crate::raster::palette::VIEWS`]: canvas sizes and proportions.
    pub view: String,
    /// One of [`crate::raster::palette::PROPORTIONS`]: which silhouette bands
    /// the shape gates read.
    pub proportions: String,
    pub rules: StyleRules,
    pub created_at: i64,
    pub updated_at: i64,
}
/// One entry in a project's own log: what happened to the project or its
/// style, and who did it. The asset op log cannot hold these, because its rows
/// belong to an asset and a project can have none, or be gone.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLogEntry {
    pub seq: i64,
    pub project_id: Uuid,
    /// `project_create`, `project_rename`, `project_delete` or `style_rules_set`.
    pub kind: String,
    pub payload: serde_json::Value,
    /// `user` or `agent:<mcp session id>`, as in the asset op log.
    pub actor: String,
    pub at: i64,
}
/// What a style edit did: the style as saved, whether it had to move to the
/// `custom` era to hold rules its own era does not have, and whether an asset
/// was given a style of its own to carry them.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleChange {
    pub style: Style,
    /// The era the style had before, when the edit moved it to `custom`.
    pub era_was: Option<String>,
    /// True when an asset that read its project's style got its own copy.
    pub forked: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: AssetId,
    pub project_id: Uuid,
    pub style_id: Option<Uuid>,
    pub name: String,
    pub kind: String,
    pub width: u16,
    pub height: u16,
    /// The furthest step the asset has reached: where `advance` moves on from.
    pub step: String,
    /// The step being viewed and drawn in. It is `step` unless an earlier
    /// step was selected, which hides the layers of the steps after it and
    /// sends drawing to its own layer without un-passing anything.
    #[serde(default)]
    pub active_step: String,
    pub created_at: i64,
    pub updated_at: i64,
    /// The root of the animation this asset is a later frame of; `None` for
    /// a root or a lone asset, which are what the home screen lists.
    pub root_id: Option<AssetId>,
    /// How many frames a root or lone asset has (at least 1); 0 for a later
    /// frame, so a count summed over a project counts each animation once.
    pub frames: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub asset: Asset,
    pub palette: Palette,
    pub layers: Vec<Layer>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    pub id: Uuid,
    pub asset_id: AssetId,
    pub name: String,
    pub source_png: Vec<u8>,
    pub conformed: Option<Vec<u8>>,
    pub conform_meta: Option<serde_json::Value>,
    pub created_at: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpResult {
    pub changed: usize,
    pub bounds: Option<Bounds>,
    pub roles: Vec<crate::raster::LayerRole>,
    pub seq: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateReport {
    pub step: String,
    pub pass: bool,
    /// Every check the step ran, the ones that passed included. An agent that
    /// can only see what broke cannot tell a gate that verified its work from
    /// one that never looked.
    pub checks: Vec<GateCheck>,
    pub metrics: GateMetrics,
}

impl GateReport {
    /// The names of the checks that failed, for a message that has room for
    /// nothing else.
    pub fn failures(&self) -> Vec<&str> {
        self.checks
            .iter()
            .filter(|check| !check.pass)
            .map(|check| check.name.as_str())
            .collect()
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepState {
    pub asset_id: AssetId,
    /// The furthest step reached. Every step before it has passed.
    pub step: String,
    /// The step selected to view and draw in: `step`, or one before it.
    pub active_step: String,
    /// The style's line mode, which is what decides `order`.
    pub line_mode: String,
    /// Every step id in the order this style works through them.
    pub order: Vec<String>,
    /// Passed steps whose gate has to run again before the next advance,
    /// because a layer of a step before them was edited after they passed.
    /// A soft state: nothing is locked by it.
    pub needs_recheck: Vec<String>,
    /// The layer roles the canvas shows at this view: the active step's and
    /// every earlier step's. The layers of later steps are hidden, not gone.
    pub visible_roles: Vec<String>,
    /// Whether `step`'s own gate passes and it has a successor. The steps in
    /// `needs_recheck` are re-run by the advance itself, which reports them.
    pub can_advance: bool,
    /// The gate of `active_step`.
    pub gate: GateReport,
    /// What an advance re-ran from `needs_recheck` first. Empty otherwise.
    #[serde(default)]
    pub rechecked: Vec<GateReport>,
}

pub const STEPS: [&str; 11] = [
    "reference",
    "palette",
    "silhouette",
    "flats",
    "shadow",
    "light",
    "outline",
    "detail",
    "accent",
    "cleanup",
    "variation",
];

/// The line-first order of a `single` line style: the outline straight after
/// the silhouette, then flats, shadow and light inside it, which is the order a
/// pixel artist draws a one-colour line sprite in by hand. Step ids are the
/// same as in [`STEPS`]; only the order moves.
pub const LINE_FIRST_STEPS: [&str; 11] = [
    "reference",
    "palette",
    "silhouette",
    "outline",
    "flats",
    "shadow",
    "light",
    "detail",
    "accent",
    "cleanup",
    "variation",
];

/// The step order a style with this line mode works through.
pub fn steps_for(line_mode: &str) -> &'static [&'static str; 11] {
    if line_mode == "single" {
        &LINE_FIRST_STEPS
    } else {
        &STEPS
    }
}

/// The layer roles a step paints, from section 6 of the document model. Four
/// steps paint none: `reference` and `palette` write their own tables,
/// `cleanup` works over every layer and `variation` forks the asset.
pub fn step_roles(step: &str) -> &'static [&'static str] {
    match step {
        "silhouette" => &["silhouette"],
        "flats" => &["flats"],
        "shadow" => &["shadow-core", "shadow-deep"],
        "light" => &["light"],
        "outline" => &["outline"],
        "detail" => &["detail"],
        "accent" => &["rim", "accent"],
        _ => &[],
    }
}

/// The step that paints a layer role, or `None` for a role no step owns.
pub fn role_step(role: &str) -> Option<&'static str> {
    STEPS
        .iter()
        .copied()
        .find(|step| step_roles(step).contains(&role))
}
