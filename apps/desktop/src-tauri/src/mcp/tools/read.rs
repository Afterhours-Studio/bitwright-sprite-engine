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

//! Reading the canvas: grids, palette, layer diffs.

use super::super::error::ToolError;
use super::super::host::{with_store, DocumentHost};
use super::super::session::Session;
use super::{parse, resolve_asset, role, ToolResult, ToolSpec};
use bitwright::raster::grid;
use bitwright::raster::{IndexedBuffer, Palette};
use bitwright::store::{AppError, Document};
use serde::Deserialize;
use serde_json::{json, Value};

/// The composite on indices: a transparent buffer filled bottom-to-top by
/// ordinal, where every non-zero byte overwrites the one beneath.
fn flatten(document: &Document) -> IndexedBuffer {
    let mut buffer = IndexedBuffer::new(document.asset.width, document.asset.height)
        .expect("asset dimensions are always valid");
    let mut sorted = document.layers.clone();
    sorted.sort_by_key(|l| l.ordinal);
    for layer in &sorted {
        if !layer.visible {
            continue;
        }
        for (i, &slot) in layer.buffer.data.iter().enumerate() {
            if slot != 0 {
                buffer.data[i] = slot;
            }
        }
    }
    buffer
}

/// Extract a rectangle from a buffer, refusing zero-sized or out-of-bounds
/// regions.
fn crop(
    buffer: &IndexedBuffer,
    x: u16,
    y: u16,
    w: u16,
    h: u16,
) -> Result<IndexedBuffer, ToolError> {
    if w == 0 || h == 0 {
        return Err(ToolError::new(
            "bounds.outside",
            "region has zero width or height",
            format!(
                "w and h must be positive; the canvas is {}x{}.",
                buffer.width, buffer.height
            ),
        ));
    }
    let x2 = u32::from(x) + u32::from(w);
    let y2 = u32::from(y) + u32::from(h);
    if x2 > u32::from(buffer.width) || y2 > u32::from(buffer.height) {
        return Err(ToolError::new(
            "bounds.outside",
            "region extends past the canvas edge",
            format!(
                "The canvas is {}x{}; stay inside those bounds.",
                buffer.width, buffer.height
            ),
        ));
    }
    let mut cropped = IndexedBuffer::new(w, h).expect("w and h are positive and fit in u16");
    for row in 0..h {
        let src_start = (y + row) as usize * buffer.width as usize + x as usize;
        let dst_start = row as usize * w as usize;
        cropped.data[dst_start..dst_start + w as usize]
            .copy_from_slice(&buffer.data[src_start..src_start + w as usize]);
    }
    Ok(cropped)
}

/// The grid character for a single palette index, taken from the one renderer
/// that owns the alphabet.
///
/// A slot the grid cannot represent surfaces as `slot.out_of_range` through the
/// usual error translation rather than being silently replaced.
fn slot_char(slot: u8) -> Result<char, ToolError> {
    let mut buffer = IndexedBuffer::new(1, 1).expect("a 1x1 buffer is always valid");
    buffer.data[0] = slot;
    let text = grid::render(&buffer, false).map_err(|e| ToolError::from(AppError::from(e)))?;
    Ok(text.chars().next().expect("a 1x1 render is one character"))
}

/// Render a buffer with real canvas offsets for the rulers.
///
/// Column rulers show real canvas columns starting at `x0` (a number at every
/// canvas column divisible by 5). Row labels are `y0 + row`. The body rows come
/// from `grid::render`, so this shares the one grid alphabet. Without rulers
/// this is identical to `grid::render`.
pub(crate) fn render_at(
    buffer: &IndexedBuffer,
    x0: u16,
    y0: u16,
    rulers: bool,
) -> Result<String, ToolError> {
    let body = grid::render(buffer, false).map_err(|e| ToolError::from(AppError::from(e)))?;
    if !rulers {
        return Ok(body);
    }
    let mut lines = Vec::new();
    let mut ruler = vec![b' '; buffer.width as usize];
    for local_col in 0..buffer.width as usize {
        let canvas_col = x0 as usize + local_col;
        if canvas_col % 5 != 0 {
            continue;
        }
        let label = canvas_col.to_string();
        // A label is drawn whole or not at all. A clipped "1" standing for
        // column 15 reads back as column 1, so it must never be drawn.
        if local_col + label.len() > ruler.len() {
            continue;
        }
        for (offset, byte) in label.bytes().enumerate() {
            ruler[local_col + offset] = byte;
        }
    }
    lines.push(format!(
        "      {}",
        String::from_utf8(ruler).expect("rulers are ASCII")
    ));
    for (row, body_row) in body.lines().enumerate() {
        let y_label = y0 as usize + row;
        lines.push(format!("{y_label:3} | {body_row}"));
    }
    Ok(lines.join("\n"))
}

/// Describe the palette slots that appear in a buffer.
///
/// Format: `"legend: "`, then for every slot present in ascending order
/// `<char>=<index> <name>` separated by two spaces, then `.=transparent`.
pub(crate) fn legend(buffer: &IndexedBuffer, palette: &Palette) -> Result<String, ToolError> {
    let mut present: Vec<u8> = buffer
        .data
        .iter()
        .copied()
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    present.sort();
    let mut parts = Vec::new();
    for slot in &present {
        if *slot == 0 {
            continue;
        }
        let ch = slot_char(*slot)?;
        let name = palette
            .slots
            .iter()
            .find(|s| s.index == *slot)
            .map(|s| {
                if let Some(ref n) = s.name {
                    n.clone()
                } else if let (Some(ref ramp), Some(step)) = (&s.ramp, s.step) {
                    format!("{ramp}.{step}")
                } else {
                    format!("slot{}", s.index)
                }
            })
            .unwrap_or_else(|| format!("slot{}", slot));
        parts.push(format!("{ch}={slot} {name}"));
    }
    parts.push(".=transparent".to_string());
    Ok(format!("legend: {}", parts.join("  ")))
}

// ---------------------------------------------------------------------------
// read_canvas
// ---------------------------------------------------------------------------

fn read_canvas_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "layer": { "type": "string" },
            "region": {
                "type": "object",
                "properties": {
                    "x": { "type": "integer", "minimum": 0 },
                    "y": { "type": "integer", "minimum": 0 },
                    "w": { "type": "integer", "minimum": 1 },
                    "h": { "type": "integer", "minimum": 1 }
                },
                "required": ["x", "y", "w", "h"],
                "additionalProperties": false
            },
            "rulers": { "type": "boolean", "default": true }
        },
        "additionalProperties": false
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Region {
    x: u16,
    y: u16,
    w: u16,
    h: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadCanvasArgs {
    asset_id: Option<String>,
    layer: Option<String>,
    region: Option<Region>,
    rulers: Option<bool>,
}

fn read_canvas(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: ReadCanvasArgs = parse(args)?;
    let id = resolve_asset(session, args.asset_id.as_deref())?;
    let show_rulers = args.rulers.unwrap_or(true);
    let role_val = args.layer.as_deref().map(role).transpose()?;
    let region = args.region;
    let (document, buffer) = with_store(host, |store| {
        let document = store.asset_open(id)?;
        let buffer = match role_val {
            Some(r) => store
                .layer_read(id, r)
                .map(|l| l.buffer)
                .unwrap_or_else(|_| {
                    IndexedBuffer::new(document.asset.width, document.asset.height)
                        .expect("asset dimensions are always valid")
                }),
            None => flatten(&document),
        };
        Ok((document, buffer))
    })?;
    let (x, y, w, h) = if let Some(ref region) = region {
        (region.x, region.y, region.w, region.h)
    } else {
        (0, 0, document.asset.width, document.asset.height)
    };
    let cropped = crop(&buffer, x, y, w, h)?;
    let grid_text = render_at(&cropped, x, y, show_rulers)?;
    let lg = legend(&cropped, &document.palette)?;
    let text = format!("{lg}\n\n{grid_text}");
    Ok(json!({
        "text": text,
        "x": x,
        "y": y,
        "width": w,
        "height": h
    }))
}

// ---------------------------------------------------------------------------
// read_region
// ---------------------------------------------------------------------------

fn read_region_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "layer": { "type": "string" },
            "x": { "type": "integer", "minimum": 0 },
            "y": { "type": "integer", "minimum": 0 },
            "w": { "type": "integer", "minimum": 1 },
            "h": { "type": "integer", "minimum": 1 },
            "rulers": { "type": "boolean", "default": true }
        },
        "required": ["x", "y", "w", "h"],
        "additionalProperties": false
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadRegionArgs {
    asset_id: Option<String>,
    layer: Option<String>,
    x: u16,
    y: u16,
    w: u16,
    h: u16,
    rulers: Option<bool>,
}

fn read_region(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: ReadRegionArgs = parse(args)?;
    let id = resolve_asset(session, args.asset_id.as_deref())?;
    let show_rulers = args.rulers.unwrap_or(true);
    let role_val = args.layer.as_deref().map(role).transpose()?;
    let (document, buffer) = with_store(host, |store| {
        let document = store.asset_open(id)?;
        let buffer = match role_val {
            Some(r) => store
                .layer_read(id, r)
                .map(|l| l.buffer)
                .unwrap_or_else(|_| {
                    IndexedBuffer::new(document.asset.width, document.asset.height)
                        .expect("asset dimensions are always valid")
                }),
            None => flatten(&document),
        };
        Ok((document, buffer))
    })?;
    let cropped = crop(&buffer, args.x, args.y, args.w, args.h)?;
    let grid_text = render_at(&cropped, args.x, args.y, show_rulers)?;
    let lg = legend(&cropped, &document.palette)?;
    let text = format!("{lg}\n\n{grid_text}");
    Ok(json!({
        "text": text,
        "x": args.x,
        "y": args.y,
        "width": args.w,
        "height": args.h
    }))
}

// ---------------------------------------------------------------------------
// describe_palette
// ---------------------------------------------------------------------------

fn describe_palette_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" }
        },
        "additionalProperties": false
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DescribePaletteArgs {
    asset_id: Option<String>,
}

fn describe_palette(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: DescribePaletteArgs = parse(args)?;
    let id = resolve_asset(session, args.asset_id.as_deref())?;
    let (palette, document) = with_store(host, |store| {
        let palette = store.palette_read(id)?;
        let document = store.asset_open(id)?;
        Ok((palette, document))
    })?;
    let mut slots_out = Vec::new();
    for slot in &palette.slots {
        let hex = format!(
            "#{:02X}{:02X}{:02X}",
            slot.rgba[0], slot.rgba[1], slot.rgba[2]
        );
        slots_out.push(json!({
            "index": slot.index,
            "char": slot_char(slot.index)?,
            "hex": hex,
            "name": slot.name,
            "ramp": slot.ramp,
            "step": slot.step,
        }));
    }
    // A layer byte with no palette slot cannot legitimately happen: the store
    // refuses to save one. If it does, it is a slot the palette does not hold.
    for layer in &document.layers {
        for &byte in &layer.buffer.data {
            if byte != 0 {
                palette
                    .slot(byte)
                    .map_err(|e| ToolError::from(AppError::from(e)))?;
            }
        }
    }
    let mut ramps_out = Vec::new();
    for ramp in &palette.ramps {
        let mut sorted_slots: Vec<u8> = ramp.slots.clone();
        sorted_slots.sort_by_key(|&idx| {
            let step = palette
                .slots
                .iter()
                .find(|s| s.index == idx)
                .and_then(|s| s.step)
                .unwrap_or(u8::MAX);
            (step, idx)
        });
        ramps_out.push(json!({
            "name": ramp.name,
            "material": ramp.material,
            "slots": sorted_slots,
        }));
    }
    Ok(json!({ "slots": slots_out, "ramps": ramps_out }))
}

// ---------------------------------------------------------------------------
// diff_layers
// ---------------------------------------------------------------------------

fn diff_layers_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": { "type": "string", "format": "uuid" },
            "a": { "type": "string" },
            "b": { "type": "string" },
            "rulers": { "type": "boolean", "default": true }
        },
        "required": ["a", "b"],
        "additionalProperties": false
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiffLayersArgs {
    asset_id: Option<String>,
    a: String,
    b: String,
    rulers: Option<bool>,
}

fn diff_layers(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: DiffLayersArgs = parse(args)?;
    let id = resolve_asset(session, args.asset_id.as_deref())?;
    let role_a = role(&args.a)?;
    let role_b = role(&args.b)?;
    let show_rulers = args.rulers.unwrap_or(true);
    let (document, buf_a, buf_b) = with_store(host, |store| {
        let document = store.asset_open(id)?;
        let trans = || {
            IndexedBuffer::new(document.asset.width, document.asset.height)
                .expect("asset dimensions are always valid")
        };
        let buf_a = store
            .layer_read(document.asset.id, role_a)
            .map(|l| l.buffer)
            .unwrap_or_else(|_| trans());
        let buf_b = store
            .layer_read(document.asset.id, role_b)
            .map(|l| l.buffer)
            .unwrap_or_else(|_| trans());
        Ok((document, buf_a, buf_b))
    })?;
    let width = document.asset.width;
    let height = document.asset.height;
    let mut diff_buf =
        IndexedBuffer::new(width, height).expect("asset dimensions are always valid");
    let mut differing: u32 = 0;
    for i in 0..buf_a.data.len() {
        if buf_a.data[i] == buf_b.data[i] {
            diff_buf.data[i] = 0;
        } else {
            diff_buf.data[i] = 1;
            differing += 1;
        }
    }
    let mut lines = Vec::new();
    if show_rulers {
        let mut ruler = vec![b' '; width as usize];
        for col in (0..width as usize).step_by(5) {
            let label = col.to_string();
            for (offset, byte) in label.bytes().enumerate() {
                if col + offset < ruler.len() {
                    ruler[col + offset] = byte;
                }
            }
        }
        lines.push(format!(
            "      {}",
            String::from_utf8(ruler).expect("rulers are ASCII")
        ));
    }
    for row in 0..height as usize {
        let body: String = diff_buf
            .data
            .chunks(width as usize)
            .nth(row)
            .unwrap()
            .iter()
            .map(|&b| if b == 1 { 'X' } else { '=' })
            .collect();
        if show_rulers {
            lines.push(format!("{row:3} | {body}"));
        } else {
            lines.push(body);
        }
    }
    let text = lines.join("\n");
    Ok(json!({ "text": text, "differing": differing }))
}

pub fn tools() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "read_canvas",
            description: "Read a layer, or the flattened sprite, as a text grid with a legend and rulers. Rulers show real canvas coordinates. Read after every few writes: seeing what you drew is how you catch mistakes.",
            input_schema: read_canvas_schema,
            handler: read_canvas,
        },
        ToolSpec {
            name: "read_region",
            description: "The same as read_canvas for a rectangle, for canvases too large to read whole.",
            input_schema: read_region_schema,
            handler: read_region,
        },
        ToolSpec {
            name: "describe_palette",
            description: "Every palette slot with its grid character, hex, ramp and position in the ramp, and every ramp darkest first. Read this to know what stepping a slot up or down means.",
            input_schema: describe_palette_schema,
            handler: describe_palette,
        },
        ToolSpec {
            name: "diff_layers",
            description: "Where two layers disagree, as a grid of = and X. The cheap way to check, say, that the outline stayed inside the silhouette.",
            input_schema: diff_layers_schema,
            handler: diff_layers,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::host::HeadlessHost;
    use crate::mcp::session::Session;
    use crate::raster::{
        palette::{Material, PaletteSlot, Ramp},
        Op,
    };
    use crate::store::{AssetId, Store};
    use serde_json::json;

    fn setup() -> (HeadlessHost, Session) {
        let host = HeadlessHost::new(Store::memory().unwrap());
        let session = Session::new("t");
        (host, session)
    }

    fn create_asset(host: &HeadlessHost) -> AssetId {
        let arc = host.store();
        let mut store = arc.lock().unwrap();
        let project = store.project_create("P", "hd2d").unwrap();
        let asset = store
            .asset_create(project.id, "Hero", "character", 8, 8)
            .unwrap();
        store
            .palette_write(
                asset.id,
                Palette {
                    slots: vec![
                        PaletteSlot {
                            index: 1,
                            rgba: [255, 0, 0, 255],
                            name: Some("red".into()),
                            ramp: None,
                            step: None,
                        },
                        PaletteSlot {
                            index: 2,
                            rgba: [0, 255, 0, 255],
                            name: Some("green".into()),
                            ramp: None,
                            step: None,
                        },
                        PaletteSlot {
                            index: 3,
                            rgba: [0, 0, 255, 255],
                            name: Some("blue".into()),
                            ramp: None,
                            step: None,
                        },
                    ],
                    ramps: vec![],
                },
            )
            .unwrap();
        asset.id
    }

    fn set_pixel(store: &mut Store, asset_id: AssetId, role: &str, x: i32, y: i32, slot: u8) {
        use crate::raster::LayerRole;
        store
            .write_ops(
                asset_id,
                vec![Op::SetPixels {
                    layer: LayerRole::parse(role).unwrap(),
                    pixels: vec![bitwright::raster::ops::Pixel { x, y, slot }],
                }],
                "user",
            )
            .unwrap();
    }

    #[test]
    fn composite_puts_higher_ordinal_over_lower() {
        let (host, session) = setup();
        let id = create_asset(&host);
        session.set_current_asset(id);
        {
            let arc = host.store();
            let mut store = arc.lock().unwrap();
            set_pixel(&mut store, id, "flats", 0, 0, 1);
            set_pixel(&mut store, id, "outline", 0, 0, 2);
        }
        let result = super::read_canvas(&host, &session, json!({ "rulers": false })).unwrap();
        let text = result["text"].as_str().unwrap();
        let first_data_line = text
            .lines()
            .find(|l| !l.starts_with("legend") && !l.is_empty())
            .unwrap();
        assert_eq!(
            first_data_line.chars().next().unwrap(),
            'B',
            "outline (B) should be over flats (A) at (0,0): {first_data_line}"
        );
    }

    #[test]
    fn invisible_layer_is_skipped() {
        let (host, session) = setup();
        let id = create_asset(&host);
        session.set_current_asset(id);
        {
            let arc = host.store();
            let mut store = arc.lock().unwrap();
            set_pixel(&mut store, id, "flats", 0, 0, 1);
            let mut layer = store
                .layer_read(id, crate::raster::LayerRole::parse("flats").unwrap())
                .unwrap();
            layer.visible = false;
            store.layer_write(id, layer).unwrap();
        }
        let result = super::read_canvas(&host, &session, json!({ "rulers": false })).unwrap();
        let text = result["text"].as_str().unwrap();
        let first_data_line = text
            .lines()
            .find(|l| !l.starts_with("legend") && !l.is_empty())
            .unwrap();
        assert_eq!(
            first_data_line.chars().next().unwrap(),
            '.',
            "invisible flats layer should show transparent at (0,0): {first_data_line}"
        );
    }

    #[test]
    fn single_layer_read() {
        let (host, session) = setup();
        let id = create_asset(&host);
        session.set_current_asset(id);
        {
            let arc = host.store();
            let mut store = arc.lock().unwrap();
            set_pixel(&mut store, id, "flats", 0, 0, 1);
            set_pixel(&mut store, id, "outline", 0, 0, 2);
        }
        let result = super::read_canvas(
            &host,
            &session,
            json!({ "layer": "flats", "rulers": false }),
        )
        .unwrap();
        let text = result["text"].as_str().unwrap();
        let first_data_line = text
            .lines()
            .find(|l| !l.starts_with("legend") && !l.is_empty())
            .unwrap();
        assert_eq!(
            first_data_line.chars().next().unwrap(),
            'A',
            "single flats layer read should show A at (0,0): {first_data_line}"
        );
    }

    #[test]
    fn region_rulers_and_row_labels_start_at_corner() {
        let (host, session) = setup();
        let id = create_asset(&host);
        session.set_current_asset(id);
        {
            let arc = host.store();
            let mut store = arc.lock().unwrap();
            set_pixel(&mut store, id, "flats", 3, 5, 1);
        }
        let result = super::read_canvas(
            &host,
            &session,
            json!({ "region": { "x": 3, "y": 5, "w": 3, "h": 2 }, "rulers": true }),
        )
        .unwrap();
        let text = result["text"].as_str().unwrap();
        let lines: Vec<&str> = text.lines().collect();
        let ruler_line = lines.iter().find(|l| l.starts_with("      ")).unwrap();
        assert!(
            ruler_line.contains("5"),
            "ruler should contain column 5: {ruler_line}"
        );
        let data_line = lines
            .iter()
            .find(|l| l.starts_with("  5 |"))
            .expect("row label 5 should be present");
        let body = data_line.split(" | ").nth(1).unwrap();
        assert_eq!(
            body.chars().next().unwrap(),
            'A',
            "pixel at (3,5) should be A in cropped region"
        );
    }

    #[test]
    fn legend_lists_only_present_slots_and_ends_with_transparent() {
        let (host, session) = setup();
        let id = create_asset(&host);
        session.set_current_asset(id);
        {
            let arc = host.store();
            let mut store = arc.lock().unwrap();
            set_pixel(&mut store, id, "flats", 0, 0, 1);
            set_pixel(&mut store, id, "flats", 1, 0, 3);
        }
        let result = super::read_canvas(&host, &session, json!({ "rulers": false })).unwrap();
        let text = result["text"].as_str().unwrap();
        let legend_line = text.lines().next().unwrap();
        assert!(
            legend_line.starts_with("legend: "),
            "should start with 'legend: ': {legend_line}"
        );
        assert!(
            legend_line.contains("A=1 red"),
            "legend should contain A=1 red: {legend_line}"
        );
        assert!(
            legend_line.contains("C=3 blue"),
            "legend should contain C=3 blue: {legend_line}"
        );
        assert!(
            !legend_line.contains("B=2"),
            "legend should not contain B=2: {legend_line}"
        );
        assert!(
            legend_line.ends_with("=transparent"),
            "legend should end with .=transparent: {legend_line}"
        );
    }

    #[test]
    fn bounds_outside_when_region_extends_past_canvas() {
        let (host, session) = setup();
        let id = create_asset(&host);
        session.set_current_asset(id);
        let err = super::read_canvas(
            &host,
            &session,
            json!({ "region": { "x": 7, "y": 0, "w": 2, "h": 1 } }),
        )
        .unwrap_err();
        assert_eq!(err.code, "bounds.outside");
    }

    #[test]
    fn bounds_outside_when_width_or_height_is_zero() {
        let (host, session) = setup();
        let id = create_asset(&host);
        session.set_current_asset(id);
        let err = super::read_canvas(
            &host,
            &session,
            json!({ "region": { "x": 0, "y": 0, "w": 0, "h": 1 } }),
        )
        .unwrap_err();
        assert_eq!(err.code, "bounds.outside");
    }

    #[test]
    fn rulers_false_returns_bare_rows() {
        let (host, session) = setup();
        let id = create_asset(&host);
        session.set_current_asset(id);
        {
            let arc = host.store();
            let mut store = arc.lock().unwrap();
            set_pixel(&mut store, id, "flats", 0, 0, 1);
        }
        let result = super::read_canvas(&host, &session, json!({ "rulers": false })).unwrap();
        let text = result["text"].as_str().unwrap();
        assert!(
            !text.lines().any(|l| l.starts_with("      ")),
            "should not have ruler line when rulers=false"
        );
        let data_lines: Vec<&str> = text
            .lines()
            .filter(|l| !l.starts_with("legend") && !l.is_empty())
            .collect();
        for line in &data_lines {
            assert!(
                !line.contains(" | "),
                "bare rows should not have ' | ': {line}"
            );
        }
    }

    /// The catalogue says rulers are on by default "because a model counting
    /// unaided to column 37 on row 41 will miss". A grid with rulers has a
    /// column-ruler line (six leading spaces) and `NNN | ` row labels.
    fn assert_rulers_present(text: &str, ctx: &str) {
        assert!(
            text.lines().any(|l| l.starts_with("      ")),
            "rulers must default to on, no column ruler line in: {text}\n({ctx})"
        );
        assert!(
            text.contains("  0 | "),
            "rulers must default to on, no row label in: {text}\n({ctx})"
        );
    }

    fn assert_rulers_absent(text: &str, ctx: &str) {
        assert!(
            !text.lines().any(|l| l.starts_with("      ")),
            "rulers=false must drop the column ruler line: {text}\n({ctx})"
        );
        assert!(
            !text.contains(" | "),
            "rulers=false must drop the row labels: {text}\n({ctx})"
        );
    }

    #[test]
    fn read_canvas_defaults_to_rulers_on() {
        let (host, session) = setup();
        let id = create_asset(&host);
        session.set_current_asset(id);
        {
            let arc = host.store();
            let mut store = arc.lock().unwrap();
            set_pixel(&mut store, id, "flats", 0, 0, 1);
        }
        let with_default = super::read_canvas(&host, &session, json!({})).unwrap();
        assert_rulers_present(with_default["text"].as_str().unwrap(), "read_canvas");

        let explicit_off = super::read_canvas(&host, &session, json!({ "rulers": false })).unwrap();
        assert_rulers_absent(explicit_off["text"].as_str().unwrap(), "read_canvas");
    }

    #[test]
    fn read_region_defaults_to_rulers_on() {
        let (host, session) = setup();
        let id = create_asset(&host);
        session.set_current_asset(id);
        {
            let arc = host.store();
            let mut store = arc.lock().unwrap();
            set_pixel(&mut store, id, "flats", 0, 0, 1);
        }
        let with_default =
            super::read_region(&host, &session, json!({ "x": 0, "y": 0, "w": 4, "h": 2 })).unwrap();
        assert_rulers_present(with_default["text"].as_str().unwrap(), "read_region");

        let explicit_off = super::read_region(
            &host,
            &session,
            json!({ "x": 0, "y": 0, "w": 4, "h": 2, "rulers": false }),
        )
        .unwrap();
        assert_rulers_absent(explicit_off["text"].as_str().unwrap(), "read_region");
    }

    #[test]
    fn diff_layers_defaults_to_rulers_on() {
        let (host, session) = setup();
        let id = create_asset(&host);
        session.set_current_asset(id);
        {
            let arc = host.store();
            let mut store = arc.lock().unwrap();
            set_pixel(&mut store, id, "flats", 0, 0, 1);
            set_pixel(&mut store, id, "outline", 0, 0, 2);
        }
        let with_default =
            super::diff_layers(&host, &session, json!({ "a": "flats", "b": "outline" })).unwrap();
        assert_rulers_present(with_default["text"].as_str().unwrap(), "diff_layers");
        assert_eq!(with_default["differing"], 1);

        let explicit_off = super::diff_layers(
            &host,
            &session,
            json!({ "a": "flats", "b": "outline", "rulers": false }),
        )
        .unwrap();
        assert_rulers_absent(explicit_off["text"].as_str().unwrap(), "diff_layers");
        assert_eq!(explicit_off["differing"], 1);
    }

    #[test]
    fn every_read_schema_advertises_the_rulers_default() {
        for schema in [
            super::read_canvas_schema(),
            super::read_region_schema(),
            super::diff_layers_schema(),
        ] {
            assert_eq!(
                schema["properties"]["rulers"]["default"],
                serde_json::json!(true),
                "the rulers property must advertise its default: {schema}"
            );
        }
    }

    #[test]
    fn read_region_requires_x_y_w_h() {
        let (host, session) = setup();
        let id = create_asset(&host);
        session.set_current_asset(id);
        let err = super::read_region(&host, &session, json!({ "x": 0, "y": 0 })).unwrap_err();
        assert_eq!(err.code, "args.invalid");
    }
    fn create_asset_with_ramps(host: &HeadlessHost) -> AssetId {
        let arc = host.store();
        let mut store = arc.lock().unwrap();
        let project = store.project_create("P", "hd2d").unwrap();
        let asset = store
            .asset_create(project.id, "Hero", "character", 8, 8)
            .unwrap();
        store
            .palette_write(
                asset.id,
                Palette {
                    slots: vec![
                        PaletteSlot {
                            index: 1,
                            rgba: [30, 0, 0, 255],
                            name: None,
                            ramp: Some("skin".into()),
                            step: Some(0),
                        },
                        // A ramp member with no step metadata: the tool must
                        // sort it after the stepped slots, not echo the stored
                        // order, so this fails if the sort is removed.
                        PaletteSlot {
                            index: 2,
                            rgba: [60, 30, 0, 255],
                            name: None,
                            ramp: None,
                            step: None,
                        },
                        PaletteSlot {
                            index: 3,
                            rgba: [120, 60, 30, 255],
                            name: None,
                            ramp: Some("skin".into()),
                            step: Some(2),
                        },
                        PaletteSlot {
                            index: 4,
                            rgba: [10, 10, 40, 255],
                            name: None,
                            ramp: Some("cloth".into()),
                            step: Some(0),
                        },
                        PaletteSlot {
                            index: 5,
                            rgba: [30, 30, 90, 255],
                            name: None,
                            ramp: Some("cloth".into()),
                            step: Some(1),
                        },
                    ],
                    // The skin ramp lists slot 2, which carries no step, in the
                    // middle of its stored order. Sorting darkest first moves it
                    // to the end, so this fails if the sort is removed.
                    ramps: vec![
                        Ramp {
                            name: "cloth".into(),
                            material: Material::Cloth,
                            slots: vec![4, 5],
                        },
                        Ramp {
                            name: "skin".into(),
                            material: Material::Skin,
                            slots: vec![1, 2, 3],
                        },
                    ],
                },
            )
            .unwrap();
        asset.id
    }

    #[test]
    fn describe_palette_returns_hex_and_char_and_ramps_darkest_first() {
        let (host, session) = setup();
        let id = create_asset_with_ramps(&host);
        session.set_current_asset(id);
        let result = super::describe_palette(&host, &session, json!({})).unwrap();
        let slots = result["slots"].as_array().unwrap();
        // One entry per palette slot, in palette order.
        let skin_slot = slots.iter().find(|s| s["index"] == 1).unwrap();
        assert_eq!(skin_slot["char"], "A");
        assert_eq!(skin_slot["hex"], "#1E0000");
        assert_eq!(skin_slot["ramp"], "skin");
        assert_eq!(skin_slot["step"], 0);
        let cloth_slot = slots.iter().find(|s| s["index"] == 4).unwrap();
        assert_eq!(cloth_slot["hex"], "#0A0A28");

        let ramps = result["ramps"].as_array().unwrap();
        let skin_ramp = ramps.iter().find(|r| r["name"] == "skin").unwrap();
        let skin_slots = skin_ramp["slots"].as_array().unwrap();
        // Darkest first: step 0 (index 1), step 2 (index 3), then the slot with
        // no step (index 2). The ramp is stored as [1, 2, 3], so this fails if
        // the sort is removed.
        assert_eq!(skin_slots, &vec![json!(1), json!(3), json!(2)]);

        let cloth_ramp = ramps.iter().find(|r| r["name"] == "cloth").unwrap();
        let cloth_slots = cloth_ramp["slots"].as_array().unwrap();
        // step 0 (index 4) before step 1 (index 5).
        assert_eq!(cloth_slots, &vec![json!(4), json!(5)]);
    }

    #[test]
    fn diff_layers_shows_three_x_for_three_differing_pixels() {
        let (host, session) = setup();
        let id = create_asset(&host);
        session.set_current_asset(id);
        {
            let arc = host.store();
            let mut store = arc.lock().unwrap();
            // Put slot 1 on flats at (0,0), (1,0), (2,0)
            set_pixel(&mut store, id, "flats", 0, 0, 1);
            set_pixel(&mut store, id, "flats", 1, 0, 1);
            set_pixel(&mut store, id, "flats", 2, 0, 1);
            // Put slot 2 on outline at (0,0), (1,0), (2,0)
            set_pixel(&mut store, id, "outline", 0, 0, 2);
            set_pixel(&mut store, id, "outline", 1, 0, 2);
            set_pixel(&mut store, id, "outline", 2, 0, 2);
        }
        let result = super::diff_layers(
            &host,
            &session,
            json!({ "a": "flats", "b": "outline", "rulers": false }),
        )
        .unwrap();
        assert_eq!(result["differing"], 3);
        let text = result["text"].as_str().unwrap();
        let x_count = text.chars().filter(|&c| c == 'X').count();
        assert_eq!(x_count, 3, "expected 3 X marks in: {text}");
    }

    #[test]
    fn diff_layers_unknown_role_returns_layer_unknown_role() {
        let (host, session) = setup();
        let id = create_asset(&host);
        session.set_current_asset(id);
        let err = super::diff_layers(
            &host,
            &session,
            json!({ "a": "flats", "b": "background", "rulers": false }),
        )
        .unwrap_err();
        assert_eq!(err.code, "layer.unknown_role");
    }

    #[test]
    fn read_canvas_missing_layer_reads_transparent() {
        let (host, session) = setup();
        let id = create_asset(&host);
        session.set_current_asset(id);
        {
            let arc = host.store();
            let mut store = arc.lock().unwrap();
            set_pixel(&mut store, id, "flats", 0, 0, 1);
            store
                .layer_delete(id, crate::raster::LayerRole::parse("flats").unwrap())
                .unwrap();
        }
        let result = super::read_canvas(
            &host,
            &session,
            json!({ "layer": "flats", "rulers": false }),
        )
        .unwrap();
        let text = result["text"].as_str().unwrap();
        let first_data_line = text
            .lines()
            .find(|l| !l.starts_with("legend") && !l.is_empty())
            .unwrap();
        assert_eq!(
            first_data_line.chars().next().unwrap(),
            '.',
            "a valid role with no layer should read as transparent: {first_data_line}"
        );
    }

    #[test]
    fn read_region_missing_layer_reads_transparent() {
        let (host, session) = setup();
        let id = create_asset(&host);
        session.set_current_asset(id);
        {
            let arc = host.store();
            let mut store = arc.lock().unwrap();
            set_pixel(&mut store, id, "flats", 0, 0, 1);
            store
                .layer_delete(id, crate::raster::LayerRole::parse("flats").unwrap())
                .unwrap();
        }
        let result = super::read_region(
            &host,
            &session,
            json!({ "layer": "flats", "x": 0, "y": 0, "w": 2, "h": 2, "rulers": false }),
        )
        .unwrap();
        let text = result["text"].as_str().unwrap();
        let first_data_line = text
            .lines()
            .find(|l| !l.starts_with("legend") && !l.is_empty())
            .unwrap();
        assert_eq!(
            first_data_line.chars().next().unwrap(),
            '.',
            "a valid role with no layer should read as transparent: {first_data_line}"
        );
    }

    /// A label that does not fit the region is not drawn at all: a clipped "1"
    /// standing for column 15 reads back as column 1.
    #[test]
    fn ruler_labels_are_never_clipped() {
        let ruler = |x0: u16, width: u16| {
            let buffer = IndexedBuffer::new(width, 1).unwrap();
            render_at(&buffer, x0, 0, true)
                .unwrap()
                .lines()
                .next()
                .unwrap()
                .trim_end()
                .to_string()
        };
        // Columns 0, 5 and 10 fit; column 15 needs two cells and only one is
        // left, so the whole label is dropped rather than drawn as "1".
        assert_eq!(ruler(0, 16), "      0    5    10");
        assert_eq!(ruler(0, 17), "      0    5    10   15");
        // The same rule applies to a region, whose labels are canvas columns:
        // canvas column 15 starts at local offset 5 of a 6-wide region.
        assert_eq!(ruler(10, 6), "      10");
    }

    #[test]
    fn crop_rejects_region_that_overflows_u16() {
        // A 65535-wide canvas: x + w overflows u16, so a saturating check would
        // let the copy index past the end of the data.
        let buffer = IndexedBuffer::new(65535, 1).unwrap();
        let err = crop(&buffer, 65535, 0, 1, 1).unwrap_err();
        assert_eq!(err.code, "bounds.outside");

        let tall = IndexedBuffer::new(1, 65535).unwrap();
        let err = crop(&tall, 0, 65535, 1, 1).unwrap_err();
        assert_eq!(err.code, "bounds.outside");
    }
}
