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
            "flats" => {
                let flats = layer("flats")
                    .ok_or_else(|| AppError::new("document.layer_not_found", "flats"))?;
                let mask = silhouette
                    .ok_or_else(|| AppError::new("document.layer_not_found", "silhouette"))?;
                if mask
                    .data
                    .iter()
                    .zip(&flats.data)
                    .any(|(mask, flat)| (*mask != 0) != (*flat != 0))
                {
                    issues.push("gate.flats_coverage".into());
                }
                for &slot in flats.data.iter().filter(|s| **s != 0) {
                    if !document
                        .palette
                        .ramps
                        .iter()
                        .any(|r| r.slots.get(r.slots.len() / 2) == Some(&slot))
                    {
                        issues.push("gate.flats_base_slot".into());
                        break;
                    }
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
            "accent" => {
                if layer("accent").map_or(0, |b| b.data.iter().filter(|s| **s != 0).count())
                    > gates::HD2D.accent_count
                {
                    issues.push("gate.accent_budget".into());
                }
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
            "cleanup" => {
                if metrics.orphan_fraction > rules.noise_budget
                    || metrics.orphan_count > gates::HD2D.orphan_count
                {
                    issues.push("gate.noise".into());
                }
                if metrics.speckle_fraction > gates::HD2D.speckle_fraction {
                    issues.push("gate.speckle".into());
                }
                if metrics.jaggy_sequences > 0 {
                    issues.push("gate.jaggies".into());
                }
                if metrics.pillow_correlation > gates::HD2D.pillow_correlation {
                    issues.push("gate.pillow_shading".into());
                }
                if document.layers.iter().any(|l| outside(l.role.0) > 0) {
                    issues.push("gate.cleanup_outside".into());
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raster::{grid, Material, Palette, PaletteSlot, Ramp};

    /// A four-step cloth ramp, darkest first, that satisfies the palette gate:
    /// its hue rotates cool into shadow and it spans the floor to the ceiling.
    const RAMP: [[u8; 4]; 4] = [
        [4, 7, 14, 255],
        [29, 71, 98, 255],
        [49, 153, 168, 255],
        [191, 237, 230, 255],
    ];
    /// A solid six-by-six body with a one pixel margin, whose perimeter is 20.
    const BODY: &str =
        "........\n.AAAAAA.\n.AAAAAA.\n.AAAAAA.\n.AAAAAA.\n.AAAAAA.\n.AAAAAA.\n........";
    const BLANK: &str =
        "........\n........\n........\n........\n........\n........\n........\n........";
    /// A rounded body: one region, and a perimeter the style calls readable.
    const READABLE: &str = "..AAAA..
.AAAAAA.
AAAAAAAA
AAAAAAAA
AAAAAAAA
AAAAAAAA
.AAAAAA.
..AAAA..";
    /// Two separate blobs, which is a silhouette that has not resolved.
    const SPLIT: &str =
        "AA....AA\nAA....AA\n........\n........\n........\n........\n........\n........";

    fn palette() -> Palette {
        Palette {
            slots: RAMP
                .iter()
                .enumerate()
                .map(|(step, rgba)| PaletteSlot {
                    index: step as u8 + 1,
                    rgba: *rgba,
                    name: None,
                    ramp: Some("cloth".into()),
                    step: Some(step as u8),
                })
                .collect(),
            ramps: vec![Ramp {
                name: "cloth".into(),
                material: Material::Cloth,
                slots: vec![1, 2, 3, 4],
            }],
        }
    }

    /// A store holding one asset parked on `step`, with the given layers drawn.
    fn asset(step: &str, drawn: &[(&str, &str)]) -> (Store, AssetId) {
        let mut store = Store::memory().unwrap();
        let project = store.project_create("project", "hd2d").unwrap();
        let canvas = grid::parse(drawn[0].1).unwrap();
        let asset = store
            .asset_create(
                project.id,
                "asset",
                "character",
                canvas.width,
                canvas.height,
            )
            .unwrap();
        store.palette_write(asset.id, palette()).unwrap();
        for (role, text) in drawn {
            let mut layer = store
                .layer_read(asset.id, LayerRole::parse(role).unwrap())
                .unwrap();
            layer.buffer = grid::parse(text).unwrap();
            store.layer_write(asset.id, layer).unwrap();
        }
        store
            .commit(asset.id, Mutation::Step(step.to_string()), "user")
            .unwrap();
        (store, asset.id)
    }

    fn issues(step: &str, drawn: &[(&str, &str)]) -> Vec<String> {
        let (store, id) = asset(step, drawn);
        store.step_check(id).unwrap().issues
    }

    fn raised(step: &str, drawn: &[(&str, &str)], code: &str) -> bool {
        issues(step, drawn).iter().any(|issue| issue == code)
    }

    #[test]
    fn the_reference_step_has_no_gate_and_advances_to_the_palette() {
        let (mut store, id) = asset("reference", &[("silhouette", BLANK)]);
        assert!(store.step_state(id).unwrap().can_advance);
        let (state, _) = store.step_advance(id).unwrap();
        assert_eq!(state.step, "palette");
    }

    #[test]
    fn the_palette_step_measures_the_ramp_rather_than_the_pixels() {
        let (mut store, id) = asset("palette", &[("silhouette", BLANK)]);
        assert!(store.step_check(id).unwrap().passed);
        // The same four slots with the colour drained out of them: still a
        // legal palette, no longer a legal ramp.
        let mut grey = palette();
        for (step, slot) in grey.slots.iter_mut().enumerate() {
            let value = 8 + step as u8 * 75;
            slot.rgba = [value, value, value, 255];
        }
        store.palette_write(id, grey).unwrap();
        assert!(store
            .step_check(id)
            .unwrap()
            .issues
            .contains(&"palette.hue_shift:cloth".to_string()));
    }

    #[test]
    fn a_silhouette_must_read_as_one_connected_shape() {
        assert!(raised(
            "silhouette",
            &[("silhouette", SPLIT)],
            "gate.silhouette_regions"
        ));
        assert!(!raised(
            "silhouette",
            &[("silhouette", BODY)],
            "gate.silhouette_regions"
        ));
    }

    #[test]
    fn a_silhouette_that_is_all_edge_fails_readability() {
        // A one pixel comb: the same area as a body spread over far more
        // perimeter, which is what an unreadable silhouette looks like.
        let comb = "A.A.A.A.\nA.A.A.A.\nA.A.A.A.\nAAAAAAAA\n........\n........\n........\n........";
        assert!(raised(
            "silhouette",
            &[("silhouette", comb)],
            "gate.silhouette_readability"
        ));
        assert!(!raised(
            "silhouette",
            &[("silhouette", READABLE)],
            "gate.silhouette_readability"
        ));
        // A solid rectangle fails the other way: it fills its own convex hull,
        // so it has no negative space and reads as a block, not a character.
        assert!(raised(
            "silhouette",
            &[("silhouette", BODY)],
            "gate.silhouette_solidity"
        ));
    }

    #[test]
    fn flats_must_cover_the_silhouette_exactly_and_sit_mid_ramp() {
        let filled = BODY.replace('A', "C");
        let holed = filled.replacen("CCCCCC", "CCCC.C", 1);
        assert!(raised(
            "flats",
            &[("silhouette", BODY), ("flats", &holed)],
            "gate.flats_coverage"
        ));
        assert!(!raised(
            "flats",
            &[("silhouette", BODY), ("flats", &filled)],
            "gate.flats_coverage"
        ));
        // Slot 3 is the middle of the four step ramp, so it is the base a
        // material shades away from. Slot 2 is already a shadow step.
        assert!(raised(
            "flats",
            &[("silhouette", BODY), ("flats", &BODY.replace('A', "B"))],
            "gate.flats_base_slot"
        ));
        assert!(!raised(
            "flats",
            &[("silhouette", BODY), ("flats", &filled)],
            "gate.flats_base_slot"
        ));
    }

    /// A body whose light sits upper left and whose shadow sits lower right,
    /// which is the direction the default style rules name.
    const LIT: [(&str, &str); 4] = [
        (
            "silhouette",
            "........\n........\n..AAAA..\n..AAAA..\n..AAAA..\n..AAAA..\n........\n........",
        ),
        (
            "flats",
            "........\n........\n..CCCC..\n..CCCC..\n..CCCC..\n..CCCC..\n........\n........",
        ),
        (
            "light",
            "........\n........\n..DD....\n..DD....\n........\n........\n........\n........",
        ),
        (
            "shadow-core",
            "........\n........\n........\n........\n....BB..\n....BB..\n........\n........",
        ),
    ];

    #[test]
    fn the_shadow_step_needs_a_light_direction_it_can_measure() {
        // A body painted in one slot has no dark to light vector at all, so
        // there is nothing to check the key direction against.
        let flat = &LIT[..2];
        assert!(raised("shadow", flat, "gate.light_unmeasurable"));
        assert!(!raised("shadow", &LIT, "gate.light_unmeasurable"));
        assert!(!raised("shadow", &LIT, "gate.light_wrong_direction"));
    }

    #[test]
    fn a_light_that_disagrees_with_the_style_is_named() {
        // The same body with the light and the shadow exchanged, so the key
        // now reads as coming from the lower right.
        let inverted = [
            LIT[0],
            LIT[1],
            (
                "light",
                "........\n........\n........\n........\n....DD..\n....DD..\n........\n........",
            ),
            (
                "shadow-core",
                "........\n........\n..BB....\n..BB....\n........\n........\n........\n........",
            ),
        ];
        assert!(raised("shadow", &inverted, "gate.light_wrong_direction"));
    }

    #[test]
    fn the_light_step_catches_shading_that_runs_inward_from_the_edge() {
        // Concentric rings getting lighter toward the middle: the textbook
        // pillow, and the exact correlation the gate measures.
        let rings = [
            ("silhouette", "AAAAA\nAAAAA\nAAAAA\nAAAAA\nAAAAA"),
            ("flats", "AAAAA\nABBBA\nABCBA\nABBBA\nAAAAA"),
        ];
        assert!(raised("light", &rings, "gate.pillow_shading"));
        assert!(!raised("light", &LIT, "gate.pillow_shading"));
    }

    #[test]
    fn the_detail_step_counts_loose_pixels_against_the_noise_budget() {
        let scattered =
            "A.A.A.A.\n........\nA.A.A.A.\n........\nA.A.A.A.\n........\nA.A.A.A.\n........";
        assert!(raised("detail", &[("detail", scattered)], "gate.noise"));
        assert!(!raised("detail", &[("detail", BODY)], "gate.noise"));
    }

    #[test]
    fn the_cleanup_step_refuses_pixels_outside_the_silhouette() {
        let stray =
            "B.......\n.AAAAAA.\n.AAAAAA.\n.AAAAAA.\n.AAAAAA.\n.AAAAAA.\n.AAAAAA.\n........";
        assert!(raised(
            "cleanup",
            &[("silhouette", BODY), ("detail", stray)],
            "gate.cleanup_outside"
        ));
        assert!(!raised(
            "cleanup",
            &[("silhouette", BODY), ("detail", BLANK)],
            "gate.cleanup_outside"
        ));
    }

    #[test]
    fn the_accent_step_bounds_the_rim_to_a_share_of_the_perimeter() {
        // Four pixels of a twenty pixel perimeter is a fifth, the middle of the
        // style's band. None at all is not a rim.
        let rim = "........\n......B.\n......B.\n......B.\n......B.\n........\n........\n........";
        assert!(!raised(
            "accent",
            &[("silhouette", BODY), ("rim", rim)],
            "gate.rim_coverage"
        ));
        assert!(!raised(
            "accent",
            &[("silhouette", BODY), ("rim", rim)],
            "gate.rim_direction"
        ));
        assert!(raised(
            "accent",
            &[("silhouette", BODY), ("rim", BLANK)],
            "gate.rim_coverage"
        ));
        // A rim on the side the key strikes is misplaced however much of it
        // there is, because a backlight cannot reach that edge.
        let front =
            "........\n.B......\n.B......\n.B......\n.B......\n........\n........\n........";
        assert!(raised(
            "accent",
            &[("silhouette", BODY), ("rim", front)],
            "gate.rim_direction"
        ));
    }

    #[test]
    fn the_outline_step_bounds_coverage_and_keeps_it_inside_the_shape() {
        // Thirteen of twenty perimeter pixels: a selective outline, which is
        // what leaves the lit edge open.
        let selective =
            "........\n.BBBBBB.\n.B......\n........\n........\n........\n.BBBBBB.\n........";
        assert!(!raised(
            "outline",
            &[("silhouette", BODY), ("outline", selective)],
            "gate.outline_coverage"
        ));
        assert!(raised(
            "outline",
            &[("silhouette", BODY), ("outline", BLANK)],
            "gate.outline_coverage"
        ));
        let escaped =
            "B.......\n.BBBBBB.\n.B......\n........\n........\n........\n.BBBBBB.\n........";
        assert!(raised(
            "outline",
            &[("silhouette", BODY), ("outline", escaped)],
            "gate.outline_outside"
        ));
    }

    #[test]
    fn advancing_is_refused_while_a_gate_fails_and_leaves_the_step_alone() {
        let (mut store, id) = asset("silhouette", &[("silhouette", SPLIT)]);
        assert!(!store.step_state(id).unwrap().can_advance);
        assert_eq!(store.step_advance(id).unwrap_err().code, "step.gate_failed");
        assert_eq!(store.asset_read(id).unwrap().step, "silhouette");
    }

    #[test]
    fn the_last_step_has_no_successor_and_an_unknown_step_is_refused() {
        let (mut store, id) = asset("variation", &[("silhouette", BLANK)]);
        // `variation` forks the asset rather than progressing, so it is the end
        // of the line however its own gate reports.
        assert!(!store.step_state(id).unwrap().can_advance);
        assert!(store
            .commit(id, Mutation::Step("sketching".into()), "user")
            .is_err());
    }
}
