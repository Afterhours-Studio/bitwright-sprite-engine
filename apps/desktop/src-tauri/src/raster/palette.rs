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

use super::gates::GateCheck;
use super::{color, RasterError, Result};
use serde::{Deserialize, Serialize};

/// §11.3 counts pairs of palette entries that differ by less than this in
/// OKLCH lightness *and* less than [`MUD_DELTA_HUE`] in hue, and the §11.7
/// table gives the target for that count as zero. Both members of such a pair
/// read as the same colour at sprite scale, so the second one is a wasted slot
/// and a source of the muddy mid-tones the rule is named after.
const MUD_DELTA_L: f32 = 0.05;
/// Measured as an Oklab hue angle, because the rule it comes from states its
/// companion threshold in OKLCH lightness and the two have to be read in the
/// same space to describe one colour difference.
const MUD_DELTA_HUE: f32 = 20.0;

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

impl Material {
    /// §2.3's value spread for this material, as OKLCH lightness from a ramp's
    /// darkest step to its lightest.
    ///
    /// Metal is the widest band in the table because metal reads as metal
    /// through its value range rather than through its hue. Materials the guide
    /// does not name have no band, and a ramp of one of those goes unmeasured
    /// rather than measured against a number nobody wrote down.
    pub fn value_spread(&self) -> Option<[f32; 2]> {
        Some(match self {
            Self::Cloth => [0.18, 0.26],
            Self::Skin => [0.22, 0.30],
            Self::Leather => [0.26, 0.34],
            Self::Hair => [0.24, 0.34],
            Self::Metal => [0.45, 0.60],
            _ => return None,
        })
    }
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
    pub fn gate_checks(&self, rules: &StyleRules) -> Result<Vec<GateCheck>> {
        self.validate(rules)?;
        let mut checks = vec![
            GateCheck::verdict(
                "palette-not-empty",
                !self.slots.is_empty(),
                format!("{} slots", self.slots.len()),
                "Add the colours the sprite needs; §2.1 budgets 14 to 22 of them for a 48x64 character.",
            ),
            GateCheck::verdict(
                "palette-has-ramps",
                !self.ramps.is_empty(),
                format!("{} ramps", self.ramps.len()),
                "Group the slots into one ramp per material, darkest step first, as §2.2 lays them out.",
            ),
        ];
        let (mut lengths, mut order, mut separation) = (Vec::new(), Vec::new(), Vec::new());
        let (mut hue, mut chroma, mut lightness) = (Vec::new(), Vec::new(), Vec::new());
        let mut spreads = Vec::new();
        for ramp in &self.ramps {
            if ramp.slots.len() < usize::from(rules.ramp_steps.min)
                || ramp.slots.len() > usize::from(rules.ramp_steps.max)
            {
                lengths.push(format!(
                    "{} has {} steps, outside {}..{}",
                    ramp.name,
                    ramp.slots.len(),
                    rules.ramp_steps.min,
                    rules.ramp_steps.max
                ));
            }
            // Skin, and anything else translucent, rotates toward red in shadow
            // rather than toward blue, because light that enters the surface and
            // scatters back out carries the blood under it. It is the one
            // material where the cool-shadow rule is inverted rather than
            // relaxed, so the whole exception is this sign.
            let warm = rules.warm_shadow_materials.contains(&ramp.material);
            // Every rule in §2.4 is stated as a step away from the material's
            // base, and the two directions disagree: a darker step may hold its
            // chroma, a lighter step must lose a fifth of it. Read against the
            // same pair those two rules contradict each other, so the base is
            // what decides which of them a pair answers to. It is the same base
            // the flats gate uses, the middle slot of the ramp.
            let base = ramp.slots.len() / 2;
            let shift = &rules.hue_shift;
            let invert = |bounds: [f32; 2]| [-bounds[1], -bounds[0]];
            let entries = ramp
                .slots
                .iter()
                .map(|index| self.slot(*index))
                .collect::<Result<Vec<_>>>()?;
            let labs: Vec<[f32; 3]> = entries
                .iter()
                .map(|slot| color::srgb_to_oklab(slot.rgba))
                .collect();
            for (step, pair) in labs.windows(2).enumerate() {
                // `step` indexes the pair's darker member, so a pair whose lighter
                // member is at or below the base was reached by stepping darker.
                let darker = step < base;
                if pair[1][0] <= pair[0][0] {
                    order.push(format!(
                        "{} steps {} and {} run L {:.3} then {:.3}",
                        ramp.name,
                        step,
                        step + 1,
                        pair[0][0],
                        pair[1][0]
                    ));
                }
                // Two steps that sit this close in value read as one colour
                // wherever they touch, which wastes a slot and leaves the form
                // undescribed at exactly the edge it was meant to show.
                let gap = pair[1][0] - pair[0][0];
                if gap < rules.min_edge_delta_l {
                    separation.push(format!(
                        "{} steps {} and {} differ by dL {:.3}",
                        ramp.name,
                        step,
                        step + 1,
                        gap
                    ));
                }
                // §2.4 gives the lightness move per step in both directions.
                // The bounds are signed from the darker step toward the lighter
                // one, which is the order a ramp is stored in, so the darker
                // rule's negative bracket is read back the way round the ramp
                // runs.
                let allowed = if darker {
                    invert(shift.darker_delta_l)
                } else {
                    shift.lighter_delta_l
                };
                if !(allowed[0]..=allowed[1]).contains(&gap) {
                    lightness.push(format!(
                        "{} steps {} and {} move dL {:.3}, outside {:.2}..{:.2} for a step {}",
                        ramp.name,
                        step,
                        step + 1,
                        gap,
                        allowed[0],
                        allowed[1],
                        if darker { "darker" } else { "lighter" }
                    ));
                }
                // Hue has no direction at zero chroma, so a grey ramp does not
                // acquire a fabricated hue shift from floating point noise.
                let grey = pair.iter().any(|lab| color::chroma(*lab) < 0.001);
                // Measured in HSL degrees, which is the unit the style rules are
                // written in, and in the direction the step is taken, which is
                // the direction the rule names.
                let (from, to) = if darker {
                    (step + 1, step)
                } else {
                    (step, step + 1)
                };
                let rotation = color::angle_delta(
                    color::hsl_hue(entries[to].rgba),
                    color::hsl_hue(entries[from].rgba),
                );
                // Skin, and anything else translucent, rotates toward red in
                // shadow rather than toward blue, because light that enters the
                // surface and scatters back out carries the blood under it. It
                // is the one material where the cool-shadow rule is inverted
                // rather than relaxed, so the whole exception is this sign.
                let mut bounds = if darker {
                    shift.darker_hue_deg
                } else {
                    shift.lighter_hue_deg
                };
                if warm {
                    bounds = invert(bounds);
                }
                if grey || !(bounds[0]..=bounds[1]).contains(&rotation) {
                    hue.push(format!(
                        "{} steps {} and {} rotate {:.1} deg, outside {:.0}..{:.0} for a step {}",
                        ramp.name,
                        step,
                        step + 1,
                        rotation,
                        bounds[0],
                        bounds[1],
                        if darker { "darker" } else { "lighter" }
                    ));
                }
                // Chroma is skipped on a grey pair rather than divided by zero,
                // and that pair has already been named by the hue rule.
                let factor = color::chroma(labs[to]) / color::chroma(labs[from]).max(f32::EPSILON);
                let bounds = if darker {
                    shift.darker_chroma_factor
                } else {
                    shift.lighter_chroma_factor
                };
                if !grey && !(bounds[0]..=bounds[1]).contains(&factor) {
                    chroma.push(format!(
                        "{} steps {} and {} scale chroma by {:.2}, outside {:.2}..{:.2} for a step {}",
                        ramp.name,
                        step,
                        step + 1,
                        factor,
                        bounds[0],
                        bounds[1],
                        if darker { "darker" } else { "lighter" }
                    ));
                }
            }
            // §2.3's spread is a property of the whole ramp rather than of any
            // step: it is what makes metal read as metal beside cloth.
            if let (Some(band), Some(low), Some(high)) = (
                ramp.material.value_spread(),
                labs.first().map(|lab| lab[0]),
                labs.last().map(|lab| lab[0]),
            ) {
                let spread = high - low;
                if !(band[0]..=band[1]).contains(&spread) {
                    spreads.push(format!(
                        "{} spans dL {:.3}, outside the {:.2}..{:.2} its material allows",
                        ramp.name, spread, band[0], band[1]
                    ));
                }
            }
        }
        let measured = match self.ramps.len() {
            1 => "1 ramp measured".to_string(),
            count => format!("{count} ramps measured"),
        };
        for (name, faults, hint) in [
            (
                "ramp-steps",
                lengths,
                "Give each ramp the step count §2.2 budgets for its material: 3 for cloth, 4 for skin, 5 for metal.",
            ),
            (
                "ramp-order",
                order,
                "Store each ramp darkest step first. A ramp that doubles back has no direction for the shading gates to read.",
            ),
            (
                "ramp-value-separation",
                separation,
                "Push the two steps apart until they differ by dL 0.07, which is the §2.5 floor for an edge the eye can read.",
            ),
            (
                "ramp-step-lightness",
                lightness,
                "Restate the step at the lightness §2.4 gives it: down 0.08 to 0.13 into shadow, up 0.09 to 0.15 into light.",
            ),
            (
                "ramp-hue-shift",
                hue,
                "Rotate the hue as you step: §2.4 asks 12 to 20 degrees toward blue going darker, the same toward yellow going lighter, and the opposite sign on skin.",
            ),
            (
                "ramp-chroma-shift",
                chroma,
                "Hold or lift chroma slightly into shadow and drop it to 0.70 to 0.85 into light, per §2.4. Bright light washes colour out; ambient shadow does not.",
            ),
            (
                "material-value-spread",
                spreads,
                "Widen or narrow the ramp to the §2.3 band for its material, which is what tells metal from cloth before hue does.",
            ),
        ] {
            checks.push(GateCheck::verdict(
                name,
                faults.is_empty(),
                if faults.is_empty() {
                    measured.clone()
                } else {
                    faults.join("; ")
                },
                hint,
            ));
        }
        // The floor and the ceiling are properties of the whole palette rather
        // than of any one ramp: they are what keeps a sprite from going to pure
        // black in its deepest occlusion or blowing out to paper white, both of
        // which read as a hole rather than as a surface.
        let labs: Vec<[f32; 3]> = self
            .slots
            .iter()
            .map(|slot| color::srgb_to_oklab(slot.rgba))
            .collect();
        let lightness: Vec<f32> = labs.iter().map(|lab| lab[0]).collect();
        if let Some(floor) = lightness.iter().copied().reduce(f32::min) {
            checks.push(GateCheck::verdict(
                "value-floor",
                (rules.value_floor[0]..=rules.value_floor[1]).contains(&floor),
                format!("darkest slot sits at L {floor:.3}"),
                format!(
                    "Move the darkest slot into L {:.2}..{:.2}. Below it the deepest occlusion has nowhere left to go, and pure black reads as a hole rather than a surface.",
                    rules.value_floor[0], rules.value_floor[1]
                ),
            ));
        }
        if let Some(ceiling) = lightness.iter().copied().reduce(f32::max) {
            checks.push(GateCheck::verdict(
                "value-ceiling",
                (rules.value_ceiling[0]..=rules.value_ceiling[1]).contains(&ceiling),
                format!("lightest slot sits at L {ceiling:.3}"),
                format!(
                    "Move the lightest slot into L {:.2}..{:.2}. Above it every material reads as the same mirror-finish plastic.",
                    rules.value_ceiling[0], rules.value_ceiling[1]
                ),
            ));
        }
        // §11.3 reads across the whole palette rather than along one ramp,
        // because two ramps can each be well formed and still be the same
        // colour as each other. Each such pair is a slot that buys nothing and
        // a place the sprite will go muddy.
        let mut muddy = Vec::new();
        for (first, a) in labs.iter().enumerate() {
            for (second, b) in labs.iter().enumerate().skip(first + 1) {
                // Two neutrals have no hue to differ in, so lightness is the
                // only thing that can separate them and the hue test would
                // otherwise excuse them on floating point noise.
                let neutral = color::chroma(*a) < 0.001 || color::chroma(*b) < 0.001;
                let angle = color::angle_delta(color::hue(*a), color::hue(*b)).abs();
                if (a[0] - b[0]).abs() < MUD_DELTA_L && (neutral || angle < MUD_DELTA_HUE) {
                    muddy.push(format!(
                        "slots {} and {} differ by dL {:.3} and {:.0} deg of hue",
                        self.slots[first].index,
                        self.slots[second].index,
                        (a[0] - b[0]).abs(),
                        if neutral { 0.0 } else { angle }
                    ));
                }
            }
        }
        checks.push(GateCheck::verdict(
            "distinct-palette-entries",
            muddy.is_empty(),
            if muddy.is_empty() {
                format!("{} slots, no pair within dL {MUD_DELTA_L} and {MUD_DELTA_HUE:.0} deg", self.slots.len())
            } else {
                muddy.join("; ")
            },
            "Merge each pair and spend the freed slot on a material that needs contrast, or push one of the two apart in lightness. §11.7 wants no such pair at all.",
        ));
        Ok(checks)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A three-step cloth ramp, darkest first, built to §2.4 step by step: the
    /// hue rotates 16 degrees cool into shadow, the lightness moves 0.11 per
    /// step, and the chroma holds into the shadow and drops to 0.79 into the
    /// light. Its spread is 0.22, inside the band §2.3 gives cloth.
    const CLOTH: [[u8; 4]; 3] = [[53, 59, 146, 255], [52, 97, 188, 255], [55, 142, 200, 255]];
    /// The same ramp built the other way round: its shadows rotate toward red,
    /// which is what §2.4 asks of skin and of anything else translucent.
    const SKIN: [[u8; 4]; 3] = [[126, 35, 17, 255], [159, 74, 9, 255], [168, 135, 56, 255]];
    /// The two colours §2.6 shares across a project. They are what carries a
    /// palette down to the value floor and up to the ceiling, because no single
    /// material's ramp is allowed to span that far at 0.11 a step.
    const OUTLINE_DARK: [u8; 4] = [8, 7, 14, 255];
    const RIM: [u8; 4] = [241, 220, 177, 255];

    /// One material's ramp, followed by the two shared global slots.
    fn ramped(colours: &[[u8; 4]], material: Material) -> Palette {
        let mut palette = Palette {
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
        };
        for rgba in [OUTLINE_DARK, RIM] {
            palette = with_loose_slot(palette, rgba);
        }
        palette
    }

    /// A second ramp appended to an existing palette, before the globals.
    fn with_ramp(palette: &Palette, colours: &[[u8; 4]], material: Material) -> Palette {
        let mut built = Palette {
            slots: palette.slots[..palette.slots.len() - 2].to_vec(),
            ramps: palette.ramps.clone(),
        };
        let first = built.slots.len() as u8 + 1;
        for (step, rgba) in colours.iter().enumerate() {
            built.slots.push(PaletteSlot {
                index: first + step as u8,
                rgba: *rgba,
                name: None,
                ramp: Some("second".into()),
                step: Some(step as u8),
            });
        }
        built.ramps.push(Ramp {
            name: "second".into(),
            material,
            slots: (first..first + colours.len() as u8).collect(),
        });
        for rgba in [OUTLINE_DARK, RIM] {
            built = with_loose_slot(built, rgba);
        }
        built
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

    fn checks(palette: &Palette) -> Vec<GateCheck> {
        palette.gate_checks(&StyleRules::default()).unwrap()
    }

    /// Whether the named check ran and failed. Asking for a check by name and
    /// getting nothing is a failure of the report rather than of the palette,
    /// so an absent name panics rather than reading as a pass.
    fn failed(palette: &Palette, name: &str) -> bool {
        let all = checks(palette);
        let check = all
            .iter()
            .find(|check| check.name == name)
            .unwrap_or_else(|| panic!("no check named {name} in {all:?}"));
        !check.pass
    }

    #[test]
    fn a_ramp_built_to_the_style_passes_every_check_and_says_what_it_measured() {
        let passing = checks(&ramped(&CLOTH, Material::Cloth));
        assert!(passing.iter().all(|check| check.pass), "{passing:?}");
        // A passing check still reports what it measured and carries no hint,
        // because there is nothing to recover from.
        let spread = passing
            .iter()
            .find(|check| check.name == "material-value-spread")
            .unwrap();
        assert!(spread.detail.is_some());
        assert_eq!(spread.hint, None);
    }

    #[test]
    fn a_failing_check_names_the_measurement_and_a_way_out_of_it() {
        let grey = [[8, 8, 8, 255], [80, 80, 80, 255], [150, 150, 150, 255]];
        let all = checks(&ramped(&grey, Material::Cloth));
        let shift = all
            .iter()
            .find(|check| check.name == "ramp-hue-shift")
            .unwrap();
        assert!(!shift.pass);
        assert!(shift.detail.as_ref().unwrap().contains("cloth"));
        assert!(shift.hint.as_ref().unwrap().contains("§2.4"));
    }

    #[test]
    fn a_ramp_of_the_wrong_length_is_named() {
        let short = ramped(&CLOTH[..2], Material::Cloth);
        assert!(failed(&short, "ramp-steps"));
        let rules = StyleRules {
            ramp_steps: RampSteps { min: 2, max: 2 },
            ..StyleRules::default()
        };
        assert!(short
            .gate_checks(&rules)
            .unwrap()
            .iter()
            .any(|check| check.name == "ramp-steps" && check.pass));
    }

    #[test]
    fn a_grey_ramp_has_no_hue_shift_to_find() {
        let grey = [[8, 8, 8, 255], [80, 80, 80, 255], [150, 150, 150, 255]];
        assert!(failed(&ramped(&grey, Material::Cloth), "ramp-hue-shift"));
        assert!(!failed(&ramped(&CLOTH, Material::Cloth), "ramp-hue-shift"));
    }

    #[test]
    fn two_steps_that_read_alike_fail_the_edge_delta() {
        let mut crowded = CLOTH;
        // Second step moved up against the first, so the pair no longer carries
        // the value difference the eye needs to see them as two colours.
        crowded[0] = [60, 80, 165, 255];
        assert!(failed(
            &ramped(&crowded, Material::Cloth),
            "ramp-value-separation"
        ));
        assert!(!failed(
            &ramped(&CLOTH, Material::Cloth),
            "ramp-value-separation"
        ));
    }

    #[test]
    fn a_step_that_moves_the_wrong_distance_in_value_is_named() {
        // §2.4 moves a step down 0.08 to 0.13 in OKLCH lightness and up 0.09 to
        // 0.15, and the rule was declared in `StyleRules` and read by nothing.
        // This ramp's shadow step falls 0.25 instead, which is two steps' worth
        // of value in one and leaves nothing for the occlusion below it.
        let mut stretched = CLOTH;
        stretched[0] = [22, 24, 74, 255];
        assert!(failed(
            &ramped(&stretched, Material::Cloth),
            "ramp-step-lightness"
        ));
        assert!(!failed(
            &ramped(&CLOTH, Material::Cloth),
            "ramp-step-lightness"
        ));
    }

    #[test]
    fn a_light_step_that_keeps_its_chroma_is_named() {
        // §2.4 washes colour out of a light step, to chroma 0.70 to 0.85 of the
        // base. This one holds its saturation all the way up, which is the
        // other rule that was written down and never enforced.
        let mut saturated = CLOTH;
        saturated[2] = [0, 148, 218, 255];
        assert!(failed(
            &ramped(&saturated, Material::Cloth),
            "ramp-chroma-shift"
        ));
        assert!(!failed(
            &ramped(&CLOTH, Material::Cloth),
            "ramp-chroma-shift"
        ));
    }

    #[test]
    fn a_material_shaded_outside_its_own_value_spread_is_named() {
        // §2.3 gives metal the widest band in the table, 0.45 to 0.60, because
        // metal reads as metal through its value range. A cloth ramp declared
        // as metal spans 0.22 and reads as cloth however it is labelled.
        assert!(failed(
            &ramped(&CLOTH, Material::Metal),
            "material-value-spread"
        ));
        assert!(!failed(
            &ramped(&CLOTH, Material::Cloth),
            "material-value-spread"
        ));
        // Eyes are two colours rather than a ramp, and §2.3 gives them no band,
        // so nothing is measured rather than something invented.
        assert!(!failed(
            &ramped(&CLOTH, Material::Eyes),
            "material-value-spread"
        ));
    }

    #[test]
    fn two_ramps_a_hair_apart_are_one_wasted_slot_each() {
        // Each ramp is well formed on its own, and every step of the second one
        // sits one or two sRGB units from a step of the first: dL 0.007 and
        // under a degree of hue. §11.7 wants no such pair anywhere in the
        // palette, and a check that only walks one ramp at a time cannot see
        // them at all.
        let cloth = ramped(&CLOTH, Material::Cloth);
        let twinned = with_ramp(
            &cloth,
            &[[55, 61, 148, 255], [54, 99, 190, 255], [57, 144, 202, 255]],
            Material::Cloth,
        );
        assert!(failed(&twinned, "distinct-palette-entries"));
        // Two ramps that share a lightness but not a hue are two materials, not
        // one material twice, and they have to keep passing.
        let paired = with_ramp(&cloth, &SKIN, Material::Skin);
        assert!(!failed(&paired, "distinct-palette-entries"));
        assert!(!failed(&cloth, "distinct-palette-entries"));
    }

    #[test]
    fn the_floor_and_the_ceiling_bound_the_whole_palette() {
        let passing = ramped(&CLOTH, Material::Cloth);
        assert!(!failed(&passing, "value-floor"));
        assert!(!failed(&passing, "value-ceiling"));
        let sunk = with_loose_slot(passing.clone(), [0, 0, 0, 255]);
        assert!(failed(&sunk, "value-floor"));
        let blown = with_loose_slot(passing, [255, 255, 255, 255]);
        assert!(failed(&blown, "value-ceiling"));
    }

    #[test]
    fn skin_shadows_rotate_warm_and_everything_else_rotates_cool() {
        // The same three colours are correct for skin and wrong for cloth,
        // which is the whole of the subsurface-scattering exception.
        assert!(!failed(&ramped(&SKIN, Material::Skin), "ramp-hue-shift"));
        assert!(failed(&ramped(&SKIN, Material::Cloth), "ramp-hue-shift"));
        // And the exception is an inversion, not a relaxation: a cool ramp is
        // wrong for skin exactly as a warm one is wrong for cloth.
        assert!(failed(&ramped(&CLOTH, Material::Skin), "ramp-hue-shift"));
        assert!(!failed(&ramped(&CLOTH, Material::Cloth), "ramp-hue-shift"));
    }

    #[test]
    fn a_malformed_palette_is_an_error_while_an_unfinished_one_is_an_issue() {
        let rules = StyleRules::default();
        let mut broken = ramped(&CLOTH, Material::Cloth);
        broken.slots[2].index = 9;
        assert_eq!(
            broken.gate_checks(&rules).unwrap_err().code,
            "palette.invalid_index"
        );
        let mut orphaned = ramped(&CLOTH, Material::Cloth);
        orphaned.ramps.clear();
        assert_eq!(
            orphaned.gate_checks(&rules).unwrap_err().code,
            "palette.invalid_ramp"
        );
        // An empty palette is merely unfinished, so it saves and is reported.
        let empty = Palette::default();
        let reported = empty.gate_checks(&rules).unwrap();
        assert!(reported
            .iter()
            .any(|check| check.name == "palette-not-empty" && !check.pass));
        assert!(reported
            .iter()
            .any(|check| check.name == "palette-has-ramps" && !check.pass));
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
        let palette = ramped(&CLOTH, Material::Cloth);
        assert_eq!(palette.nearest([50, 60, 150, 255]), Some(1));
        assert_eq!(palette.nearest([240, 220, 180, 255]), Some(5));
        assert_eq!(Palette::default().nearest([0, 0, 0, 255]), None);
        assert_eq!(palette.slot(9).unwrap_err().code, "palette.unknown_slot");
    }
}
