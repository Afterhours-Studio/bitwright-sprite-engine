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
use crate::raster::gates::GateCheck;
use crate::raster::{color, gates, IndexedBuffer, LayerRole};

impl Store {
    pub fn step_check(&self, id: AssetId) -> Result<GateReport> {
        let document = self.asset_open(id)?;
        let rules = super::effective_rules(&self.connection, &document.asset)?;
        let mut buffer = IndexedBuffer::new(document.asset.width, document.asset.height)?;
        let mut ordered: Vec<_> = document.layers.iter().collect();
        ordered.sort_by_key(|layer| layer.ordinal);
        for layer in &ordered {
            if layer.visible && layer.opacity > 0.0 {
                for (dest, &source) in buffer.data.iter_mut().zip(&layer.buffer.data) {
                    if source != 0 {
                        *dest = source;
                    }
                }
            }
        }
        let metrics = gates::measure(&buffer, &document.palette)?;
        let mut checks: Vec<GateCheck> = Vec::new();
        let step = document.asset.step.clone();
        let width = usize::from(document.asset.width);
        // Every slot's lightness, taken from the palette rather than from the
        // pixels, because a fill the rim covers completely still has to be
        // measurable as the thing the rim is supposed to be brighter than.
        let mut lightness = [0.0_f32; 64];
        for slot in &document.palette.slots {
            if let Some(cell) = lightness.get_mut(usize::from(slot.index)) {
                *cell = color::srgb_to_oklab(slot.rgba)[0];
            }
        }
        let layer = |role| {
            document
                .layers
                .iter()
                .find(|l| l.role == LayerRole(role))
                .map(|l| &l.buffer)
        };
        let silhouette = layer("silhouette");
        let key = gates::key_vector(&rules.light_direction);
        let edges = silhouette.map_or_else(Vec::new, |mask| gates::edge_pixels(mask, key));
        let ring = silhouette.map_or_else(Vec::new, |mask| gates::perimeter_ring(mask, key));
        let point = |i: usize| ((i % width) as u16, (i / width) as u16);
        let outside = |role: &'static str| -> Vec<(u16, u16)> {
            layer(role).map_or_else(Vec::new, |b| {
                b.data
                    .iter()
                    .enumerate()
                    .filter(|(i, s)| **s != 0 && silhouette.map_or(true, |mask| mask.data[*i] == 0))
                    .map(|(i, _)| point(i))
                    .collect()
            })
        };
        let confined = |name: &str, roles: &[&'static str]| {
            let stray: Vec<(u16, u16)> = roles.iter().flat_map(|role| outside(role)).collect();
            GateCheck::verdict(
                name,
                stray.is_empty(),
                format!("{} pixels fall outside the silhouette", stray.len()),
                format!(
                    "Erase the pixels at {}, or widen the silhouette to take them in. Paint outside the mask is paint the sprite's shape does not account for.",
                    gates::named_points(&stray)
                ),
            )
        };
        let noise = || {
            let over = metrics.orphan_fraction > rules.noise_budget
                || metrics.orphan_count > gates::HD2D.orphan_count;
            GateCheck::verdict(
                "noise",
                !over,
                format!(
                    "{} orphan pixels, {:.1}% of filled",
                    metrics.orphan_count,
                    metrics.orphan_fraction * 100.0
                ),
                format!(
                    "Merge each lone pixel into its commonest neighbour, or grow it to a 2x2 cluster if it was carrying information. §11.1 allows {} of them and {:.0}% of filled pixels.",
                    gates::HD2D.orphan_count,
                    rules.noise_budget * 100.0
                ),
            )
        };
        let speckle = || {
            GateCheck::verdict(
                "speckle",
                metrics.speckle_fraction <= gates::HD2D.speckle_fraction,
                format!(
                    "{:.1}% of filled pixels have at most one like neighbour",
                    metrics.speckle_fraction * 100.0
                ),
                format!(
                    "Consolidate the scattered pixels into runs of two or more. §11.1 puts the ceiling at {:.0}%.",
                    gates::HD2D.speckle_fraction * 100.0
                ),
            )
        };
        let jaggies = || {
            GateCheck::verdict(
                "jaggies",
                metrics.jaggy_sequences == 0,
                format!("{} chewed edge sequences", metrics.jaggy_sequences),
                "Rewrite each flagged edge as a monotone run sequence such as 5,4,3,2,1,1. §11.2 warns that anti-aliasing a bad line only blurs it.",
            )
        };
        let pillow = || {
            GateCheck::verdict(
                "pillow-shading",
                metrics.pillow_correlation <= gates::HD2D.pillow_correlation,
                format!(
                    "lightness tracks edge distance at r {:.2} in the worst window",
                    metrics.pillow_correlation
                ),
                format!(
                    "Re-shade so each band follows its form's cross-section rather than the silhouette's offset. §7.2 wants r at or under {:.1}.",
                    gates::HD2D.pillow_correlation
                ),
            )
        };
        let check_light = || {
            let mut light = vec![GateCheck::verdict(
                "light-measurable",
                !(metrics.light_vectors.is_empty() && metrics.undirected_regions.is_empty()),
                format!("{} regions carry a light vector", metrics.light_vectors.len()),
                "Shade at least one form larger than 6x6 px: fill the side facing away from the key with that material's shadow1, per §5.2.",
            )];
            // A shaded region whose dark and light bands share a centroid is
            // lit from nowhere. It has to be named on its own, because every
            // other check here reads the vector list, and a region that
            // contributes no vector is invisible to all of them.
            let named = metrics
                .undirected_regions
                .iter()
                .map(gates::RegionBounds::to_string)
                .collect::<Vec<_>>()
                .join("; ");
            light.push(GateCheck::verdict(
                "light-directed",
                metrics.undirected_regions.is_empty(),
                if metrics.undirected_regions.is_empty() {
                    "every shaded region points somewhere".into()
                } else {
                    format!("{named} shade symmetrically about their own centre")
                },
                format!(
                    "Re-shade {named} from the key direction so the light band sits off centre. Shading symmetric about a form's middle is the pillow of §7.2 with no direction left to read."
                ),
            ));
            if let Some(deviation) = metrics.light_std_degrees {
                light.push(GateCheck::verdict(
                    "light-consistent",
                    deviation <= gates::HD2D.light_std_degrees,
                    format!("light vectors scatter by {deviation:.0} deg"),
                    format!(
                        "Re-shade the regions that disagree rather than the whole sprite. §11.4 allows a circular standard deviation of {:.0} deg.",
                        gates::HD2D.light_std_degrees
                    ),
                ));
            }
            if let Some(mean) = metrics.light_mean_degrees {
                let strays = metrics
                    .light_vectors
                    .iter()
                    .filter(|angle| {
                        color::angle_delta(**angle, mean).abs() > gates::HD2D.light_region_deviation
                    })
                    .count();
                light.push(GateCheck::verdict(
                    "light-region-agreement",
                    strays == 0,
                    format!(
                        "{strays} of {} regions differ from the {mean:.0} deg mean by over {:.0} deg",
                        metrics.light_vectors.len(),
                        gates::HD2D.light_region_deviation
                    ),
                    "Re-shade the offending regions to the shared key. §11.4 calls a sprite lit two ways a collage.",
                ));
                let declared = gates::key_degrees(&rules.light_direction);
                light.push(GateCheck::verdict(
                    "light-matches-key",
                    color::angle_delta(mean, declared).abs() <= gates::HD2D.light_mean_deviation,
                    format!(
                        "shading points {mean:.0} deg against the declared {} at {declared:.0} deg",
                        rules.light_direction
                    ),
                    format!(
                        "Move the light bands to the {} side and the shadow bands opposite them. §5.1 fixes one key for the whole project.",
                        rules.light_direction
                    ),
                ));
            }
            light
        };
        match step.as_str() {
            "reference" => {}
            "palette" => checks.extend(document.palette.gate_checks(&rules)?),
            "silhouette" => {
                let mask = silhouette
                    .ok_or_else(|| AppError::new("document.layer_not_found", "silhouette"))?;
                let measured = gates::measure(mask, &document.palette)?;
                let strays: Vec<(u16, u16)> = gates::connected_regions(mask)
                    .iter()
                    .skip(1)
                    .filter_map(|region| region.first().map(|&i| gates::point(mask, i)))
                    .collect();
                let others = measured
                    .region_sizes
                    .iter()
                    .skip(1)
                    .map(|size| format!("{size}px"))
                    .collect::<Vec<_>>()
                    .join(" and ");
                checks.push(GateCheck::verdict(
                    "single-region",
                    measured.region_sizes.len() == 1,
                    format!(
                        "{} disconnected regions; largest is {}px, others {others}",
                        measured.region_sizes.len(),
                        measured.region_sizes.first().copied().unwrap_or(0)
                    ),
                    format!(
                        "Remove the stray pixels at {}, or connect them to the main mass. §3.1 settles the silhouette as one shape before any second colour is placed.",
                        gates::named_points(&strays)
                    ),
                ));
                let ratio = measured.perimeter_squared_over_area;
                let band = gates::HD2D.perimeter_ratio;
                checks.push(GateCheck::verdict(
                    "reads-at-1x",
                    (band[0]..=band[1]).contains(&ratio),
                    format!(
                        "perimeter squared over area is {ratio:.1}, target {}..{}",
                        band[0], band[1]
                    ),
                    if ratio > band[1] {
                        "Thicken or remove the single-pixel spikes. §3.4 calls an edge above this band fringed, and fringe disappears at display scale."
                    } else {
                        "Exaggerate the defining extremity - weapon, hat, hair - until the shape has features. §3.4 calls a shape below this band a lump."
                    },
                ));
                let band = gates::HD2D.solidity;
                checks.push(GateCheck::verdict(
                    "solidity",
                    (band[0]..=band[1]).contains(&measured.solidity),
                    format!(
                        "the shape fills {:.2} of its convex hull, target {}..{}",
                        measured.solidity, band[0], band[1]
                    ),
                    if measured.solidity > band[1] {
                        "Carve a notch of at least 2x2 px between arm and torso or between the legs. §11.6 calls a shape this solid a silhouette with no negative space."
                    } else {
                        "Thicken the limbs. §11.6 calls a shape this sparse spindly, and it reads as a wire frame rather than a body."
                    },
                ));
            }
            "flats" => {
                let flats = layer("flats")
                    .ok_or_else(|| AppError::new("document.layer_not_found", "flats"))?;
                let mask = silhouette
                    .ok_or_else(|| AppError::new("document.layer_not_found", "silhouette"))?;
                let uncovered: Vec<(u16, u16)> = mask
                    .data
                    .iter()
                    .zip(&flats.data)
                    .enumerate()
                    .filter(|(_, (mask, flat))| (**mask != 0) != (**flat != 0))
                    .map(|(i, _)| point(i))
                    .collect();
                checks.push(GateCheck::verdict(
                    "flats-cover-silhouette",
                    uncovered.is_empty(),
                    format!("{} pixels disagree with the silhouette", uncovered.len()),
                    format!(
                        "Fill or clear the pixels at {}. The flats step gives every silhouette pixel a material and adds none of its own.",
                        gates::named_points(&uncovered)
                    ),
                ));
                let stray: Vec<(u16, u16)> = flats
                    .data
                    .iter()
                    .enumerate()
                    .filter(|(_, slot)| {
                        **slot != 0
                            && !document
                                .palette
                                .ramps
                                .iter()
                                .any(|r| r.slots.get(r.slots.len() / 2) == Some(slot))
                    })
                    .map(|(i, _)| point(i))
                    .collect();
                checks.push(GateCheck::verdict(
                    "flats-base-slots",
                    stray.is_empty(),
                    format!(
                        "{} pixels use a slot that is not a ramp's base step",
                        stray.len()
                    ),
                    format!(
                        "Repaint the pixels at {} in the middle step of their material's ramp. Step 2 places base colours only; shadow and light steps arrive later.",
                        gates::named_points(&stray)
                    ),
                ));
                // Coverage is exact and every slot is a legal base, and a
                // checkerboard of two materials satisfies both of those. What
                // it fails is that flats are areas: §11.5 measures how often
                // colour changes along a row, and two materials interleaved
                // change on nearly every pair.
                let rate = gates::horizontal_change_rate(flats);
                checks.push(GateCheck::verdict(
                    "flats-material-blocks",
                    rate <= gates::HD2D.change_rate,
                    format!("colour changes on {rate:.2} of horizontal pixel pairs"),
                    format!(
                        "Give each material one contiguous area rather than interleaving them. §11.5 calls a sprite busy above {:.2}, and at the flats step there is no detail to blame it on.",
                        gates::HD2D.change_rate
                    ),
                ));
            }
            "outline" => {
                checks.push(confined("outline-inside-silhouette", &["outline"]));
                if let Some(mask) = silhouette {
                    let outline = layer("outline");
                    let painted = |pixel: &gates::EdgePixel| {
                        outline.is_some_and(|b| b.data[pixel.index] != 0)
                    };
                    // An outline pixel that is neither on a perimeter nor
                    // outside the shape is inside it, where §4.4 gives the job
                    // to a separator drawn in the occluded form's shadow step.
                    // Coverage is a ratio over edge pixels, so without this
                    // nothing bounds the interior at all.
                    let interior: Vec<(u16, u16)> = outline.map_or_else(Vec::new, |b| {
                        b.data
                            .iter()
                            .enumerate()
                            .filter(|(i, slot)| {
                                **slot != 0
                                    && mask.data[*i] != 0
                                    && !edges.iter().any(|edge| edge.index == *i)
                            })
                            .map(|(i, _)| point(i))
                            .collect()
                    });
                    checks.push(GateCheck::verdict(
                        "outline-on-perimeter",
                        interior.is_empty(),
                        format!("{} outline pixels sit inside the form", interior.len()),
                        format!(
                            "Move the pixels at {} onto the perimeter, or redraw them as an interior separator in the occluded form's shadow step. §4.4 keeps OUTLINE_DARK off the interior.",
                            gates::named_points(&interior)
                        ),
                    ));
                    let outlined = edges.iter().filter(|edge| painted(edge)).count();
                    let coverage = outlined as f32 / edges.len().max(1) as f32;
                    let range = if rules.outline == "full" {
                        [1.0, 1.0]
                    } else if rules.outline == "none" {
                        [0.0, 0.0]
                    } else {
                        rules.outline_coverage
                    };
                    checks.push(GateCheck::verdict(
                        "outline-coverage",
                        (range[0]..=range[1]).contains(&coverage),
                        format!(
                            "{outlined} of {} perimeter pixels outlined, {:.0}% against {:.0}..{:.0}%",
                            edges.len(),
                            coverage * 100.0,
                            range[0] * 100.0,
                            range[1] * 100.0
                        ),
                        if coverage > range[1] {
                            "Drop the outline along the arc that faces the key, per §4.3, and let light1 be the outermost pixel there. A ring all the way round is a sticker."
                        } else {
                            "Restore the outline everywhere the surface turns away from the key. §4.3 drops it only on the lit arc."
                        },
                    ));
                    // Coverage counts how much outline there is and not where
                    // it went, so an outline kept on the lit arc and dropped on
                    // the shadow arc - §4.3 exactly inverted - scores the same
                    // as a correct one.
                    let bare: Vec<(u16, u16)> = edges
                        .iter()
                        .filter(|edge| edge.shadow_facing && !edge.key_facing && !painted(edge))
                        .map(gates::EdgePixel::point)
                        .collect();
                    checks.push(GateCheck::verdict(
                        "outline-shadow-arc",
                        bare.is_empty() || range[1] == 0.0,
                        format!(
                            "{} perimeter pixels facing away from the key carry no outline",
                            bare.len()
                        ),
                        format!(
                            "Outline the pixels at {}. §4.3 drops the outline only where the surface normal faces the key light; an edge turned away from it keeps the dark edge.",
                            gates::named_points(&bare)
                        ),
                    ));
                    // §4.3 again, at the one place it allows no judgement: the
                    // bottom of the sprite is where the contact shadow anchors
                    // the character to the ground plane.
                    let floor = edges
                        .iter()
                        .map(|edge| f32::from(edge.y))
                        .fold(f32::NEG_INFINITY, f32::max);
                    let crown = edges
                        .iter()
                        .map(|edge| f32::from(edge.y))
                        .fold(f32::INFINITY, f32::min);
                    let band =
                        crown + (floor - crown + 1.0) * (1.0 - gates::HD2D.outline_bottom_band);
                    let dropped: Vec<(u16, u16)> = edges
                        .iter()
                        .filter(|edge| f32::from(edge.y) >= band && !painted(edge))
                        .map(gates::EdgePixel::point)
                        .collect();
                    checks.push(GateCheck::verdict(
                        "outline-bottom-band",
                        dropped.is_empty() || range[1] == 0.0,
                        format!(
                            "{} perimeter pixels below row {band:.0} carry no outline",
                            dropped.len()
                        ),
                        format!(
                            "Outline the pixels at {}. §4.3 never drops the outline along the bottom fifth, where the contact shadow anchors the sprite to the ground.",
                            gates::named_points(&dropped)
                        ),
                    ));
                }
            }
            "shadow" => {
                checks.extend(check_light());
                checks.push(confined(
                    "shadow-inside-silhouette",
                    &["shadow-core", "shadow-deep"],
                ));
            }
            "light" => {
                checks.extend(check_light());
                checks.push(pillow());
                checks.push(jaggies());
                checks.push(confined("light-inside-silhouette", &["light"]));
            }
            "accent" => {
                let accents =
                    layer("accent").map_or(0, |b| b.data.iter().filter(|s| **s != 0).count());
                checks.push(GateCheck::verdict(
                    "accent-budget",
                    accents <= gates::HD2D.accent_count,
                    format!("{accents} accent pixels"),
                    format!(
                        "Cut the speculars back to {} pixels on metal, glass or an eye. Step 7 budgets no more, and above it every material reads as polished plastic.",
                        gates::HD2D.accent_count
                    ),
                ));
                checks.push(confined("rim-inside-silhouette", &["rim"]));
                let rim = layer("rim");
                let lit = |pixel: &gates::EdgePixel| rim.is_some_and(|b| b.data[pixel.index] != 0);
                if let Some(mask) = silhouette {
                    // §5.5 rule 8 keeps the rim off the key-lit side and off
                    // the bottom quarter, and rule 3 puts it on the outermost
                    // pixel rather than inside the form.
                    let permitted = |pixel: &gates::EdgePixel| {
                        let crown = mask.get(i32::from(pixel.x), i32::from(pixel.y) - 1) == 0;
                        (pixel.shadow_facing || crown)
                            && f32::from(pixel.y) < f32::from(mask.height) * 0.75
                    };
                    let inner: Vec<(u16, u16)> = rim.map_or_else(Vec::new, |b| {
                        b.data
                            .iter()
                            .enumerate()
                            .filter(|(i, slot)| {
                                **slot != 0 && !ring.iter().any(|edge| edge.index == *i)
                            })
                            .map(|(i, _)| point(i))
                            .collect()
                    });
                    let misplaced: Vec<(u16, u16)> = ring
                        .iter()
                        .filter(|edge| lit(edge) && !permitted(edge))
                        .map(gates::EdgePixel::point)
                        .chain(inner)
                        .collect();
                    checks.push(GateCheck::verdict(
                        "rim-placement",
                        misplaced.is_empty(),
                        format!(
                            "{} rim pixels sit where no backlight reaches",
                            misplaced.len()
                        ),
                        format!(
                            "Move the rim at {} onto the outermost pixels of the upper-{} arc and the crown. §5.5 keeps it off the key side, off the interior, and off the bottom quarter.",
                            gates::named_points(&misplaced),
                            if rules.light_direction.contains("left") {
                                "right"
                            } else {
                                "left"
                            }
                        ),
                    ));
                    let marked: Vec<bool> = ring.iter().map(lit).collect();
                    let coverage =
                        marked.iter().filter(|m| **m).count() as f32 / ring.len().max(1) as f32;
                    checks.push(GateCheck::verdict(
                        "rim-coverage",
                        (rules.rim_coverage[0]..=rules.rim_coverage[1]).contains(&coverage),
                        format!(
                            "rim covers {:.0}% of the {} pixel perimeter, target {:.0}..{:.0}%",
                            coverage * 100.0,
                            ring.len(),
                            rules.rim_coverage[0] * 100.0,
                            rules.rim_coverage[1] * 100.0
                        ),
                        if coverage > rules.rim_coverage[1] {
                            "Break more of the rim away. §5.5 rule 5 says a backlight past this share stops reading as a rim and becomes an outline."
                        } else {
                            "Add rim to the hardest silhouette turns - shoulder tops, the crown, the outer edge of a raised arm. Below this share it reads as stray pixels."
                        },
                    ));
                    // §5.5 rule 4. Coverage alone cannot see this: one unbroken
                    // run and several short ones spend the same pixels, and
                    // only the first is the glow sticker the rule forbids.
                    let runs = gates::ring_runs(&marked);
                    let band = gates::HD2D.rim_run;
                    let long: Vec<String> = runs
                        .iter()
                        .filter(|(_, length)| !(band[0]..=band[1]).contains(length))
                        .map(|(start, length)| {
                            let (x, y) = ring[*start].point();
                            format!("{length}px from ({x},{y})")
                        })
                        .collect();
                    checks.push(GateCheck::verdict(
                        "rim-run-length",
                        long.is_empty(),
                        if long.is_empty() {
                            format!("{} rim runs, all {}..{}px", runs.len(), band[0], band[1])
                        } else {
                            format!("runs of {}", long.join(", "))
                        },
                        format!(
                            "Break each run into lengths of {} to {}px. §5.5 rule 4 breaks the rim at every concave turn; a continuous band reads as a glow-outline sticker.",
                            band[0], band[1]
                        ),
                    ));
                    let allowed = gates::HD2D.rim_gap;
                    let mut wide = Vec::new();
                    for (pair, (start, length)) in runs.iter().enumerate() {
                        let from = (start + length) % ring.len().max(1);
                        let next = runs[(pair + 1) % runs.len()].0;
                        let gap = (next + ring.len() - from) % ring.len().max(1);
                        // A stretch that leaves the arc a backlight can reach
                        // is not a gap in a broken rim; it is where the rim
                        // band ends, and §5.5 rule 8 is what ends it.
                        let inside_arc =
                            (0..gap).all(|k| permitted(&ring[(from + k) % ring.len()]));
                        if runs.len() < 2 || !inside_arc {
                            continue;
                        }
                        if !(allowed[0]..=allowed[1]).contains(&gap) {
                            let (x, y) = ring[from].point();
                            wide.push(format!("{gap}px from ({x},{y})"));
                        }
                    }
                    checks.push(GateCheck::verdict(
                        "rim-gap-length",
                        wide.is_empty(),
                        if wide.is_empty() {
                            format!(
                                "gaps inside the lit arc run {}..{}px",
                                allowed[0], allowed[1]
                            )
                        } else {
                            format!("gaps of {}", wide.join(", "))
                        },
                        format!(
                            "Close each gap to {} to {}px, or drop the run past it. §5.5 rule 4 breaks the rim; it does not scatter it.",
                            allowed[0], allowed[1]
                        ),
                    ));
                    // §5.5 rule 9. The same rim painted in the darkest slot
                    // satisfies every check above and is invisible.
                    let rim_ordinal = crate::raster::LAYER_ROLES
                        .iter()
                        .find(|(role, _)| *role == "rim")
                        .map_or(70, |(_, ordinal)| *ordinal);
                    let mut beneath = IndexedBuffer::new(mask.width, mask.height)?;
                    for under in ordered.iter().filter(|l| l.ordinal < rim_ordinal) {
                        for (dest, &source) in beneath.data.iter_mut().zip(&under.buffer.data) {
                            if source != 0 {
                                *dest = source;
                            }
                        }
                    }
                    let dim: Vec<String> = ring
                        .iter()
                        .filter(|edge| lit(edge))
                        .filter_map(|edge| {
                            let (x, y) = (i32::from(edge.x), i32::from(edge.y));
                            // The fill the rim is measured against is what the
                            // rim covers, or failing that what it touches: a
                            // backlight reads against the surface beside it.
                            let adjacent = [(0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)]
                                .iter()
                                .map(|(dx, dy)| beneath.get(x + dx, y + dy))
                                .find(|slot| *slot != 0)?;
                            let slot = rim.map_or(0, |b| b.data[edge.index]);
                            let contrast =
                                lightness[usize::from(slot)] - lightness[usize::from(adjacent)];
                            (contrast < gates::HD2D.rim_contrast)
                                .then(|| format!("dL {contrast:+.2} at ({x},{y})"))
                        })
                        .collect();
                    checks.push(GateCheck::verdict(
                        "rim-contrast",
                        dim.is_empty(),
                        if dim.is_empty() {
                            format!(
                                "every rim pixel beats its fill by dL {:.2}",
                                gates::HD2D.rim_contrast
                            )
                        } else {
                            dim.join("; ")
                        },
                        format!(
                            "Repaint the rim in the shared global RIM colour. §5.5 rule 9 needs it to beat the adjacent fill by dL {:.2} or it does not read as a backlight at all.",
                            gates::HD2D.rim_contrast
                        ),
                    ));
                }
            }
            "detail" => {
                checks.push(noise());
                checks.push(speckle());
            }
            "cleanup" => {
                checks.push(noise());
                checks.push(speckle());
                checks.push(jaggies());
                checks.push(pillow());
                let roles: Vec<&str> = document.layers.iter().map(|l| l.role.0).collect();
                checks.push(confined("layers-inside-silhouette", &roles));
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
                checks.push(GateCheck::verdict(
                    "variation-baseline",
                    baseline.is_some(),
                    "no earlier palette survives in the op log",
                    "Write the palette this variation forks from before recolouring, so the gate has something to compare the new values against.",
                ));
                if let Some(previous) = baseline {
                    let moved: Vec<String> = previous
                        .slots
                        .iter()
                        .zip(&document.palette.slots)
                        .filter_map(|(a, b)| {
                            let shift =
                                color::srgb_to_oklab(b.rgba)[0] - color::srgb_to_oklab(a.rgba)[0];
                            (shift.abs() > 0.01)
                                .then(|| format!("slot {} moved dL {shift:+.3}", a.index))
                        })
                        .collect();
                    let sized = previous.slots.len() == document.palette.slots.len();
                    checks.push(GateCheck::verdict(
                        "variation-values-held",
                        sized && moved.is_empty(),
                        if sized {
                            format!(
                                "{} slots, {} of them moved in value",
                                previous.slots.len(),
                                moved.len()
                            )
                        } else {
                            format!(
                                "the palette went from {} slots to {}",
                                previous.slots.len(),
                                document.palette.slots.len()
                            )
                        },
                        format!(
                            "Restore the baseline lightness and move hue and chroma only. §10.3 lets a palette swap change colour and not value, because value is what carries the form. Moved: {}.",
                            moved.join("; ")
                        ),
                    ));
                }
            }
            _ => return Err(AppError::new("document.invalid_step", &step)),
        }
        Ok(GateReport {
            step,
            pass: checks.iter().all(|check| check.pass),
            checks,
            metrics,
        })
    }
    pub fn step_state(&self, id: AssetId) -> Result<StepState> {
        let gate = self.step_check(id)?;
        Ok(StepState {
            asset_id: id,
            step: gate.step.clone(),
            can_advance: gate.pass && gate.step != "variation",
            gate,
        })
    }
    pub fn step_advance(&mut self, id: AssetId) -> Result<(StepState, OpResult)> {
        self.step_advance_as(id, "user", false)
    }

    /// Advances as `actor`. With `force`, a failing gate is overridden, and
    /// the op log records it: the actor is written as "<actor> (forced)".
    pub fn step_advance_as(
        &mut self,
        id: AssetId,
        actor: &str,
        force: bool,
    ) -> Result<(StepState, OpResult)> {
        let state = self.step_state(id)?;
        if !state.gate.pass && !force {
            return Err(AppError::new(
                "step.gate_failed",
                state.gate.failures().join(", "),
            ));
        }
        let position = STEPS
            .iter()
            .position(|s| *s == state.step)
            .ok_or_else(|| AppError::new("document.invalid_step", &state.step))?;
        let next = STEPS
            .get(position + 1)
            .ok_or_else(|| AppError::new("step.complete", "the final step has no successor"))?;
        let actual_actor = if force {
            format!("{actor} (forced)")
        } else {
            actor.to_string()
        };
        let result = self.commit(id, Mutation::Step((*next).into()), &actual_actor)?;
        Ok((self.step_state(id)?, result))
    }

    /// Moves back to an earlier step. Nothing is erased.
    pub fn step_revisit(
        &mut self,
        id: AssetId,
        step: &str,
        actor: &str,
    ) -> Result<(StepState, OpResult)> {
        let state = self.step_state(id)?;
        let current_pos = STEPS
            .iter()
            .position(|s| *s == state.step)
            .ok_or_else(|| AppError::new("document.invalid_step", &state.step))?;
        let target_pos = STEPS
            .iter()
            .position(|s| *s == step)
            .ok_or_else(|| AppError::new("document.invalid_step", step))?;
        if target_pos >= current_pos {
            return Err(AppError::new(
                "document.invalid_step",
                format!(
                    "cannot revisit step {step}; the asset is already at step {}",
                    state.step
                ),
            ));
        }
        let result = self.commit(id, Mutation::Step(step.to_string()), actor)?;
        Ok((self.step_state(id)?, result))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raster::{grid, Material, Palette, PaletteSlot, Ramp};

    /// A three-step cloth ramp and a three-step skin ramp, each built to §2.4
    /// step by step, plus the two global slots §2.6 shares across a project.
    /// The globals are what reach the value floor and ceiling: no one material
    /// spans that far at the 0.11 of lightness a step is allowed.
    ///
    /// The letters a fixture draws with follow from the order: `A` is
    /// `OUTLINE_DARK`, `B` `C` `D` are cloth's shadow, base and light, `E` is
    /// `RIM`, and `F` `G` `H` are skin's three.
    const SLOTS: [[u8; 4]; 8] = [
        [8, 7, 14, 255],
        [53, 59, 146, 255],
        [52, 97, 188, 255],
        [55, 142, 200, 255],
        [241, 220, 177, 255],
        [126, 35, 17, 255],
        [159, 74, 9, 255],
        [168, 135, 56, 255],
    ];
    /// A solid six-by-six body with a one pixel margin, whose perimeter is 20.
    const BODY: &str =
        "........\n.AAAAAA.\n.AAAAAA.\n.AAAAAA.\n.AAAAAA.\n.AAAAAA.\n.AAAAAA.\n........";
    const BLANK: &str =
        "........\n........\n........\n........\n........\n........\n........\n........";
    /// A ten-by-ten body on a twelve pixel canvas, whose perimeter is 36. The
    /// rim rules need a shape this size to be measurable at all: a run of the
    /// length §5.5 forbids does not fit inside a quarter of a 20 px perimeter.
    const WIDE_BODY: &str = "............
.AAAAAAAAAA.
.AAAAAAAAAA.
.AAAAAAAAAA.
.AAAAAAAAAA.
.AAAAAAAAAA.
.AAAAAAAAAA.
.AAAAAAAAAA.
.AAAAAAAAAA.
.AAAAAAAAAA.
.AAAAAAAAAA.
............";
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
        let ramp = |name: &str, first: u8| Ramp {
            name: name.into(),
            material: if name == "cloth" {
                Material::Cloth
            } else {
                Material::Skin
            },
            slots: (first..first + 3).collect(),
        };
        let member = |index: u8| match index {
            2..=4 => Some(("cloth".to_string(), index - 2)),
            6..=8 => Some(("skin".to_string(), index - 6)),
            _ => None,
        };
        Palette {
            slots: SLOTS
                .iter()
                .enumerate()
                .map(|(position, rgba)| {
                    let index = position as u8 + 1;
                    let (ramp, step) =
                        member(index).map_or((None, None), |(r, s)| (Some(r), Some(s)));
                    PaletteSlot {
                        index,
                        rgba: *rgba,
                        name: None,
                        ramp,
                        step,
                    }
                })
                .collect(),
            ramps: vec![ramp("cloth", 2), ramp("skin", 6)],
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

    fn report(step: &str, drawn: &[(&str, &str)]) -> GateReport {
        let (store, id) = asset(step, drawn);
        store.step_check(id).unwrap()
    }

    /// The named check, which has to have run. A gate that reports nothing
    /// under a name is a hole rather than a pass, so asking for a name the
    /// report does not carry fails the test rather than reading as silence.
    fn check(step: &str, drawn: &[(&str, &str)], name: &str) -> GateCheck {
        let report = report(step, drawn);
        report
            .checks
            .iter()
            .find(|check| check.name == name)
            .unwrap_or_else(|| panic!("no check named {name} in {:?}", report.checks))
            .clone()
    }

    fn raised(step: &str, drawn: &[(&str, &str)], name: &str) -> bool {
        !check(step, drawn, name).pass
    }

    #[test]
    fn the_report_names_what_ran_what_it_measured_and_what_to_do() {
        // §8 of the tool contract: a check carries a name, a verdict, the
        // measurement behind it, and for a failure a hint that names pixels.
        let report = report("silhouette", &[("silhouette", SPLIT)]);
        assert!(!report.pass);
        let failed = report
            .checks
            .iter()
            .find(|check| check.name == "single-region")
            .unwrap();
        assert!(failed.detail.as_ref().unwrap().contains("2 disconnected"));
        assert!(failed.hint.as_ref().unwrap().contains("(6,0)"));
        // Checks that passed are reported too, so a reader can tell a gate that
        // looked and found nothing from one that never looked.
        let whole = self::report("silhouette", &[("silhouette", READABLE)]);
        let passed = whole
            .checks
            .iter()
            .find(|check| check.name == "single-region")
            .unwrap();
        assert!(passed.pass);
        assert!(passed.detail.is_some());
        assert_eq!(passed.hint, None);
        assert_eq!(
            report.failures(),
            vec!["single-region", "reads-at-1x", "solidity"]
        );
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
        let report = store.step_check(id).unwrap();
        assert!(report.pass, "{:?}", report.checks);
        // The same slots with the colour drained out of them: still a legal
        // palette, no longer a legal ramp.
        let mut grey = palette();
        for (position, slot) in grey.slots.iter_mut().enumerate() {
            let value = 8 + position as u8 * 30;
            slot.rgba = [value, value, value, 255];
        }
        store.palette_write(id, grey).unwrap();
        assert!(store
            .step_check(id)
            .unwrap()
            .checks
            .iter()
            .any(|check| check.name == "ramp-hue-shift" && !check.pass));
    }

    #[test]
    fn a_silhouette_must_read_as_one_connected_shape() {
        assert!(raised(
            "silhouette",
            &[("silhouette", SPLIT)],
            "single-region"
        ));
        assert!(!raised(
            "silhouette",
            &[("silhouette", BODY)],
            "single-region"
        ));
    }

    #[test]
    fn a_silhouette_that_is_all_edge_fails_readability() {
        // A one pixel comb: the same area as a body spread over far more
        // perimeter, which is what an unreadable silhouette looks like.
        let comb = "A.A.A.A.\nA.A.A.A.\nA.A.A.A.\nAAAAAAAA\n........\n........\n........\n........";
        assert!(raised("silhouette", &[("silhouette", comb)], "reads-at-1x"));
        assert!(!raised(
            "silhouette",
            &[("silhouette", READABLE)],
            "reads-at-1x"
        ));
        // A solid rectangle fails the other way: it fills its own convex hull,
        // so it has no negative space and reads as a block, not a character.
        assert!(raised("silhouette", &[("silhouette", BODY)], "solidity"));
    }

    #[test]
    fn flats_must_cover_the_silhouette_exactly_and_sit_mid_ramp() {
        let filled = BODY.replace('A', "C");
        let holed = filled.replacen("CCCCCC", "CCCC.C", 1);
        assert!(raised(
            "flats",
            &[("silhouette", BODY), ("flats", &holed)],
            "flats-cover-silhouette"
        ));
        assert!(!raised(
            "flats",
            &[("silhouette", BODY), ("flats", &filled)],
            "flats-cover-silhouette"
        ));
        // Slot 3 is the middle of cloth's three step ramp, so it is the base a
        // material shades away from. Slot 2 is already the shadow step.
        assert!(raised(
            "flats",
            &[("silhouette", BODY), ("flats", &BODY.replace('A', "B"))],
            "flats-base-slots"
        ));
        assert!(!raised(
            "flats",
            &[("silhouette", BODY), ("flats", &filled)],
            "flats-base-slots"
        ));
    }

    #[test]
    fn flats_woven_from_two_materials_are_caught_by_the_step_that_owns_them() {
        // A checkerboard of cloth's base and skin's base. Coverage is exact and
        // every slot is some ramp's base step, so the two checks that came
        // before this one both pass and the sprite still has no flats: §11.5's
        // colour-change rate reads 0.90 where a field of one material reads 0.
        let woven = WIDE_BODY
            .lines()
            .enumerate()
            .map(|(y, row)| {
                row.chars()
                    .enumerate()
                    .map(|(x, cell)| match (cell, (x + y) % 2 == 0) {
                        ('A', true) => 'C',
                        ('A', false) => 'G',
                        _ => cell,
                    })
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n");
        let drawn = [("silhouette", WIDE_BODY), ("flats", woven.as_str())];
        assert!(!raised("flats", &drawn, "flats-cover-silhouette"));
        assert!(!raised("flats", &drawn, "flats-base-slots"));
        assert!(raised("flats", &drawn, "flats-material-blocks"));
        // The same two materials given an area each, which is what flats are.
        let blocked = WIDE_BODY.replace("AAAAAAAAAA", "CCCCCGGGGG");
        assert!(!raised(
            "flats",
            &[("silhouette", WIDE_BODY), ("flats", &blocked)],
            "flats-material-blocks"
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
        assert!(raised("shadow", flat, "light-measurable"));
        assert!(!raised("shadow", &LIT, "light-measurable"));
        assert!(!raised("shadow", &LIT, "light-matches-key"));
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
        assert!(raised("shadow", &inverted, "light-matches-key"));
    }

    #[test]
    fn the_light_step_catches_shading_that_runs_inward_from_the_edge() {
        // Concentric rings getting lighter toward the middle: the textbook
        // pillow, and the exact correlation the gate measures.
        let rings = [
            ("silhouette", "AAAAA\nAAAAA\nAAAAA\nAAAAA\nAAAAA"),
            ("flats", "BBBBB\nBCCCB\nBCDCB\nBCCCB\nBBBBB"),
        ];
        assert!(raised("light", &rings, "pillow-shading"));
        assert!(!raised("light", &LIT, "pillow-shading"));
    }

    /// A pillow-shaded head on a flat body: one correlation over every filled
    /// pixel reads well under the threshold here, because the body contributes
    /// edge distance and no lightness to go with it. The head is the same head.
    const PILLOW_HEAD: [(&str, &str); 2] = [
        (
            "silhouette",
            "...AAAAAAA...
...AAAAAAA...
...AAAAAAA...
...AAAAAAA...
...AAAAAAA...
...AAAAAAA...
...AAAAAAA...
.....AAA.....
.AAAAAAAAAAA.
.AAAAAAAAAAA.
.AAAAAAAAAAA.
.AAAAAAAAAAA.
.AAAAAAAAAAA.",
        ),
        (
            "flats",
            "...BBBBBBB...
...BCCCCCB...
...BCDDDCB...
...BCDDDCB...
...BCDDDCB...
...BCDDDCB...
...BBCDCBB...
.....BCB.....
.CCCCCCCCCCC.
.CCCCCCCCCCC.
.CCCCCCCCCCC.
.CCCCCCCCCCC.
.CCCCCCCCCCC.",
        ),
    ];

    #[test]
    fn a_pillow_shaded_head_is_caught_over_the_flat_body_carrying_it() {
        assert!(raised("light", &PILLOW_HEAD, "pillow-shading"));
        // The same silhouette in three cel bands laid across an upper-left key,
        // which is the shading §5.2 asks for and which must keep passing.
        let banded = [
            PILLOW_HEAD[0],
            (
                "flats",
                "...DDDCCCC...
...DDCCCCC...
...DCCCCCB...
...CCCCCBB...
...CCCCBBB...
...CCCBBBB...
...CCBBBBB...
.....BBB.....
.CCBBBBBBBBB.
.CBBBBBBBBBB.
.BBBBBBBBBBB.
.BBBBBBBBBBB.
.BBBBBBBBBBB.",
            ),
        ];
        assert!(!raised("light", &banded, "pillow-shading"));
    }

    #[test]
    fn shading_with_no_light_direction_fails_the_light_step_by_name() {
        // Two forms side by side. The right one is banded across an upper-left
        // key and reports a clean vector. The left one has columns B B C D C B
        // B, brightest down the middle and mirrored about it, so its darkest
        // band's centroid and its lightest band's land on the same pixel and it
        // contributes no vector at all. That is textbook pillow shading, and it
        // measures under the pillow threshold. Every other light check reads
        // the vector list, and the list is a clean single vector, so before the
        // region was reported on its own the sprite passed in silence.
        let symmetric = "BBCDCBB.DDDCCCB
BBCDCBB.DDCCCBB
BBCDCBB.DCCCBBB
BBCDCBB.CCCBBBD
BBCDCBB.CCBBBDD
BBCDCBB.CBBBDDD
BBCDCBB.BBBDDDD";
        let drawn = [("silhouette", symmetric), ("flats", symmetric)];
        assert!(!raised("light", &drawn, "pillow-shading"));
        assert!(!raised("light", &drawn, "light-measurable"));
        assert!(raised("light", &drawn, "light-directed"));
        assert!(raised("shadow", &drawn, "light-directed"));
        // The report names the pixels, so an agent can go and repaint them.
        assert!(check("light", &drawn, "light-directed")
            .detail
            .unwrap()
            .contains("7x7 at 0,0"));
        // A body shaded across a key keeps its direction and stays quiet, and
        // so does a body with no shading at all: an unshaded region is not a
        // region lit from nowhere, and §2.5's dL 0.07 is what separates them.
        assert!(!raised("light", &LIT, "light-directed"));
        assert!(!raised("shadow", &LIT[..2], "light-directed"));
        assert!(raised("shadow", &LIT[..2], "light-measurable"));
    }

    #[test]
    fn the_detail_step_counts_loose_pixels_against_the_noise_budget() {
        let scattered =
            "A.A.A.A.\n........\nA.A.A.A.\n........\nA.A.A.A.\n........\nA.A.A.A.\n........";
        assert!(raised("detail", &[("detail", scattered)], "noise"));
        assert!(!raised("detail", &[("detail", BODY)], "noise"));
    }

    #[test]
    fn the_cleanup_step_refuses_pixels_outside_the_silhouette() {
        let stray =
            "B.......\n.AAAAAA.\n.AAAAAA.\n.AAAAAA.\n.AAAAAA.\n.AAAAAA.\n.AAAAAA.\n........";
        assert!(raised(
            "cleanup",
            &[("silhouette", BODY), ("detail", stray)],
            "layers-inside-silhouette"
        ));
        assert!(!raised(
            "cleanup",
            &[("silhouette", BODY), ("detail", BLANK)],
            "layers-inside-silhouette"
        ));
    }

    #[test]
    fn the_accent_step_bounds_the_rim_to_a_share_of_the_perimeter() {
        // Four pixels of a twenty pixel perimeter is a fifth, the middle of the
        // style's band. None at all is not a rim.
        let rim = "........\n......E.\n......E.\n......E.\n......E.\n........\n........\n........";
        assert!(!raised(
            "accent",
            &[("silhouette", BODY), ("rim", rim)],
            "rim-coverage"
        ));
        assert!(!raised(
            "accent",
            &[("silhouette", BODY), ("rim", rim)],
            "rim-placement"
        ));
        assert!(raised(
            "accent",
            &[("silhouette", BODY), ("rim", BLANK)],
            "rim-coverage"
        ));
        // A rim on the side the key strikes is misplaced however much of it
        // there is, because a backlight cannot reach that edge.
        let front =
            "........\n.E......\n.E......\n.E......\n.E......\n........\n........\n........";
        assert!(raised(
            "accent",
            &[("silhouette", BODY), ("rim", front)],
            "rim-placement"
        ));
    }

    /// Nine unbroken pixels along the crown of [`WIDE_BODY`], which is exactly
    /// a quarter of its 36 px perimeter and so exactly the top of §5.5's
    /// coverage band.
    const UNBROKEN_RIM: &str = "............
.EEEEEEEEE..
............
............
............
............
............
............
............
............
............
............";
    /// The upper-right arc and crown of [`WIDE_BODY`], carrying a backlight
    /// broken into a run of five and a run of three with a single pixel between
    /// them: 8 px of a 36 px perimeter, which is 22% and inside §5.5's band.
    const BROKEN_RIM: &str = "............
.EEEEE.EEEE.
............
............
............
............
............
............
............
............
............
............";

    #[test]
    fn a_rim_drawn_as_one_long_run_is_caught_where_coverage_cannot_see_it() {
        // Nine unbroken pixels of a 36 px perimeter is exactly 25%, the top of
        // the coverage band, so coverage passes and §5.5 rule 4 is what this
        // sprite breaks: at sprite scale an unbroken band is the glow-outline
        // sticker the rule exists to prevent.
        let long = [("silhouette", WIDE_BODY), ("rim", UNBROKEN_RIM)];
        assert!(!raised("accent", &long, "rim-coverage"));
        assert!(!raised("accent", &long, "rim-placement"));
        assert!(raised("accent", &long, "rim-run-length"));
        assert!(check("accent", &long, "rim-run-length")
            .detail
            .unwrap()
            .contains("9px"));
        // The same rim broken into runs of five and three with a one pixel gap,
        // which is what §5.5 rule 4 asks for, has to keep passing.
        let broken = [("silhouette", WIDE_BODY), ("rim", BROKEN_RIM)];
        assert!(!raised("accent", &broken, "rim-run-length"));
        assert!(!raised("accent", &broken, "rim-gap-length"));
        assert!(!raised("accent", &broken, "rim-coverage"));
        assert!(!raised("accent", &broken, "rim-placement"));
    }

    #[test]
    fn a_rim_too_dark_to_read_is_caught_where_placement_cannot_see_it() {
        // §5.5 rule 9 asks the backlight to beat the fill beside it by dL 0.20.
        // Painted in the darkest slot the rim sits in exactly the right place,
        // in runs of exactly the right length, and is invisible.
        let flats = WIDE_BODY.replace('A', "C");
        let dark = [
            ("silhouette", WIDE_BODY),
            ("flats", flats.as_str()),
            ("rim", &BROKEN_RIM.replace('E', "A")),
        ];
        assert!(!raised("accent", &dark, "rim-placement"));
        assert!(!raised("accent", &dark, "rim-run-length"));
        assert!(raised("accent", &dark, "rim-contrast"));
        // The same rim in the shared global RIM colour, over the same fill.
        let lit = [
            ("silhouette", WIDE_BODY),
            ("flats", flats.as_str()),
            ("rim", BROKEN_RIM),
        ];
        assert!(!raised("accent", &lit, "rim-contrast"));
    }

    /// A selective outline on [`BODY`]: dropped along the top-left arc the key
    /// strikes, kept everywhere the surface turns away from it, and kept in
    /// full along the bottom. Fourteen of twenty perimeter pixels, which is 70%
    /// and inside §4.3's band.
    const SELECTIVE: &str = "........
....EEE.
......E.
......E.
......E.
.E....E.
.EEEEEE.
........";

    #[test]
    fn the_outline_step_bounds_coverage_and_keeps_it_inside_the_shape() {
        assert!(!raised(
            "outline",
            &[("silhouette", BODY), ("outline", SELECTIVE)],
            "outline-coverage"
        ));
        assert!(raised(
            "outline",
            &[("silhouette", BODY), ("outline", BLANK)],
            "outline-coverage"
        ));
        let escaped = SELECTIVE.replacen("........", "E.......", 1);
        assert!(raised(
            "outline",
            &[("silhouette", BODY), ("outline", &escaped)],
            "outline-inside-silhouette"
        ));
    }

    #[test]
    fn an_outline_kept_on_the_lit_arc_and_dropped_on_the_shadow_arc_is_named() {
        // §4.3 exactly inverted: the outline rings the top-left, where the form
        // catches the key and the outline should disappear, and the right side
        // is bare, where the surface turns away and the darkest edge belongs.
        // It spends thirteen of twenty perimeter pixels, 65%, so the coverage
        // band has nothing to say about it.
        let inverted = "........
.EEEEEE.
.E......
........
........
........
.EEEEEE.
........";
        let drawn = [("silhouette", BODY), ("outline", inverted)];
        assert!(!raised("outline", &drawn, "outline-coverage"));
        assert!(raised("outline", &drawn, "outline-shadow-arc"));
        assert!(check("outline", &drawn, "outline-shadow-arc")
            .hint
            .unwrap()
            .contains("(6,2)"));
        // The correctly drawn outline keeps passing, on the arc rule and on the
        // bottom band §4.3 never lets go.
        let correct = [("silhouette", BODY), ("outline", SELECTIVE)];
        assert!(!raised("outline", &correct, "outline-shadow-arc"));
        assert!(!raised("outline", &correct, "outline-bottom-band"));
        // And an outline that stops short of the feet is caught by the band
        // even when the arc rule is satisfied elsewhere.
        let footless = SELECTIVE.replacen(".EEEEEE.\n........", "........\n........", 1);
        assert!(raised(
            "outline",
            &[("silhouette", BODY), ("outline", &footless)],
            "outline-bottom-band"
        ));
    }

    /// A selective outline on [`WIDE_BODY`]: twenty-three of thirty-six
    /// perimeter pixels, 64%, with every edge that turns away from the key
    /// covered and the bottom fifth whole.
    const WIDE_OUTLINE: &str = "............
.......EEEE.
..........E.
..........E.
..........E.
..........E.
..........E.
..........E.
..........E.
.E........E.
.EEEEEEEEEE.
............";

    #[test]
    fn an_outline_painted_through_the_middle_of_a_form_is_named() {
        // A 6x6 block of outline colour inside a 12x12 body. Coverage is a
        // ratio over edge pixels, so these thirty-six pixels are counted
        // neither as outlined nor as outside, and every other outline check
        // reads the perimeter. Before the interior was measured the whole
        // sprite passed the outline step.
        let bled = WIDE_OUTLINE
            .lines()
            .enumerate()
            .map(|(y, row)| {
                row.chars()
                    .enumerate()
                    .map(|(x, cell)| {
                        if (3..=8).contains(&x) && (3..=8).contains(&y) {
                            'E'
                        } else {
                            cell
                        }
                    })
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n");
        let drawn = [("silhouette", WIDE_BODY), ("outline", bled.as_str())];
        assert!(!raised("outline", &drawn, "outline-coverage"));
        assert!(!raised("outline", &drawn, "outline-inside-silhouette"));
        assert!(!raised("outline", &drawn, "outline-shadow-arc"));
        assert!(raised("outline", &drawn, "outline-on-perimeter"));
        assert!(check("outline", &drawn, "outline-on-perimeter")
            .hint
            .unwrap()
            .contains("(3,3)"));
        // The same outline without the block through its middle passes every
        // check the step runs.
        let clean = report(
            "outline",
            &[("silhouette", WIDE_BODY), ("outline", WIDE_OUTLINE)],
        );
        assert!(clean.pass, "{:?}", clean.checks);
    }

    #[test]
    fn flats_that_spill_past_the_silhouette_are_caught_as_well_as_flats_that_fall_short() {
        // The coverage check reads both ways round, so paint that leaves the
        // shape is the same finding as paint that never reaches its edge.
        let spilled = BODY.replace('A', "C").replacen("........", "C.......", 1);
        assert!(raised(
            "flats",
            &[("silhouette", BODY), ("flats", &spilled)],
            "flats-cover-silhouette"
        ));
    }

    #[test]
    fn an_outline_that_rings_the_whole_shape_fails_the_same_band_as_one_that_is_missing() {
        // §4.3 has the outline drop on the key-lit arc, so a ring all the way
        // round is out of the band at the top end just as nothing at all is out
        // at the bottom end.
        let ring = "........
.EEEEEE.
.E....E.
.E....E.
.E....E.
.E....E.
.EEEEEE.
........";
        assert!(raised(
            "outline",
            &[("silhouette", BODY), ("outline", ring)],
            "outline-coverage"
        ));
    }

    #[test]
    fn a_rim_that_is_too_wide_or_sits_inside_or_low_is_refused() {
        // §5.5 caps the backlight at a quarter of the perimeter; the crown and
        // the back edge together run to half of it here.
        let wide = "........
.EEEEEE.
......E.
......E.
......E.
......E.
........
........";
        assert!(raised(
            "accent",
            &[("silhouette", BODY), ("rim", wide)],
            "rim-coverage"
        ));
        // Rule 3 puts the rim on the outermost filled pixel, so a rim pixel
        // with sprite on all four sides is inside the form.
        let inside = "........
........
........
...EE...
...EE...
........
........
........";
        assert!(raised(
            "accent",
            &[("silhouette", BODY), ("rim", inside)],
            "rim-placement"
        ));
        // Rule 8 keeps the rim off the bottom quarter, where nothing is behind
        // the subject to light it.
        let low = "........
........
........
........
........
........
.EEEE...
........";
        assert!(raised(
            "accent",
            &[("silhouette", BODY), ("rim", low)],
            "rim-placement"
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

    // ---- step_advance_as / step_revisit ----

    #[test]
    fn step_advance_as_advances_with_the_given_actor() {
        let (mut store, id) = asset("reference", &[("silhouette", BLANK)]);
        let (state, _) = store.step_advance_as(id, "agent:s-1", false).unwrap();
        assert_eq!(state.step, "palette");
        let log = store.op_log(id).unwrap();
        let last = log.last().unwrap();
        assert_eq!(last.actor, "agent:s-1");
        assert_eq!(last.kind, "step_advance");
    }

    #[test]
    fn step_advance_as_with_force_overrides_a_failing_gate() {
        let (mut store, id) = asset("silhouette", &[("silhouette", SPLIT)]);
        assert!(!store.step_state(id).unwrap().gate.pass);
        let (state, _) = store.step_advance_as(id, "agent:s-2", true).unwrap();
        assert_eq!(state.step, "flats");
        let log = store.op_log(id).unwrap();
        let last = log.last().unwrap();
        assert_eq!(last.actor, "agent:s-2 (forced)");
    }

    #[test]
    fn step_advance_as_user_with_force_records_the_forced_actor() {
        let (mut store, id) = asset("silhouette", &[("silhouette", SPLIT)]);
        assert!(!store.step_state(id).unwrap().gate.pass);
        let (state, _) = store.step_advance_as(id, "user", true).unwrap();
        assert_eq!(state.step, "flats");
        let log = store.op_log(id).unwrap();
        let last = log.last().unwrap();
        assert_eq!(last.actor, "user (forced)");
        assert_eq!(last.kind, "step_advance");
    }

    #[test]
    fn step_advance_as_without_force_refuses_a_failing_gate() {
        let (mut store, id) = asset("silhouette", &[("silhouette", SPLIT)]);
        let err = store.step_advance_as(id, "agent:s-3", false).unwrap_err();
        assert_eq!(err.code, "step.gate_failed");
        assert_eq!(store.asset_read(id).unwrap().step, "silhouette");
    }

    #[test]
    fn step_advance_delegates_to_step_advance_as() {
        let (mut store, id) = asset("reference", &[("silhouette", BLANK)]);
        let (state, _) = store.step_advance(id).unwrap();
        assert_eq!(state.step, "palette");
        let log = store.op_log(id).unwrap();
        let last = log.last().unwrap();
        assert_eq!(last.actor, "user");
    }

    #[test]
    fn step_revisit_moves_to_an_earlier_step() {
        let (mut store, id) = asset("silhouette", &[("silhouette", BLANK)]);
        let (state, _) = store.step_revisit(id, "reference", "agent:s-4").unwrap();
        assert_eq!(state.step, "reference");
        let log = store.op_log(id).unwrap();
        let last = log.last().unwrap();
        assert_eq!(last.actor, "agent:s-4");
        assert_eq!(last.kind, "step_advance");
    }

    #[test]
    fn step_revisit_to_the_current_step_is_refused() {
        let (mut store, id) = asset("silhouette", &[("silhouette", BLANK)]);
        let err = store
            .step_revisit(id, "silhouette", "agent:s-5")
            .unwrap_err();
        assert_eq!(err.code, "document.invalid_step");
        assert!(err.detail.contains("already at step"));
    }

    #[test]
    fn step_revisit_to_a_later_step_is_refused() {
        let (mut store, id) = asset("reference", &[("silhouette", BLANK)]);
        let err = store.step_revisit(id, "palette", "agent:s-6").unwrap_err();
        assert_eq!(err.code, "document.invalid_step");
        assert!(err.detail.contains("already at step"));
    }

    #[test]
    fn step_revisit_to_an_unknown_step_is_refused() {
        let (mut store, id) = asset("reference", &[("silhouette", BLANK)]);
        let err = store.step_revisit(id, "bogus", "agent:s-7").unwrap_err();
        assert_eq!(err.code, "document.invalid_step");
    }
}
