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

//! Gates report measurements, rather than trusting a tool's claim that its
//! output is clean. Thresholds live together so a style change is reviewable.

use super::{color, IndexedBuffer, Palette, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};

pub struct Thresholds {
    pub orphan_fraction: f32,
    pub orphan_count: usize,
    pub speckle_fraction: f32,
    pub perimeter_ratio: [f32; 2],
    pub solidity: [f32; 2],
    pub pillow_correlation: f32,
    pub pillow_window: usize,
    pub pillow_window_fill: f32,
    pub shaded_spread: f32,
    pub light_std_degrees: f32,
    pub light_region_deviation: f32,
    pub light_mean_deviation: f32,
    pub jaggy_span: usize,
    pub jaggy_long_run: usize,
    pub jaggy_repeat: usize,
    pub jaggy_jump: usize,
    pub accent_count: usize,
    pub rim_run: [usize; 2],
    pub rim_gap: [usize; 2],
    pub rim_contrast: f32,
    pub change_rate: f32,
    pub outline_bottom_band: f32,
}
pub const HD2D: Thresholds = Thresholds {
    orphan_fraction: 0.02,
    orphan_count: 6,
    speckle_fraction: 0.06,
    perimeter_ratio: [18.0, 28.0],
    solidity: [0.62, 0.82],
    // §11.7 fixes the lightness-to-edge-distance correlation at r <= 0.6. The
    // number survives the move to a windowed, direction-corrected measurement
    // because that measurement can only ever read lower than the sprite-wide
    // Pearson the guide describes: removing the planar component removes
    // lightness that answers to the key rather than to the silhouette, and a
    // window that happens to sit on a flat area contributes nothing instead of
    // diluting a neighbour. Measured against the two figures §7.2 draws, the
    // pillowed one scores 1.00 and the directional one 0.48 once §4.3 is
    // applied to its outline, so 0.6 sits between them with room on both sides.
    pillow_correlation: 0.6,
    // §5.2 gives three bands only to a form larger than 6 x 6 px, so a 7 x 7
    // window is the smallest patch of sprite that can carry a shading ramp at
    // all, and therefore the smallest that can carry a pillow.
    pillow_window: 7,
    // A window that is mostly transparent is looking at the silhouette's edge
    // rather than into a form, where edge distance has neither the spread nor
    // the meaning the heuristic needs. Two thirds filled keeps the window on a
    // body.
    pillow_window_fill: 0.666,
    // §2.5 puts the floor for a band boundary the eye can read at dL 0.07.
    // Below it a region carries no shading, which is a legitimate flat.
    shaded_spread: 0.07,
    light_std_degrees: 35.0,
    light_region_deviation: 45.0,
    light_mean_deviation: 30.0,
    jaggy_span: 4,
    jaggy_long_run: 3,
    jaggy_repeat: 5,
    jaggy_jump: 2,
    accent_count: 6,
    // §5.5 rule 4 draws the rim in runs of 3 to 7 px separated by gaps of 1 to
    // 3 px, and the step 7 checklist repeats the run half of it. A longer run
    // is the glow-outline sticker the rule exists to prevent, and a shorter
    // one is the stray pixel rule 5 warns about at the bottom of the band.
    rim_run: [3, 7],
    rim_gap: [1, 3],
    // §5.5 rule 9: the rim has to beat the fill it sits against by this much
    // in OKLCH lightness or it does not read as a backlight at all.
    rim_contrast: 0.20,
    // §11.5 calls a sprite busy above this rate of horizontal colour changes
    // per filled pixel. At the flats step nothing has been detailed yet, so a
    // buffer over the busy line is not detail that went too far: it is two
    // materials interleaved where one material's area should be.
    change_rate: 0.45,
    // §4.3 never drops the outline along the bottom fifth of the sprite, where
    // the contact shadow is what anchors the character to the ground plane.
    outline_bottom_band: 0.20,
};

/// One measurement a gate made, in the shape `mcp-tools.md` §8 specifies.
///
/// A bare reason code tells an agent only that it failed. A measured `detail`
/// and a `hint` that names coordinates tell it what to do next, which is the
/// difference between an agent that converges and one that retries blindly.
/// Checks that passed are reported alongside the ones that did not, so a reader
/// can see what was verified rather than only what broke.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateCheck {
    pub name: String,
    pub pass: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

impl GateCheck {
    /// A check whose verdict and whose measurement are computed together.
    ///
    /// The hint is built whether or not it is needed and then dropped on a
    /// pass, because a hint assembled at the call site beside the measurement
    /// can name the pixels that failed, and one assembled later cannot.
    pub fn verdict(
        name: &str,
        pass: bool,
        detail: impl Into<String>,
        hint: impl Into<String>,
    ) -> Self {
        Self {
            name: name.into(),
            pass,
            detail: Some(detail.into()),
            hint: (!pass).then(|| hint.into()),
        }
    }
}

/// Where a gate found something, as `(x,y)` pairs an agent can paint over.
///
/// Only the first few are named: a hint is a place to start, and a list of
/// three hundred coordinates is not one.
pub fn named_points(points: &[(u16, u16)]) -> String {
    const SHOWN: usize = 6;
    let named = points
        .iter()
        .take(SHOWN)
        .map(|(x, y)| format!("({x},{y})"))
        .collect::<Vec<_>>()
        .join(", ");
    match points.len().checked_sub(SHOWN) {
        Some(rest) if rest > 0 => format!("{named} and {rest} more"),
        _ => named,
    }
}

/// Where a region sits, so a report can point an agent at the pixels it has to
/// repaint rather than only telling it that something is wrong.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionBounds {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    pub area: usize,
}

impl std::fmt::Display for RegionBounds {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}x{} at {},{}", self.width, self.height, self.x, self.y)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateMetrics {
    pub filled: usize,
    pub region_sizes: Vec<usize>,
    pub perimeter: usize,
    pub perimeter_squared_over_area: f32,
    pub solidity: f32,
    pub orphan_count: usize,
    pub orphan_fraction: f32,
    pub speckle_fraction: f32,
    pub jaggy_sequences: usize,
    pub horizontal_change_rate: f32,
    pub pillow_correlation: f32,
    pub light_vectors: Vec<f32>,
    pub light_mean_degrees: Option<f32>,
    pub light_std_degrees: Option<f32>,
    /// Regions that are shaded but whose shading points nowhere. They are
    /// reported rather than dropped, because a missing vector reads as consent
    /// to every downstream check that only looks at the vectors it was given.
    pub undirected_regions: Vec<RegionBounds>,
}

pub fn connected_regions(buffer: &IndexedBuffer) -> Vec<Vec<usize>> {
    regions(buffer, |_| 1)
}

fn regions(buffer: &IndexedBuffer, key: impl Fn(u8) -> usize) -> Vec<Vec<usize>> {
    let mut seen = vec![false; buffer.data.len()];
    let mut result = Vec::new();
    for start in 0..buffer.data.len() {
        if seen[start] || buffer.data[start] == 0 {
            continue;
        }
        let material = key(buffer.data[start]);
        let mut component = Vec::new();
        let mut queue = vec![start];
        seen[start] = true;
        while let Some(i) = queue.pop() {
            component.push(i);
            let (x, y) = xy(buffer, i);
            for (nx, ny) in neighbours(x, y) {
                if let Some(j) = buffer.offset(nx, ny) {
                    if !seen[j] && buffer.data[j] != 0 && key(buffer.data[j]) == material {
                        seen[j] = true;
                        queue.push(j);
                    }
                }
            }
        }
        result.push(component);
    }
    result.sort_by_key(|r| std::cmp::Reverse(r.len()));
    result
}

fn xy(buffer: &IndexedBuffer, i: usize) -> (i32, i32) {
    (
        (i % usize::from(buffer.width)) as i32,
        (i / usize::from(buffer.width)) as i32,
    )
}
fn neighbours(x: i32, y: i32) -> [(i32, i32); 4] {
    [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]
}

pub fn measure(buffer: &IndexedBuffer, palette: &Palette) -> Result<GateMetrics> {
    buffer.validate()?;
    let mut lightness = [0.0; 64];
    for &index in &buffer.data {
        if index != 0 {
            lightness[usize::from(index)] = color::srgb_to_oklab(palette.slot(index)?.rgba)[0];
        }
    }
    let filled = buffer.data.iter().filter(|s| **s != 0).count();
    let mut perimeter = 0;
    let mut orphan_count = 0;
    let mut speckle = 0;
    let mut distance = vec![usize::MAX; buffer.data.len()];
    let mut queue = VecDeque::new();
    let mut corners = Vec::new();
    for (i, &slot) in buffer.data.iter().enumerate() {
        if slot == 0 {
            continue;
        }
        let (x, y) = xy(buffer, i);
        let edges = neighbours(x, y)
            .iter()
            .filter(|&&(nx, ny)| buffer.get(nx, ny) == 0)
            .count();
        perimeter += edges;
        if edges > 0 {
            distance[i] = 0;
            queue.push_back(i);
        }
        let mut same = 0;
        for dy in -1..=1 {
            for dx in -1..=1 {
                if (dx != 0 || dy != 0) && buffer.get(x + dx, y + dy) == slot {
                    same += 1;
                }
            }
        }
        orphan_count += usize::from(same == 0);
        speckle += usize::from(same <= 1);
        corners.extend([(x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)]);
    }
    // The image boundary counts as an alpha edge, even on a completely filled
    // canvas. Otherwise the distance transform would have no starting point.
    while let Some(i) = queue.pop_front() {
        let (x, y) = xy(buffer, i);
        for (nx, ny) in neighbours(x, y) {
            if let Some(j) = buffer.offset(nx, ny) {
                if buffer.data[j] != 0 && distance[j] > distance[i] + 1 {
                    distance[j] = distance[i] + 1;
                    queue.push_back(j);
                }
            }
        }
    }
    let hull = hull_area(corners);
    let material = |slot| {
        palette
            .ramps
            .iter()
            .position(|r| r.slots.contains(&slot))
            .unwrap_or(palette.ramps.len() + usize::from(slot))
    };
    let mut vectors = Vec::new();
    let mut undirected_regions = Vec::new();
    for region in regions(buffer, material) {
        let low = region
            .iter()
            .map(|&i| lightness[usize::from(buffer.data[i])])
            .fold(f32::INFINITY, f32::min);
        let high = region
            .iter()
            .map(|&i| lightness[usize::from(buffer.data[i])])
            .fold(f32::NEG_INFINITY, f32::max);
        // A region whose whole lightness spread is under the §2.5 floor carries
        // no boundary the eye can read, so it is a flat and it owes the light
        // step nothing. A region above the floor is shaded, and from here on
        // silence about its direction is a finding rather than an exemption:
        // that is the only difference between a flat and a form lit from
        // nowhere, and it is the one the reader sees.
        if high - low < HD2D.shaded_spread {
            continue;
        }
        let centroid = |level: f32| {
            let mut sum = (0.0, 0.0, 0.0);
            for &i in &region {
                if (lightness[usize::from(buffer.data[i])] - level).abs() < 0.0001 {
                    let (x, y) = xy(buffer, i);
                    sum.0 += x as f32;
                    sum.1 += y as f32;
                    sum.2 += 1.0;
                }
            }
            (sum.0 / sum.2, sum.1 / sum.2)
        };
        let dark = centroid(low);
        let light = centroid(high);
        let (dx, dy) = (light.0 - dark.0, light.1 - dark.1);
        if dx.hypot(dy) > 0.0001 {
            vectors.push(dy.atan2(dx).to_degrees());
        } else {
            undirected_regions.push(bounds(buffer, &region));
        }
    }
    let (mean, std) = circular_statistics(&vectors);
    let denominator = filled.max(1) as f32;
    Ok(GateMetrics {
        filled,
        region_sizes: connected_regions(buffer).iter().map(Vec::len).collect(),
        perimeter,
        perimeter_squared_over_area: (perimeter as f32).powi(2) / denominator,
        solidity: if hull > 0.0 {
            filled as f32 / hull
        } else {
            0.0
        },
        orphan_count,
        orphan_fraction: orphan_count as f32 / denominator,
        speckle_fraction: speckle as f32 / denominator,
        jaggy_sequences: jaggies(buffer),
        horizontal_change_rate: horizontal_change_rate(buffer),
        pillow_correlation: pillow_correlation(buffer, &distance, &lightness),
        light_vectors: vectors,
        light_mean_degrees: mean,
        light_std_degrees: std,
        undirected_regions,
    })
}

/// §11.5's colour-change rate: horizontally adjacent pairs that differ in
/// colour, over filled pixels. It is what separates an area of one material
/// from two materials interleaved, and it does not depend on canvas size.
pub fn horizontal_change_rate(buffer: &IndexedBuffer) -> f32 {
    let width = usize::from(buffer.width);
    let mut changes = 0;
    for row in buffer.data.chunks(width) {
        // A pair is counted only where both pixels are filled, because the
        // silhouette's own edge is a colour change the sprite is supposed to
        // have and counting it would charge a shape for its outline.
        changes += row
            .windows(2)
            .filter(|p| p[0] != 0 && p[1] != 0 && p[0] != p[1])
            .count();
    }
    let filled = buffer.data.iter().filter(|s| **s != 0).count();
    changes as f32 / filled.max(1) as f32
}

/// A pixel on the silhouette's outer edge, and which way that edge faces.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EdgePixel {
    pub x: u16,
    pub y: u16,
    pub index: usize,
    /// The edge here faces into the key light, which is the arc §4.3 lets the
    /// outline drop and §5.5 rule 8 keeps the rim off.
    pub key_facing: bool,
    /// The edge here faces away from the key, which is where §4.3 requires an
    /// outline and where §5.5 puts the backlight.
    pub shadow_facing: bool,
}

impl EdgePixel {
    pub fn point(&self) -> (u16, u16) {
        (self.x, self.y)
    }
}

/// The angle the key light arrives from, in canvas degrees, where y increases
/// downward and an unrecognised name falls back to the §5.1 convention.
pub fn key_degrees(light_direction: &str) -> f32 {
    match light_direction {
        "upper-right" => -45.0,
        "lower-left" => 135.0,
        "lower-right" => 45.0,
        "up" => -90.0,
        "down" => 90.0,
        "left" => 180.0,
        "right" => 0.0,
        _ => -135.0,
    }
}

/// The same direction as a unit vector pointing toward the light, which is what
/// an edge's outward normal is compared against.
pub fn key_vector(light_direction: &str) -> (f32, f32) {
    let radians = key_degrees(light_direction).to_radians();
    (radians.cos(), radians.sin())
}

/// A canvas position, for a hint that has to name where to paint.
pub fn point(buffer: &IndexedBuffer, index: usize) -> (u16, u16) {
    let (x, y) = xy(buffer, index);
    (x as u16, y as u16)
}

/// One filled pixel of `mask` that has transparency beside it, described
/// against the key light `key` — a unit vector pointing toward the light, on a
/// canvas whose y increases downward.
pub fn edge_pixel(mask: &IndexedBuffer, index: usize, key: (f32, f32)) -> EdgePixel {
    let (x, y) = xy(mask, index);
    let facing = |sign: f32| {
        neighbours(x, y)
            .iter()
            .zip([(-1.0, 0.0), (1.0, 0.0), (0.0, -1.0), (0.0, 1.0)])
            .any(|(&(nx, ny), (ox, oy))| {
                // The outward normal at an edge is the direction of the
                // transparent pixel beside it, so an edge faces the key exactly
                // when that direction agrees with the key vector.
                mask.get(nx, ny) == 0 && (ox * key.0 + oy * key.1) * sign > 0.01
            })
    };
    EdgePixel {
        x: x as u16,
        y: y as u16,
        index,
        key_facing: facing(1.0),
        shadow_facing: facing(-1.0),
    }
}

/// Every edge pixel of `mask`, in raster order.
///
/// This includes the border of an enclosed hole, which is a perimeter the
/// outline has to cover as much as the outer silhouette does.
pub fn edge_pixels(mask: &IndexedBuffer, key: (f32, f32)) -> Vec<EdgePixel> {
    (0..mask.data.len())
        .filter(|&i| {
            let (x, y) = xy(mask, i);
            mask.data[i] != 0 && neighbours(x, y).iter().any(|&(x, y)| mask.get(x, y) == 0)
        })
        .map(|i| edge_pixel(mask, i, key))
        .collect()
}

/// The outer boundary of `mask`, in order, walking from its topmost-leftmost
/// filled pixel (Moore-neighbour tracing, stopping when the start is re-entered
/// from the direction it was first left by).
///
/// The order is the point. §5.5 states the rim as runs and gaps *along* the
/// silhouette's edge, and a set of edge pixels cannot answer how long a run is
/// or how wide the gap after it was. The trace follows the outer contour only,
/// so a pixel bordering an enclosed hole is not on the ring — which is the same
/// reading §5.5 rule 3 gives when it says the rim sits on the outermost pixel.
///
/// `key` is the direction the light comes from, as a unit vector on the canvas
/// with y increasing downward.
pub fn perimeter_ring(mask: &IndexedBuffer, key: (f32, f32)) -> Vec<EdgePixel> {
    const CLOCKWISE: [(i32, i32); 8] = [
        (-1, -1),
        (0, -1),
        (1, -1),
        (1, 0),
        (1, 1),
        (0, 1),
        (-1, 1),
        (-1, 0),
    ];
    let Some(start) = mask.data.iter().position(|s| *s != 0) else {
        return Vec::new();
    };
    let mut ring = vec![edge_pixel(mask, start, key)];
    let (sx, sy) = xy(mask, start);
    // The pixel to the west of the topmost-leftmost filled pixel is empty by
    // construction, so it is where the walk can always be entered from.
    let mut backtrack = CLOCKWISE.iter().position(|d| *d == (-1, 0)).unwrap_or(7);
    let (mut x, mut y) = (sx, sy);
    let first = (x, y, backtrack);
    // Every pixel can be entered from at most eight directions, so this many
    // steps is past any legal contour and the walk cannot spin on a fault.
    for step in 0..mask.data.len() * 8 {
        let mut moved = false;
        for turn in 1..=8 {
            let direction = (backtrack + turn) % 8;
            let (dx, dy) = CLOCKWISE[direction];
            if mask.get(x + dx, y + dy) != 0 {
                backtrack = (direction + 4) % 8;
                x += dx;
                y += dy;
                moved = true;
                break;
            }
        }
        if !moved {
            break;
        }
        if (x, y, backtrack) == first || (step > 0 && (x, y) == (sx, sy) && ring.len() > 2) {
            break;
        }
        if let Some(index) = mask.offset(x, y) {
            if !ring.iter().any(|p| p.index == index) {
                ring.push(edge_pixel(mask, index, key));
            }
        }
    }
    ring
}

/// Runs of `true` along a ring, as `(start position, length)` pairs.
///
/// The ring is circular, so a run that straddles its first pixel is one run and
/// not two. A run that covers the whole ring is reported once, at position 0.
pub fn ring_runs(marked: &[bool]) -> Vec<(usize, usize)> {
    let total = marked.iter().filter(|m| **m).count();
    if total == 0 {
        return Vec::new();
    }
    if total == marked.len() {
        return vec![(0, total)];
    }
    let offset = marked.iter().position(|m| !*m).unwrap_or(0);
    let mut runs = Vec::new();
    let mut run: Option<(usize, usize)> = None;
    for step in 0..marked.len() {
        let position = (offset + step) % marked.len();
        if marked[position] {
            match &mut run {
                Some(open) => open.1 += 1,
                None => run = Some((position, 1)),
            }
        } else if let Some(open) = run.take() {
            runs.push(open);
        }
    }
    runs.extend(run);
    runs
}

fn bounds(buffer: &IndexedBuffer, region: &[usize]) -> RegionBounds {
    let (mut left, mut top) = (i32::MAX, i32::MAX);
    let (mut right, mut bottom) = (i32::MIN, i32::MIN);
    for &i in region {
        let (x, y) = xy(buffer, i);
        left = left.min(x);
        top = top.min(y);
        right = right.max(x);
        bottom = bottom.max(y);
    }
    RegionBounds {
        x: left as u16,
        y: top as u16,
        width: (right - left + 1) as u16,
        height: (bottom - top + 1) as u16,
        area: region.len(),
    }
}

/// The worst 7 x 7 window rather than the whole sprite, because a sprite with
/// one pillow-shaded region is pillow-shaded. A single correlation over every
/// filled pixel is defeated by the ordinary shape of a sprite: flat base colour
/// adds edge-distance spread that carries no lightness with it, so a pillowed
/// head reading 1.00 on its own falls to 0.41 once a plain body is attached
/// below it. Averaging regions would lose the same way, so the worst window is
/// reported and nothing is allowed to vote it down.
fn pillow_correlation(buffer: &IndexedBuffer, distance: &[usize], lightness: &[f32; 64]) -> f32 {
    let width = usize::from(buffer.width);
    let height = usize::from(buffer.height);
    let sample = |i: usize| {
        let (x, y) = xy(buffer, i);
        [
            x as f32,
            y as f32,
            distance[i] as f32,
            lightness[usize::from(buffer.data[i])],
        ]
    };
    let edge = HD2D.pillow_window.min(width).min(height);
    let required = ((edge * edge) as f32 * HD2D.pillow_window_fill).ceil() as usize;
    let mut worst = None;
    for top in 0..=height - edge {
        for left in 0..=width - edge {
            let window: Vec<[f32; 4]> = (top..top + edge)
                .flat_map(|y| (left..left + edge).map(move |x| y * width + x))
                .filter(|&i| buffer.data[i] != 0)
                .map(sample)
                .collect();
            if window.len() < required {
                continue;
            }
            let score = pillow_score(&window);
            worst = Some(worst.map_or(score, |previous: f32| previous.max(score)));
        }
    }
    // A sprite too sparse for any window to sit on a form is its own window.
    // Refusing to measure it would be a third way to pass the gate by default.
    worst.unwrap_or_else(|| {
        let whole: Vec<[f32; 4]> = (0..buffer.data.len())
            .filter(|&i| buffer.data[i] != 0)
            .map(sample)
            .collect();
        pillow_score(&whole)
    })
}

/// Lightness against edge distance, with the planar component of both removed.
/// §7.2 says that in a correctly lit sprite lightness tracks
/// `dot(pixel_normal_estimate, L)`, which across a window this small is a plane
/// in x and y; taking that plane out leaves only the shading that answers to
/// the silhouette, which is the definition of a pillow. Without the correction
/// the shadow side of any legitimately lit form reads as a pillow locally,
/// because there too lightness rises as you walk inward.
fn pillow_score(samples: &[[f32; 4]]) -> f32 {
    if samples.len() < 3 {
        return 0.0;
    }
    let paired: Vec<(f32, f32)> = plane_residuals(samples, 2)
        .into_iter()
        .zip(plane_residuals(samples, 3))
        .collect();
    correlation(&paired)
}

/// What is left of `axis` once the best-fitting plane in x and y is subtracted.
fn plane_residuals(samples: &[[f32; 4]], axis: usize) -> Vec<f32> {
    let count = samples.len() as f32;
    let mean = |k: usize| samples.iter().map(|s| s[k]).sum::<f32>() / count;
    let (mx, my, mv) = (mean(0), mean(1), mean(axis));
    let centred = |s: &[f32; 4]| (s[0] - mx, s[1] - my, s[axis] - mv);
    let (mut sxx, mut syy, mut sxy, mut svx, mut svy) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for s in samples {
        let (x, y, v) = centred(s);
        sxx += x * x;
        syy += y * y;
        sxy += x * y;
        svx += v * x;
        svy += v * y;
    }
    // Cauchy-Schwarz keeps the determinant non-negative, so it only reaches
    // zero when the window's pixels are collinear and there is no plane to fit.
    let determinant = sxx * syy - sxy * sxy;
    if determinant <= f32::EPSILON {
        return samples.iter().map(|s| centred(s).2).collect();
    }
    let slope_x = (svx * syy - svy * sxy) / determinant;
    let slope_y = (svy * sxx - svx * sxy) / determinant;
    samples
        .iter()
        .map(|s| {
            let (x, y, v) = centred(s);
            v - slope_x * x - slope_y * y
        })
        .collect()
}

pub fn correlation(samples: &[(f32, f32)]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let count = samples.len() as f32;
    let (mx, my) = samples
        .iter()
        .fold((0.0, 0.0), |(x, y), (a, b)| (x + a / count, y + b / count));
    let (cov, vx, vy) = samples.iter().fold((0.0, 0.0, 0.0), |(c, x, y), (a, b)| {
        (
            c + (a - mx) * (b - my),
            x + (a - mx).powi(2),
            y + (b - my).powi(2),
        )
    });
    if vx * vy <= f32::EPSILON {
        0.0
    } else {
        (cov / (vx * vy).sqrt()).clamp(-1.0, 1.0)
    }
}

pub fn circular_statistics(degrees: &[f32]) -> (Option<f32>, Option<f32>) {
    if degrees.is_empty() {
        return (None, None);
    }
    let (x, y) = degrees.iter().fold((0.0, 0.0), |(x, y), a| {
        (x + a.to_radians().cos(), y + a.to_radians().sin())
    });
    let length = (x.hypot(y) / degrees.len() as f32).clamp(f32::EPSILON, 1.0);
    (
        Some(y.atan2(x).to_degrees()),
        Some((-2.0 * length.ln()).sqrt().to_degrees()),
    )
}

fn hull_area(mut points: Vec<(i32, i32)>) -> f32 {
    points.sort_unstable();
    points.dedup();
    if points.len() < 3 {
        return 0.0;
    }
    let cross = |a: (i32, i32), b: (i32, i32), c: (i32, i32)| {
        i64::from(b.0 - a.0) * i64::from(c.1 - a.1) - i64::from(b.1 - a.1) * i64::from(c.0 - a.0)
    };
    let mut hull = Vec::new();
    for &p in &points {
        while hull.len() >= 2 && cross(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0 {
            hull.pop();
        }
        hull.push(p);
    }
    let lower = hull.len();
    for &p in points.iter().rev().skip(1) {
        while hull.len() > lower && cross(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0 {
            hull.pop();
        }
        hull.push(p);
    }
    hull.windows(2)
        .map(|p| {
            (i64::from(p[0].0) * i64::from(p[1].1) - i64::from(p[1].0) * i64::from(p[0].1)) as f64
        })
        .sum::<f64>()
        .abs() as f32
        / 2.0
}

pub fn jaggy_runs(runs: &[usize]) -> bool {
    if runs
        .windows(3)
        .any(|w| w[1] == 1 && w[0] >= HD2D.jaggy_long_run && w[2] >= HD2D.jaggy_long_run)
    {
        return true;
    }
    if runs.windows(HD2D.jaggy_span).any(|w| {
        let mut up = false;
        let mut down = false;
        for p in w.windows(2) {
            up |= p[1] > p[0];
            down |= p[1] < p[0];
        }
        up && down
    }) {
        return true;
    }
    let mut repeated = 1;
    for w in runs.windows(2) {
        if w[0] == w[1] {
            repeated += 1;
        } else {
            if repeated > HD2D.jaggy_repeat && w[0].abs_diff(w[1]) > HD2D.jaggy_jump {
                return true;
            }
            repeated = 1;
        }
    }
    false
}

fn jaggies(buffer: &IndexedBuffer) -> usize {
    // Directed cell edges make holes and separate islands inspectable without
    // inventing connections between diagonally touching pixels.
    type Vertex = (i32, i32);
    let mut edges: BTreeMap<Vertex, Vec<(Vertex, u8)>> = BTreeMap::new();
    for (i, &slot) in buffer.data.iter().enumerate() {
        if slot == 0 {
            continue;
        }
        let (x, y) = xy(buffer, i);
        for (nx, ny, a, b, d) in [
            (x, y - 1, (x, y), (x + 1, y), 0),
            (x + 1, y, (x + 1, y), (x + 1, y + 1), 1),
            (x, y + 1, (x + 1, y + 1), (x, y + 1), 2),
            (x - 1, y, (x, y + 1), (x, y), 3),
        ] {
            if buffer.get(nx, ny) == 0 {
                edges.entry(a).or_default().push((b, d));
            }
        }
    }
    let mut failures = 0;
    while let Some((&start, _)) = edges.first_key_value() {
        let mut current = start;
        let mut runs: Vec<(u8, usize)> = Vec::new();
        while let Some(out) = edges.get_mut(&current) {
            let previous = runs.last().map(|r| r.0);
            let chosen = out
                .iter()
                .position(|(_, d)| previous.is_some_and(|p| *d == (p + 1) % 4))
                .unwrap_or(0);
            let (next, direction) = out.remove(chosen);
            if out.is_empty() {
                edges.remove(&current);
            }
            if let Some(last) = runs.last_mut().filter(|r| r.0 == direction) {
                last.1 += 1;
            } else {
                runs.push((direction, 1));
            }
            current = next;
            if current == start {
                break;
            }
        }
        for axis in 0..2 {
            // Steps along one axis are separated by the steps across it, so the
            // contour's moves are read per axis to recover the run sequence the
            // style guide talks about.
            let along: Vec<(u8, usize)> = runs
                .iter()
                .copied()
                .filter(|&(direction, _)| direction % 2 == axis)
                .collect();
            // The line between a jaggy and a legitimate curve is drawn on how
            // often the edge turns back on itself, not on how far it moves. A
            // curve reverses only at its turning points, so a circle reverses
            // twice in a whole loop and an S-curve four times; an edge that
            // reverses at every step for a whole window is the chewed line of
            // §11.2 at any scale. This is checked on the direction sequence
            // because the length sequence cannot see it: a wobble's widening
            // and narrowing runs point opposite ways, so the monotonicity rule
            // below only ever receives the fragments between two reversals,
            // which are too short for a window of `jaggy_span` to fit in.
            if along
                .windows(HD2D.jaggy_span)
                .any(|w| w.windows(2).all(|p| p[0].0 != p[1].0))
            {
                failures += 1;
            }
            let mut sequence = Vec::new();
            let mut last_direction = None;
            for &(direction, length) in &along {
                if last_direction.is_some_and(|d| d != direction) {
                    failures += usize::from(jaggy_runs(&sequence));
                    sequence.clear();
                }
                sequence.push(length);
                last_direction = Some(direction);
            }
            failures += usize::from(jaggy_runs(&sequence));
        }
    }
    failures
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raster::{grid, Material, PaletteSlot, Ramp};
    fn palette() -> Palette {
        Palette {
            slots: (1..=3)
                .map(|i| PaletteSlot {
                    index: i,
                    rgba: [i * 70, i * 70, i * 70, 255],
                    name: None,
                    ramp: None,
                    step: None,
                })
                .collect(),
            ramps: vec![Ramp {
                name: "test".into(),
                material: Material::Cloth,
                slots: vec![1, 2, 3],
            }],
        }
    }
    #[test]
    fn measures_regions_hull_perimeter_and_orphans() {
        let b = grid::parse("AA..\nAA.B").unwrap();
        let m = measure(&b, &palette()).unwrap();
        assert_eq!(m.region_sizes, vec![4, 1]);
        assert_eq!(m.perimeter, 12);
        assert_eq!(m.orphan_count, 1);
        assert!((m.orphan_fraction - 0.2).abs() < 0.0001);
        let square = measure(&grid::parse("AA\nAA").unwrap(), &palette()).unwrap();
        assert_eq!(square.solidity, 1.0);
        assert_eq!(square.perimeter_squared_over_area, 16.0);
    }
    #[test]
    fn pillow_shading_is_measured_from_edge_distance() {
        let b = grid::parse("AAAAA\nABBBA\nABCBA\nABBBA\nAAAAA").unwrap();
        assert!(measure(&b, &palette()).unwrap().pillow_correlation > HD2D.pillow_correlation);
        let flat = grid::parse("AAAAA\nAAAAA\nAAAAA").unwrap();
        assert_eq!(measure(&flat, &palette()).unwrap().pillow_correlation, 0.0);
    }
    #[test]
    fn a_pillow_region_is_measured_past_the_flat_area_beside_it() {
        // A seven by seven lump shaded concentrically inward, which is the
        // figure §7.2 draws, carried on a flat body of base colour. On its own
        // the lump measures 0.98 against every filled pixel; the body adds edge
        // distance that carries no lightness with it, and one correlation over
        // the whole sprite falls to 0.46 and passes. Nothing about the lump has
        // changed, and a reader still sees a cushion where the head should be.
        let head_on_body = grid::parse(
            "...AAAAAAA...
...ABBBBBA...
...ABCCCBA...
...ABCCCBA...
...ABCCCBA...
...ABCCCBA...
...AABCBAA...
.....ABA.....
.CCCCCCCCCCC.
.CCCCCCCCCCC.
.CCCCCCCCCCC.
.CCCCCCCCCCC.
.CCCCCCCCCCC.",
        )
        .unwrap();
        assert!(
            measure(&head_on_body, &palette())
                .unwrap()
                .pillow_correlation
                > HD2D.pillow_correlation
        );
        // The same silhouette in three cel bands running across an upper-left
        // key, which is what §5.2 asks for. Its lightness rises inward from the
        // shadowed edge exactly as a pillow's does, so an uncorrected window
        // reads 0.77 on it; the plane the key light draws is taken out first,
        // and what is left measures 0.21.
        let lit = grid::parse(
            "....CCCCC....
...CCCCCBB...
..CCCCCBBBB..
.CCCCCBBBBBB.
CCCCCBBBBBBAA
CCCCBBBBBBAAA
CCCBBBBBBAAAA
CCBBBBBBAAAAA
CBBBBBBAAAAAA
.BBBBBAAAAAA.
..BBBAAAAAA..
...BAAAAAA...
....AAAAA....",
        )
        .unwrap();
        assert!(measure(&lit, &palette()).unwrap().pillow_correlation < HD2D.pillow_correlation);
    }

    #[test]
    fn shading_that_points_nowhere_is_reported_and_a_flat_is_not() {
        // Columns A A B C B A A: brightest down the middle, symmetric about it,
        // so the darkest band's centroid and the lightest band's land on the
        // same pixel and the region offers no light vector at all. It is
        // textbook pillow shading, and it measures 0.49 on the pillow gate, so
        // unless the absence is itself reported nothing here says a word.
        let symmetric = grid::parse(
            "AABCBAA
AABCBAA
AABCBAA
AABCBAA
AABCBAA
AABCBAA
AABCBAA",
        )
        .unwrap();
        let measured = measure(&symmetric, &palette()).unwrap();
        assert!(measured.light_vectors.is_empty());
        assert!(measured.pillow_correlation < HD2D.pillow_correlation);
        assert_eq!(
            measured.undirected_regions,
            vec![RegionBounds {
                x: 0,
                y: 0,
                width: 7,
                height: 7,
                area: 49,
            }]
        );
        // A region painted in one colour is not shaded at all, so it is a flat
        // and not a finding.
        let flat = grid::parse("AAAA\nAAAA\nAAAA\nAAAA").unwrap();
        let measured = measure(&flat, &palette()).unwrap();
        assert!(measured.light_vectors.is_empty());
        assert!(measured.undirected_regions.is_empty());
        // And a region shaded across a key keeps its vector and stays quiet.
        let lit = grid::parse("CCBB\nCCBB\nBBAA\nBBAA").unwrap();
        let measured = measure(&lit, &palette()).unwrap();
        assert_eq!(measured.light_vectors.len(), 1);
        assert!(measured.undirected_regions.is_empty());
    }

    #[test]
    fn the_perimeter_is_walked_in_order_and_each_edge_knows_which_way_it_faces() {
        // A four by four block on a six by six canvas: twelve edge pixels, and
        // a walk that starts at the top left and comes back to it.
        let b = grid::parse("......\n.AAAA.\n.AAAA.\n.AAAA.\n.AAAA.\n......").unwrap();
        let key = key_vector("upper-left");
        let ring = perimeter_ring(&b, key);
        assert_eq!(ring.len(), 12);
        assert_eq!(ring.len(), edge_pixels(&b, key).len());
        assert_eq!(ring[0].point(), (1, 1));
        assert_eq!(ring[1].point(), (2, 1));
        // Consecutive ring pixels touch, which is what makes a run a run.
        for pair in ring.windows(2) {
            assert!(pair[0].x.abs_diff(pair[1].x) <= 1 && pair[0].y.abs_diff(pair[1].y) <= 1);
        }
        // The top edge faces the key, the right edge faces away from it, and
        // the top right corner does both at once.
        let at = |x: u16, y: u16| *ring.iter().find(|p| p.point() == (x, y)).unwrap();
        assert!(at(2, 1).key_facing && !at(2, 1).shadow_facing);
        assert!(at(4, 2).shadow_facing && !at(4, 2).key_facing);
        assert!(at(4, 1).key_facing && at(4, 1).shadow_facing);
        // A key from straight above leaves the sides facing neither way, which
        // is the perpendicular case §4.2 gives its own mix to.
        let above = perimeter_ring(&b, key_vector("up"));
        let at = |x: u16, y: u16| *above.iter().find(|p| p.point() == (x, y)).unwrap();
        assert!(!at(4, 2).key_facing && !at(4, 2).shadow_facing);
    }

    #[test]
    fn runs_along_a_ring_wrap_around_its_join() {
        assert_eq!(ring_runs(&[false; 4]), Vec::new());
        assert_eq!(ring_runs(&[true; 4]), vec![(0, 4)]);
        assert_eq!(ring_runs(&[true, false, true, true]), vec![(2, 3)]);
        // A run that straddles the start of the ring is one run, not two: the
        // ring has no beginning, and §5.5 counts runs along the silhouette.
        assert_eq!(ring_runs(&[true, true, false, true]), vec![(3, 3)]);
    }

    #[test]
    fn the_change_rate_separates_an_area_from_two_colours_interleaved() {
        let woven = grid::parse("ABAB\nBABA\nABAB\nBABA").unwrap();
        assert!(horizontal_change_rate(&woven) > HD2D.change_rate);
        let blocks = grid::parse("AABB\nAABB\nAABB\nAABB").unwrap();
        assert!(horizontal_change_rate(&blocks) < HD2D.change_rate);
        // The silhouette's own edge is not a colour change the sprite chose, so
        // a field of one colour on a transparent canvas reads as zero.
        let flat = grid::parse(".AA.\n.AA.\n.AA.").unwrap();
        assert_eq!(horizontal_change_rate(&flat), 0.0);
    }

    #[test]
    fn light_vectors_respect_wraparound_and_disagreeing_regions() {
        let (_, std) = circular_statistics(&[179.0, -179.0]);
        assert!(std.unwrap() < 2.0);
        let b = grid::parse("ABC.CBA").unwrap();
        let m = measure(&b, &palette()).unwrap();
        assert_eq!(m.light_vectors.len(), 2);
        assert!(m.light_std_degrees.unwrap() > HD2D.light_std_degrees);
    }
    #[test]
    fn jaggies_detect_reversals_pinches_and_abrupt_kinks() {
        for runs in [vec![4, 2, 3, 1], vec![3, 1, 3], vec![2, 2, 2, 2, 2, 2, 5]] {
            assert!(jaggy_runs(&runs));
        }
        for runs in [vec![5, 4, 3, 2, 1, 1], vec![1, 1, 2, 3, 4, 6], vec![2; 10]] {
            assert!(!jaggy_runs(&runs));
        }
    }

    #[test]
    fn a_stair_stepped_edge_is_counted_and_a_clean_one_is_not() {
        // The steps of this edge run two pixels, then one, then two, then one:
        // the alternation the reversal rule looks for, and what an artist would
        // call a jagged stair.
        let jagged = grid::parse(
            "AAAAAAAA
AAAAAA..
AAAAA...
AAA.....
AA......
A.......
A.......
A.......",
        )
        .unwrap();
        assert!(measure(&jagged, &palette()).unwrap().jaggy_sequences > 0);
        // The same descent taken in steps that only ever grow: still a curve,
        // but one whose stair reads as intentional.
        let clean = grid::parse(
            "AAAAAAAA
AAAAAAAA
AAAAAAA.
AAAAAAA.
AAAAAA..
AAAAA...
AAAA....
AA......",
        )
        .unwrap();
        assert_eq!(measure(&clean, &palette()).unwrap().jaggy_sequences, 0);
    }

    #[test]
    fn speckle_counts_pixels_with_almost_no_company() {
        // A checkerboard: no pixel is fully alone, because company is counted
        // over the eight neighbours and every one of these has a diagonal. It
        // is still the texture the despeckle pass exists to remove, and the
        // speckle measure is what catches it where the orphan count cannot.
        let noisy = grid::parse(
            "A.A.
.A.A
A.A.
.A.A",
        )
        .unwrap();
        let measured = measure(&noisy, &palette()).unwrap();
        assert_eq!(measured.orphan_fraction, 0.0);
        assert!(measured.speckle_fraction > HD2D.speckle_fraction);
        let solid = grid::parse(
            "AAAA
AAAA
AAAA
AAAA",
        )
        .unwrap();
        let measured = measure(&solid, &palette()).unwrap();
        assert_eq!(measured.orphan_count, 0);
        assert_eq!(measured.speckle_fraction, 0.0);
        // Pixels with nothing at all beside them, which is the orphan count.
        let scattered = grid::parse(
            "A..A
....
..A.
A...",
        )
        .unwrap();
        let measured = measure(&scattered, &palette()).unwrap();
        assert_eq!(measured.orphan_count, 4);
        assert_eq!(measured.orphan_fraction, 1.0);
        assert_eq!(measured.speckle_fraction, 1.0);
    }

    #[test]
    fn a_wobbling_edge_is_counted_and_a_deliberate_curve_is_not() {
        // Row widths 6, 3, 5, 2, 4, 1: the edge widens and narrows at every
        // step, which is the chewed line of §11.2. The run-length rules cannot
        // see it, because the widening runs and the narrowing runs point
        // opposite ways and so reach those rules as fragments of one.
        let wobble = grid::parse(
            "AAAAAA..
AAA.....
AAAAA...
AA......
AAAA....
A.......",
        )
        .unwrap();
        assert!(measure(&wobble, &palette()).unwrap().jaggy_sequences > 0);
        // Row widths 6, 5, 4, 3, 2, 1: the same descent, taken monotonically,
        // which §6.3 offers as the example of a clean curve.
        let curve = grid::parse(
            "AAAAAA..
AAAAA...
AAAA....
AAA.....
AA......
A.......",
        )
        .unwrap();
        assert_eq!(measure(&curve, &palette()).unwrap().jaggy_sequences, 0);
        // A forty-five degree diagonal, whose runs are all one, and a straight
        // edge, whose contour never turns back on itself at all.
        let diagonal = grid::parse(
            "A.....
AA....
AAA...
AAAA..
AAAAA.
AAAAAA",
        )
        .unwrap();
        assert_eq!(measure(&diagonal, &palette()).unwrap().jaggy_sequences, 0);
        let straight = grid::parse(
            "AAAAAA
AAAAAA
AAAAAA
AAAAAA",
        )
        .unwrap();
        assert_eq!(measure(&straight, &palette()).unwrap().jaggy_sequences, 0);
    }

    #[test]
    fn a_spindly_silhouette_fails_both_shape_bands_and_a_readable_one_passes() {
        // Limbs one pixel thick: the perimeter runs away from the area and the
        // shape fills under half its own hull. A human reads this as a wire
        // frame rather than a sprite, and both §11.6 bands say the same.
        let spindly = grid::parse(
            "..A...
..A...
AAAAAA
..A...
..A...
..A...",
        )
        .unwrap();
        let measured = measure(&spindly, &palette()).unwrap();
        assert!(measured.perimeter_squared_over_area > HD2D.perimeter_ratio[1]);
        assert!(measured.solidity < HD2D.solidity[0]);
        // The same cross with limbs thick enough to read at this size, which is
        // the shape the bands are calibrated to accept.
        let readable = grid::parse(
            "...AAAA...
...AAAA...
...AAAA...
AAAAAAAAAA
AAAAAAAAAA
AAAAAAAAAA
...AAAA...
...AAAA...
...AAAA...",
        )
        .unwrap();
        let measured = measure(&readable, &palette()).unwrap();
        assert!((HD2D.perimeter_ratio[0]..=HD2D.perimeter_ratio[1])
            .contains(&measured.perimeter_squared_over_area));
        assert!((HD2D.solidity[0]..=HD2D.solidity[1]).contains(&measured.solidity));
    }
}
