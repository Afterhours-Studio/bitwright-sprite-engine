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

//! Reference images: reading one through the asset's own palette, and
//! turning its colours into ramps a model can hand to `set_palette`.
//!
//! Neither tool here calls the sidecar; both only read what the store
//! already has for the asset.

use super::super::error::ToolError;
use super::super::host::{with_store, DocumentHost};
use super::super::session::Session;
use super::read::{legend, render_at};
use super::{parse, resolve_asset, ToolResult, ToolSpec};
use bitwright::raster::color;
use bitwright::raster::png;
use bitwright::store::{AppError, Reference};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

/// Picks the reference the caller asked for, or the most recent one.
///
/// A `referenceId` that is not a uuid, or is a uuid this asset has no
/// reference for, is `reference.not_found`; an asset with no references at
/// all (when none was asked for) is `reference.none`.
fn pick_reference(
    references: Vec<Reference>,
    reference_id: Option<&str>,
) -> Result<Reference, ToolError> {
    match reference_id {
        Some(raw) => Uuid::parse_str(raw)
            .ok()
            .and_then(|id| references.into_iter().find(|r| r.id == id))
            .ok_or_else(|| {
                ToolError::new(
                    "reference.not_found",
                    format!("no reference {raw} on this asset"),
                    "Call read_reference without referenceId to see the most recent one.",
                )
            }),
        None => references
            .into_iter()
            .max_by_key(|r| r.created_at)
            .ok_or_else(|| {
                ToolError::new(
                    "reference.none",
                    "this asset has no reference image",
                    "Import one in the reference panel first.",
                )
            }),
    }
}

fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn bad_hex(value: &str) -> ToolError {
    ToolError::new(
        "reference.invalid",
        format!("{value} is not a colour"),
        "conform_meta.palette should hold #RRGGBB strings; re-import the reference.",
    )
}

fn parse_hex(value: &str) -> Result<[u8; 4], ToolError> {
    let bytes = value.as_bytes();
    if bytes.len() != 7 || bytes[0] != b'#' {
        return Err(bad_hex(value));
    }
    let mut rgba = [0u8; 4];
    for channel in 0..3 {
        let hi = hex_digit(bytes[1 + channel * 2]).ok_or_else(|| bad_hex(value))?;
        let lo = hex_digit(bytes[2 + channel * 2]).ok_or_else(|| bad_hex(value))?;
        rgba[channel] = hi * 16 + lo;
    }
    rgba[3] = 255;
    Ok(rgba)
}

fn hex_of(rgba: &[u8; 4]) -> String {
    format!("#{:02X}{:02X}{:02X}", rgba[0], rgba[1], rgba[2])
}

/// The reference's colours, most used first: `conform_meta.palette` when it
/// has one, else the distinct opaque colours of the decoded image in order
/// of how often they appear.
fn source_colours(reference: &Reference) -> Result<Vec<[u8; 4]>, ToolError> {
    if let Some(meta) = &reference.conform_meta {
        if let Some(palette) = meta.get("palette").and_then(|p| p.as_array()) {
            let mut colours = Vec::with_capacity(palette.len());
            for value in palette {
                let hex = value.as_str().ok_or_else(|| bad_hex("<non-string>"))?;
                colours.push(parse_hex(hex)?);
            }
            if !colours.is_empty() {
                return Ok(colours);
            }
        }
    }
    let bytes = reference
        .conformed
        .clone()
        .unwrap_or_else(|| reference.source_png.clone());
    let image = png::decode(&bytes).map_err(|e| ToolError::from(AppError::from(e)))?;
    let mut order: Vec<[u8; 4]> = Vec::new();
    let mut counts: std::collections::HashMap<[u8; 4], usize> = std::collections::HashMap::new();
    for pixel in image.data.chunks_exact(4) {
        if pixel[3] < 128 {
            continue;
        }
        let rgba = [pixel[0], pixel[1], pixel[2], pixel[3]];
        counts
            .entry(rgba)
            .and_modify(|n| *n += 1)
            .or_insert_with(|| {
                order.push(rgba);
                1
            });
    }
    order.sort_by(|a, b| counts[b].cmp(&counts[a]));
    Ok(order)
}

/// One hue-grouped ramp in progress: its name, a representative hue used
/// only to pick a merge target, and its colours.
struct Group {
    name: String,
    hue: f32,
    colours: Vec<[u8; 4]>,
}

/// The `ramps` array `extract_palette` returns: a reference's colours,
/// grouped by hue into ramps, darkest slot first, in the exact shape
/// `set_palette` takes.
pub(crate) fn extracted_ramps(reference: &Reference, max_slots: usize) -> Result<Value, ToolError> {
    let max_slots = max_slots.clamp(1, 62);
    let colours = source_colours(reference)?;
    let kept: Vec<[u8; 4]> = colours.into_iter().take(max_slots).collect();
    if kept.is_empty() {
        return Ok(json!([]));
    }

    let mut groups: Vec<Group> = Vec::new();
    for rgba in &kept {
        let lab = color::srgb_to_oklab(*rgba);
        let c = color::chroma(lab);
        let h = color::hue(lab);
        let name = if c < 0.03 {
            "neutral".to_string()
        } else {
            let bucket = ((h.rem_euclid(360.0) / 30.0).floor() as i32) * 30;
            format!("hue-{bucket}")
        };
        if let Some(group) = groups.iter_mut().find(|g| g.name == name) {
            group.colours.push(*rgba);
        } else {
            groups.push(Group {
                name,
                hue: h,
                colours: vec![*rgba],
            });
        }
    }

    // Merge singleton ramps into whichever remaining ramp sits nearest in
    // hue, so every ramp ends with at least two slots unless only one
    // colour was kept in total.
    loop {
        if groups.len() <= 1 {
            break;
        }
        let Some(pos) = groups.iter().position(|g| g.colours.len() == 1) else {
            break;
        };
        let singleton_hue = groups[pos].hue;
        let mut best: Option<(usize, f32)> = None;
        for (i, g) in groups.iter().enumerate() {
            if i == pos {
                continue;
            }
            let delta = color::angle_delta(singleton_hue, g.hue).abs();
            if best.map(|(_, d)| delta < d).unwrap_or(true) {
                best = Some((i, delta));
            }
        }
        let (target, _) = best.expect("groups.len() > 1 guarantees another group");
        let colours = std::mem::take(&mut groups[pos].colours);
        groups[target].colours.extend(colours);
        groups.remove(pos);
    }

    let mut ramps = Vec::with_capacity(groups.len());
    for group in groups {
        let mut colours = group.colours;
        colours.sort_by(|a, b| {
            let la = color::srgb_to_oklab(*a)[0];
            let lb = color::srgb_to_oklab(*b)[0];
            la.partial_cmp(&lb).unwrap_or(std::cmp::Ordering::Equal)
        });
        let slots: Vec<String> = colours.iter().map(hex_of).collect();
        ramps.push(json!({
            "name": group.name,
            "material": "custom",
            "slots": slots,
        }));
    }
    Ok(Value::Array(ramps))
}

// ---------------------------------------------------------------------------
// read_reference
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadReferenceArgs {
    asset_id: Option<String>,
    reference_id: Option<String>,
    rulers: Option<bool>,
}

fn read_reference_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string" },
            "referenceId": { "type": "string" },
            "rulers": { "type": "boolean" }
        },
        "additionalProperties": false
    })
}

fn read_reference(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: ReadReferenceArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let show_rulers = args.rulers.unwrap_or(true);
    let (document, references) = with_store(host, |store| {
        let document = store.asset_open(asset)?;
        let references = store.reference_list(asset)?;
        Ok((document, references))
    })?;
    let reference = pick_reference(references, args.reference_id.as_deref())?;

    let bytes = reference
        .conformed
        .clone()
        .unwrap_or_else(|| reference.source_png.clone());
    let image = png::decode(&bytes).map_err(|e| ToolError::from(AppError::from(e)))?;
    let buffer = png::index(&image, &document.palette, 128)
        .map_err(|e| ToolError::from(AppError::from(e)))?;
    let grid_text = render_at(&buffer, 0, 0, show_rulers)?;
    let lg = legend(&buffer, &document.palette)?;
    let mut text = format!("{lg}\n\n{grid_text}");
    if document.palette.slots.is_empty() {
        text = format!(
            "No palette yet: every pixel reads as empty. Call extract_palette, then \
             set_palette.\n{text}"
        );
    }

    let (detected, warnings) = match &reference.conform_meta {
        Some(meta) => (
            meta.get("detected").cloned().unwrap_or(Value::Null),
            meta.get("warnings").cloned().unwrap_or_else(|| json!([])),
        ),
        None => (Value::Null, json!([])),
    };

    Ok(json!({
        "referenceId": reference.id.to_string(),
        "name": reference.name,
        "width": image.width,
        "height": image.height,
        "text": text,
        "detected": detected,
        "warnings": warnings,
    }))
}

// ---------------------------------------------------------------------------
// extract_palette
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExtractPaletteArgs {
    asset_id: Option<String>,
    reference_id: Option<String>,
    max_slots: Option<usize>,
}

fn extract_palette_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string" },
            "referenceId": { "type": "string" },
            "maxSlots": { "type": "integer", "minimum": 1, "maximum": 62 }
        },
        "additionalProperties": false
    })
}

fn extract_palette(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: ExtractPaletteArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let max_slots = args.max_slots.unwrap_or(32).clamp(1, 62);
    let references = with_store(host, |store| store.reference_list(asset))?;
    let reference = pick_reference(references, args.reference_id.as_deref())?;
    let ramps = extracted_ramps(&reference, max_slots)?;
    Ok(json!({
        "referenceId": reference.id.to_string(),
        "ramps": ramps,
    }))
}

// ---------------------------------------------------------------------------

pub fn tools() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "read_reference",
            description: "Read a reference image through the asset's own palette: the same \
                grid and legend read_canvas gives, plus what was detected while conforming \
                it (cell size, confidence) and any warnings from that pass. Import happens \
                elsewhere; this only reads what the store already has.",
            input_schema: read_reference_schema,
            handler: read_reference,
        },
        ToolSpec {
            name: "extract_palette",
            description: "Turn a reference's colours into ramps grouped by hue, darkest slot \
                first. It applies nothing by itself: pass the ramps this returns straight to \
                set_palette to make them the asset's palette.",
            input_schema: extract_palette_schema,
            handler: extract_palette,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::host::HeadlessHost;
    use crate::mcp::tools::call;
    use bitwright::raster::IndexedBuffer;
    use bitwright::store::{AssetId, Store};

    fn setup() -> (HeadlessHost, Session, AssetId) {
        let mut store = Store::memory().unwrap();
        let project = store.project_create("demo", "hd2d").unwrap();
        let asset = store
            .asset_create(project.id, "hero", "character", 4, 4)
            .unwrap();
        let host = HeadlessHost::new(store);
        (host, Session::new("test"), asset.id)
    }

    /// Writes a palette straight to the store. The style's ramp rules are
    /// `set_palette`'s business and are tested there; these tests need a
    /// palette of exactly the colours the reference uses.
    fn set_slots(host: &HeadlessHost, _session: &Session, asset: AssetId, hexes: &[&str]) {
        use bitwright::raster::{Material, Palette, PaletteSlot, Ramp};
        let channel = |hex: &str, at: usize| u8::from_str_radix(&hex[at..at + 2], 16).unwrap();
        let slots: Vec<PaletteSlot> = hexes
            .iter()
            .enumerate()
            .map(|(i, hex)| PaletteSlot {
                index: i as u8 + 1,
                rgba: [channel(hex, 1), channel(hex, 3), channel(hex, 5), 255],
                name: None,
                ramp: Some("ramp".into()),
                step: Some(i as u8),
            })
            .collect();
        let palette = Palette {
            ramps: vec![Ramp {
                name: "ramp".into(),
                material: Material::Custom,
                slots: slots.iter().map(|slot| slot.index).collect(),
            }],
            slots,
        };
        let store = host.store();
        let mut store = store.lock().unwrap();
        store.palette_write_as(asset, palette, "user").unwrap();
    }

    #[allow(clippy::too_many_arguments)]
    fn store_reference(
        host: &HeadlessHost,
        asset: AssetId,
        name: &str,
        width: u16,
        height: u16,
        slots: &[u8],
        created_at: i64,
    ) -> Uuid {
        with_store(host, |store| {
            let document = store.asset_open(asset)?;
            let mut buffer = IndexedBuffer::new(width, height)?;
            buffer.data.copy_from_slice(slots);
            let image = bitwright::raster::png::colour(&buffer, &document.palette)?;
            let bytes = bitwright::raster::png::encode(&image)?;
            let id = Uuid::new_v4();
            store.reference_write(Reference {
                id,
                asset_id: asset,
                name: name.to_string(),
                source_png: bytes.clone(),
                conformed: Some(bytes),
                conform_meta: None,
                created_at,
            })?;
            Ok(id)
        })
        .expect("reference stored")
    }

    #[test]
    fn no_references_is_reference_none() {
        let (host, session, asset) = setup();
        let error = call(
            &host,
            &session,
            "read_reference",
            json!({ "assetId": asset.0.to_string() }),
        )
        .expect_err("no references yet");
        assert_eq!(error.code, "reference.none");
    }

    #[test]
    fn reads_back_the_palette_slot_grid_and_defaults_to_most_recent() {
        let (host, session, asset) = setup();
        set_slots(&host, &session, asset, &["#FF0000", "#00FF00"]);
        let old = [1u8; 16];
        let new = [2u8; 16];
        let _old_id = store_reference(&host, asset, "old", 4, 4, &old, 1);
        let new_id = store_reference(&host, asset, "new", 4, 4, &new, 2);

        let result = call(
            &host,
            &session,
            "read_reference",
            json!({ "assetId": asset.0.to_string() }),
        )
        .expect("reads the most recent reference");
        assert_eq!(result["referenceId"], json!(new_id.to_string()));
        assert_eq!(result["name"], json!("new"));
        let text = result["text"].as_str().unwrap();
        assert!(text.contains('B'));
        assert!(!text.contains('A'));
    }

    #[test]
    fn unknown_reference_id_is_reference_not_found() {
        let (host, session, asset) = setup();
        set_slots(&host, &session, asset, &["#FF0000"]);
        store_reference(&host, asset, "one", 4, 4, &[1; 16], 1);
        let error = call(
            &host,
            &session,
            "read_reference",
            json!({
                "assetId": asset.0.to_string(),
                "referenceId": Uuid::new_v4().to_string()
            }),
        )
        .expect_err("unknown reference id");
        assert_eq!(error.code, "reference.not_found");
    }

    #[test]
    fn a_palette_less_asset_says_so_first() {
        let (host, session, asset) = setup();
        store_reference(&host, asset, "blank", 4, 4, &[0; 16], 1);
        let result = call(
            &host,
            &session,
            "read_reference",
            json!({ "assetId": asset.0.to_string() }),
        )
        .expect("no palette yet is not an error");
        let text = result["text"].as_str().unwrap();
        assert!(text.starts_with("No palette yet"));
    }

    #[test]
    fn extract_palette_groups_by_hue_darkest_first_and_caps_max_slots() {
        let (host, session, asset) = setup();
        // Two reds, two blues, two greys: two real hue clusters and a
        // neutral one, each with two members so no merging is forced.
        set_slots(
            &host,
            &session,
            asset,
            &[
                "#200000", "#FF4040", "#000020", "#4040FF", "#303030", "#909090",
            ],
        );
        let reference_id = store_reference(
            &host,
            asset,
            "swatches",
            4,
            4,
            &[1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 1, 2, 3, 4],
            1,
        );

        let result = call(
            &host,
            &session,
            "extract_palette",
            json!({ "assetId": asset.0.to_string(), "referenceId": reference_id.to_string() }),
        )
        .expect("colours extracted");
        let ramps = result["ramps"].as_array().expect("ramps array");
        assert!(
            ramps.len() >= 2,
            "expected at least two ramps, got {ramps:?}"
        );
        for ramp in ramps {
            let slots = ramp["slots"].as_array().unwrap();
            assert!(
                slots.len() >= 2,
                "every ramp should have at least two slots"
            );
            assert_eq!(ramp["material"], json!("custom"));
        }
        let neutral = ramps.iter().find(|r| r["name"] == json!("neutral"));
        assert!(neutral.is_some(), "the greys should land in a neutral ramp");
        let neutral_slots = neutral.unwrap()["slots"].as_array().unwrap();
        // Darkest first.
        assert_eq!(neutral_slots[0], json!("#303030"));
        assert_eq!(neutral_slots[1], json!("#909090"));

        // maxSlots caps how many colours are kept in total.
        let capped = call(
            &host,
            &session,
            "extract_palette",
            json!({
                "assetId": asset.0.to_string(),
                "referenceId": reference_id.to_string(),
                "maxSlots": 2
            }),
        )
        .expect("capped extraction");
        let total: usize = capped["ramps"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["slots"].as_array().unwrap().len())
            .sum();
        assert!(total <= 2);

        // What extract_palette returns is exactly the body set_palette takes.
        // Whether the style accepts these colours is a judgement about the
        // reference, not about the shape, so either outcome is fine as long
        // as set_palette read the body rather than refusing its arguments.
        let applied = call(
            &host,
            &session,
            "set_palette",
            json!({ "assetId": asset.0.to_string(), "ramps": result["ramps"].clone() }),
        );
        if let Err(error) = applied {
            assert_eq!(error.code, "palette.rule_violation", "{error:?}");
        }
    }
}
