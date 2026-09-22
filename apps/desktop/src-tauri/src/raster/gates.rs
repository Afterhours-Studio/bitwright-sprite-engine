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
    pub light_std_degrees: f32,
    pub light_region_deviation: f32,
    pub light_mean_deviation: f32,
    pub jaggy_span: usize,
    pub jaggy_long_run: usize,
    pub jaggy_repeat: usize,
    pub jaggy_jump: usize,
    pub accent_count: usize,
}
pub const HD2D: Thresholds = Thresholds {
    orphan_fraction: 0.02,
    orphan_count: 6,
    speckle_fraction: 0.06,
    perimeter_ratio: [18.0, 28.0],
    solidity: [0.62, 0.82],
    pillow_correlation: 0.6,
    light_std_degrees: 35.0,
    light_region_deviation: 45.0,
    light_mean_deviation: 30.0,
    jaggy_span: 4,
    jaggy_long_run: 3,
    jaggy_repeat: 5,
    jaggy_jump: 2,
    accent_count: 6,
};

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
    pub pillow_correlation: f32,
    pub light_vectors: Vec<f32>,
    pub light_mean_degrees: Option<f32>,
    pub light_std_degrees: Option<f32>,
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
    let samples: Vec<_> = buffer
        .data
        .iter()
        .enumerate()
        .filter(|(_, s)| **s != 0)
        .map(|(i, s)| (distance[i] as f32, lightness[usize::from(*s)]))
        .collect();
    let hull = hull_area(corners);
    let material = |slot| {
        palette
            .ramps
            .iter()
            .position(|r| r.slots.contains(&slot))
            .unwrap_or(palette.ramps.len() + usize::from(slot))
    };
    let mut vectors = Vec::new();
    for region in regions(buffer, material) {
        let low = region
            .iter()
            .map(|&i| lightness[usize::from(buffer.data[i])])
            .fold(f32::INFINITY, f32::min);
        let high = region
            .iter()
            .map(|&i| lightness[usize::from(buffer.data[i])])
            .fold(f32::NEG_INFINITY, f32::max);
        if high - low < 0.0001 {
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
        pillow_correlation: correlation(&samples),
        light_vectors: vectors,
        light_mean_degrees: mean,
        light_std_degrees: std,
    })
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
        loop {
            let Some(out) = edges.get_mut(&current) else {
                break;
            };
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
