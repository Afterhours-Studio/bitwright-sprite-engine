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

//! The document-level half of the op system: what a write means to a sprite.
//!
//! This is the only op type `document_write_ops` accepts and the only one the
//! op log stores. It does two things the buffer level cannot. It resolves which
//! layer a write lands on, so that the layer an op names and the layer it
//! reaches can never disagree. And it owns the three ops whose colour is
//! decided by the engine rather than the caller: shade, outline and antialias.
//! Deciding one of those needs the palette's ramps, the style's rules and the
//! sibling layers, none of which an `IndexedBuffer` has.
//!
//! Everything else is translated straight into a [`ops::RasterOp`] and handed
//! down, so there is exactly one implementation of each primitive.

use super::ops::{self, Bounds};
use super::shading::{self, Direction, OutlineMode, ShadeKind};
use super::{IndexedBuffer, Layer, LayerRole, Palette, RasterError, Result, StyleRules};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub use super::ops::{Axis, PasteMode, Pixel as PixelSet, Point, Run};

/// The rectangle a shading op may write inside, in the wire's own field names.
///
/// It is spelled `w`/`h` rather than reusing [`Bounds`] because this is the
/// shape the MCP contract publishes, and a wire type that drifts from the
/// document it is specified in is a wire type agents get wrong.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct Rect {
    pub x: u16,
    pub y: u16,
    pub w: u16,
    pub h: u16,
}

impl From<Rect> for Bounds {
    fn from(rect: Rect) -> Self {
        Self {
            x: rect.x,
            y: rect.y,
            width: rect.w,
            height: rect.h,
        }
    }
}

/// Which figure a `draw_shape` call draws.
///
/// The endpoints sit beside this on the op rather than inside it, because the
/// tool contract takes one `from` and one `to` whatever the figure is; the
/// buffer level's [`ops::Shape`] carries them per variant so that a curve has
/// somewhere to put its control points.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Shape {
    Line,
    Rect,
    Ellipse,
    Curve,
}

/// Everything a write to a document can be.
///
/// Every variant names the layer it writes, which is what lets a commit report
/// the affected roles without re-reading the document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Op {
    PasteGrid {
        layer: LayerRole,
        x: u16,
        y: u16,
        rows: Vec<String>,
        #[serde(default)]
        mode: PasteMode,
    },
    DrawRuns {
        layer: LayerRole,
        runs: Vec<Run>,
    },
    SetPixels {
        layer: LayerRole,
        pixels: Vec<PixelSet>,
    },
    DrawShape {
        layer: LayerRole,
        shape: Shape,
        from: Point,
        to: Point,
        slot: u8,
        #[serde(default)]
        fill: bool,
        #[serde(rename = "pixelPerfect", alias = "pixel_perfect", default = "enabled")]
        pixel_perfect: bool,
    },
    FillRegion {
        layer: LayerRole,
        x: u16,
        y: u16,
        slot: u8,
        #[serde(default = "enabled")]
        contiguous: bool,
    },
    Mirror {
        layer: LayerRole,
        axis: Axis,
        #[serde(default)]
        about: Option<u16>,
    },
    Translate {
        layer: LayerRole,
        dx: i32,
        dy: i32,
    },
    Clear {
        layer: LayerRole,
    },
    /// Steps the source layer's slots along their own ramps into `target`.
    ///
    /// There is deliberately no band argument. The target layer *is* the band -
    /// `shadow-core`, `shadow-deep`, `light` and `rim` each mean exactly one
    /// thing - and a second argument that could contradict the target is an
    /// argument an agent will eventually get wrong. The enum is tagged `kind`,
    /// so a field of that name could not live here in any case.
    Shade {
        target: LayerRole,
        from: LayerRole,
        #[serde(default)]
        region: Option<Rect>,
        #[serde(default)]
        direction: Option<Direction>,
        #[serde(default = "one")]
        depth: u8,
    },
    /// Derives the outline from the fills it borders, into the outline layer.
    ///
    /// `mode` is optional because the contract lets a call inherit the
    /// project's, and the key direction is not an argument at all: an outline
    /// that was lit from somewhere other than the project's key would disagree
    /// with every other sprite in the same scene.
    Outline {
        from: LayerRole,
        #[serde(default)]
        mode: Option<OutlineMode>,
        #[serde(default = "one")]
        darken: u8,
    },
    Antialias {
        layer: LayerRole,
        #[serde(default = "one")]
        strength: u8,
    },
}

/// The default for a flag the caller has to turn off rather than turn on.
fn enabled() -> bool {
    true
}

/// One ramp step, which is what an op that omits its depth asked for.
fn one() -> u8 {
    1
}

impl Op {
    /// The layer this op writes.
    ///
    /// `outline` is the one op that does not name its own target: it writes the
    /// outline layer by definition, and letting it name another would let an
    /// agent scatter derived outline colours across layers that composite above
    /// the fills those colours came from.
    pub fn target(&self) -> LayerRole {
        match self {
            Self::PasteGrid { layer, .. }
            | Self::DrawRuns { layer, .. }
            | Self::SetPixels { layer, .. }
            | Self::DrawShape { layer, .. }
            | Self::FillRegion { layer, .. }
            | Self::Mirror { layer, .. }
            | Self::Translate { layer, .. }
            | Self::Clear { layer }
            | Self::Antialias { layer, .. } => *layer,
            Self::Shade { target, .. } => *target,
            Self::Outline { .. } => LayerRole("outline"),
        }
    }
}

/// Which band of a ramp a shading target stands for, and how deep it sits.
///
/// `shadow-deep` is one step beyond `shadow-core` rather than a different
/// mechanism: it is the occlusion band, and occlusion is core shadow taken
/// further down the same ramp. Deriving it here is what lets the op carry no
/// band argument at all.
fn band(target: LayerRole) -> Result<(ShadeKind, u8)> {
    Ok(match target.0 {
        "shadow-core" => (ShadeKind::Shadow, 0),
        "shadow-deep" => (ShadeKind::Shadow, 1),
        "light" => (ShadeKind::Light, 0),
        "rim" => (ShadeKind::Rim, 0),
        other => {
            return Err(RasterError::new(
                "document.invalid_shade_target",
                format!("{other} is not a shading band"),
            ))
        }
    })
}

/// Applies one document op, returning the inverse needed to undo it exactly.
///
/// The write is staged on a clone of the target layer and every resulting index
/// is checked against the palette before the clone is installed. A batch that
/// would leave a pixel pointing at a slot the document does not have is
/// therefore rejected whole, rather than saved and discovered at composite time
/// when there is no longer anything to blame.
pub fn apply(
    layers: &mut [Layer],
    palette: &Palette,
    rules: &StyleRules,
    op: &Op,
) -> Result<ops::Edit> {
    let role = op.target();
    let target = layers
        .iter()
        .position(|l| l.role == role)
        .ok_or_else(|| RasterError::new("document.layer_not_found", role.0))?;
    if layers[target].locked {
        return Err(RasterError::new("document.layer_locked", role.0));
    }
    let (raster, skipped) = resolve(layers, palette, rules, op, target)?;
    let mut next = layers[target].buffer.clone();
    let mut edit = ops::apply(&mut next, &raster)?;
    for &index in &next.data {
        if index != 0 {
            palette.slot(index)?;
        }
    }
    layers[target].buffer = next;
    edit.skipped = skipped;
    Ok(edit)
}

/// Turns one document op into the buffer op that performs it.
///
/// The second return value is the count of pixels a shading pass could not
/// resolve to a ramp. It travels separately because it is not something a
/// buffer write can produce or explain.
fn resolve(
    layers: &[Layer],
    palette: &Palette,
    rules: &StyleRules,
    op: &Op,
    target: usize,
) -> Result<(ops::RasterOp, usize)> {
    let raster = match op {
        Op::PasteGrid {
            x, y, rows, mode, ..
        } => ops::RasterOp::PasteGrid {
            x: i32::from(*x),
            y: i32::from(*y),
            rows: rows.clone(),
            mode: *mode,
        },
        Op::DrawRuns { runs, .. } => ops::RasterOp::DrawRuns { runs: runs.clone() },
        Op::SetPixels { pixels, .. } => ops::RasterOp::SetPixels {
            pixels: pixels.clone(),
        },
        Op::DrawShape {
            shape,
            from,
            to,
            slot,
            fill,
            pixel_perfect,
            ..
        } => {
            if *slot != 0 {
                palette.slot(*slot)?;
            }
            ops::RasterOp::DrawShape {
                shape: figure(*shape, *from, *to, *fill),
                slot: *slot,
                pixel_perfect: *pixel_perfect,
            }
        }
        Op::FillRegion {
            x,
            y,
            slot,
            contiguous,
            ..
        } => ops::RasterOp::FillRegion {
            x: i32::from(*x),
            y: i32::from(*y),
            slot: *slot,
            contiguous: *contiguous,
        },
        Op::Mirror { axis, about, .. } => ops::RasterOp::Mirror {
            axis: *axis,
            about: *about,
        },
        Op::Translate { dx, dy, .. } => ops::RasterOp::Translate { dx: *dx, dy: *dy },
        Op::Clear { .. } => ops::RasterOp::Clear {},
        Op::Shade {
            target: band_role,
            from,
            region,
            direction,
            depth,
        } => {
            let (kind, extra) = band(*band_role)?;
            let sources = sources(layers);
            let context = shading::Context {
                palette,
                sources: &sources,
                rules,
            };
            let shaded = shading::shade(
                &context,
                from.0,
                region.map(Bounds::from),
                kind,
                *direction,
                depth.saturating_add(extra),
            )?;
            return Ok(placed(shaded));
        }
        Op::Outline { from, mode, darken } => {
            let sources = sources(layers);
            let context = shading::Context {
                palette,
                sources: &sources,
                rules,
            };
            let mode = match mode {
                Some(mode) => *mode,
                None => OutlineMode::parse(&rules.outline)?,
            };
            return Ok(placed(shading::outline(
                &context, from.0, mode, *darken, None,
            )?));
        }
        Op::Antialias { strength, .. } => {
            let sources = sources(layers);
            let context = shading::Context {
                palette,
                sources: &sources,
                rules,
            };
            return Ok(placed(shading::antialias(
                &context,
                &layers[target].buffer,
                *strength,
            )?));
        }
    };
    Ok((raster, 0))
}

/// Pairs the endpoints the tool contract supplies with the figure they describe.
fn figure(shape: Shape, from: Point, to: Point, fill: bool) -> ops::Shape {
    match shape {
        Shape::Line => ops::Shape::Line { from, to },
        Shape::Rect => ops::Shape::Rect {
            from,
            to,
            filled: fill,
        },
        Shape::Ellipse => ops::Shape::Ellipse {
            from,
            to,
            filled: fill,
        },
        Shape::Curve => {
            // The contract supplies endpoints but no handles. A quadratic
            // elbow through the corner of their bounding box is therefore the
            // reproducible default curve, and expressing it as a cubic keeps
            // one curve implementation rather than two.
            let control = Point { x: to.x, y: from.y };
            let handle = |p: Point| Point {
                x: ((i64::from(p.x) + 2 * i64::from(control.x)) / 3) as i32,
                y: ((i64::from(p.y) + 2 * i64::from(control.y)) / 3) as i32,
            };
            ops::Shape::Curve {
                from,
                control1: handle(from),
                control2: handle(to),
                to,
            }
        }
    }
}

/// The layers a shading pass may read, keyed by role.
///
/// Shading reads siblings while the target is being written, so it is given a
/// snapshot rather than the live layers. That also means a pass can never write
/// through one of its own inputs.
fn sources(layers: &[Layer]) -> BTreeMap<&'static str, IndexedBuffer> {
    layers
        .iter()
        .map(|layer| (layer.role.0, layer.buffer.clone()))
        .collect()
}

/// Turns resolved placements into the pixel write that lands them.
fn placed(shaded: shading::Shaded) -> (ops::RasterOp, usize) {
    (
        ops::RasterOp::SetPixels {
            pixels: shaded
                .placements
                .into_iter()
                .map(|placement| PixelSet {
                    x: placement.x,
                    y: placement.y,
                    slot: placement.slot,
                })
                .collect(),
        },
        shaded.skipped,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raster::{grid, Material, PaletteSlot, Ramp};
    use uuid::Uuid;

    fn palette() -> Palette {
        Palette {
            slots: (1..=4)
                .map(|index| PaletteSlot {
                    index,
                    rgba: [index * 50, index * 50, index * 50, 255],
                    name: None,
                    ramp: Some("cloth".into()),
                    step: Some(index - 1),
                })
                .collect(),
            ramps: vec![Ramp {
                name: "cloth".into(),
                material: Material::Cloth,
                slots: vec![1, 2, 3, 4],
            }],
        }
    }

    fn layers(pairs: &[(&'static str, &str)]) -> Vec<Layer> {
        pairs
            .iter()
            .map(|(role, text)| Layer {
                id: Uuid::now_v7(),
                role: LayerRole::parse(role).unwrap(),
                ordinal: crate::raster::LAYER_ROLES
                    .iter()
                    .find(|(name, _)| name == role)
                    .map(|(_, ordinal)| *ordinal)
                    .unwrap(),
                visible: true,
                locked: false,
                opacity: 1.0,
                buffer: grid::parse(text).unwrap(),
            })
            .collect()
    }

    fn buffer(layers: &[Layer], role: &str) -> IndexedBuffer {
        layers
            .iter()
            .find(|l| l.role.0 == role)
            .unwrap()
            .buffer
            .clone()
    }

    #[test]
    fn a_transport_op_lands_on_the_layer_it_names() {
        let mut document = layers(&[("silhouette", "..\n.."), ("flats", "..\n..")]);
        let edit = apply(
            &mut document,
            &palette(),
            &StyleRules::default(),
            &Op::PasteGrid {
                layer: LayerRole("flats"),
                x: 0,
                y: 0,
                rows: vec!["CC".into(), "CC".into()],
                mode: PasteMode::Replace,
            },
        )
        .unwrap();
        assert_eq!(edit.changed, 4);
        assert_eq!(buffer(&document, "flats").data, vec![3; 4]);
        assert_eq!(buffer(&document, "silhouette").data, vec![0; 4]);
    }

    #[test]
    fn a_locked_or_missing_layer_is_refused_before_anything_is_written() {
        let mut document = layers(&[("flats", "..\n..")]);
        document[0].locked = true;
        let clear = Op::Clear {
            layer: LayerRole("flats"),
        };
        assert_eq!(
            apply(&mut document, &palette(), &StyleRules::default(), &clear)
                .unwrap_err()
                .code,
            "document.layer_locked"
        );
        document[0].locked = false;
        assert_eq!(
            apply(
                &mut document,
                &palette(),
                &StyleRules::default(),
                &Op::Clear {
                    layer: LayerRole("detail")
                }
            )
            .unwrap_err()
            .code,
            "document.layer_not_found"
        );
    }

    #[test]
    fn a_write_naming_a_slot_the_palette_lacks_is_rejected_whole() {
        let mut document = layers(&[("flats", "..\n..")]);
        let before = buffer(&document, "flats");
        let error = apply(
            &mut document,
            &palette(),
            &StyleRules::default(),
            &Op::PasteGrid {
                layer: LayerRole("flats"),
                x: 0,
                y: 0,
                rows: vec!["ZZ".into(), "ZZ".into()],
                mode: PasteMode::Replace,
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "palette.unknown_slot");
        assert_eq!(buffer(&document, "flats"), before);
    }

    #[test]
    fn the_target_layer_names_the_shading_band() {
        let flats = "CCCCCC\nCCCCCC\nCCCCCC\nCCCCCC\nCCCCCC\nCCCCCC";
        let empty = "......\n......\n......\n......\n......\n......";
        let mut document = layers(&[
            ("silhouette", flats),
            ("flats", flats),
            ("shadow-core", empty),
            ("shadow-deep", empty),
            ("light", empty),
        ]);
        let rules = StyleRules::default();
        let shade = |target: &'static str| Op::Shade {
            target: LayerRole::parse(target).unwrap(),
            from: LayerRole("flats"),
            region: None,
            direction: Some(Direction::UpperLeft),
            depth: 1,
        };
        for role in ["shadow-core", "shadow-deep", "light"] {
            apply(&mut document, &palette(), &rules, &shade(role)).unwrap();
        }
        // Slot 3 is the flats' base. Core shadow steps one down it, deep shadow
        // two, and light one up - and none of that was named by the caller.
        assert!(buffer(&document, "shadow-core")
            .data
            .iter()
            .all(|s| *s == 0 || *s == 2));
        assert!(buffer(&document, "shadow-deep")
            .data
            .iter()
            .all(|s| *s == 0 || *s == 1));
        assert!(buffer(&document, "light")
            .data
            .iter()
            .all(|s| *s == 0 || *s == 4));
        assert!(buffer(&document, "shadow-core")
            .data
            .iter()
            .any(|s| *s != 0));
    }

    #[test]
    fn a_shading_band_that_is_not_a_band_is_refused() {
        let mut document = layers(&[("flats", "CC\nCC"), ("detail", "..\n..")]);
        let error = apply(
            &mut document,
            &palette(),
            &StyleRules::default(),
            &Op::Shade {
                target: LayerRole("detail"),
                from: LayerRole("flats"),
                region: None,
                direction: None,
                depth: 1,
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "document.invalid_shade_target");
    }

    #[test]
    fn unresolvable_shading_pixels_are_counted_rather_than_guessed() {
        let mut unramped = palette();
        unramped.ramps.clear();
        for slot in &mut unramped.slots {
            slot.ramp = None;
            slot.step = None;
        }
        let mut document = layers(&[
            ("silhouette", "CCC\nCCC\nCCC"),
            ("flats", "CCC\nCCC\nCCC"),
            ("shadow-core", "...\n...\n..."),
        ]);
        let edit = apply(
            &mut document,
            &unramped,
            &StyleRules::default(),
            &Op::Shade {
                target: LayerRole("shadow-core"),
                from: LayerRole("flats"),
                region: None,
                direction: Some(Direction::UpperLeft),
                depth: 1,
            },
        )
        .unwrap();
        assert_eq!(edit.changed, 0);
        assert!(edit.skipped > 0);
    }

    #[test]
    fn an_omitted_outline_mode_comes_from_the_style() {
        let body = "CCCCCCCCCC\n".repeat(10);
        let body = body.trim_end();
        let blank = "..........\n".repeat(10);
        let mut document = layers(&[
            ("silhouette", body),
            ("flats", body),
            ("outline", blank.trim_end()),
        ]);
        let mut rules = StyleRules {
            outline: "none".into(),
            ..StyleRules::default()
        };
        let outline = Op::Outline {
            from: LayerRole("flats"),
            mode: None,
            darken: 1,
        };
        assert_eq!(
            apply(&mut document, &palette(), &rules, &outline)
                .unwrap()
                .changed,
            0
        );
        rules.outline = "full".into();
        assert!(
            apply(&mut document, &palette(), &rules, &outline)
                .unwrap()
                .changed
                > 0
        );
        // The colour came from the fill it borders, one step down its ramp.
        assert!(buffer(&document, "outline")
            .data
            .iter()
            .all(|s| *s == 0 || *s == 2));
    }
}
