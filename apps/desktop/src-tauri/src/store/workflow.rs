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

//! Advancing rechecks the stored pixels while the store is locked, so a stale
//! report cannot authorize a step after another writer has changed its input.

use super::{
    history::Mutation, AppError, AssetId, GateReport, OpResult, Result, StepState, Store, STEPS,
};
use crate::raster::{color, gates, IndexedBuffer, LayerRole};

impl Store {
    pub fn step_check(&self, id: AssetId) -> Result<GateReport> {
        let document = self.asset_open(id)?;
        let rules = super::effective_rules(&self.connection, &document.asset)?;
        let mut buffer = IndexedBuffer::new(document.asset.width, document.asset.height)?;
        for layer in &document.layers {
            if layer.visible && layer.opacity > 0.0 {
                for (dest, &source) in buffer.data.iter_mut().zip(&layer.buffer.data) {
                    if source != 0 {
                        *dest = source;
                    }
                }
            }
        }
        let metrics = gates::measure(&buffer, &document.palette)?;
        let mut issues = Vec::new();
        let step = document.asset.step.clone();
        let layer = |role| {
            document
                .layers
                .iter()
                .find(|l| l.role == LayerRole(role))
                .map(|l| &l.buffer)
        };
        let silhouette = layer("silhouette");
        let outside = |role| {
            layer(role).map_or(0, |b| {
                b.data
                    .iter()
                    .enumerate()
                    .filter(|(i, s)| **s != 0 && silhouette.map_or(true, |mask| mask.data[*i] == 0))
                    .count()
            })
        };
        let check_light = |issues: &mut Vec<String>| {
            if metrics.light_vectors.is_empty() {
                issues.push("gate.light_unmeasurable".into());
            }
            if metrics
                .light_std_degrees
                .is_some_and(|s| s > gates::HD2D.light_std_degrees)
            {
                issues.push("gate.light_inconsistent".into());
            }
            if let Some(mean) = metrics.light_mean_degrees {
                if metrics.light_vectors.iter().any(|angle| {
                    color::angle_delta(*angle, mean).abs() > gates::HD2D.light_region_deviation
                }) {
                    issues.push("gate.light_region_deviation".into());
                }
                let direction = match rules.light_direction.as_str() {
                    "upper-left" => -135.0,
                    "upper-right" => -45.0,
                    "lower-left" => 135.0,
                    "lower-right" => 45.0,
                    "up" => -90.0,
                    "down" => 90.0,
                    "left" => 180.0,
                    "right" => 0.0,
                    _ => -135.0,
                };
                if color::angle_delta(mean, direction).abs() > gates::HD2D.light_mean_deviation {
                    issues.push("gate.light_wrong_direction".into());
                }
            }
        };
        match step.as_str() {
            "reference" => {}
            "palette" => issues.extend(document.palette.gate_issues(&rules)?),
            "silhouette" => {
                let mask = silhouette
                    .ok_or_else(|| AppError::new("document.layer_not_found", "silhouette"))?;
                let measured = gates::measure(mask, &document.palette)?;
                if measured.region_sizes.len() != 1 {
                    issues.push("gate.silhouette_regions".into());
                }
                if !(gates::HD2D.perimeter_ratio[0]..=gates::HD2D.perimeter_ratio[1])
                    .contains(&measured.perimeter_squared_over_area)
                {
                    issues.push("gate.silhouette_readability".into());
                }
                if !(gates::HD2D.solidity[0]..=gates::HD2D.solidity[1]).contains(&measured.solidity)
                {
                    issues.push("gate.silhouette_solidity".into());
                }
            }
            "outline" => {
                if outside("outline") > 0 {
                    issues.push("gate.outline_outside".into());
                }
                if let Some(mask) = silhouette {
                    let mut edges = 0;
                    let mut outlined = 0;
                    for (i, &slot) in mask.data.iter().enumerate() {
                        if slot == 0 {
                            continue;
                        }
                        let x = (i % usize::from(mask.width)) as i32;
                        let y = (i / usize::from(mask.width)) as i32;
                        if [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]
                            .iter()
                            .any(|&(x, y)| mask.get(x, y) == 0)
                        {
                            edges += 1;
                            outlined +=
                                usize::from(layer("outline").is_some_and(|b| b.data[i] != 0));
                        }
                    }
                    let coverage = outlined as f32 / edges.max(1) as f32;
                    let range = if rules.outline == "full" {
                        [1.0, 1.0]
                    } else if rules.outline == "none" {
                        [0.0, 0.0]
                    } else {
                        rules.outline_coverage
                    };
                    if !(range[0]..=range[1]).contains(&coverage) {
                        issues.push("gate.outline_coverage".into());
                    }
                }
            }
            "shadow" => {
                check_light(&mut issues);
                if outside("shadow-core") + outside("shadow-deep") > 0 {
                    issues.push("gate.shadow_outside".into());
                }
            }
            "light" => {
                check_light(&mut issues);
                if metrics.pillow_correlation > gates::HD2D.pillow_correlation {
                    issues.push("gate.pillow_shading".into());
                }
                if metrics.jaggy_sequences > 0 {
                    issues.push("gate.jaggies".into());
                }
                if outside("light") > 0 {
                    issues.push("gate.light_outside".into());
                }
            }
            "rim" => {
                if outside("rim") > 0 {
                    issues.push("gate.rim_outside".into());
                }
                let mut perimeter = 0;
                let mut rim_count = 0;
                let mut misplaced = 0;
                if let Some(mask) = silhouette {
                    for (i, &slot) in mask.data.iter().enumerate() {
                        if slot == 0 {
                            continue;
                        }
                        let x = (i % usize::from(mask.width)) as i32;
                        let y = (i / usize::from(mask.width)) as i32;
                        let edge = [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]
                            .iter()
                            .any(|&(x, y)| mask.get(x, y) == 0);
                        perimeter += usize::from(edge);
                        if layer("rim").is_some_and(|b| b.data[i] != 0) {
                            rim_count += 1;
                            // The style guide places the backlight on the crown and
                            // the side opposite the key, rather than on the key side.
                            let back = if rules.light_direction.contains("left") {
                                mask.get(x + 1, y) == 0
                            } else {
                                mask.get(x - 1, y) == 0
                            };
                            if !edge
                                || (!back && mask.get(x, y - 1) != 0)
                                || y as f32 >= f32::from(mask.height) * 0.75
                            {
                                misplaced += 1;
                            }
                        }
                    }
                }
                if misplaced > 0 {
                    issues.push("gate.rim_direction".into());
                }
                let coverage = rim_count as f32 / perimeter.max(1) as f32;
                if !(rules.rim_coverage[0]..=rules.rim_coverage[1]).contains(&coverage) {
                    issues.push("gate.rim_coverage".into());
                }
            }
            "detail" => {
                if metrics.orphan_fraction > rules.noise_budget
                    || metrics.orphan_count > gates::HD2D.orphan_count
                {
                    issues.push("gate.noise".into());
                }
                if metrics.speckle_fraction > gates::HD2D.speckle_fraction {
                    issues.push("gate.speckle".into());
                }
            }
            "accent" => {
                if layer("accent").map_or(0, |b| b.data.iter().filter(|s| **s != 0).count())
                    > gates::HD2D.accent_count
                {
                    issues.push("gate.accent_budget".into());
                }
            }
            "variation" => {
                let baseline = self
                    .op_log(id)?
                    .into_iter()
                    .rev()
                    .filter(|op| op.kind == "palette_write")
                    .find_map(|op| {
                        op.inverse
                            .and_then(|bytes| serde_json::from_slice::<Mutation>(&bytes).ok())
                            .and_then(|m| {
                                if let Mutation::Palette(p) = m {
                                    (!p.slots.is_empty()).then_some(p)
                                } else {
                                    None
                                }
                            })
                    });
                match baseline {
                    Some(previous) => {
                        if previous.slots.len() != document.palette.slots.len()
                            || previous
                                .slots
                                .iter()
                                .zip(&document.palette.slots)
                                .any(|(a, b)| {
                                    (color::srgb_to_oklab(a.rgba)[0]
                                        - color::srgb_to_oklab(b.rgba)[0])
                                        .abs()
                                        > 0.01
                                })
                        {
                            issues.push("gate.variation_value_changed".into());
                        }
                    }
                    None => issues.push("gate.variation_baseline_missing".into()),
                }
            }
            _ => return Err(AppError::new("document.invalid_step", &step)),
        }
        Ok(GateReport {
            step,
            passed: issues.is_empty(),
            issues,
            metrics,
        })
    }
    pub fn step_state(&self, id: AssetId) -> Result<StepState> {
        let gate = self.step_check(id)?;
        Ok(StepState {
            asset_id: id,
            step: gate.step.clone(),
            can_advance: gate.passed && gate.step != "variation",
            gate,
        })
    }
    pub fn step_advance(&mut self, id: AssetId) -> Result<(StepState, OpResult)> {
        let state = self.step_state(id)?;
        if !state.gate.passed {
            return Err(AppError::new(
                "step.gate_failed",
                state.gate.issues.join(", "),
            ));
        }
        let position = STEPS
            .iter()
            .position(|s| *s == state.step)
            .ok_or_else(|| AppError::new("document.invalid_step", &state.step))?;
        let next = STEPS
            .get(position + 1)
            .ok_or_else(|| AppError::new("step.complete", "the final step has no successor"))?;
        let result = self.commit(id, Mutation::Step((*next).into()), "user")?;
        Ok((self.step_state(id)?, result))
    }
}
