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
    pub created_at: i64,
    pub updated_at: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Style {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub name: String,
    pub preset: String,
    pub rules: StyleRules,
    pub created_at: i64,
    pub updated_at: i64,
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
    pub step: String,
    pub created_at: i64,
    pub updated_at: i64,
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
    pub step: String,
    pub can_advance: bool,
    pub gate: GateReport,
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
