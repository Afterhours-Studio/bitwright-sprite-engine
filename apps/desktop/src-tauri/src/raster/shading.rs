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

//! The agent chooses where, the engine chooses which colour.
//!
//! This is the module that makes that rule true. Nothing here accepts a colour:
//! every write resolves to a palette slot by finding the ramp the source pixel
//! already belongs to and stepping along it. An agent can therefore ask for
//! core shadow over a region without ever being in a position to invent a muddy
//! hex value, which is the single largest lever on output quality.
//!
//! When a source pixel's slot belongs to no ramp there is no step to take, so
//! the pixel is skipped and counted. That count is the signal an agent needs:
//! it is how it discovers it has been painting with an unramped slot.

use super::ops::Bounds;
use super::{IndexedBuffer, Palette, RasterError, Result, StyleRules};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Where the key light comes from, named rather than given as a vector.
///
/// A project fixes one direction and every sprite in it obeys that direction,
/// so the only interesting values are the eight compass positions an artist
/// would actually name. Storing the name also keeps the style rules readable by
/// the person editing them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Direction {
    UpperLeft,
    UpperRight,
    LowerLeft,
    LowerRight,
    Up,
    Down,
    Left,
    Right,
}

impl Direction {
    /// Parses the name a `StyleRules` stores, refusing anything else.
    pub fn parse(value: &str) -> Result<Self> {
        Ok(match value {
            "upper-left" => Self::UpperLeft,
            "upper-right" => Self::UpperRight,
            "lower-left" => Self::LowerLeft,
            "lower-right" => Self::LowerRight,
            "up" => Self::Up,
            "down" => Self::Down,
            "left" => Self::Left,
            "right" => Self::Right,
            _ => return Err(RasterError::new("style.invalid_direction", value)),
        })
    }

    /// The unit vector pointing from the sprite toward the key light.
    ///
    /// Canvas coordinates, so `y` grows downward and "upper" is negative. Every
    /// direction has the same magnitude, so that no one of them shades more
    /// aggressively than another.
    pub fn vector(self) -> (f32, f32) {
        let diagonal = std::f32::consts::FRAC_1_SQRT_2;
        match self {
            Self::UpperLeft => (-diagonal, -diagonal),
            Self::UpperRight => (diagonal, -diagonal),
            Self::LowerLeft => (-diagonal, diagonal),
            Self::LowerRight => (diagonal, diagonal),
            Self::Up => (0.0, -1.0),
            Self::Down => (0.0, 1.0),
            Self::Left => (-1.0, 0.0),
            Self::Right => (1.0, 0.0),
        }
    }

    /// The angle of the vector running from shadow toward light, in degrees.
    ///
    /// The light-direction gate measures each region's dark-to-light vector and
    /// compares it with this, so the two have to share a convention: `atan2(dy,
    /// dx)` in canvas coordinates.
    pub fn angle_degrees(self) -> f32 {
        let (x, y) = self.vector();
        y.atan2(x).to_degrees()
    }
}

/// Which way along a ramp a `shade` call steps, and which pixels it selects.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShadeKind {
    /// Steps down the ramp, on the surfaces facing away from the key light.
    Shadow,
    /// Steps up the ramp, on the surfaces facing the key light.
    Light,
    /// Steps up the ramp, on the silhouette edge away from the key light only.
    Rim,
}

/// Which perimeter pixels an `outline` call writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutlineMode {
    /// Writes nothing, for a style that carries no outline at all.
    None,
    /// Drops the outline where the key light strikes, so the sprite reads lit.
    Selective,
    /// Writes every perimeter pixel.
    Full,
}

impl OutlineMode {
    /// Parses the name a `StyleRules` stores, refusing anything else.
    ///
    /// An `outline` call may omit its mode and take the project's, so the style
    /// string has to become a mode somewhere; doing it here keeps the one place
    /// that knows these three names next to the code that acts on them.
    pub fn parse(value: &str) -> Result<Self> {
        Ok(match value {
            "none" => Self::None,
            "selective" => Self::Selective,
            "full" => Self::Full,
            _ => return Err(RasterError::new("style.invalid_outline", value)),
        })
    }
}

/// One resolved write: a position and the slot the engine chose for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Placement {
    pub x: i32,
    pub y: i32,
    pub slot: u8,
}

/// What a shading pass produced, and what it could not resolve.
///
/// `skipped` is reported rather than swallowed because a pass that wrote
/// nothing and a pass that could not find a ramp look identical from the
/// outside, and the difference between them is the whole diagnosis.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Shaded {
    pub placements: Vec<Placement>,
    pub skipped: usize,
}

/// The document context a shading pass reads but never writes.
///
/// A shading op is the only kind that cannot be answered from the layer it
/// writes: it needs the flats to know which material each pixel is, the palette
/// to know which ramp that material uses, and the silhouette to know where the
/// sprite's outer edge falls.
pub struct Context<'a> {
    pub palette: &'a Palette,
    pub sources: &'a BTreeMap<&'static str, IndexedBuffer>,
    pub rules: &'a StyleRules,
}

impl Context<'_> {
    /// The named layer, or a stated failure rather than a silently empty pass.
    pub fn source(&self, role: &str) -> Result<&IndexedBuffer> {
        self.sources
            .get(role)
            .ok_or_else(|| RasterError::new("document.layer_not_found", role))
    }

    /// The key light direction, preferring an explicit one over the style's.
    fn direction(&self, requested: Option<Direction>) -> Result<Direction> {
        match requested {
            Some(direction) => Ok(direction),
            None => Direction::parse(&self.rules.light_direction),
        }
    }

    /// The silhouette if the document has one, otherwise the given fallback.
    ///
    /// The outer edge matters to three of the rules here, and the silhouette is
    /// its authoritative record. Falling back to the layer under inspection
    /// keeps the ops usable on a document that has not reached that step yet.
    fn mask<'b>(&'b self, fallback: &'b IndexedBuffer) -> &'b IndexedBuffer {
        self.sources
            .get("silhouette")
            .filter(|mask| mask.data.iter().any(|slot| *slot != 0))
            .unwrap_or(fallback)
    }
}

/// Steps `depth` places along `slot`'s ramp, clamping at either end.
///
/// Clamping rather than failing is deliberate. An agent asking for a second
/// shadow step on a three-step ramp has asked for the darkest colour that ramp
/// holds, and giving it that is more useful than refusing the whole call. A
/// slot belonging to no ramp returns `None`, which is what the skip count
/// counts.
fn step_along_ramp(palette: &Palette, slot: u8, depth: i32) -> Option<u8> {
    let (slots, step) = palette.ramps.iter().find_map(|ramp| {
        ramp.slots
            .iter()
            .position(|index| *index == slot)
            .map(|step| (ramp.slots.as_slice(), step))
    })?;
    let target = (step as i32 + depth).clamp(0, slots.len() as i32 - 1);
    slots.get(target as usize).copied()
}

/// The slot sitting between two slots of one ramp, if the ramp has one.
///
/// Anti-aliasing needs an existing palette entry whose lightness lies between
/// the two colours it joins. Averaging the two in RGB would invent a colour,
/// and invented intermediates are the documented cause of muddy anti-aliasing,
/// so a ramp with no room between the two steps simply does not get anti-
/// aliased there.
fn between(palette: &Palette, first: u8, second: u8) -> Option<u8> {
    let ramp = palette
        .ramps
        .iter()
        .find(|ramp| ramp.slots.contains(&first) && ramp.slots.contains(&second))?;
    let a = ramp.slots.iter().position(|slot| *slot == first)?;
    let b = ramp.slots.iter().position(|slot| *slot == second)?;
    if a.abs_diff(b) < 2 {
        return None;
    }
    ramp.slots.get((a + b) / 2).copied()
}

fn position(buffer: &IndexedBuffer, index: usize) -> (i32, i32) {
    (
        (index % usize::from(buffer.width)) as i32,
        (index / usize::from(buffer.width)) as i32,
    )
}

fn edge_neighbours(x: i32, y: i32) -> [(i32, i32); 4] {
    [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]
}

fn all_neighbours(x: i32, y: i32) -> [(i32, i32); 8] {
    [
        (x - 1, y - 1),
        (x, y - 1),
        (x + 1, y - 1),
        (x - 1, y),
        (x + 1, y),
        (x - 1, y + 1),
        (x, y + 1),
        (x + 1, y + 1),
    ]
}

/// Whether a filled pixel touches transparency, and so lies on the perimeter.
fn on_perimeter(mask: &IndexedBuffer, x: i32, y: i32) -> bool {
    mask.get(x, y) != 0
        && edge_neighbours(x, y)
            .iter()
            .any(|&(nx, ny)| mask.get(nx, ny) == 0)
}

/// The outward normal at a perimeter pixel, summed over its empty directions.
///
/// It is left unnormalised because every use of it is a sign test or a sort
/// key, and its magnitude only ever says how exposed the pixel is - which is
/// itself a reasonable tie-break, since the most exposed pixels are the ones a
/// backlight actually catches.
fn outward_normal(mask: &IndexedBuffer, x: i32, y: i32) -> (f32, f32) {
    let mut normal = (0.0, 0.0);
    for (nx, ny) in all_neighbours(x, y) {
        if mask.get(nx, ny) == 0 {
            normal.0 += (nx - x) as f32;
            normal.1 += (ny - y) as f32;
        }
    }
    normal
}

/// Every perimeter pixel of the mask, in reading order.
fn perimeter(mask: &IndexedBuffer) -> Vec<usize> {
    (0..mask.data.len())
        .filter(|&index| {
            let (x, y) = position(mask, index);
            on_perimeter(mask, x, y)
        })
        .collect()
}

/// Groups filled pixels into connected regions of one material.
///
/// Shading is decided per form rather than per canvas, because a sprite is
/// several forms and each one turns away from the light in its own place. Two
/// pixels join the same region when they touch edge-on and their slots share a
/// ramp, which is the closest thing an indexed buffer has to "the same
/// surface".
fn material_regions(buffer: &IndexedBuffer, palette: &Palette) -> Vec<Vec<usize>> {
    let material = |slot: u8| {
        palette
            .ramps
            .iter()
            .position(|ramp| ramp.slots.contains(&slot))
            .unwrap_or(palette.ramps.len() + usize::from(slot))
    };
    let mut seen = vec![false; buffer.data.len()];
    let mut regions = Vec::new();
    for start in 0..buffer.data.len() {
        if seen[start] || buffer.data[start] == 0 {
            continue;
        }
        let key = material(buffer.data[start]);
        let mut region = Vec::new();
        let mut queue = vec![start];
        seen[start] = true;
        while let Some(index) = queue.pop() {
            region.push(index);
            let (x, y) = position(buffer, index);
            for (nx, ny) in edge_neighbours(x, y) {
                let Some(next) = buffer.offset(nx, ny) else {
                    continue;
                };
                if !seen[next] && buffer.data[next] != 0 && material(buffer.data[next]) == key {
                    seen[next] = true;
                    queue.push(next);
                }
            }
        }
        regions.push(region);
    }
    regions
}

/// Keeps a rectangle's worth of indices, or all of them when none was given.
fn in_region(buffer: &IndexedBuffer, region: Option<Bounds>, index: usize) -> bool {
    let Some(bounds) = region else {
        return true;
    };
    let (x, y) = position(buffer, index);
    x >= i32::from(bounds.x)
        && y >= i32::from(bounds.y)
        && x < i32::from(bounds.x) + i32::from(bounds.width)
        && y < i32::from(bounds.y) + i32::from(bounds.height)
}

/// The share of each form's pixels core shadow claims, from the style guide.
const SHADOW_SHARE: f32 = 0.35;
/// The share light claims. It is smaller than shadow on purpose: light areas
/// that grow as large as shadow areas flatten the form.
const LIGHT_SHARE: f32 = 0.25;

/// Resolves a `shade` call into the slots it writes to the target layer.
///
/// Shadow and light are chosen per form by projecting every pixel onto the key
/// light axis and taking a share from each end. The share is a quantile rather
/// than a fixed distance, and that is the important part: a pixel is shaded
/// because of where it sits within its own form, not because of how near it is
/// to the edge. Shading by edge distance is precisely pillow shading, and the
/// pillow gate measures the correlation between lightness and edge distance, so
/// a fixed-distance rule here would fail the gate the moment it ran.
pub fn shade(
    context: &Context,
    from: &str,
    region: Option<Bounds>,
    kind: ShadeKind,
    direction: Option<Direction>,
    depth: u8,
) -> Result<Shaded> {
    let source = context.source(from)?;
    source.validate()?;
    let direction = context.direction(direction)?;
    let steps = i32::from(depth.max(1));
    if kind == ShadeKind::Rim {
        return rim(context, source, direction, region, steps);
    }
    let (kx, ky) = direction.vector();
    let (share, offset) = match kind {
        ShadeKind::Shadow => (SHADOW_SHARE, -steps),
        ShadeKind::Light => (LIGHT_SHARE, steps),
        ShadeKind::Rim => unreachable!("rim returned above"),
    };
    let mut result = Shaded::default();
    for pixels in material_regions(source, context.palette) {
        // Sorting by the projection puts the pixels furthest from the light
        // first and those facing it last, so each end of the ordering is the
        // band this call wants.
        let mut projected: Vec<(f32, usize)> = pixels
            .iter()
            .map(|&index| {
                let (x, y) = position(source, index);
                (x as f32 * kx + y as f32 * ky, index)
            })
            .collect();
        projected.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        let take = ((projected.len() as f32 * share).round() as usize).min(projected.len());
        let chosen: Vec<usize> = match kind {
            ShadeKind::Shadow => projected.iter().take(take).map(|p| p.1).collect(),
            _ => projected.iter().rev().take(take).map(|p| p.1).collect(),
        };
        for index in chosen {
            if !in_region(source, region, index) {
                continue;
            }
            let (x, y) = position(source, index);
            match step_along_ramp(context.palette, source.data[index], offset) {
                Some(slot) => result.placements.push(Placement { x, y, slot }),
                None => result.skipped += 1,
            }
        }
    }
    result
        .placements
        .sort_by_key(|placement| (placement.y, placement.x));
    Ok(result)
}

/// The fraction of the sprite's height that carries no rim at all.
const RIM_FLOOR: f32 = 0.75;
/// The longest unbroken rim run. Beyond this the rim stops reading as a
/// backlight and starts reading as a glow outline round the whole sprite.
const RIM_RUN: usize = 7;
/// The gap left between runs, which is what breaks the rim up.
const RIM_GAP: usize = 2;

/// Resolves the backlight edge, which is the signature HD-2D move.
///
/// The rim sits on the outermost filled pixel of the side facing away from the
/// key, never on the key-lit side and never in the bottom quarter of the
/// sprite. It is then broken into short runs and trimmed to the style's
/// perimeter coverage, because a rim that runs continuously round the sprite
/// reads as a glow sticker rather than as a second light - and because landing
/// inside the coverage band is what lets the accent gate pass.
fn rim(
    context: &Context,
    source: &IndexedBuffer,
    direction: Direction,
    region: Option<Bounds>,
    steps: i32,
) -> Result<Shaded> {
    let mask = context.mask(source);
    mask.validate()?;
    let (kx, ky) = direction.vector();
    let edge = perimeter(mask);
    let floor = f32::from(mask.height) * RIM_FLOOR;
    let mut candidates: Vec<usize> = edge
        .iter()
        .copied()
        .filter(|&index| {
            let (x, y) = position(mask, index);
            let (nx, ny) = outward_normal(mask, x, y);
            // A negative dot product means the surface turns away from the key,
            // which is the only side a backlight can reach.
            (y as f32) < floor && nx * kx + ny * ky < 0.0 && in_region(mask, region, index)
        })
        .collect();
    // The ceiling is a hard failure in the style guide, so the trim targets the
    // middle of the band rather than its upper edge.
    let target =
        (edge.len() as f32 * (context.rules.rim_coverage[0] + context.rules.rim_coverage[1]) / 2.0)
            .round() as usize;
    candidates.sort_by_key(|&index| {
        let (x, y) = position(mask, index);
        let (nx, ny) = outward_normal(mask, x, y);
        // Most-exposed first: the hardest silhouette turns are where a rim
        // earns its contrast, so they survive the trim.
        std::cmp::Reverse(((nx * kx + ny * ky) * -1000.0) as i32)
    });
    let keep: std::collections::BTreeSet<usize> =
        candidates.into_iter().take(target.max(1)).collect();
    let mut result = Shaded::default();
    for chain in chains(mask, &keep) {
        for (offset, index) in chain.into_iter().enumerate() {
            // Runs of `RIM_RUN` separated by `RIM_GAP`, so the rim is broken
            // rather than continuous even where the silhouette is not.
            if offset % (RIM_RUN + RIM_GAP) >= RIM_RUN {
                continue;
            }
            let (x, y) = position(mask, index);
            let base = source.get(x, y);
            if base == 0 {
                continue;
            }
            match step_along_ramp(context.palette, base, steps) {
                Some(slot) => result.placements.push(Placement { x, y, slot }),
                None => result.skipped += 1,
            }
        }
    }
    result
        .placements
        .sort_by_key(|placement| (placement.y, placement.x));
    Ok(result)
}

/// Orders a set of perimeter pixels into the chains they form along the edge.
///
/// Breaking the rim into runs only means anything if the runs follow the
/// silhouette, so the pixels have to be walked in contour order rather than in
/// reading order. Each walk starts from an end of a chain where there is one,
/// so a chain is traversed once from its tip rather than from its middle.
fn chains(mask: &IndexedBuffer, members: &std::collections::BTreeSet<usize>) -> Vec<Vec<usize>> {
    let linked = |index: usize| {
        let (x, y) = position(mask, index);
        all_neighbours(x, y)
            .into_iter()
            .filter_map(|(nx, ny)| mask.offset(nx, ny))
            .filter(|next| members.contains(next))
            .collect::<Vec<_>>()
    };
    let mut visited = std::collections::BTreeSet::new();
    let mut result = Vec::new();
    // Tips first, so a chain with two ends is walked from one of them and only
    // a closed loop is entered at an arbitrary point.
    let starts = members
        .iter()
        .filter(|&&index| linked(index).len() <= 1)
        .chain(members.iter());
    for &start in starts {
        if visited.contains(&start) {
            continue;
        }
        let mut chain = vec![start];
        visited.insert(start);
        let mut current = start;
        while let Some(&next) = linked(current).iter().find(|next| !visited.contains(next)) {
            visited.insert(next);
            chain.push(next);
            current = next;
        }
        result.push(chain);
    }
    result
}

/// Resolves an `outline` call into the slots it writes to the outline layer.
///
/// The colour of every outline pixel is derived from the fill it borders, by
/// stepping `darken` places down that fill's own ramp. It is never a constant,
/// and in particular never black: a black outline carries no hue, so it reads
/// the same against leather as against cloth and flattens the sprite, and it is
/// the most recognisable tell of amateur pixel art.
///
/// `selective` drops the outline where the key light strikes, which is what
/// makes a sprite read as lit rather than as a sticker. It drops the pixels
/// facing the light most directly, stopping at the coverage the style asks for,
/// and it never drops one in the bottom fifth of the sprite - that band carries
/// the contact edge and needs a full dark outline to sit on the ground.
pub fn outline(
    context: &Context,
    from: &str,
    mode: OutlineMode,
    darken: u8,
    direction: Option<Direction>,
) -> Result<Shaded> {
    let source = context.source(from)?;
    source.validate()?;
    if mode == OutlineMode::None {
        return Ok(Shaded::default());
    }
    let mask = context.mask(source);
    mask.validate()?;
    let (kx, ky) = context.direction(direction)?.vector();
    let edge = perimeter(mask);
    let grounded = f32::from(mask.height) * 0.80;
    let mut keep: Vec<usize> = edge
        .iter()
        .copied()
        .filter(|&index| (position(mask, index).1 as f32) >= grounded)
        .collect();
    let mut optional: Vec<usize> = edge
        .iter()
        .copied()
        .filter(|&index| (position(mask, index).1 as f32) < grounded)
        .collect();
    if mode == OutlineMode::Selective {
        let coverage =
            (context.rules.outline_coverage[0] + context.rules.outline_coverage[1]) / 2.0;
        let budget = ((edge.len() as f32 * coverage).round() as usize).saturating_sub(keep.len());
        // Least lit first, so the pixels the key strikes head-on are the ones
        // that fall off the end of the budget.
        optional.sort_by_key(|&index| {
            let (x, y) = position(mask, index);
            let (nx, ny) = outward_normal(mask, x, y);
            ((nx * kx + ny * ky) * 1000.0) as i32
        });
        optional.truncate(budget);
    }
    keep.append(&mut optional);
    let mut result = Shaded::default();
    for index in keep {
        let (x, y) = position(mask, index);
        let base = source.get(x, y);
        if base == 0 {
            // Nothing to derive a colour from. An outline pixel guessed here
            // would be the flat black this op exists to avoid.
            result.skipped += 1;
            continue;
        }
        match step_along_ramp(context.palette, base, -i32::from(darken.max(1))) {
            Some(slot) => result.placements.push(Placement { x, y, slot }),
            None => result.skipped += 1,
        }
    }
    result
        .placements
        .sort_by_key(|placement| (placement.y, placement.x));
    Ok(result)
}

/// How many anti-aliasing pixels a stair step of this run length earns.
///
/// Straight from the style guide's table: the longer the segment, the longer
/// the anti-aliasing. A run of one or two pixels gets none, which is also what
/// keeps a 45-degree diagonal - a sequence of one-pixel runs - untouched. A
/// 45-degree diagonal is already optimal and anti-aliasing it only blurs it.
fn antialias_count(run: usize, strength: u8) -> usize {
    let base = match run {
        0..=2 => 0,
        3..=4 => 1,
        5..=8 => 2,
        _ => 3,
    };
    (base * usize::from(strength)).min(3)
}

/// The smallest feature that may be anti-aliased, in pixels.
///
/// Eyes, mouths and anything else at or below three pixels turn to mush when
/// an intermediate value is placed inside them.
const ANTIALIAS_MIN_FEATURE: usize = 4;

/// Resolves an `antialias` call into intermediate ramp steps on interior edges.
///
/// It refuses to touch the outer silhouette boundary, and that refusal is the
/// point rather than a caution. This sprite is composited over 3D backgrounds
/// of unknown and changing colour; an anti-aliased outer edge is blended toward
/// one particular background and shows as a dirty fringe over every other one.
/// That halo is exactly what the conform pipeline exists to remove, so placing
/// it here deliberately would be self-defeating.
pub fn antialias(context: &Context, layer: &IndexedBuffer, strength: u8) -> Result<Shaded> {
    layer.validate()?;
    let mask = context.mask(layer);
    mask.validate()?;
    let sizes = feature_sizes(layer);
    let mut result = Shaded::default();
    if strength == 0 {
        return Ok(result);
    }
    // Both axes, because a shallow diagonal produces horizontal runs along a
    // vertical boundary and a steep one produces vertical runs along a
    // horizontal boundary. Only one of the two would leave half the edges
    // stair-stepped.
    for transposed in [false, true] {
        let (across, along) = if transposed {
            (layer.width, layer.height)
        } else {
            (layer.height, layer.width)
        };
        let at = |a: i32, b: i32| {
            if transposed {
                layer.get(a, b)
            } else {
                layer.get(b, a)
            }
        };
        for boundary in 0..i32::from(across).saturating_sub(1) {
            let mut start = 0_i32;
            while start < i32::from(along) {
                let first = at(boundary, start);
                let second = at(boundary + 1, start);
                let mut end = start;
                while end + 1 < i32::from(along)
                    && at(boundary, end + 1) == first
                    && at(boundary + 1, end + 1) == second
                {
                    end += 1;
                }
                collect_step(
                    context,
                    layer,
                    mask,
                    &sizes,
                    &mut result,
                    &Step {
                        transposed,
                        boundary,
                        start,
                        end,
                        slots: (first, second),
                        strength,
                    },
                );
                start = end + 1;
            }
        }
    }
    result
        .placements
        .sort_by_key(|placement| (placement.y, placement.x));
    result
        .placements
        .dedup_by_key(|placement| (placement.y, placement.x));
    Ok(result)
}

/// One run of a stair-stepped interior edge, as the scan found it.
///
/// The scan runs over both axes, so `transposed` says which of `boundary` and
/// the run coordinate is `x`: without it the two passes would need two copies
/// of everything below.
struct Step {
    transposed: bool,
    boundary: i32,
    start: i32,
    end: i32,
    slots: (u8, u8),
    strength: u8,
}

/// Places the corner pixels for one run of a stair-stepped interior edge.
fn collect_step(
    context: &Context,
    layer: &IndexedBuffer,
    mask: &IndexedBuffer,
    sizes: &[usize],
    result: &mut Shaded,
    step: &Step,
) {
    let (first, second) = step.slots;
    if first == 0 || second == 0 || first == second {
        return;
    }
    let run = (step.end - step.start + 1) as usize;
    let mut count = antialias_count(run, step.strength);
    // At least one pixel of the run has to survive, or the step is not softened
    // but replaced, and the line loses the shape it had.
    while count > 0 && count * 2 >= run {
        count -= 1;
    }
    if count == 0 {
        return;
    }
    let Some(slot) = between(context.palette, first, second) else {
        // No intermediate exists in the ramp, so there is nothing to place that
        // would not be an invented colour.
        result.skipped += 1;
        return;
    };
    for offset in 0..count as i32 {
        for along in [step.start + offset, step.end - offset] {
            let (x, y) = if step.transposed {
                (step.boundary, along)
            } else {
                (along, step.boundary)
            };
            let Some(index) = layer.offset(x, y) else {
                continue;
            };
            let outer = all_neighbours(x, y)
                .iter()
                .any(|&(nx, ny)| mask.get(nx, ny) == 0)
                || mask.get(x, y) == 0;
            if outer || sizes[index] < ANTIALIAS_MIN_FEATURE {
                result.skipped += 1;
                continue;
            }
            result.placements.push(Placement { x, y, slot });
        }
    }
}

/// The size of the same-slot region each pixel belongs to.
///
/// Used only to keep anti-aliasing away from features of three pixels or
/// fewer, where an intermediate value replaces most of the feature rather than
/// softening its edge.
fn feature_sizes(layer: &IndexedBuffer) -> Vec<usize> {
    let mut sizes = vec![0; layer.data.len()];
    let mut seen = vec![false; layer.data.len()];
    for start in 0..layer.data.len() {
        if seen[start] || layer.data[start] == 0 {
            continue;
        }
        let slot = layer.data[start];
        let mut region = Vec::new();
        let mut queue = vec![start];
        seen[start] = true;
        while let Some(index) = queue.pop() {
            region.push(index);
            let (x, y) = position(layer, index);
            for (nx, ny) in edge_neighbours(x, y) {
                let Some(next) = layer.offset(nx, ny) else {
                    continue;
                };
                if !seen[next] && layer.data[next] == slot {
                    seen[next] = true;
                    queue.push(next);
                }
            }
        }
        for index in &region {
            sizes[*index] = region.len();
        }
    }
    sizes
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raster::{grid, Material, PaletteSlot, Ramp};

    /// A four-step ramp on slots 1..=4, dark to light, plus one unramped slot.
    fn palette() -> Palette {
        let mut slots: Vec<PaletteSlot> = (1..=5)
            .map(|index| PaletteSlot {
                index,
                rgba: [index * 40, index * 40, index * 40, 255],
                name: None,
                ramp: (index <= 4).then(|| "cloth".to_string()),
                step: (index <= 4).then_some(index - 1),
            })
            .collect();
        slots[4].rgba = [200, 20, 20, 255];
        Palette {
            slots,
            ramps: vec![Ramp {
                name: "cloth".into(),
                material: Material::Cloth,
                slots: vec![1, 2, 3, 4],
            }],
        }
    }

    fn context<'a>(
        sources: &'a BTreeMap<&'static str, IndexedBuffer>,
        palette: &'a Palette,
        rules: &'a StyleRules,
    ) -> Context<'a> {
        Context {
            palette,
            sources,
            rules,
        }
    }

    fn sources(pairs: &[(&'static str, &str)]) -> BTreeMap<&'static str, IndexedBuffer> {
        pairs
            .iter()
            .map(|(role, text)| (*role, grid::parse(text).unwrap()))
            .collect()
    }

    #[test]
    fn shadow_lands_away_from_the_key_and_light_toward_it() {
        let flats = "CCCCCC\nCCCCCC\nCCCCCC\nCCCCCC\nCCCCCC\nCCCCCC";
        let map = sources(&[("flats", flats)]);
        let palette = palette();
        let rules = StyleRules::default();
        let context = context(&map, &palette, &rules);
        let shadow = shade(
            &context,
            "flats",
            None,
            ShadeKind::Shadow,
            Some(Direction::UpperLeft),
            1,
        )
        .unwrap();
        let light = shade(
            &context,
            "flats",
            None,
            ShadeKind::Light,
            Some(Direction::UpperLeft),
            1,
        )
        .unwrap();
        assert!(!shadow.placements.is_empty() && !light.placements.is_empty());
        // Every shadow pixel steps one down the ramp from slot 3, every light
        // pixel one up, and the engine never consulted a colour to decide it.
        assert!(shadow.placements.iter().all(|p| p.slot == 2));
        assert!(light.placements.iter().all(|p| p.slot == 4));
        let shadow_centre: f32 = shadow
            .placements
            .iter()
            .map(|p| (p.x + p.y) as f32)
            .sum::<f32>()
            / shadow.placements.len() as f32;
        let light_centre: f32 = light
            .placements
            .iter()
            .map(|p| (p.x + p.y) as f32)
            .sum::<f32>()
            / light.placements.len() as f32;
        assert!(
            light_centre < shadow_centre,
            "light {light_centre} should sit nearer the upper left than shadow {shadow_centre}"
        );
    }

    #[test]
    fn an_unramped_slot_is_skipped_and_counted() {
        let map = sources(&[("flats", "EEE\nEEE\nEEE")]);
        let palette = palette();
        let rules = StyleRules::default();
        let result = shade(
            &context(&map, &palette, &rules),
            "flats",
            None,
            ShadeKind::Shadow,
            Some(Direction::UpperLeft),
            1,
        )
        .unwrap();
        assert!(result.placements.is_empty());
        assert!(result.skipped > 0);
    }

    #[test]
    fn shade_depth_clamps_at_the_end_of_the_ramp() {
        let map = sources(&[("flats", "AAAA\nAAAA\nAAAA\nAAAA")]);
        let palette = palette();
        let rules = StyleRules::default();
        let result = shade(
            &context(&map, &palette, &rules),
            "flats",
            None,
            ShadeKind::Shadow,
            Some(Direction::UpperLeft),
            9,
        )
        .unwrap();
        // Slot 1 is already the darkest step, so the darkest step is what an
        // over-deep request gets rather than an error.
        assert!(result.placements.iter().all(|p| p.slot == 1));
    }

    #[test]
    fn shade_honours_a_region() {
        let map = sources(&[("flats", "CCCCCC\nCCCCCC\nCCCCCC\nCCCCCC\nCCCCCC\nCCCCCC")]);
        let palette = palette();
        let rules = StyleRules::default();
        let result = shade(
            &context(&map, &palette, &rules),
            "flats",
            Some(Bounds {
                x: 0,
                y: 0,
                width: 6,
                height: 2,
            }),
            ShadeKind::Shadow,
            Some(Direction::UpperLeft),
            1,
        )
        .unwrap();
        assert!(result.placements.iter().all(|p| p.y < 2));
    }

    #[test]
    fn rim_avoids_the_key_side_and_the_bottom_quarter() {
        let body = "CCCCCCCC\n".repeat(12);
        let map = sources(&[("flats", body.trim_end()), ("silhouette", body.trim_end())]);
        let palette = palette();
        let rules = StyleRules::default();
        let result = shade(
            &context(&map, &palette, &rules),
            "flats",
            None,
            ShadeKind::Rim,
            Some(Direction::UpperLeft),
            1,
        )
        .unwrap();
        assert!(!result.placements.is_empty());
        assert!(
            result.placements.iter().all(|p| p.y < 9),
            "the bottom quarter must stay free of rim"
        );
        assert!(
            result.placements.iter().any(|p| p.x == 7),
            "the away side of the key should carry rim"
        );
        assert!(
            !result.placements.iter().any(|p| p.x == 0 && p.y == 0),
            "the key-lit corner must not carry rim"
        );
    }

    #[test]
    fn outline_colour_comes_from_the_fill_it_borders() {
        let map = sources(&[("flats", "CCC\nCEC\nCCC"), ("silhouette", "AAA\nAAA\nAAA")]);
        let palette = palette();
        let rules = StyleRules::default();
        let result = outline(
            &context(&map, &palette, &rules),
            "flats",
            OutlineMode::Full,
            2,
            Some(Direction::UpperLeft),
        )
        .unwrap();
        // Slot 3 stepped two down its ramp is slot 1, and no pixel is given a
        // constant dark instead.
        assert!(!result.placements.is_empty());
        assert!(result.placements.iter().all(|p| p.slot == 1));
    }

    #[test]
    fn selective_outline_drops_the_lit_arc_and_keeps_the_ground_edge() {
        let body = "CCCCCCCCCC\n".repeat(10);
        let map = sources(&[("flats", body.trim_end()), ("silhouette", body.trim_end())]);
        let palette = palette();
        let rules = StyleRules::default();
        let context = context(&map, &palette, &rules);
        let full = outline(
            &context,
            "flats",
            OutlineMode::Full,
            1,
            Some(Direction::UpperLeft),
        )
        .unwrap();
        let selective = outline(
            &context,
            "flats",
            OutlineMode::Selective,
            1,
            Some(Direction::UpperLeft),
        )
        .unwrap();
        assert!(selective.placements.len() < full.placements.len());
        assert!(selective
            .placements
            .iter()
            .any(|p| p.y == 9 && (p.x == 0 || p.x == 9)));
        assert!(
            !selective.placements.iter().any(|p| p.x == 0 && p.y == 0),
            "the corner the key strikes head-on is the first to be dropped"
        );
        assert_eq!(
            outline(
                &context,
                "flats",
                OutlineMode::None,
                1,
                Some(Direction::UpperLeft)
            )
            .unwrap(),
            Shaded::default()
        );
    }

    #[test]
    fn antialias_never_touches_the_outer_silhouette() {
        // A stair-stepped interior boundary between slot 1 and slot 4 inside a
        // solid block, with a one-pixel margin of its own colour all round.
        let text = "\
AAAAAAAAAA\n\
ADDDDDDDDA\n\
AAAADDDDDA\n\
AAAAAAADDA\n\
AAAAAAAAAA";
        let map = sources(&[("flats", text), ("silhouette", text)]);
        let palette = palette();
        let rules = StyleRules::default();
        let layer = grid::parse(text).unwrap();
        let result = antialias(&context(&map, &palette, &rules), &layer, 1).unwrap();
        for placement in &result.placements {
            assert!(
                placement.x > 0 && placement.y > 0 && placement.x < 9 && placement.y < 4,
                "{placement:?} sits on the outer edge"
            );
            // The written slot is a real ramp entry between the two it joins,
            // not an average of them.
            assert!(placement.slot == 2 || placement.slot == 3);
        }
    }

    #[test]
    fn antialias_leaves_short_runs_and_missing_intermediates_alone() {
        assert_eq!(antialias_count(1, 1), 0);
        assert_eq!(antialias_count(2, 1), 0);
        assert_eq!(antialias_count(4, 1), 1);
        assert_eq!(antialias_count(6, 1), 2);
        assert_eq!(antialias_count(12, 1), 3);
        assert_eq!(antialias_count(12, 4), 3);
        assert_eq!(antialias_count(12, 0), 0);
        let palette = palette();
        // Adjacent ramp steps have nothing between them, so there is no legal
        // anti-aliasing colour and none is invented.
        assert_eq!(between(&palette, 1, 2), None);
        assert_eq!(between(&palette, 1, 4), Some(2));
        assert_eq!(between(&palette, 1, 5), None);
    }

    #[test]
    fn direction_names_round_trip_and_point_where_they_say() {
        assert_eq!(
            Direction::parse("upper-left").unwrap(),
            Direction::UpperLeft
        );
        assert!(Direction::parse("sideways").is_err());
        let (x, y) = Direction::UpperLeft.vector();
        assert!(x < 0.0 && y < 0.0);
        assert!((Direction::UpperLeft.angle_degrees() - -135.0).abs() < 0.001);
        assert!((Direction::Right.angle_degrees() - 0.0).abs() < 0.001);
    }
}
