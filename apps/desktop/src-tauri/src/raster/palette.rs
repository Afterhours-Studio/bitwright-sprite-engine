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

//! Palette validation separates a malformed document from a style gate failure.
//! An unfinished ramp can be saved, but it cannot pass the palette step.

use super::{color, RasterError, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Material {
    Skin,
    Cloth,
    Leather,
    Metal,
    Hair,
    Eyes,
    Accent,
    Stone,
    Glass,
    Wood,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PaletteSlot {
    pub index: u8,
    pub rgba: [u8; 4],
    pub name: Option<String>,
    pub ramp: Option<String>,
    pub step: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Ramp {
    pub name: String,
    pub material: Material,
    pub slots: Vec<u8>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Palette {
    pub slots: Vec<PaletteSlot>,
    pub ramps: Vec<Ramp>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RampSteps {
    pub min: u8,
    pub max: u8,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Canvas {
    pub width: u16,
    pub height: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HueShift {
    pub darker_hue_deg: [f32; 2],
    pub darker_chroma_factor: [f32; 2],
    pub darker_delta_l: [f32; 2],
    pub lighter_hue_deg: [f32; 2],
    pub lighter_chroma_factor: [f32; 2],
    pub lighter_delta_l: [f32; 2],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleRules {
    pub max_slots: u8,
    pub ramp_steps: RampSteps,
    pub hue_shift: HueShift,
    pub warm_shadow_materials: Vec<Material>,
    pub value_floor: [f32; 2],
    pub value_ceiling: [f32; 2],
    pub min_edge_delta_l: f32,
    pub outline: String,
    pub outline_coverage: [f32; 2],
    pub light_direction: String,
    pub rim_coverage: [f32; 2],
    pub noise_budget: f32,
    pub canvas: Canvas,
}

impl Default for StyleRules {
    fn default() -> Self {
        Self {
            max_slots: 24,
            ramp_steps: RampSteps { min: 3, max: 5 },
            hue_shift: HueShift {
                darker_hue_deg: [12.0, 20.0],
                darker_chroma_factor: [0.85, 1.12],
                darker_delta_l: [-0.13, -0.08],
                lighter_hue_deg: [-20.0, -12.0],
                lighter_chroma_factor: [0.70, 0.85],
                lighter_delta_l: [0.09, 0.15],
            },
            warm_shadow_materials: vec![Material::Skin],
            value_floor: [0.10, 0.16],
            value_ceiling: [0.88, 0.94],
            min_edge_delta_l: 0.07,
            outline: "selective".into(),
            outline_coverage: [0.60, 0.75],
            light_direction: "upper-left".into(),
            rim_coverage: [0.15, 0.25],
            noise_budget: 0.02,
            canvas: Canvas {
                width: 48,
                height: 64,
            },
        }
    }
}

impl StyleRules {
    pub fn preset(preset: &str) -> Result<Self> {
        let mut rules = Self::default();
        match preset {
            "hd2d" | "custom" => {}
            "snes" => {
                rules.max_slots = 16;
            }
            "gameboy" => {
                rules.max_slots = 4;
                rules.ramp_steps = RampSteps { min: 2, max: 4 };
                rules.outline = "full".into();
            }
            _ => return Err(RasterError::new("style.invalid_preset", preset)),
        }
        Ok(rules)
    }
}

impl Palette {
    pub fn slot(&self, index: u8) -> Result<&PaletteSlot> {
        self.slots
            .iter()
            .find(|slot| slot.index == index)
            .ok_or_else(|| RasterError::new("palette.unknown_slot", format!("slot {index}")))
    }

    pub fn validate(&self, rules: &StyleRules) -> Result<()> {
        if self.slots.len() > usize::from(rules.max_slots.min(63)) {
            return Err(RasterError::new(
                "palette.too_many_slots",
                "palette exceeds the style ceiling",
            ));
        }
        for (position, slot) in self.slots.iter().enumerate() {
            if usize::from(slot.index) != position + 1 {
                return Err(RasterError::new(
                    "palette.invalid_index",
                    "slots must be contiguous, ordered, and one-based",
                ));
            }
            if let Some(name) = &slot.ramp {
                let ramp = self
                    .ramps
                    .iter()
                    .find(|r| &r.name == name)
                    .ok_or_else(|| RasterError::new("palette.invalid_ramp", name))?;
                if !ramp.slots.contains(&slot.index)
                    || slot.step.map(usize::from)
                        != ramp.slots.iter().position(|i| *i == slot.index)
                {
                    return Err(RasterError::new(
                        "palette.invalid_ramp",
                        "slot ramp metadata disagrees with ramp order",
                    ));
                }
            } else if slot.step.is_some() {
                return Err(RasterError::new(
                    "palette.invalid_ramp",
                    "a step needs a ramp",
                ));
            }
        }
        let mut names = std::collections::BTreeSet::new();
        for ramp in &self.ramps {
            if ramp.name.trim().is_empty() || !names.insert(&ramp.name) {
                return Err(RasterError::new(
                    "palette.invalid_ramp",
                    "ramp names must be nonempty and unique",
                ));
            }
            let mut indices = std::collections::BTreeSet::new();
            for &index in &ramp.slots {
                self.slot(index)?;
                if !indices.insert(index) {
                    return Err(RasterError::new(
                        "palette.invalid_ramp",
                        "a ramp repeats a slot",
                    ));
                }
            }
        }
        Ok(())
    }

    pub fn nearest(&self, rgba: [u8; 4]) -> Option<u8> {
        self.slots
            .iter()
            .min_by(|a, b| color::distance(a.rgba, rgba).total_cmp(&color::distance(b.rgba, rgba)))
            .map(|s| s.index)
    }

    pub fn gate_issues(&self, rules: &StyleRules) -> Result<Vec<String>> {
        self.validate(rules)?;
        let mut issues = Vec::new();
        if self.slots.is_empty() {
            issues.push("palette.empty".into());
        }
        if self.ramps.is_empty() {
            issues.push("palette.no_ramps".into());
        }
        for ramp in &self.ramps {
            if ramp.slots.len() < usize::from(rules.ramp_steps.min)
                || ramp.slots.len() > usize::from(rules.ramp_steps.max)
            {
                issues.push(format!("palette.ramp_steps:{}", ramp.name));
            }
            let labs = ramp
                .slots
                .iter()
                .map(|i| self.slot(*i).map(|s| color::srgb_to_oklab(s.rgba)))
                .collect::<Result<Vec<_>>>()?;
            for pair in labs.windows(2) {
                if pair[1][0] <= pair[0][0] {
                    issues.push(format!("palette.ramp_order:{}", ramp.name));
                }
                // Hue has no direction at zero chroma, so a grey ramp does not
                // acquire a fabricated hue shift from floating point noise.
                if pair.iter().any(|v| v[1].hypot(v[2]) < 0.001)
                    || color::angle_delta(color::hue(pair[1]), color::hue(pair[0])).abs() < 1.0
                {
                    issues.push(format!("palette.hue_shift:{}", ramp.name));
                }
            }
        }
        Ok(issues)
    }
}
