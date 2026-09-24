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

//! Palette: setting ramps and forking variations.

use super::super::error::ToolError;
use super::super::host::{with_store, DocumentHost};
use super::super::session::Session;
use super::{asset_id, parse, ToolResult, ToolSpec};
use crate::raster::gates::GateCheck;
use crate::raster::{Material, Palette, PaletteSlot, Ramp};
use crate::store::{AppError, AssetId};
use serde::Deserialize;
use serde_json::{json, Value};

const MATERIALS: &[&str] = &[
    "skin", "cloth", "leather", "metal", "hair", "eyes", "accent", "stone", "glass", "wood",
    "custom",
];

const MATERIAL_HINT: &str = "Use one of: skin, cloth, leather, metal, hair, eyes, accent, \
    stone, glass, wood, custom.";

fn bad_hex(value: &str) -> ToolError {
    ToolError::new(
        "args.invalid",
        format!("{value} is not a colour"),
        "Colours are #RRGGBB, six hex digits.",
    )
}

fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
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

fn parse_material(value: &str) -> Result<Material, ToolError> {
    serde_json::from_value::<Material>(Value::String(value.to_string())).map_err(|_| {
        ToolError::new(
            "args.invalid",
            format!("{value} is not a material"),
            MATERIAL_HINT,
        )
    })
}

fn resolve_asset(session: &Session, asset_id_arg: Option<&str>) -> Result<AssetId, ToolError> {
    match asset_id_arg {
        Some(value) => asset_id(value),
        None => session.current_asset().ok_or_else(|| {
            ToolError::new(
                "asset.not_found",
                "no assetId was given and the session has no current asset",
                "Pass assetId, or call open_asset first.",
            )
        }),
    }
}

/// Runs the structural and style checks a palette must pass, in the order the
/// two kinds of fault deserve: a malformed palette is an error, an unfinished
/// one is a rule violation with the measurements that failed.
fn check_palette(palette: &Palette, rules: &crate::raster::StyleRules) -> Result<(), ToolError> {
    palette
        .validate(rules)
        .map_err(|error| ToolError::from(AppError::from(error)))?;
    let checks = palette
        .gate_checks(rules)
        .map_err(|error| ToolError::from(AppError::from(error)))?;
    let failing: Vec<&GateCheck> = checks.iter().filter(|check| !check.pass).collect();
    if failing.is_empty() {
        return Ok(());
    }
    let message = failing
        .iter()
        .map(|check| match &check.detail {
            Some(detail) => format!("{}: {detail}", check.name),
            None => check.name.clone(),
        })
        .collect::<Vec<_>>()
        .join("; ");
    let hint = failing
        .iter()
        .filter_map(|check| check.hint.clone())
        .collect::<Vec<_>>()
        .join(" ");
    Err(ToolError::new("palette.rule_violation", message, hint))
}

// ---------------------------------------------------------------------------
// set_palette
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetPaletteArgs {
    asset_id: Option<String>,
    ramps: Vec<RampArg>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RampArg {
    name: String,
    material: String,
    slots: Vec<String>,
}

fn set_palette_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string" },
            "ramps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "material": { "type": "string", "enum": MATERIALS },
                        "slots": {
                            "type": "array",
                            "items": { "type": "string" }
                        }
                    },
                    "required": ["name", "material", "slots"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["ramps"],
        "additionalProperties": false
    })
}

/// The grid alphabet has 62 characters, so a palette can never address more
/// than 62 slots; the style ceiling may be lower still.
const SLOT_CEILING: usize = 62;

fn build_palette(ramps: &[RampArg]) -> Result<Palette, ToolError> {
    if ramps.is_empty() {
        return Err(ToolError::new(
            "args.invalid",
            "no ramps were given",
            "Give at least one ramp with a name, a material and its colours.",
        ));
    }
    let total: usize = ramps.iter().map(|ramp| ramp.slots.len()).sum();
    if total > SLOT_CEILING {
        return Err(ToolError::new(
            "args.invalid",
            format!("{total} slots were given but a palette holds at most {SLOT_CEILING}"),
            "The grid alphabet has 62 characters, so a palette holds at most 62 slots; \
                the style ceiling may be lower.",
        ));
    }
    let mut palette = Palette::default();
    let mut index: u8 = 1;
    for ramp in ramps {
        if palette
            .ramps
            .iter()
            .any(|existing| existing.name == ramp.name)
        {
            return Err(ToolError::new(
                "args.invalid",
                format!("{} is named twice", ramp.name),
                "Give every ramp a distinct name.",
            ));
        }
        let material = parse_material(&ramp.material)?;
        let mut indices = Vec::with_capacity(ramp.slots.len());
        for (step, hex) in ramp.slots.iter().enumerate() {
            let rgba = parse_hex(hex)?;
            let step = u8::try_from(step).map_err(|_| {
                ToolError::new(
                    "args.invalid",
                    format!("{} has more than 255 steps", ramp.name),
                    "A ramp holds at most 255 steps.",
                )
            })?;
            palette.slots.push(PaletteSlot {
                index,
                rgba,
                name: Some(format!("{}.{}", ramp.name, step)),
                ramp: Some(ramp.name.clone()),
                step: Some(step),
            });
            indices.push(index);
            index = index.checked_add(1).ok_or_else(|| {
                ToolError::new(
                    "args.invalid",
                    format!("{} pushes the palette past its slot ceiling", ramp.name),
                    "A palette holds at most 62 slots.",
                )
            })?;
        }
        palette.ramps.push(Ramp {
            name: ramp.name.clone(),
            material,
            slots: indices,
        });
    }
    Ok(palette)
}

fn set_palette(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: SetPaletteArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let palette = build_palette(&args.ramps)?;
    let rules = with_store(host, |store| store.asset_rules(asset))?;
    check_palette(&palette, &rules)?;
    let actor = session.actor();
    let (stored, op) = with_store(host, |store| store.palette_write_as(asset, palette, &actor))?;
    host.palette_changed(asset);
    let slots = stored
        .slots
        .iter()
        .map(|slot| {
            json!({
                "index": slot.index,
                "hex": hex_of(&slot.rgba),
                "name": slot.name.clone().unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "slots": slots, "seq": op.seq }))
}

// ---------------------------------------------------------------------------
// create_variation
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateVariationArgs {
    asset_id: Option<String>,
    name: String,
    remap: Vec<RemapArg>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemapArg {
    ramp: String,
    to: Vec<String>,
}

fn create_variation_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string" },
            "name": { "type": "string" },
            "remap": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "ramp": { "type": "string" },
                        "to": {
                            "type": "array",
                            "items": { "type": "string" }
                        }
                    },
                    "required": ["ramp", "to"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["name", "remap"],
        "additionalProperties": false
    })
}

fn recolour(palette: &mut Palette, remap: &[RemapArg]) -> Result<(), ToolError> {
    for entry in remap {
        let indices = {
            let ramp = palette
                .ramps
                .iter()
                .find(|ramp| ramp.name == entry.ramp)
                .ok_or_else(|| {
                    ToolError::new(
                        "args.invalid",
                        format!("{} is not a ramp in this palette", entry.ramp),
                        "Call get_palette for the ramp names.",
                    )
                })?;
            if ramp.slots.len() != entry.to.len() {
                return Err(ToolError::new(
                    "args.invalid",
                    format!(
                        "{} has {} slots but {} colours were given",
                        entry.ramp,
                        ramp.slots.len(),
                        entry.to.len()
                    ),
                    "Give one colour per slot, in ramp order.",
                ));
            }
            ramp.slots.clone()
        };
        for (index, hex) in indices.iter().zip(entry.to.iter()) {
            let rgba = parse_hex(hex)?;
            let slot = palette
                .slots
                .iter_mut()
                .find(|slot| slot.index == *index)
                .ok_or_else(|| {
                    ToolError::new(
                        "args.invalid",
                        format!(
                            "{} refers to slot {index}, which is not in this palette",
                            entry.ramp
                        ),
                        "Call get_palette for the ramp's slots.",
                    )
                })?;
            slot.rgba = rgba;
        }
    }
    Ok(())
}

fn create_variation(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: CreateVariationArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let source = with_store(host, |store| store.asset_open(asset))?;
    let rules = with_store(host, |store| store.asset_rules(asset))?;
    let mut palette = source.palette.clone();
    recolour(&mut palette, &args.remap)?;
    check_palette(&palette, &rules)?;
    let actor = session.actor();
    let created = with_store(host, |store| {
        let created = store.asset_create(
            source.asset.project_id,
            &args.name,
            &source.asset.kind,
            source.asset.width,
            source.asset.height,
        )?;
        store.palette_write_as(created.id, palette, &actor)?;
        let target = store.asset_open(created.id)?;
        for layer in &source.layers {
            if let Some(mut copy) = target
                .layers
                .iter()
                .find(|candidate| candidate.role == layer.role)
                .cloned()
            {
                copy.buffer = layer.buffer.clone();
                store.layer_write_as(created.id, copy, &actor)?;
            }
        }
        Ok(created)
    })?;
    host.palette_changed(created.id);
    Ok(json!({ "asset": created }))
}

// ---------------------------------------------------------------------------
// catalogue
// ---------------------------------------------------------------------------

pub fn tools() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "set_palette",
            description: "Set the asset's ramps. The only tool that takes hex colours. \
                Checked against the style: slot ceiling, ramp length, and hue shift — \
                shadows move cool, lights move warm; a ramp that only changes lightness \
                is refused.",
            input_schema: set_palette_schema,
            handler: set_palette,
        },
        ToolSpec {
            name: "create_variation",
            description: "Fork the asset under a new name with some ramps recoloured. Not \
                one pixel moves, so the shading survives exactly.",
            input_schema: create_variation_schema,
            handler: create_variation,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::host::HeadlessHost;
    use crate::mcp::tools::call;
    use crate::store::Store;

    const SKIN: [&str; 4] = ["#5C3B2E", "#8A5B41", "#C08A63", "#E8BC94"];
    const GREY: [&str; 4] = ["#303030", "#606060", "#909090", "#C0C0C0"];

    fn setup() -> (HeadlessHost, Session, AssetId) {
        let mut store = Store::memory().unwrap();
        let project = store.project_create("demo", "hd2d").unwrap();
        let asset = store
            .asset_create(project.id, "hero", "character", 48, 64)
            .unwrap();
        let host = HeadlessHost::new(store);
        (host, Session::new("test"), asset.id)
    }

    /// The worked character palette from the skill pack's palette reference
    /// (`skills/bitwright-pixel-art/references/palette.md`, section 3): seven
    /// ramps written to pass the hd2d palette gate as a whole.
    fn example_ramps() -> Value {
        json!([
            { "name": "skin", "material": "skin",
              "slots": ["#8F595E", "#AB7469", "#C19470", "#CEBB92"] },
            { "name": "cloth-blue", "material": "cloth",
              "slots": ["#3E4991", "#406EB3", "#509BC1"] },
            { "name": "cloth-green", "material": "cloth",
              "slots": ["#447648", "#69945F", "#9AB485"] },
            { "name": "leather", "material": "leather",
              "slots": ["#2F3000", "#604914", "#906D52"] },
            { "name": "hair", "material": "hair",
              "slots": ["#2D0E22", "#492C46", "#69546D"] },
            { "name": "ink", "material": "custom",
              "slots": ["#0D051A", "#211E36", "#393C50"] },
            { "name": "rim", "material": "custom",
              "slots": ["#B6A889", "#E3C4AE", "#FFE2DC"] }
        ])
    }

    fn example_palette(asset: &AssetId) -> Value {
        json!({ "assetId": asset.0.to_string(), "ramps": example_ramps() })
    }

    #[test]
    fn the_documented_example_palette_passes() {
        let (host, session, asset) = setup();
        let result = match set_palette(&host, &session, example_palette(&asset)) {
            Ok(result) => result,
            Err(error) => panic!("{}: {} | {}", error.code, error.message, error.hint),
        };
        assert_eq!(result["slots"].as_array().unwrap().len(), 22);
        assert_eq!(result["slots"][0]["index"], 1);
        assert_eq!(result["slots"][0]["hex"], "#8F595E");
        assert_eq!(result["slots"][0]["name"], "skin.0");
        assert!(result["seq"].as_i64().unwrap() >= 0);
    }

    #[test]
    fn a_flat_grey_ramp_is_a_rule_violation() {
        let (host, session, asset) = setup();
        let error = set_palette(
            &host,
            &session,
            json!({
                "assetId": asset.0.to_string(),
                "ramps": [{ "name": "cloth", "material": "cloth", "slots": GREY }],
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, "palette.rule_violation");
    }

    #[test]
    fn bad_hex_is_rejected() {
        let (host, session, asset) = setup();
        let error = set_palette(
            &host,
            &session,
            json!({
                "assetId": asset.0.to_string(),
                "ramps": [{ "name": "skin", "material": "skin", "slots": ["#GGGGGG"] }],
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, "args.invalid");
    }

    #[test]
    fn unknown_material_is_rejected() {
        let (host, session, asset) = setup();
        let error = set_palette(
            &host,
            &session,
            json!({
                "assetId": asset.0.to_string(),
                "ramps": [{ "name": "skin", "material": "plaid", "slots": SKIN }],
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, "args.invalid");
        assert!(error.hint.contains("skin"));
    }

    #[test]
    fn variation_copies_pixels_and_recolours() {
        let mut store = Store::memory().unwrap();
        let project = store.project_create("demo", "hd2d").unwrap();
        let asset = store
            .asset_create(project.id, "hero", "character", 48, 64)
            .unwrap();
        let host = HeadlessHost::new(store);
        let session = Session::new("test");

        set_palette(&host, &session, example_palette(&asset.id)).unwrap();

        // Slot 1 is skin.0: paint a pixel with a slot the palette actually has.
        {
            let store = host.store();
            let mut store = store.lock().unwrap();
            let document = store.asset_open(asset.id).unwrap();
            let mut layer = document.layers[0].clone();
            layer.buffer.data[0] = 1;
            store.layer_write(asset.id, layer).unwrap();
        }

        // Recolour cloth-blue with cloth-green's own three colours: both are
        // cloth ramps of three steps, so the variant's palette still satisfies
        // the gate, but the colours differ from the source ramp's. cloth-green
        // takes cloth-blue's colours in exchange so the palette keeps no
        // duplicate pair.
        let recoloured = ["#447648", "#69945F", "#9AB485"];
        let swapped = ["#3E4991", "#406EB3", "#509BC1"];
        let result = match create_variation(
            &host,
            &session,
            json!({
                "assetId": asset.id.0.to_string(),
                "name": "hero_variant",
                "remap": [
                    { "ramp": "cloth-blue", "to": recoloured },
                    { "ramp": "cloth-green", "to": swapped },
                ],
            }),
        ) {
            Ok(result) => result,
            Err(error) => panic!("{}: {} / {}", error.code, error.message, error.hint),
        };
        let new_id = asset_id(result["asset"]["id"].as_str().unwrap()).unwrap();
        let store = host.store();
        let store = store.lock().unwrap();
        let new_document = store.asset_open(new_id).unwrap();
        assert_eq!(new_document.layers[0].buffer.data[0], 1);
        // cloth-blue is slots 5..7 (skin holds 1..4).
        assert_eq!(new_document.palette.slots[4].rgba, [0x44, 0x76, 0x48, 255]);
        assert_eq!(new_document.palette.slots[5].rgba, [0x69, 0x94, 0x5F, 255]);
        assert_eq!(new_document.palette.slots[6].rgba, [0x9A, 0xB4, 0x85, 255]);
        assert_eq!(new_document.asset.name, "hero_variant");
        // The source asset's cloth-blue ramp is untouched.
        let source_document = store.asset_open(asset.id).unwrap();
        assert_eq!(
            source_document.palette.slots[4].rgba,
            [0x3E, 0x49, 0x91, 255]
        );
        assert_eq!(
            source_document.palette.slots[5].rgba,
            [0x40, 0x6E, 0xB3, 255]
        );
        assert_eq!(
            source_document.palette.slots[6].rgba,
            [0x50, 0x9B, 0xC1, 255]
        );
    }

    #[test]
    fn a_palette_write_through_the_tool_records_the_agent_as_its_author() {
        let (host, session, asset) = setup();
        call(&host, &session, "set_palette", example_palette(&asset)).unwrap();
        let store = host.store();
        let store = store.lock().unwrap();
        let log = store.op_log(asset).unwrap();
        let last = log.last().expect("the palette write is logged");
        assert_eq!(last.kind, "palette_write");
        assert!(
            last.actor.starts_with("agent:"),
            "an agent's write must not be blamed on the person: {}",
            last.actor
        );
        assert_eq!(last.actor, session.actor());
    }

    #[test]
    fn a_variation_fork_records_the_agent_as_the_author_of_its_writes() {
        let (host, session, asset) = setup();
        call(&host, &session, "set_palette", example_palette(&asset)).unwrap();
        let recoloured = ["#447648", "#69945F", "#9AB485"];
        let swapped = ["#3E4991", "#406EB3", "#509BC1"];
        let result = call(
            &host,
            &session,
            "create_variation",
            json!({
                "assetId": asset.0.to_string(),
                "name": "hero_variant",
                "remap": [
                    { "ramp": "cloth-blue", "to": recoloured },
                    { "ramp": "cloth-green", "to": swapped },
                ],
            }),
        )
        .unwrap();
        let created = asset_id(result["asset"]["id"].as_str().unwrap()).unwrap();
        let store = host.store();
        let store = store.lock().unwrap();
        let log = store.op_log(created).unwrap();
        let writes: Vec<&str> = log
            .iter()
            .filter(|op| op.kind == "palette_write" || op.kind == "layer_write")
            .map(|op| op.actor.as_str())
            .collect();
        assert!(
            writes.iter().all(|actor| actor.starts_with("agent:")),
            "every write of the fork belongs to the agent: {writes:?}"
        );
        assert!(
            writes.iter().any(|actor| *actor == session.actor()),
            "the fork's palette is the agent's own write"
        );
    }

    #[test]
    fn too_many_slots_is_rejected_without_panicking() {
        let (host, session, asset) = setup();
        let ramps = (0..63)
            .map(|step| {
                json!({
                    "name": format!("r{step}"),
                    "material": "custom",
                    "slots": ["#000000"],
                })
            })
            .collect::<Vec<_>>();
        let error = set_palette(
            &host,
            &session,
            json!({ "assetId": asset.0.to_string(), "ramps": ramps }),
        )
        .unwrap_err();
        assert_eq!(error.code, "args.invalid");
        assert!(error.message.contains("62"));
    }

    #[test]
    fn unknown_ramp_in_remap_is_rejected() {
        let (host, session, asset) = setup();
        set_palette(&host, &session, example_palette(&asset)).unwrap();
        let error = create_variation(
            &host,
            &session,
            json!({
                "assetId": asset.0.to_string(),
                "name": "hero_variant",
                "remap": [{ "ramp": "metal", "to": ["#8F595E", "#AB7469", "#C19470", "#CEBB92"] }],
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, "args.invalid");
        assert!(error.message.contains("metal"));
    }
}
