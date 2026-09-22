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

//! Each edit records the original rectangle before changing any byte, so an
//! inverse remains exact even when a stroke revisits the same pixel.

use super::{grid, IndexedBuffer, LayerRole, RasterError, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pixel {
    pub x: i32,
    pub y: i32,
    pub slot: u8,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Run {
    pub x: i32,
    pub y: i32,
    pub length: u16,
    pub slot: u8,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RasterOp {
    PasteGrid {
        x: i32,
        y: i32,
        grid: String,
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
    },
    FillRegion {
        x: i32,
        y: i32,
        slot: u8,
    },
    Mirror {
        axis: Axis,
    },
    Translate {
        dx: i32,
        dy: i32,
    },
    Clear {
        bounds: Option<Bounds>,
    },
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Axis {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawOp {
    pub role: LayerRole,
    #[serde(flatten)]
    pub op: RasterOp,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Edit {
    pub changed: usize,
    pub bounds: Option<Bounds>,
    pub prior: Vec<u8>,
}

fn coordinate(value: i32) -> Result<()> {
    if value.abs_diff(0) > 65535 {
        return Err(RasterError::new(
            "raster.invalid_coordinate",
            "coordinates must be within -65535..=65535",
        ));
    }
    Ok(())
}
fn slot(value: u8) -> Result<()> {
    if value > 63 {
        return Err(RasterError::new("palette.unknown_slot", value.to_string()));
    }
    Ok(())
}

pub fn apply(buffer: &mut IndexedBuffer, op: &RasterOp) -> Result<Edit> {
    buffer.validate()?;
    let mut writes = BTreeMap::new();
    let mut put = |x, y, value| {
        if let Some(i) = buffer.offset(x, y) {
            writes.insert(i, value);
        }
    };
    match op {
        RasterOp::PasteGrid { x, y, grid: text } => {
            coordinate(*x)?;
            coordinate(*y)?;
            let source = grid::parse(text)?;
            for sy in 0..source.height {
                for sx in 0..source.width {
                    put(
                        x + i32::from(sx),
                        y + i32::from(sy),
                        source.get(i32::from(sx), i32::from(sy)),
                    );
                }
            }
        }
        RasterOp::DrawRuns { runs } => {
            for run in runs {
                coordinate(run.x)?;
                coordinate(run.y)?;
                slot(run.slot)?;
                for dx in 0..run.length {
                    put(run.x + i32::from(dx), run.y, run.slot);
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
        RasterOp::DrawShape { shape, slot: value } => {
            slot(*value)?;
            for point in shape_points(shape, buffer.width, buffer.height)? {
                put(point.x, point.y, *value);
            }
        }
        RasterOp::FillRegion { x, y, slot: value } => {
            slot(*value)?;
            coordinate(*x)?;
            coordinate(*y)?;
            if buffer.offset(*x, *y).is_some() && buffer.get(*x, *y) != *value {
                let target = buffer.get(*x, *y);
                let mut seen = vec![false; buffer.data.len()];
                let mut stack = vec![(*x, *y)];
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
                        && !seen[buffer.offset(left - 1, y).expect("inside row")]
                    {
                        left -= 1;
                    }
                    let mut right = left;
                    while let Some(i) = buffer.offset(right, y) {
                        if seen[i] || buffer.data[i] != target {
                            break;
                        }
                        seen[i] = true;
                        put(right, y, *value);
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
        }
        RasterOp::Mirror { axis } => {
            for y in 0..i32::from(buffer.height) {
                for x in 0..i32::from(buffer.width) {
                    let (sx, sy) = match axis {
                        Axis::Horizontal => (i32::from(buffer.width) - x - 1, y),
                        Axis::Vertical => (x, i32::from(buffer.height) - y - 1),
                    };
                    put(x, y, buffer.get(sx, sy));
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
        RasterOp::Clear { bounds } => {
            let b = bounds.unwrap_or(Bounds {
                x: 0,
                y: 0,
                width: buffer.width,
                height: buffer.height,
            });
            for y in
                i32::from(b.y)..(i32::from(b.y) + i32::from(b.height)).min(i32::from(buffer.height))
            {
                for x in i32::from(b.x)
                    ..(i32::from(b.x) + i32::from(b.width)).min(i32::from(buffer.width))
                {
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
    })
}

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

pub fn region(buffer: &IndexedBuffer, bounds: Bounds) -> Result<Vec<u8>> {
    buffer.validate()?;
    if bounds.width == 0 || bounds.height == 0
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

pub fn restore(buffer: &mut IndexedBuffer, edit: &Edit) -> Result<()> {
    if let Some(bounds) = edit.bounds {
        region(buffer, bounds)?;
        if edit.prior.len() != usize::from(bounds.width) * usize::from(bounds.height)
            || edit.prior.iter().any(|s| *s > 63)
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

fn shape_points(shape: &Shape, width: u16, height: u16) -> Result<Vec<Point>> {
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
    #[test]
    fn every_operation_has_an_exact_inverse() {
        let original = grid::parse("....\n.AB.\n.A..\n....").unwrap();
        let operations = vec![
            RasterOp::PasteGrid {
                x: -1,
                y: 0,
                grid: "AA\nBB".into(),
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
                    x: 1,
                    y: 3,
                    length: 10,
                    slot: 1,
                }],
            },
            RasterOp::FillRegion {
                x: 0,
                y: 0,
                slot: 2,
            },
            RasterOp::Mirror {
                axis: Axis::Horizontal,
            },
            RasterOp::Mirror {
                axis: Axis::Vertical,
            },
            RasterOp::Translate { dx: 1, dy: -1 },
            RasterOp::Clear { bounds: None },
            RasterOp::DrawShape {
                shape: Shape::Line {
                    from: Point { x: 0, y: 0 },
                    to: Point { x: 3, y: 3 },
                },
                slot: 3,
            },
            RasterOp::DrawShape {
                shape: Shape::Rect {
                    from: Point { x: 0, y: 0 },
                    to: Point { x: 3, y: 3 },
                    filled: false,
                },
                slot: 3,
            },
            RasterOp::DrawShape {
                shape: Shape::Ellipse {
                    from: Point { x: 0, y: 0 },
                    to: Point { x: 3, y: 3 },
                    filled: true,
                },
                slot: 3,
            },
            RasterOp::DrawShape {
                shape: Shape::Curve {
                    from: Point { x: 0, y: 0 },
                    control1: Point { x: 3, y: 0 },
                    control2: Point { x: 0, y: 3 },
                    to: Point { x: 3, y: 3 },
                },
                slot: 3,
            },
        ];
        for op in operations {
            let mut buffer = original.clone();
            let edit = apply(&mut buffer, &op).unwrap();
            assert!(edit.changed > 0, "{op:?}");
            restore(&mut buffer, &edit).unwrap();
            assert_eq!(buffer, original);
        }
    }
    #[test]
    fn fill_does_not_cross_diagonal_contacts() {
        let mut buffer = grid::parse("A.\n.A").unwrap();
        assert_eq!(
            apply(
                &mut buffer,
                &RasterOp::FillRegion {
                    x: 0,
                    y: 0,
                    slot: 2
                }
            )
            .unwrap()
            .changed,
            1
        );
        assert_eq!(buffer.data, vec![2, 0, 0, 1]);
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
            pixel_perfect(&[
                Point { x: 0, y: 0 },
                Point { x: 1, y: 0 },
                Point { x: 1, y: 1 }
            ]),
            vec![Point { x: 0, y: 0 }, Point { x: 1, y: 1 }]
        );
    }
}
