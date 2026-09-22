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
        if self.slots.len() > usize::from(rules.max_slots.min(62)) {
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

    /// Everything about this palette the style guide would reject, by name.
    ///
    /// These are separate from [`Palette::validate`] on purpose. A malformed
    /// palette cannot be stored at all, whereas an unfinished one can: an artist
    /// halfway through building a ramp still needs to save. So a structural
    /// fault is an error here and a style fault is a listed issue, and only the
    /// second kind is what holds the `palette` step closed.
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
            // Skin, and anything else translucent, rotates toward red in shadow
            // rather than toward blue, because light that enters the surface and
            // scatters back out carries the blood under it. It is the one
            // material where the cool-shadow rule is inverted rather than
            // relaxed, so the whole exception is this sign.
            let warm = rules.warm_shadow_materials.contains(&ramp.material);
            let bounds = rules.hue_shift.darker_hue_deg;
            let darker_rotation = if warm {
                [-bounds[1], -bounds[0]]
            } else {
                bounds
            };
            let entries = ramp
                .slots
                .iter()
                .map(|index| self.slot(*index))
                .collect::<Result<Vec<_>>>()?;
            let labs: Vec<[f32; 3]> = entries
                .iter()
                .map(|slot| color::srgb_to_oklab(slot.rgba))
                .collect();
            let (mut misordered, mut too_close, mut unshifted) = (false, false, false);
            for (step, pair) in labs.windows(2).enumerate() {
                misordered |= pair[1][0] <= pair[0][0];
                // Two steps that sit this close in value read as one colour
                // wherever they touch, which wastes a slot and leaves the form
                // undescribed at exactly the edge it was meant to show.
                too_close |= pair[1][0] - pair[0][0] < rules.min_edge_delta_l;
                // Hue has no direction at zero chroma, so a grey ramp does not
                // acquire a fabricated hue shift from floating point noise.
                let grey = pair.iter().any(|lab| color::chroma(*lab) < 0.001);
                // Measured in HSL degrees, which is the unit the style rules are
                // written in, and from the lighter step toward the darker one,
                // which is the direction the rule names.
                let rotation = color::angle_delta(
                    color::hsl_hue(entries[step].rgba),
                    color::hsl_hue(entries[step + 1].rgba),
                );
                unshifted |= grey || !(darker_rotation[0]..=darker_rotation[1]).contains(&rotation);
            }
            // One fault per ramp, however many of its steps share it, so the
            // report names what is wrong rather than how long the ramp is.
            for (failed, code) in [
                (misordered, "palette.ramp_order"),
                (too_close, "palette.edge_delta_l"),
                (unshifted, "palette.hue_shift"),
            ] {
                if failed {
                    issues.push(format!("{code}:{}", ramp.name));
                }
            }
        }
        // The floor and the ceiling are properties of the whole palette rather
        // than of any one ramp: they are what keeps a sprite from going to pure
        // black in its deepest occlusion or blowing out to paper white, both of
        // which read as a hole rather than as a surface.
        let lightness: Vec<f32> = self
            .slots
            .iter()
            .map(|slot| color::srgb_to_oklab(slot.rgba)[0])
            .collect();
        if let Some(floor) = lightness.iter().copied().reduce(f32::min) {
            if !(rules.value_floor[0]..=rules.value_floor[1]).contains(&floor) {
                issues.push("palette.value_floor".into());
            }
        }
        if let Some(ceiling) = lightness.iter().copied().reduce(f32::max) {
            if !(rules.value_ceiling[0]..=rules.value_ceiling[1]).contains(&ceiling) {
                issues.push("palette.value_ceiling".into());
            }
        }
        Ok(issues)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A four-step ramp, darkest first, whose hue rotates cool into shadow by
    /// the sixteen degrees the `hd2d` rules ask for, spanning the value floor
    /// to the value ceiling.
    const COOL: [[u8; 4]; 4] = [
        [4, 7, 14, 255],
        [29, 71, 98, 255],
        [49, 153, 168, 255],
        [191, 237, 230, 255],
    ];
    /// The same ramp built the other way round: its shadows rotate toward red.
    const WARM: [[u8; 4]; 4] = [
        [12, 5, 4, 255],
        [91, 57, 31, 255],
        [166, 132, 55, 255],
        [230, 229, 180, 255],
    ];

    fn ramped(colours: &[[u8; 4]], material: Material) -> Palette {
        Palette {
            slots: colours
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
                material,
                slots: (1..=colours.len() as u8).collect(),
            }],
        }
    }

    /// Appends a slot that belongs to no ramp, to move the palette's extremes.
    fn with_loose_slot(mut palette: Palette, rgba: [u8; 4]) -> Palette {
        palette.slots.push(PaletteSlot {
            index: palette.slots.len() as u8 + 1,
            rgba,
            name: None,
            ramp: None,
            step: None,
        });
        palette
    }

    fn issues(palette: &Palette) -> Vec<String> {
        palette.gate_issues(&StyleRules::default()).unwrap()
    }

    #[test]
    fn a_ramp_built_to_the_style_passes_every_gate() {
        assert_eq!(
            issues(&ramped(&COOL, Material::Cloth)),
            Vec::<String>::new()
        );
    }

    #[test]
    fn a_ramp_of_the_wrong_length_is_named() {
        let short = ramped(&COOL[..2], Material::Cloth);
        assert!(issues(&short).contains(&"palette.ramp_steps:cloth".to_string()));
        let rules = StyleRules {
            ramp_steps: RampSteps { min: 2, max: 2 },
            ..StyleRules::default()
        };
        assert!(!short
            .gate_issues(&rules)
            .unwrap()
            .contains(&"palette.ramp_steps:cloth".to_string()));
    }

    #[test]
    fn a_grey_ramp_has_no_hue_shift_to_find() {
        let grey = [
            [8, 8, 8, 255],
            [80, 80, 80, 255],
            [150, 150, 150, 255],
            [235, 235, 235, 255],
        ];
        assert!(issues(&ramped(&grey, Material::Cloth))
            .contains(&"palette.hue_shift:cloth".to_string()));
        assert!(!issues(&ramped(&COOL, Material::Cloth))
            .contains(&"palette.hue_shift:cloth".to_string()));
    }

    #[test]
    fn two_steps_that_read_alike_fail_the_edge_delta() {
        let mut crowded = COOL;
        // Second step moved up against the first, so the pair no longer carries
        // the value difference the eye needs to see them as two colours.
        crowded[1] = [10, 14, 22, 255];
        assert!(issues(&ramped(&crowded, Material::Cloth))
            .contains(&"palette.edge_delta_l:cloth".to_string()));
        assert!(!issues(&ramped(&COOL, Material::Cloth))
            .contains(&"palette.edge_delta_l:cloth".to_string()));
    }

    #[test]
    fn the_floor_and_the_ceiling_bound_the_whole_palette() {
        let passing = ramped(&COOL, Material::Cloth);
        assert!(!issues(&passing)
            .iter()
            .any(|i| i.starts_with("palette.value")));
        let sunk = with_loose_slot(passing.clone(), [0, 0, 0, 255]);
        assert!(issues(&sunk).contains(&"palette.value_floor".to_string()));
        let blown = with_loose_slot(passing, [255, 255, 255, 255]);
        assert!(issues(&blown).contains(&"palette.value_ceiling".to_string()));
    }

    #[test]
    fn skin_shadows_rotate_warm_and_everything_else_rotates_cool() {
        let shift = "palette.hue_shift:cloth".to_string();
        // The same four colours are correct for skin and wrong for cloth, which
        // is the whole of the subsurface-scattering exception.
        assert!(!issues(&ramped(&WARM, Material::Skin)).contains(&shift));
        assert!(issues(&ramped(&WARM, Material::Cloth)).contains(&shift));
        // And the exception is an inversion, not a relaxation: a cool ramp is
        // wrong for skin exactly as a warm one is wrong for cloth.
        assert!(issues(&ramped(&COOL, Material::Skin)).contains(&shift));
        assert!(!issues(&ramped(&COOL, Material::Cloth)).contains(&shift));
    }

    #[test]
    fn a_malformed_palette_is_an_error_while_an_unfinished_one_is_an_issue() {
        let rules = StyleRules::default();
        let mut broken = ramped(&COOL, Material::Cloth);
        broken.slots[2].index = 9;
        assert_eq!(
            broken.gate_issues(&rules).unwrap_err().code,
            "palette.invalid_index"
        );
        let mut orphaned = ramped(&COOL, Material::Cloth);
        orphaned.ramps.clear();
        assert_eq!(
            orphaned.gate_issues(&rules).unwrap_err().code,
            "palette.invalid_ramp"
        );
        // An empty palette is merely unfinished, so it saves and is reported.
        let empty = Palette::default();
        assert_eq!(
            empty.gate_issues(&rules).unwrap(),
            vec!["palette.empty".to_string(), "palette.no_ramps".to_string()]
        );
    }

    #[test]
    fn a_preset_narrows_the_rules_rather_than_replacing_them() {
        assert_eq!(StyleRules::preset("snes").unwrap().max_slots, 16);
        assert_eq!(StyleRules::preset("gameboy").unwrap().outline, "full");
        assert_eq!(
            StyleRules::preset("vector").unwrap_err().code,
            "style.invalid_preset"
        );
    }

    #[test]
    fn nearest_is_measured_perceptually_rather_than_in_srgb() {
        let palette = ramped(&COOL, Material::Cloth);
        assert_eq!(palette.nearest([5, 8, 15, 255]), Some(1));
        assert_eq!(palette.nearest([200, 240, 235, 255]), Some(4));
        assert_eq!(Palette::default().nearest([0, 0, 0, 255]), None);
        assert_eq!(palette.slot(9).unwrap_err().code, "palette.unknown_slot");
    }
}
