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

//! The buffer-level half of the op system: what a write does to one layer.
//!
//! Nothing here knows about palettes, ramps, layer roles or style rules. Every
//! op in this module can be answered from the `IndexedBuffer` it is handed and
//! the slot numbers the caller supplied, which is what makes it testable
//! without a document. The ops that must consult a palette to decide a colour -
//! shade, outline and antialias - live in [`super::shading`] and are reached
//! through [`super::document_ops`], because a buffer has no ramp to step along.
//!
//! Each edit records the original rectangle before changing any byte, so an
//! inverse remains exact even when a stroke revisits the same pixel.

use super::{grid, IndexedBuffer, RasterError, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A rectangle, given as a corner and a size rather than as two corners.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct Bounds {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

/// One pixel set to one slot, for the corrections an agent makes by hand.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Pixel {
    pub x: i32,
    pub y: i32,
    pub slot: u8,
}

/// A horizontal span, inclusive of both ends.
///
/// Both endpoints are stated rather than a start and a length, because a run
/// that names where it stops cannot be placed one pixel wrong by an agent that
/// miscounted, and miscounting a length is the mistake run-length drawing is
/// otherwise most prone to.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Run {
    pub y: i32,
    pub x0: i32,
    pub x1: i32,
    pub slot: u8,
}

/// Whether a pasted grid overwrites what is under it or paints only its gaps.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PasteMode {
    /// Every cell of the grid lands, including its transparent ones.
    #[default]
    Replace,
    /// Keeps whatever is already on the layer, so a paste can add to a layer
    /// without the agent first having to restate everything already on it.
    Over,
}

/// A geometric figure, carrying whatever that kind of figure needs.
///
/// A curve needs two control points, which is why this is a tagged union rather
/// than one `from`/`to` pair with a name beside it: a single shared shape would
/// have nowhere to put them.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "shape", rename_all = "snake_case")]
pub enum Shape {
    Line {
        from: Point,
        to: Point,
    },
    Rect {
        from: Point,
        to: Point,
        filled: bool,
    },
    Ellipse {
        from: Point,
        to: Point,
        filled: bool,
    },
    Curve {
        from: Point,
        control1: Point,
        control2: Point,
        to: Point,
    },
}

/// Everything a write to a single buffer can be.
///
/// The discriminant is explicit rather than inferred from which fields are
/// present, because this union is what the op log stores, and a log that has to
/// be replayed years from now should not depend on a reader guessing what it is
/// looking at.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RasterOp {
    PasteGrid {
        x: i32,
        y: i32,
        rows: Vec<String>,
        #[serde(default)]
        mode: PasteMode,
    },
    DrawRuns {
        runs: Vec<Run>,
    },
    SetPixels {
        pixels: Vec<Pixel>,
    },
    DrawShape {
        #[serde(flatten)]
        shape: Shape,
        slot: u8,
        #[serde(default = "enabled")]
        pixel_perfect: bool,
    },
    FillRegion {
        x: i32,
        y: i32,
        slot: u8,
        #[serde(default = "enabled")]
        contiguous: bool,
    },
    Mirror {
        axis: Axis,
        #[serde(default)]
        about: Option<u16>,
    },
    Translate {
        dx: i32,
        dy: i32,
    },
    Clear {},
}

/// The default for a flag that is on unless the caller turns it off.
///
/// `pixel_perfect` defaults on because the doubled corner pixel on a diagonal
/// is the most recognisable tell of machine-drawn pixel art, and a flood fill
/// is contiguous by default because repainting every matching pixel on the
/// canvas is almost never what was meant.
fn enabled() -> bool {
    true
}

/// The axis a mirror reflects in, named after the coordinate it reflects.
///
/// This is the one definition of the axis in the crate. The document-level op
/// re-exports it rather than declaring its own, because two enums with the same
/// two names would eventually disagree about which one "horizontal" meant.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Axis {
    /// Reflects `x`, so the left and right halves swap.
    X,
    /// Reflects `y`, so the top and bottom halves swap.
    Y,
}

/// What one op changed, and the bytes it overwrote.
///
/// `skipped` carries the count of pixels a shading op could not resolve, which
/// is the signal an agent needs to discover it has been painting with a slot
/// that belongs to no ramp. Buffer-level ops always report zero, because every
/// one of them was given its slot rather than having to find one. It is
/// `serde(default)` so that an inverse recorded before the field existed still
/// reads back, and an op log that cannot be read back is not a log.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Edit {
    pub changed: usize,
    pub bounds: Option<Bounds>,
    pub prior: Vec<u8>,
    #[serde(default)]
    pub skipped: usize,
}

/// Refuses a coordinate that could not address a pixel on any legal canvas.
///
/// Off-canvas writes are legal and are simply dropped, so this is not a bounds
/// check; it exists to catch a payload whose numbers are nonsense before an op
/// spends time iterating over them.
fn coordinate(value: i32) -> Result<()> {
    if value.abs_diff(0) > 65535 {
        return Err(RasterError::new(
            "raster.invalid_coordinate",
            "coordinates must be within -65535..=65535",
        ));
    }
    Ok(())
}

/// Refuses a slot the grid alphabet cannot name, and so an agent cannot read.
fn slot(value: u8) -> Result<()> {
    if value > 62 {
        return Err(RasterError::new("palette.unknown_slot", value.to_string()));
    }
    Ok(())
}

/// Applies one op, returning the inverse needed to undo it exactly.
///
/// Every write is staged into `writes` first and only committed once the whole
/// op has validated. A batch that fails halfway therefore leaves the buffer
/// untouched rather than half-drawn, which is what lets a rejected op be
/// reported without also having to repair the layer.
pub fn apply(buffer: &mut IndexedBuffer, op: &RasterOp) -> Result<Edit> {
    buffer.validate()?;
    let mut writes = BTreeMap::new();
    let mut put = |x, y, value| {
        if let Some(i) = buffer.offset(x, y) {
            writes.insert(i, value);
        }
    };
    match op {
        RasterOp::PasteGrid { x, y, rows, mode } => {
            coordinate(*x)?;
            coordinate(*y)?;
            let source = grid::parse(&rows.join("\n"))?;
            for sy in 0..i32::from(source.height) {
                for sx in 0..i32::from(source.width) {
                    let (px, py) = (x + sx, y + sy);
                    // `over` keeps what the layer already holds, so only the
                    // transparent destination cells take the incoming grid.
                    if *mode == PasteMode::Over && buffer.get(px, py) != 0 {
                        continue;
                    }
                    put(px, py, source.get(sx, sy));
                }
            }
        }
        RasterOp::DrawRuns { runs } => {
            for run in runs {
                coordinate(run.x0)?;
                coordinate(run.x1)?;
                coordinate(run.y)?;
                slot(run.slot)?;
                if run.x1 < run.x0 {
                    return Err(RasterError::new(
                        "raster.invalid_run",
                        "a run must end at or after it starts",
                    ));
                }
                for x in run.x0..=run.x1 {
                    put(x, run.y, run.slot);
                }
            }
        }
        RasterOp::SetPixels { pixels } => {
            for pixel in pixels {
                coordinate(pixel.x)?;
                coordinate(pixel.y)?;
                slot(pixel.slot)?;
                put(pixel.x, pixel.y, pixel.slot);
            }
        }
        RasterOp::DrawShape {
            shape,
            slot: value,
            pixel_perfect: perfect,
        } => {
            slot(*value)?;
            for point in shape_points(shape, buffer.width, buffer.height, *perfect)? {
                put(point.x, point.y, *value);
            }
        }
        RasterOp::FillRegion {
            x,
            y,
            slot: value,
            contiguous,
        } => {
            slot(*value)?;
            coordinate(*x)?;
            coordinate(*y)?;
            let Some(seed) = buffer.offset(*x, *y) else {
                return Err(RasterError::new(
                    "raster.invalid_coordinate",
                    "the fill seed is outside the canvas",
                ));
            };
            let target = buffer.data[seed];
            if target != *value {
                if *contiguous {
                    flood(buffer, (*x, *y), target, *value, &mut put);
                } else {
                    // The non-contiguous form repaints every pixel of the same
                    // slot wherever it sits, which is how a whole material is
                    // recoloured without having to seed each island of it.
                    for (i, &existing) in buffer.data.iter().enumerate() {
                        if existing == target {
                            let width = usize::from(buffer.width);
                            put((i % width) as i32, (i / width) as i32, *value);
                        }
                    }
                }
            }
        }
        RasterOp::Mirror { axis, about } => {
            let limit = match axis {
                Axis::X => buffer.width,
                Axis::Y => buffer.height,
            };
            if about.is_some_and(|centre| centre >= limit) {
                return Err(RasterError::new(
                    "raster.invalid_coordinate",
                    "the mirror axis is outside the canvas",
                ));
            }
            for y in 0..i32::from(buffer.height) {
                for x in 0..i32::from(buffer.width) {
                    match about {
                        // Without a centre the whole layer is reflected, which
                        // is a flip rather than a symmetry pass.
                        None => {
                            let (sx, sy) = match axis {
                                Axis::X => (i32::from(buffer.width) - x - 1, y),
                                Axis::Y => (x, i32::from(buffer.height) - y - 1),
                            };
                            put(x, y, buffer.get(sx, sy));
                        }
                        // With one, only the far side is rewritten, so the half
                        // the artist drew is the half that survives.
                        Some(centre) => {
                            let centre = i32::from(*centre);
                            let along = match axis {
                                Axis::X => x,
                                Axis::Y => y,
                            };
                            if along > centre {
                                let (sx, sy) = match axis {
                                    Axis::X => (2 * centre - x, y),
                                    Axis::Y => (x, 2 * centre - y),
                                };
                                put(x, y, buffer.get(sx, sy));
                            }
                        }
                    }
                }
            }
        }
        RasterOp::Translate { dx, dy } => {
            coordinate(*dx)?;
            coordinate(*dy)?;
            for y in 0..i32::from(buffer.height) {
                for x in 0..i32::from(buffer.width) {
                    put(x, y, buffer.get(x - dx, y - dy));
                }
            }
        }
        RasterOp::Clear {} => {
            for y in 0..i32::from(buffer.height) {
                for x in 0..i32::from(buffer.width) {
                    put(x, y, 0);
                }
            }
        }
    }
    let Some(bounds) = bounds_of(buffer.width, writes.keys().copied()) else {
        return Ok(Edit {
            changed: 0,
            bounds: None,
            prior: vec![],
            skipped: 0,
        });
    };
    let prior = region(buffer, bounds)?;
    let mut changed = 0;
    for (i, value) in writes {
        if buffer.data[i] != value {
            changed += 1;
            buffer.data[i] = value;
        }
    }
    Ok(Edit {
        changed,
        bounds: Some(bounds),
        prior,
        skipped: 0,
    })
}

/// A four-connected scanline flood fill from one seed.
///
/// Four-connected rather than eight, because a fill that escapes through a
/// diagonal contact leaks out of shapes an artist drew as closed, and a leak is
/// far more expensive to notice and undo than a second seeded call.
fn flood(
    buffer: &IndexedBuffer,
    seed: (i32, i32),
    target: u8,
    value: u8,
    put: &mut impl FnMut(i32, i32, u8),
) {
    let mut seen = vec![false; buffer.data.len()];
    let mut stack = vec![seed];
    while let Some((x, y)) = stack.pop() {
        let Some(i) = buffer.offset(x, y) else {
            continue;
        };
        if seen[i] || buffer.data[i] != target {
            continue;
        }
        let mut left = x;
        while left > 0
            && buffer.get(left - 1, y) == target
            && !seen[buffer.offset(left - 1, y).expect("inside the row")]
        {
            left -= 1;
        }
        let mut right = left;
        while let Some(i) = buffer.offset(right, y) {
            if seen[i] || buffer.data[i] != target {
                break;
            }
            seen[i] = true;
            put(right, y, value);
            for ny in [y - 1, y + 1] {
                if let Some(j) = buffer.offset(right, ny) {
                    if !seen[j] && buffer.data[j] == target {
                        stack.push((right, ny));
                    }
                }
            }
            right += 1;
        }
    }
}

/// The smallest rectangle containing every index the caller touched.
pub fn bounds_of(width: u16, indices: impl Iterator<Item = usize>) -> Option<Bounds> {
    let mut bounds: Option<(usize, usize, usize, usize)> = None;
    for i in indices {
        let (x, y) = (i % usize::from(width), i / usize::from(width));
        bounds = Some(match bounds {
            None => (x, y, x, y),
            Some((a, b, c, d)) => (a.min(x), b.min(y), c.max(x), d.max(y)),
        });
    }
    bounds.map(|(x, y, r, b)| Bounds {
        x: x as u16,
        y: y as u16,
        width: (r - x + 1) as u16,
        height: (b - y + 1) as u16,
    })
}

/// Copies a rectangle out of the buffer, row by row.
pub fn region(buffer: &IndexedBuffer, bounds: Bounds) -> Result<Vec<u8>> {
    buffer.validate()?;
    if bounds.width == 0
        || bounds.height == 0
        || u32::from(bounds.x) + u32::from(bounds.width) > u32::from(buffer.width)
        || u32::from(bounds.y) + u32::from(bounds.height) > u32::from(buffer.height)
    {
        return Err(RasterError::new(
            "raster.invalid_bounds",
            "region extends outside the canvas",
        ));
    }
    let mut data = Vec::new();
    for y in bounds.y..bounds.y + bounds.height {
        let start = usize::from(y) * usize::from(buffer.width) + usize::from(bounds.x);
        data.extend_from_slice(&buffer.data[start..start + usize::from(bounds.width)]);
    }
    Ok(data)
}

/// Puts back the bytes an edit recorded, which is what undo is made of.
///
/// The recorded rectangle is re-checked against the buffer rather than trusted,
/// because an inverse is read back out of the database and a row that has been
/// truncated or hand-edited must fail here rather than corrupt a layer.
pub fn restore(buffer: &mut IndexedBuffer, edit: &Edit) -> Result<()> {
    if let Some(bounds) = edit.bounds {
        region(buffer, bounds)?;
        if edit.prior.len() != usize::from(bounds.width) * usize::from(bounds.height)
            || edit.prior.iter().any(|s| *s > 62)
        {
            return Err(RasterError::new(
                "raster.invalid_inverse",
                "inverse byte count or indices are invalid",
            ));
        }
        for (dy, row) in edit.prior.chunks(usize::from(bounds.width)).enumerate() {
            let start =
                (usize::from(bounds.y) + dy) * usize::from(buffer.width) + usize::from(bounds.x);
            buffer.data[start..start + row.len()].copy_from_slice(row);
        }
    }
    Ok(())
}

/// Drops the corner pixel where a line turns, leaving a clean single-pixel step.
///
/// The doubled corner on a diagonal is the most recognisable tell of a line
/// drawn by a machine, and removing it is the difference between a stroke that
/// reads as pixel art and one that reads as a rasterised vector.
pub fn pixel_perfect(points: &[Point]) -> Vec<Point> {
    let mut clean: Vec<Point> = Vec::new();
    for &point in points {
        if clean.last() == Some(&point) {
            continue;
        }
        if clean.len() >= 2 {
            let a = clean[clean.len() - 2];
            let b = clean[clean.len() - 1];
            if (a.x - point.x).abs() == 1
                && (a.y - point.y).abs() == 1
                && (a.x - b.x).abs() + (a.y - b.y).abs() == 1
                && (b.x - point.x).abs() + (b.y - point.y).abs() == 1
            {
                clean.pop();
            }
        }
        clean.push(point);
    }
    clean
}

/// Adds back the corner pixel a pixel-perfect stroke dropped.
///
/// Keeping the corner is an explicit choice rather than an oversight. A mask
/// whose four-connected fill must not escape through a diagonal needs the
/// corner present, so `pixel_perfect: false` restores it.
fn eight_to_four_connected(points: &[Point]) -> Vec<Point> {
    let mut connected = Vec::new();
    for pair in points.windows(2) {
        connected.push(pair[0]);
        if pair[0].x.abs_diff(pair[1].x) == 1 && pair[0].y.abs_diff(pair[1].y) == 1 {
            connected.push(Point {
                x: pair[1].x,
                y: pair[0].y,
            });
        }
    }
    if let Some(last) = points.last() {
        connected.push(*last);
    }
    connected
}

fn line(from: Point, to: Point) -> Vec<Point> {
    let (mut x, mut y) = (from.x, from.y);
    let dx = (to.x - x).abs();
    let dy = -(to.y - y).abs();
    let sx = if x < to.x { 1 } else { -1 };
    let sy = if y < to.y { 1 } else { -1 };
    let mut error = dx + dy;
    let mut points = Vec::new();
    loop {
        points.push(Point { x, y });
        if x == to.x && y == to.y {
            break;
        }
        let twice = 2 * error;
        if twice >= dy {
            error += dy;
            x += sx;
        }
        if twice <= dx {
            error += dx;
            y += sy;
        }
    }
    pixel_perfect(&points)
}

/// Every pixel a shape covers, in the connectivity the caller asked for.
fn shape_points(shape: &Shape, width: u16, height: u16, perfect: bool) -> Result<Vec<Point>> {
    let points = raw_shape_points(shape, width, height)?;
    Ok(if perfect {
        points
    } else {
        eight_to_four_connected(&points)
    })
}

fn raw_shape_points(shape: &Shape, width: u16, height: u16) -> Result<Vec<Point>> {
    let (from, to) = match shape {
        Shape::Line { from, to }
        | Shape::Rect { from, to, .. }
        | Shape::Ellipse { from, to, .. }
        | Shape::Curve { from, to, .. } => (*from, *to),
    };
    for p in [from, to] {
        coordinate(p.x)?;
        coordinate(p.y)?;
    }
    let mut points = Vec::new();
    match shape {
        Shape::Line { .. } => return Ok(line(from, to)),
        Shape::Curve {
            control1: a,
            control2: b,
            ..
        } => {
            for p in [a, b] {
                coordinate(p.x)?;
                coordinate(p.y)?;
            }
            // Two samples per pixel of the control polygon's longest span, so
            // the flattened curve never skips a pixel however tight it turns.
            let steps = [from, *a, *b, to]
                .windows(2)
                .map(|p| (p[1].x - p[0].x).abs().max((p[1].y - p[0].y).abs()) as usize)
                .sum::<usize>()
                .max(1)
                * 2;
            let mut previous = from;
            for step in 1..=steps {
                let t = step as f64 / steps as f64;
                let u = 1.0 - t;
                let component = |p: i32, q: i32, r: i32, s: i32| {
                    (u * u * u * f64::from(p)
                        + 3.0 * u * u * t * f64::from(q)
                        + 3.0 * u * t * t * f64::from(r)
                        + t * t * t * f64::from(s))
                    .round() as i32
                };
                let next = Point {
                    x: component(from.x, a.x, b.x, to.x),
                    y: component(from.y, a.y, b.y, to.y),
                };
                points.extend(line(previous, next));
                previous = next;
            }
            return Ok(pixel_perfect(&points));
        }
        Shape::Rect { filled, .. } | Shape::Ellipse { filled, .. } => {
            let (left, right, top, bottom) = (
                from.x.min(to.x),
                from.x.max(to.x),
                from.y.min(to.y),
                from.y.max(to.y),
            );
            let ellipse = matches!(shape, Shape::Ellipse { .. });
            let inside = |x: i32, y: i32| {
                if x < left || x > right || y < top || y > bottom {
                    return false;
                }
                if !ellipse {
                    return true;
                }
                let rx = f64::from(right - left + 1) / 2.0;
                let ry = f64::from(bottom - top + 1) / 2.0;
                ((f64::from(x) - f64::from(left + right) / 2.0) / rx).powi(2)
                    + ((f64::from(y) - f64::from(top + bottom) / 2.0) / ry).powi(2)
                    <= 1.0
            };
            for y in top.max(0)..=bottom.min(i32::from(height) - 1) {
                for x in left.max(0)..=right.min(i32::from(width) - 1) {
                    if inside(x, y)
                        && (*filled
                            || [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]
                                .iter()
                                .any(|&(nx, ny)| !inside(nx, ny)))
                    {
                        points.push(Point { x, y });
                    }
                }
            }
        }
    }
    Ok(points)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(x: i32, y: i32) -> Point {
        Point { x, y }
    }

    #[test]
    fn every_operation_has_an_exact_inverse() {
        let original = grid::parse("....\n.AB.\n.A..\n....").unwrap();
        let operations = vec![
            RasterOp::PasteGrid {
                x: -1,
                y: 0,
                rows: vec!["AA".into(), "BB".into()],
                mode: PasteMode::Replace,
            },
            RasterOp::PasteGrid {
                x: 0,
                y: 0,
                rows: vec!["CCCC".into(), "CCCC".into()],
                mode: PasteMode::Over,
            },
            RasterOp::SetPixels {
                pixels: vec![
                    Pixel {
                        x: 0,
                        y: 0,
                        slot: 2,
                    },
                    Pixel {
                        x: 0,
                        y: 0,
                        slot: 3,
                    },
                ],
            },
            RasterOp::DrawRuns {
                runs: vec![Run {
                    y: 3,
                    x0: 1,
                    x1: 10,
                    slot: 1,
                }],
            },
            RasterOp::FillRegion {
                x: 0,
                y: 0,
                slot: 2,
                contiguous: true,
            },
            RasterOp::FillRegion {
                x: 0,
                y: 0,
                slot: 2,
                contiguous: false,
            },
            RasterOp::Mirror {
                axis: Axis::X,
                about: None,
            },
            RasterOp::Mirror {
                axis: Axis::Y,
                about: None,
            },
            RasterOp::Mirror {
                axis: Axis::X,
                about: Some(1),
            },
            RasterOp::Translate { dx: 1, dy: -1 },
            RasterOp::Clear {},
            RasterOp::DrawShape {
                shape: Shape::Line {
                    from: point(0, 0),
                    to: point(3, 3),
                },
                slot: 3,
                pixel_perfect: true,
            },
            RasterOp::DrawShape {
                shape: Shape::Rect {
                    from: point(0, 0),
                    to: point(3, 3),
                    filled: false,
                },
                slot: 3,
                pixel_perfect: true,
            },
            RasterOp::DrawShape {
                shape: Shape::Ellipse {
                    from: point(0, 0),
                    to: point(3, 3),
                    filled: true,
                },
                slot: 3,
                pixel_perfect: true,
            },
            RasterOp::DrawShape {
                shape: Shape::Curve {
                    from: point(0, 0),
                    control1: point(3, 0),
                    control2: point(0, 3),
                    to: point(3, 3),
                },
                slot: 3,
                pixel_perfect: false,
            },
        ];
        for op in operations {
            let mut buffer = original.clone();
            let edit = apply(&mut buffer, &op).unwrap();
            assert!(edit.changed > 0, "{op:?}");
            assert_eq!(edit.skipped, 0, "a buffer op is given its slot");
            restore(&mut buffer, &edit).unwrap();
            assert_eq!(buffer, original, "{op:?}");
        }
    }

    #[test]
    fn a_run_states_both_of_its_endpoints() {
        let mut buffer = grid::parse(".....\n.....").unwrap();
        let edit = apply(
            &mut buffer,
            &RasterOp::DrawRuns {
                runs: vec![Run {
                    y: 0,
                    x0: 1,
                    x1: 3,
                    slot: 1,
                }],
            },
        )
        .unwrap();
        assert_eq!(edit.changed, 3);
        assert_eq!(buffer.data, vec![0, 1, 1, 1, 0, 0, 0, 0, 0, 0]);
        assert!(apply(
            &mut buffer,
            &RasterOp::DrawRuns {
                runs: vec![Run {
                    y: 0,
                    x0: 3,
                    x1: 1,
                    slot: 1
                }]
            }
        )
        .is_err());
    }

    #[test]
    fn pasting_over_keeps_what_the_layer_already_holds() {
        let mut buffer = grid::parse("A.\n.A").unwrap();
        apply(
            &mut buffer,
            &RasterOp::PasteGrid {
                x: 0,
                y: 0,
                rows: vec!["BB".into(), "BB".into()],
                mode: PasteMode::Over,
            },
        )
        .unwrap();
        assert_eq!(buffer.data, vec![1, 2, 2, 1]);
        apply(
            &mut buffer,
            &RasterOp::PasteGrid {
                x: 0,
                y: 0,
                rows: vec!["CC".into(), "CC".into()],
                mode: PasteMode::Replace,
            },
        )
        .unwrap();
        assert_eq!(buffer.data, vec![3; 4]);
    }

    #[test]
    fn fill_does_not_cross_diagonal_contacts_unless_it_is_told_not_to_walk() {
        let mut contiguous = grid::parse("A.\n.A").unwrap();
        assert_eq!(
            apply(
                &mut contiguous,
                &RasterOp::FillRegion {
                    x: 0,
                    y: 0,
                    slot: 2,
                    contiguous: true,
                }
            )
            .unwrap()
            .changed,
            1
        );
        assert_eq!(contiguous.data, vec![2, 0, 0, 1]);
        let mut global = grid::parse("A.\n.A").unwrap();
        assert_eq!(
            apply(
                &mut global,
                &RasterOp::FillRegion {
                    x: 0,
                    y: 0,
                    slot: 2,
                    contiguous: false,
                }
            )
            .unwrap()
            .changed,
            2
        );
        assert_eq!(global.data, vec![2, 0, 0, 2]);
    }

    #[test]
    fn mirroring_about_a_column_rewrites_only_the_far_side() {
        let mut buffer = grid::parse("AB..\nA...").unwrap();
        apply(
            &mut buffer,
            &RasterOp::Mirror {
                axis: Axis::X,
                about: Some(1),
            },
        )
        .unwrap();
        assert_eq!(buffer.data, vec![1, 2, 1, 0, 1, 0, 1, 0]);
        assert!(apply(
            &mut buffer,
            &RasterOp::Mirror {
                axis: Axis::X,
                about: Some(4),
            }
        )
        .is_err());
    }

    #[test]
    fn invalid_batch_does_not_partially_mutate_and_corner_is_removed() {
        let mut b = IndexedBuffer::new(2, 2).unwrap();
        assert!(apply(
            &mut b,
            &RasterOp::SetPixels {
                pixels: vec![
                    Pixel {
                        x: 0,
                        y: 0,
                        slot: 1
                    },
                    Pixel {
                        x: 1,
                        y: 1,
                        slot: 64
                    }
                ]
            }
        )
        .is_err());
        assert_eq!(b.data, vec![0; 4]);
        assert_eq!(
            pixel_perfect(&[point(0, 0), point(1, 0), point(1, 1)]),
            vec![point(0, 0), point(1, 1)]
        );
    }

    #[test]
    fn a_shape_that_is_not_pixel_perfect_stays_four_connected() {
        let mut perfect = IndexedBuffer::new(4, 4).unwrap();
        let mut blocky = IndexedBuffer::new(4, 4).unwrap();
        let shape = Shape::Line {
            from: point(0, 0),
            to: point(3, 3),
        };
        apply(
            &mut perfect,
            &RasterOp::DrawShape {
                shape: shape.clone(),
                slot: 1,
                pixel_perfect: true,
            },
        )
        .unwrap();
        apply(
            &mut blocky,
            &RasterOp::DrawShape {
                shape,
                slot: 1,
                pixel_perfect: false,
            },
        )
        .unwrap();
        let filled = |b: &IndexedBuffer| b.data.iter().filter(|s| **s != 0).count();
        assert!(filled(&blocky) > filled(&perfect));
    }
}
