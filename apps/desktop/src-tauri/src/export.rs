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

//! Export: an explicit "Save As" that writes PNG and GIF files into a folder.
//!
//! Saving inside the document is continuous and never touches the disk as a
//! file; exporting is the one place a sprite, a sheet or an animation leaves
//! the database as a file a person can hand to an engine. An agent exporting through MCP
//! cannot name a folder, so its files always land under the exports folder
//! beneath the data root, which keeps a tool call from ever writing anywhere
//! else on disk.

use std::borrow::Cow;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::commands::{document::DocumentState, CommandError};
use crate::preferences;
use crate::raster::{self, RgbaImage};
use crate::store::{AppError, AssetId, Store};

/// Neither an asset render nor a sheet may exceed this on either side.
const MAX_EXPORT_SIDE: u32 = 8192;

/// The longest file stem export writes, before the `.png` or `.gif` extension.
const MAX_STEM_CHARS: usize = 120;

/// Windows reserves these names regardless of extension or case. `CONIN$`
/// and `CONOUT$` are reserved device names alongside `CON`; the superscript
/// forms of `COM1..3` and `LPT1..3` (`COM¹`, `COM²`, `COM³`, `LPT¹`, `LPT²`,
/// `LPT³`) are also reserved — Windows accepts the Unicode superscript
/// digits as equivalent to the ASCII ones for these names.
const RESERVED_NAMES: [&str; 30] = [
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "CONIN$",
    "CONOUT$",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "COM\u{b9}",
    "COM\u{b2}",
    "COM\u{b3}",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
    "LPT\u{b9}",
    "LPT\u{b2}",
    "LPT\u{b3}",
];

/// What an export command hands back: where the file landed and its size.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub width: u32,
    pub height: u32,
}

/// Turns a store error into the shape the frontend expects.
fn app_failed(error: AppError) -> CommandError {
    CommandError::new(error.code, error.detail)
}

/// Turns a raster error (from encoding) into the shape the frontend expects.
fn raster_failed(error: raster::RasterError) -> CommandError {
    CommandError::new(error.code, error.detail)
}

/// Replaces every path separator, reserved character and control character
/// with `_`, then trims spaces and dots from both ends.
fn sanitize(text: &str) -> String {
    let replaced: String = text
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    replaced
        .trim_matches(|c: char| c == ' ' || c == '.')
        .to_string()
}

/// Builds a safe file name from a pattern, substituting `{project}`,
/// `{asset}`, `{kind}` and `{scale}`.
///
/// # Errors
///
/// Returns `export.invalid_pattern` when the pattern is empty, or empty
/// after substitution and sanitizing.
pub fn file_name(
    pattern: &str,
    project: &str,
    asset: &str,
    kind: &str,
    scale: u8,
) -> Result<String, CommandError> {
    named(pattern, project, asset, kind, scale, ".png")
}

/// [`file_name`] for a GIF: the same substitution and the same safety rules,
/// ending in `.gif` instead of `.png`.
///
/// # Errors
///
/// Returns `export.invalid_pattern` as [`file_name`] does.
pub fn gif_file_name(
    pattern: &str,
    project: &str,
    asset: &str,
    kind: &str,
    scale: u8,
) -> Result<String, CommandError> {
    named(pattern, project, asset, kind, scale, ".gif")
}

/// The body of [`file_name`] and [`gif_file_name`]; `extension` is a dot and
/// three lower-case ASCII letters.
fn named(
    pattern: &str,
    project: &str,
    asset: &str,
    kind: &str,
    scale: u8,
    extension: &str,
) -> Result<String, CommandError> {
    let replaced = pattern
        .replace("{project}", project)
        .replace("{asset}", asset)
        .replace("{kind}", kind)
        .replace("{scale}", &scale.to_string());
    let safe = sanitize(&replaced);
    if safe.is_empty() {
        return Err(CommandError::new(
            "export.invalid_pattern",
            "the export file name pattern is empty",
        ));
    }

    // `ends_with` compares bytes without requiring `safe.len() - 4` to be a
    // char boundary, so this cannot panic on a name that ends in a
    // multi-byte character (an asset named entirely in, say, Japanese has no
    // ASCII ".png" tail to match). A match does prove the last four bytes
    // are the single-byte ASCII characters of ".png" or ".PNG", since a
    // UTF-8 continuation or lead byte always has its high bit set and so can
    // never equal one of those bytes after ASCII-lowercasing — only then is
    // slicing at `len() - 4` known to land on a char boundary.
    let has_extension = safe.to_ascii_lowercase().ends_with(extension);
    let (mut stem, kept) = if has_extension {
        let split = safe.len() - extension.len();
        (safe[..split].to_string(), safe[split..].to_string())
    } else {
        (safe, String::new())
    };

    if is_reserved(&stem) {
        stem = format!("_{stem}");
    }
    if stem.chars().count() > MAX_STEM_CHARS {
        stem = stem.chars().take(MAX_STEM_CHARS).collect();
    }

    Ok(if kept.is_empty() {
        format!("{stem}{extension}")
    } else {
        format!("{stem}{kept}")
    })
}

/// Windows reserves a name by what comes before its first `.`, regardless of
/// any extension: `CON.txt` and `aux.foo` are both off limits, not only
/// `CON` and `AUX` alone.
fn is_reserved(stem: &str) -> bool {
    let name = stem.split('.').next().unwrap_or("");
    let trimmed = name.trim_end_matches(' ');
    RESERVED_NAMES.contains(&trimmed.to_uppercase().as_str())
}

/// Turns a project's name and id into a safe, unique folder name, the same
/// way [`file_name`] turns a pattern into a safe file name: separators and
/// control characters become `_`, spaces and dots are trimmed from both
/// ends, a Windows-reserved stem is escaped, and the sanitised name is
/// capped at [`MAX_STEM_CHARS`].
///
/// An agent driving the MCP tools never names a folder directly — only an
/// asset or a project, both of which flow through here — so this is what
/// keeps a project called `../../evil` (or, once trimmed, nothing at all)
/// from landing anywhere outside the exports root. The name alone is not
/// enough to keep two projects apart, though: sanitising can collapse two
/// different names onto the same text (`a/b` and `a:b` both become `a_b`),
/// and on a case-insensitive filesystem so can two names that only differ in
/// case (`Demo` and `demo`). Appending the project id's *last* 8 hex
/// characters keeps every project's folder distinct regardless — the last
/// characters, not the first: a v7 id's leading bits are its millisecond
/// timestamp, so two projects created within the same ~65 seconds would
/// otherwise share the same 8-character prefix. The trailing characters are
/// the id's random tail, which does not repeat that way.
pub(crate) fn safe_folder_name(project: &str, id: Uuid) -> String {
    let mut safe = sanitize(project);
    if safe.is_empty() {
        safe = "project".to_string();
    }
    if is_reserved(&safe) {
        safe = format!("_{safe}");
    }
    if safe.chars().count() > MAX_STEM_CHARS {
        safe = safe.chars().take(MAX_STEM_CHARS).collect();
    }
    let suffix = &id.simple().to_string()[24..];
    format!("{safe}-{suffix}")
}

/// Scales an image by an integer factor using nearest-neighbour sampling.
///
/// # Errors
///
/// Returns `export.invalid_scale` when `scale` is outside `1..=16`, or when
/// the scaled image would exceed [`MAX_EXPORT_SIDE`] on either side.
pub fn scaled(image: &RgbaImage, scale: u8) -> Result<RgbaImage, CommandError> {
    let (width, height) = scaled_size(image.width, image.height, scale)?;
    let factor = u32::from(scale);

    let source_width = usize::from(image.width);
    let mut data = vec![0u8; (width as usize) * (height as usize) * 4];
    for y in 0..height {
        let source_y = (y / factor) as usize;
        for x in 0..width {
            let source_x = (x / factor) as usize;
            let source_index = (source_y * source_width + source_x) * 4;
            let dest_index = (y as usize * width as usize + x as usize) * 4;
            data[dest_index..dest_index + 4]
                .copy_from_slice(&image.data[source_index..source_index + 4]);
        }
    }

    Ok(RgbaImage {
        width: width as u16,
        height: height as u16,
        data,
    })
}

/// The size of a `width` x `height` image scaled by `scale`.
///
/// # Errors
///
/// Returns `export.invalid_scale` when `scale` is outside `1..=16`, or when
/// the scaled image would exceed [`MAX_EXPORT_SIDE`] on either side.
fn scaled_size(width: u16, height: u16, scale: u8) -> Result<(u32, u32), CommandError> {
    if !(1..=16).contains(&scale) {
        return Err(CommandError::new(
            "export.invalid_scale",
            format!("scale {scale} is outside 1..=16"),
        ));
    }
    let factor = u32::from(scale);
    let width = u32::from(width) * factor;
    let height = u32::from(height) * factor;
    if width > MAX_EXPORT_SIDE || height > MAX_EXPORT_SIDE {
        return Err(CommandError::new(
            "export.invalid_scale",
            format!("the scaled image {width}x{height} exceeds {MAX_EXPORT_SIDE}px a side"),
        ));
    }
    Ok((width, height))
}

/// The raw, unscaled render of an asset: a background's tilemap, or any
/// other kind's layer composite.
fn render_kind(store: &Store, asset: AssetId) -> Result<RgbaImage, CommandError> {
    let record = store.asset_read(asset).map_err(app_failed)?;
    if record.kind == "background" {
        store.tilemap_render(asset, None).map_err(app_failed)
    } else {
        store.asset_composite(asset).map_err(app_failed)
    }
}

/// An asset's render at `scale`: a background's tilemap render, any other
/// kind's layer composite.
///
/// # Errors
///
/// Returns the store's reason code when the asset is missing, and
/// `export.invalid_scale` from [`scaled`].
pub fn render_asset(store: &Store, asset: AssetId, scale: u8) -> Result<RgbaImage, CommandError> {
    let image = render_kind(store, asset)?;
    scaled(&image, scale)
}

/// Several assets of the same size, laid left to right and top to bottom in
/// `columns` columns, in order, then scaled together.
///
/// # Errors
///
/// Returns `export.empty` with no assets, `export.mixed_sizes` when the
/// assets are not all the same size, and `export.invalid_scale` when the
/// (scaled) sheet would exceed [`MAX_EXPORT_SIDE`] on either side.
pub fn render_sheet(
    store: &Store,
    assets: &[AssetId],
    columns: u16,
    scale: u8,
) -> Result<RgbaImage, CommandError> {
    if assets.is_empty() {
        return Err(CommandError::new(
            "export.empty",
            "no assets to lay out in a sheet",
        ));
    }

    // The first tile alone tells us the (scaled) sheet's size, since every
    // other tile must match it or the layout is refused anyway. Checking
    // that size now — before rendering the rest of the assets or allocating
    // the sheet's buffer — means a huge `columns`/asset count is refused
    // cheaply instead of after doing all that work.
    let first = render_kind(store, assets[0])?;
    check_sheet_bounds(first.width, first.height, assets.len(), columns, scale)?;

    let mut tiles = Vec::with_capacity(assets.len());
    tiles.push(first);
    for &asset in &assets[1..] {
        tiles.push(render_kind(store, asset)?);
    }
    compose_sheet(&tiles, columns, scale)
}

/// Checks that a sheet built from `count` tiles of `tile_width` x
/// `tile_height`, laid out in `columns` columns and scaled by `scale`, will
/// not exceed [`MAX_EXPORT_SIDE`] on either side — entirely in 64-bit
/// arithmetic, so a large tile, column count or scale cannot wrap before the
/// check runs.
///
/// # Errors
///
/// Returns `export.invalid_scale` when `scale` is outside `1..=16`, or when
/// the scaled sheet would exceed [`MAX_EXPORT_SIDE`] on either side.
fn check_sheet_bounds(
    tile_width: u16,
    tile_height: u16,
    count: usize,
    columns: u16,
    scale: u8,
) -> Result<(), CommandError> {
    if !(1..=16).contains(&scale) {
        return Err(CommandError::new(
            "export.invalid_scale",
            format!("scale {scale} is outside 1..=16"),
        ));
    }
    let count = count.max(1) as u64;
    let columns = u64::from(columns).clamp(1, count);
    let rows = count.div_ceil(columns);
    let factor = u64::from(scale);
    let width = u64::from(tile_width) * columns * factor;
    let height = u64::from(tile_height) * rows * factor;
    if width > u64::from(MAX_EXPORT_SIDE) || height > u64::from(MAX_EXPORT_SIDE) {
        return Err(CommandError::new(
            "export.invalid_scale",
            format!("the scaled sheet {width}x{height} exceeds {MAX_EXPORT_SIDE}px a side"),
        ));
    }
    Ok(())
}

/// Lays `tiles` (all the same size, at scale 1) left to right and top to
/// bottom in `columns` columns, in order, then scales the sheet.
///
/// Callers that render tiles from a store should call
/// [`check_sheet_bounds`] first; by the time this runs the casts below are
/// already known to fit, since they describe the same tile size, count and
/// column layout that call just proved fits within [`MAX_EXPORT_SIDE`].
///
/// # Errors
///
/// Returns `export.mixed_sizes` when the tiles are not all the same size,
/// and `export.invalid_scale` from [`scaled`].
fn compose_sheet(tiles: &[RgbaImage], columns: u16, scale: u8) -> Result<RgbaImage, CommandError> {
    let tile_width = tiles[0].width;
    let tile_height = tiles[0].height;
    if tiles
        .iter()
        .any(|tile| tile.width != tile_width || tile.height != tile_height)
    {
        return Err(CommandError::new(
            "export.mixed_sizes",
            "every asset in a sheet must share one size",
        ));
    }

    let columns = (columns as usize).clamp(1, tiles.len()) as u32;
    let rows = (tiles.len() as u32).div_ceil(columns);
    let sheet_width = u32::from(tile_width) * columns;
    let sheet_height = u32::from(tile_height) * rows;
    let tile_width = usize::from(tile_width);
    let tile_height = usize::from(tile_height);

    let mut data = vec![0u8; (sheet_width as usize) * (sheet_height as usize) * 4];
    for (index, tile) in tiles.iter().enumerate() {
        let column = index as u32 % columns;
        let row = index as u32 / columns;
        let origin_x = (column * tile_width as u32) as usize;
        let origin_y = (row * tile_height as u32) as usize;
        let row_bytes = tile_width * 4;
        for y in 0..tile_height {
            let dest_start = ((origin_y + y) * sheet_width as usize + origin_x) * 4;
            let source_start = y * row_bytes;
            data[dest_start..dest_start + row_bytes]
                .copy_from_slice(&tile.data[source_start..source_start + row_bytes]);
        }
    }

    let sheet = RgbaImage {
        width: sheet_width as u16,
        height: sheet_height as u16,
        data,
    };
    scaled(&sheet, scale)
}

/// Every asset a sheet lays out, in order: an asset that belongs to an
/// animation of more than one frame (its root or any other frame) stands for
/// all of that animation's frames in position order, so "a sheet of this
/// animation" is one id rather than a list the caller has to keep in step
/// with the timeline. A lone asset stands for itself.
///
/// # Errors
///
/// Returns the store's reason code when an asset is missing.
pub fn sheet_assets(store: &Store, ids: &[AssetId]) -> Result<Vec<AssetId>, CommandError> {
    let mut assets = Vec::with_capacity(ids.len());
    for &id in ids {
        let animation = store.animation_read(id).map_err(app_failed)?;
        if animation.frames.len() > 1 {
            assets.extend(animation.frames.iter().map(|frame| frame.asset_id));
        } else {
            assets.push(id);
        }
    }
    Ok(assets)
}

/// The GIF palette index every transparent pixel is written as. Index 0 keeps
/// the opaque colours at 1..=255, one short of GIF's 256-entry limit.
const TRANSPARENT_INDEX: u8 = 0;

/// The most opaque colours one GIF palette holds beside the transparent one.
const MAX_GIF_COLOURS: usize = 255;

/// A pixel at or above this alpha is written opaque; below it, transparent.
/// GIF has no partial alpha, so the cut sits at half.
const OPAQUE_ALPHA: u8 = 128;

/// The shortest delay written, in centiseconds. Browsers replace 0 and 1
/// with a much slower default, so a faster frame would play slower.
const MIN_GIF_DELAY: u16 = 2;

/// An animation rendered and ordered, ready to encode as a GIF.
///
/// Each frame is rendered once at scale 1; `sequence` refers to them by
/// index, so pingpong's repeated frames cost nothing extra to hold, and
/// scaling happens on the one-byte palette indices rather than on RGBA.
pub struct GifFrames {
    /// The animation's root, whose name the file is named after.
    pub root_id: AssetId,
    images: Vec<RgbaImage>,
    /// Index into `images` and delay in centiseconds, in playback order.
    sequence: Vec<(usize, u16)>,
    scale: u8,
    width: u32,
    height: u32,
}

impl GifFrames {
    /// The GIF's width, after scaling.
    pub fn width(&self) -> u32 {
        self.width
    }

    /// The GIF's height, after scaling.
    pub fn height(&self) -> u32 {
        self.height
    }

    /// How many frames the GIF holds: a pingpong of `n` frames plays
    /// `2n - 2` of them.
    pub fn frames(&self) -> usize {
        self.sequence.len()
    }
}

/// A frame duration in milliseconds as a GIF delay: centiseconds, rounded,
/// never under [`MIN_GIF_DELAY`].
pub fn gif_delay(duration_ms: u32) -> u16 {
    let centiseconds = duration_ms.saturating_add(5) / 10;
    u16::try_from(centiseconds)
        .unwrap_or(u16::MAX)
        .max(MIN_GIF_DELAY)
}

/// The order `count` frames play in under `playback`: forward is
/// `0..n`, reverse `n-1..=0`, and pingpong `0..n` then back through
/// `n-2..=1`, so a loop never shows either end frame twice in a row.
pub fn playback_order(count: usize, playback: &str) -> Vec<usize> {
    match playback {
        "reverse" => (0..count).rev().collect(),
        "pingpong" => (0..count)
            .chain((1..count.saturating_sub(1)).rev())
            .collect(),
        _ => (0..count).collect(),
    }
}

/// Renders every frame of the animation `asset` belongs to (a lone asset is
/// a one-frame animation) and orders them by its playback.
///
/// # Errors
///
/// Returns the store's reason code when the asset is missing,
/// `export.invalid_scale` when `scale` is outside `1..=16` or the scaled GIF
/// would exceed [`MAX_EXPORT_SIDE`] a side, and `export.mixed_sizes` when the
/// frames are not all one size.
pub fn render_gif_frames(
    store: &Store,
    asset: AssetId,
    scale: u8,
) -> Result<GifFrames, CommandError> {
    let animation = store.animation_read(asset).map_err(app_failed)?;
    let mut images: Vec<RgbaImage> = Vec::with_capacity(animation.frames.len());
    let mut size = None;
    for frame in &animation.frames {
        let image = render_kind(store, frame.asset_id)?;
        match images.first() {
            // The first frame fixes the size, so a scale that is out of
            // range or too large is refused before rendering the rest.
            None => size = Some(scaled_size(image.width, image.height, scale)?),
            Some(first) if (first.width, first.height) != (image.width, image.height) => {
                return Err(CommandError::new(
                    "export.mixed_sizes",
                    "every frame of an animation must share one size",
                ))
            }
            Some(_) => {}
        }
        images.push(image);
    }
    let (width, height) = size.ok_or_else(|| {
        CommandError::new("export.empty", "the animation has no frames to export")
    })?;
    let sequence = playback_order(animation.frames.len(), &animation.playback)
        .into_iter()
        .map(|index| (index, gif_delay(animation.frames[index].duration_ms)))
        .collect();
    Ok(GifFrames {
        root_id: animation.root_id,
        images,
        sequence,
        scale,
        width,
        height,
    })
}

/// One palette shared by every frame: RGB triples with the transparent entry
/// first, and each opaque colour's index.
struct GifPalette {
    rgb: Vec<u8>,
    lookup: HashMap<[u8; 3], u8>,
}

/// Builds the shared palette from the frames' opaque colours. A sprite's
/// palette is far below 255 colours, so normally every colour gets its own
/// entry and the GIF is exact. Layer opacity can blend new colours into the
/// composite, though; past 255, the most used colours are kept and each of
/// the rest is written as its nearest kept colour.
fn gif_palette(images: &[RgbaImage]) -> GifPalette {
    let mut counts: HashMap<[u8; 3], u64> = HashMap::new();
    for image in images {
        for pixel in image.data.chunks_exact(4) {
            if pixel[3] >= OPAQUE_ALPHA {
                *counts.entry([pixel[0], pixel[1], pixel[2]]).or_default() += 1;
            }
        }
    }
    let mut ranked: Vec<([u8; 3], u64)> = counts.into_iter().collect();
    // Colour breaks ties so the same frames always give the same file.
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));

    let kept: Vec<[u8; 3]> = ranked
        .iter()
        .take(MAX_GIF_COLOURS)
        .map(|(colour, _)| *colour)
        .collect();
    let mut rgb = vec![0, 0, 0];
    let mut lookup = HashMap::with_capacity(ranked.len());
    for (index, colour) in kept.iter().enumerate() {
        rgb.extend_from_slice(colour);
        lookup.insert(*colour, index as u8 + 1);
    }
    for (colour, _) in ranked.iter().skip(MAX_GIF_COLOURS) {
        lookup.insert(*colour, nearest(&kept, *colour));
    }
    GifPalette { rgb, lookup }
}

/// The palette index (1-based, after the transparent entry) of the kept
/// colour closest to `colour` by squared RGB distance.
fn nearest(kept: &[[u8; 3]], colour: [u8; 3]) -> u8 {
    let distance = |other: &[u8; 3]| -> u32 {
        (0..3)
            .map(|channel| {
                let delta = i32::from(colour[channel]) - i32::from(other[channel]);
                (delta * delta) as u32
            })
            .sum()
    };
    let (index, _) = kept
        .iter()
        .enumerate()
        .min_by_key(|(_, other)| distance(other))
        .expect("nearest is only asked once more than 255 colours are kept");
    index as u8 + 1
}

/// `image` as palette indices, scaled by `factor` with nearest-neighbour.
fn indexed(image: &RgbaImage, palette: &GifPalette, factor: usize) -> Vec<u8> {
    let width = usize::from(image.width);
    let mut out = Vec::with_capacity(width * factor * usize::from(image.height) * factor);
    let mut line = Vec::with_capacity(width * factor);
    for source_row in image.data.chunks_exact(width * 4) {
        line.clear();
        for pixel in source_row.chunks_exact(4) {
            let index = if pixel[3] >= OPAQUE_ALPHA {
                palette.lookup[&[pixel[0], pixel[1], pixel[2]]]
            } else {
                TRANSPARENT_INDEX
            };
            line.extend(std::iter::repeat(index).take(factor));
        }
        for _ in 0..factor {
            out.extend_from_slice(&line);
        }
    }
    out
}

fn gif_failed(error: gif::EncodingError) -> CommandError {
    CommandError::new("export.encode_failed", error.to_string())
}

/// Encodes `frames` as a GIF that loops forever. Every frame covers the whole
/// canvas and is cleared to the background before the next, so a pixel a
/// frame leaves transparent never shows the frame before it through.
///
/// # Errors
///
/// Returns `export.encode_failed` when the encoder refuses the image.
pub fn encode_gif(frames: &GifFrames) -> Result<Vec<u8>, CommandError> {
    let palette = gif_palette(&frames.images);
    let factor = usize::from(frames.scale);
    let buffers: Vec<Vec<u8>> = frames
        .images
        .iter()
        .map(|image| indexed(image, &palette, factor))
        .collect();
    // Both sides are at most MAX_EXPORT_SIDE, checked by `scaled_size`.
    let width = frames.width as u16;
    let height = frames.height as u16;

    let mut encoder =
        gif::Encoder::new(Vec::new(), width, height, &palette.rgb).map_err(gif_failed)?;
    encoder
        .set_repeat(gif::Repeat::Infinite)
        .map_err(gif_failed)?;
    for &(index, delay) in &frames.sequence {
        let frame = gif::Frame {
            width,
            height,
            delay,
            dispose: gif::DisposalMethod::Background,
            transparent: Some(TRANSPARENT_INDEX),
            buffer: Cow::Borrowed(&buffers[index]),
            ..gif::Frame::default()
        };
        encoder.write_frame(&frame).map_err(gif_failed)?;
    }
    encoder
        .into_inner()
        .map_err(|error| CommandError::new("export.encode_failed", error.to_string()))
}

/// A project's folder under the exports root, named by
/// [`safe_folder_name`] and created if needed.
///
/// # Errors
///
/// Returns `export.no_directory` when the folder cannot be created.
pub fn project_folder(root: &Path, project: &str, id: Uuid) -> Result<PathBuf, CommandError> {
    let directory = root.join(safe_folder_name(project, id));
    fs::create_dir_all(&directory).map_err(|error| {
        CommandError::new(
            "export.no_directory",
            format!("{}: {error}", directory.display()),
        )
    })?;
    Ok(directory)
}

/// Writes `image` as `directory/name`, refusing to clobber an existing file
/// unless `overwrite` is set.
///
/// The bytes always land in a temporary file in the same directory first, so
/// nothing at `directory/name` is ever partial or zero-byte, and the temp
/// file is removed again in every case — success or failure — leaving no
/// litter behind either way.
///
/// With `overwrite`, the temp file is simply renamed over the target: a
/// caller who asked to replace whatever is there gets exactly that, and a
/// process that dies mid-encode has touched nothing at `name` yet.
///
/// Without `overwrite`, the temp file is instead hard-linked onto the
/// target: two names for the same file are created only if `target` did not
/// already exist at that instant, so a second export racing this one for the
/// same name is refused atomically rather than through a separate
/// `target.exists()` check that a rename could silently clobber moments
/// later. `AlreadyExists` from the link proves the name was already taken.
/// Not every filesystem supports hard links (old FAT-formatted volumes, some
/// network shares); when linking fails for any other reason, this falls back
/// to an existence check followed by a rename, which reopens a small window
/// between the two — the same race the link exists to close — but only on
/// filesystems where the atomic path is unavailable at all.
///
/// Cleanup never removes `target` itself, only the temp file: `target` is
/// either the caller's own pre-existing file (when refused) or was never
/// touched by a failed attempt, so it is never this function's to delete.
///
/// # Errors
///
/// Returns `export.no_directory` when `directory` does not exist or is not a
/// directory, `export.exists` when the target is already there and
/// `overwrite` is false, and `export.write_failed` for any other I/O
/// failure.
pub fn write_png(
    directory: &Path,
    name: &str,
    image: &RgbaImage,
    overwrite: bool,
) -> Result<PathBuf, CommandError> {
    if !directory.is_dir() {
        return Err(CommandError::new(
            "export.no_directory",
            format!("{} is not a directory", directory.display()),
        ));
    }
    let bytes = raster::png::encode(image).map_err(raster_failed)?;
    write_file(directory, name, &bytes, overwrite)
}

/// Writes already encoded `bytes` as `directory/name` under the same rules
/// as [`write_png`]: through a temporary file, never partial, and never
/// replacing an existing file unless `overwrite` is set.
///
/// # Errors
///
/// Returns the same `export.*` codes as [`write_png`].
pub fn write_file(
    directory: &Path,
    name: &str,
    bytes: &[u8],
    overwrite: bool,
) -> Result<PathBuf, CommandError> {
    if !directory.is_dir() {
        return Err(CommandError::new(
            "export.no_directory",
            format!("{} is not a directory", directory.display()),
        ));
    }
    let target = directory.join(name);

    let temp = directory.join(format!(".{}.tmp", Uuid::now_v7()));
    fs::write(&temp, bytes).map_err(|error| write_failed(&temp, &temp, error))?;

    if overwrite {
        fs::rename(&temp, &target).map_err(|error| write_failed(&temp, &target, error))?;
        return Ok(target);
    }

    match fs::hard_link(&temp, &target) {
        Ok(()) => {
            let _ = fs::remove_file(&temp);
            Ok(target)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let _ = fs::remove_file(&temp);
            Err(CommandError::new(
                "export.exists",
                format!("{} already exists", target.display()),
            ))
        }
        Err(_) => {
            if target.exists() {
                let _ = fs::remove_file(&temp);
                return Err(CommandError::new(
                    "export.exists",
                    format!("{} already exists", target.display()),
                ));
            }
            fs::rename(&temp, &target).map_err(|error| write_failed(&temp, &target, error))?;
            Ok(target)
        }
    }
}

/// Wraps an I/O `error` as `export.write_failed`, first removing `temp` on a
/// best-effort basis. Both the write of the temporary file and the rename
/// onto the final target go through this, so a failure at either step never
/// leaves the temporary file behind.
fn write_failed(temp: &Path, context: &Path, error: std::io::Error) -> CommandError {
    let _ = fs::remove_file(temp);
    CommandError::new(
        "export.write_failed",
        format!("{}: {error}", context.display()),
    )
}

/// The MCP exports folder for the current data root, creating it if needed.
///
/// # Errors
///
/// Returns `export.no_directory` when there is no configured data root, or
/// the exports folder cannot be created.
pub fn exports_root() -> Result<PathBuf, CommandError> {
    let root = preferences::data_root_without_app()
        .ok_or_else(|| CommandError::new("export.no_directory", "no data root is configured"))?;
    let exports = root.join("exports");
    fs::create_dir_all(&exports).map_err(|error| {
        CommandError::new(
            "export.no_directory",
            format!("{}: {error}", exports.display()),
        )
    })?;
    Ok(exports)
}

/// `commands::document::run`'s body, copied: that function is private to its
/// module, so this crosses the store lock onto a blocking worker the same
/// way, but hands back a [`CommandError`] directly.
async fn run<T: Send + 'static>(
    state: &DocumentState,
    work: impl FnOnce(&mut Store) -> Result<T, CommandError> + Send + 'static,
) -> Result<T, CommandError> {
    let store = state.store();
    tauri::async_runtime::spawn_blocking(move || {
        let mut store = store.lock().map_err(|_| {
            CommandError::new("store.lock_failed", "document store lock was poisoned")
        })?;
        work(&mut store)
    })
    .await
    .map_err(|error| CommandError::new("store.worker_failed", error.to_string()))?
}

/// Exports one asset's render as a PNG.
///
/// # Errors
///
/// Returns the store's reason code when the asset is missing, and this
/// module's `export.*` codes for the name, the scale and the write.
#[tauri::command]
pub async fn export_png(
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    directory: String,
    scale: u8,
    pattern: String,
    overwrite: bool,
) -> Result<ExportResult, CommandError> {
    let (name, image) = run(&state, move |store| {
        let asset = store.asset_read(asset_id).map_err(app_failed)?;
        let project = store.project_read(asset.project_id).map_err(app_failed)?;
        let image = render_asset(store, asset_id, scale)?;
        let name = file_name(&pattern, &project.name, &asset.name, &asset.kind, scale)?;
        Ok((name, image))
    })
    .await?;

    let path = write_png(Path::new(&directory), &name, &image, overwrite)?;
    Ok(ExportResult {
        path: path.to_string_lossy().into_owned(),
        width: u32::from(image.width),
        height: u32::from(image.height),
    })
}

/// Exports several assets of the same size as one sprite sheet PNG. An
/// animation in `asset_ids` stands for all of its frames, as
/// [`sheet_assets`] expands it.
///
/// # Errors
///
/// Returns the store's reason code when an asset is missing, `export.empty`
/// with no assets, `export.mixed_sizes` when they differ in size, and this
/// module's other `export.*` codes for the name, the scale and the write.
#[tauri::command]
pub async fn export_sheet(
    state: State<'_, DocumentState>,
    asset_ids: Vec<AssetId>,
    directory: String,
    columns: u16,
    scale: u8,
    name: String,
    overwrite: bool,
) -> Result<ExportResult, CommandError> {
    let (file_name_value, image) = run(&state, move |store| {
        let asset_ids = sheet_assets(store, &asset_ids)?;
        let project_name = match asset_ids.first() {
            Some(&first) => {
                let asset = store.asset_read(first).map_err(app_failed)?;
                store
                    .project_read(asset.project_id)
                    .map_err(app_failed)?
                    .name
            }
            None => {
                return Err(CommandError::new(
                    "export.empty",
                    "no assets to lay out in a sheet",
                ))
            }
        };
        let image = render_sheet(store, &asset_ids, columns, scale)?;
        let file_name_value = file_name(&name, &project_name, "sheet", "sheet", scale)?;
        Ok((file_name_value, image))
    })
    .await?;

    let path = write_png(Path::new(&directory), &file_name_value, &image, overwrite)?;
    Ok(ExportResult {
        path: path.to_string_lossy().into_owned(),
        width: u32::from(image.width),
        height: u32::from(image.height),
    })
}

/// The file name an agent's GIF gets when it names none, as the MCP
/// `export_png` default names a PNG.
pub const DEFAULT_GIF_PATTERN: &str = "{asset}@{scale}x";

/// Renders the animation `asset_id` belongs to and names its GIF from
/// `pattern`. The pattern's `{asset}` and `{kind}` are the animation root's,
/// not the frame's, so one animation exports under one name whichever of its
/// frames is open.
///
/// # Errors
///
/// Returns the store's reason code when an asset is missing, and
/// [`render_gif_frames`]'s and [`gif_file_name`]'s `export.*` codes.
fn named_gif_frames(
    store: &Store,
    asset_id: AssetId,
    scale: u8,
    pattern: &str,
) -> Result<(GifFrames, String), CommandError> {
    let frames = render_gif_frames(store, asset_id, scale)?;
    let root = store.asset_read(frames.root_id).map_err(app_failed)?;
    let project = store.project_read(root.project_id).map_err(app_failed)?;
    let name = gif_file_name(pattern, &project.name, &root.name, &root.kind, scale)?;
    Ok((frames, name))
}

/// Encodes `frames` and writes them as `directory/name` under
/// [`write_file`]'s rules, the GIF counterpart of [`write_png`].
///
/// # Errors
///
/// Returns `export.no_directory` before encoding anything when `directory`
/// is not a directory, `export.encode_failed`, and [`write_file`]'s codes,
/// `export.exists` among them when `overwrite` is false.
fn write_gif(
    directory: &Path,
    name: &str,
    frames: &GifFrames,
    overwrite: bool,
) -> Result<ExportResult, CommandError> {
    if !directory.is_dir() {
        return Err(CommandError::new(
            "export.no_directory",
            format!("{} is not a directory", directory.display()),
        ));
    }
    let bytes = encode_gif(frames)?;
    let path = write_file(directory, name, &bytes, overwrite)?;
    Ok(ExportResult {
        path: path.to_string_lossy().into_owned(),
        width: frames.width(),
        height: frames.height(),
    })
}

/// Exports the animation `asset_id` belongs to (a lone asset exports a
/// one-frame GIF) as a looping GIF, in its playback order and durations.
///
/// It takes exactly what [`export_png`] takes and follows the same rules: the
/// file lands in `directory` under a safe name built from `pattern` (ending
/// in `.gif`), and an existing file is refused with `export.exists` unless
/// `overwrite` is set. The dialog offers both exports side by side with one
/// overwrite switch, so a GIF must never replace a file the PNG would have
/// refused to.
///
/// # Errors
///
/// Returns the store's reason code when the asset is missing,
/// `export.invalid_scale`, `export.mixed_sizes`, `export.encode_failed`, and
/// this module's other `export.*` codes for the name and the write.
#[tauri::command]
pub async fn export_gif(
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    directory: String,
    scale: u8,
    pattern: String,
    overwrite: bool,
) -> Result<ExportResult, CommandError> {
    let (frames, name) = run(&state, move |store| {
        named_gif_frames(store, asset_id, scale, &pattern)
    })
    .await?;

    // Encoding happens after the lock is released: the frames are already
    // rendered and the encoder does not need the store.
    write_gif(Path::new(&directory), &name, &frames, overwrite)
}

/// The MCP exports folder for the current data root.
///
/// # Errors
///
/// Returns `export.no_directory` when there is no configured data root, or
/// the exports folder cannot be created.
#[tauri::command]
pub async fn export_directory() -> Result<String, CommandError> {
    Ok(exports_root()?.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;
    use std::process;

    fn code_of(error: &CommandError) -> String {
        serde_json::to_value(error).unwrap()["code"]
            .as_str()
            .unwrap()
            .to_string()
    }

    struct TempDir {
        path: PathBuf,
    }
    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "bitwright-export-test-{}-{}",
                process::id(),
                Uuid::now_v7()
            ));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn solid_image(width: u16, height: u16, pixel: [u8; 4]) -> RgbaImage {
        let mut data = Vec::with_capacity(usize::from(width) * usize::from(height) * 4);
        for _ in 0..(usize::from(width) * usize::from(height)) {
            data.extend_from_slice(&pixel);
        }
        RgbaImage {
            width,
            height,
            data,
        }
    }

    fn store_with_assets(sizes: &[(u16, u16)]) -> (Store, Vec<AssetId>) {
        let mut store = Store::memory().unwrap();
        let project = store.project_create("Demo", "hd2d").unwrap();
        let mut ids = Vec::new();
        for (index, &(width, height)) in sizes.iter().enumerate() {
            let asset = store
                .asset_create(project.id, &format!("asset-{index}"), "prop", width, height)
                .unwrap();
            ids.push(asset.id);
        }
        (store, ids)
    }

    #[test]
    fn file_name_substitutes_every_placeholder() {
        let name = file_name(
            "{project}-{asset}-{kind}@{scale}x",
            "Demo",
            "hero",
            "prop",
            3,
        )
        .unwrap();
        assert_eq!(name, "Demo-hero-prop@3x.png");
    }

    #[test]
    fn file_name_replaces_separators_and_reserved_characters() {
        assert_eq!(file_name("a/b:c", "p", "a", "k", 1).unwrap(), "a_b_c.png");
    }

    #[test]
    fn file_name_escapes_a_windows_reserved_stem() {
        assert_eq!(file_name("CON", "p", "a", "k", 1).unwrap(), "_CON.png");
    }

    #[test]
    fn file_name_rejects_a_pattern_empty_after_substitution() {
        let error = file_name("{asset}", "p", "", "k", 1).unwrap_err();
        assert_eq!(code_of(&error), "export.invalid_pattern");
    }

    #[test]
    fn file_name_keeps_a_single_png_extension() {
        assert_eq!(file_name("x.PNG", "p", "a", "k", 1).unwrap(), "x.PNG");
    }

    #[test]
    fn file_name_does_not_panic_on_a_non_ascii_name_without_a_png_suffix() {
        // Regression: checking the extension by slicing `safe.len() - 4`
        // panicked whenever the name's last four bytes were not a char
        // boundary, which poisoned the store mutex when this ran inside
        // `run`'s blocking closure.
        let name = file_name("{asset}", "p", "\u{65e5}\u{672c}", "prop", 1).unwrap();
        assert_eq!(name, "\u{65e5}\u{672c}.png");
    }

    #[test]
    fn file_name_escapes_a_reserved_name_with_an_extension() {
        // The reserved check looks at the part before the FIRST '.', not
        // only a whole-name match, so an extension does not hide it.
        assert_eq!(
            file_name("CON.txt", "p", "a", "k", 1).unwrap(),
            "_CON.txt.png"
        );
        assert_eq!(
            file_name("aux.foo", "p", "a", "k", 1).unwrap(),
            "_aux.foo.png"
        );
    }

    /// A fixed id so its last 8 hex characters — the part `safe_folder_name`
    /// actually uses — are predictable in tests.
    const PROJECT_ID: Uuid =
        Uuid::from_bytes([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xab, 0xcd, 0xef, 0x01]);

    #[test]
    fn safe_folder_name_replaces_separators() {
        assert_eq!(safe_folder_name("a/b:c", PROJECT_ID), "a_b_c-abcdef01");
    }

    #[test]
    fn safe_folder_name_falls_back_when_nothing_survives_sanitizing() {
        // Trimmed of dots and spaces, ".." leaves nothing behind (there is no
        // separator here for `sanitize` to turn into an `_` first); the
        // fallback keeps `exports_root().join(...)` from ever landing on the
        // exports root itself.
        assert_eq!(safe_folder_name("..", PROJECT_ID), "project-abcdef01");
        assert_eq!(safe_folder_name("   ", PROJECT_ID), "project-abcdef01");
    }

    #[test]
    fn safe_folder_name_never_contains_a_path_separator() {
        // Even when sanitizing does not empty it out, the traversal segments
        // survive only as literal, separator-free text, never as `..` path
        // components: joined onto a directory, this can only ever create a
        // sibling of that directory, not escape it.
        let name = safe_folder_name("../../evil", PROJECT_ID);
        assert!(!name.contains('/') && !name.contains('\\'));
    }

    #[test]
    fn safe_folder_name_pins_the_exact_value_for_a_traversal_attempt() {
        // Regression: the escaping strategy for a hostile name is an
        // implementation detail an agent must never be able to rely on, but
        // it still has to stay put once fixed, since anything that folds
        // multiple sanitized names back together would reopen the same
        // collision the id suffix exists to close.
        assert_eq!(
            safe_folder_name("../../evil", PROJECT_ID),
            "_.._evil-abcdef01"
        );
    }

    #[test]
    fn safe_folder_name_escapes_a_windows_reserved_name() {
        assert_eq!(safe_folder_name("CON", PROJECT_ID), "_CON-abcdef01");
    }

    #[test]
    fn safe_folder_name_keeps_two_projects_apart() {
        // Two projects whose names sanitize to the same text (a separator
        // vs. a reserved character both becoming `_`) must still end up in
        // different folders — that's the whole reason the id is appended.
        let other = Uuid::from_bytes([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x11, 0x22, 0x33, 0x44]);
        assert_ne!(
            safe_folder_name("a/b", PROJECT_ID),
            safe_folder_name("a:b", other)
        );
        // Same name, different id — e.g. two projects named identically, or
        // names that differ only by case on a case-insensitive filesystem.
        assert_ne!(
            safe_folder_name("Demo", PROJECT_ID),
            safe_folder_name("Demo", other)
        );
    }

    #[test]
    fn safe_folder_name_keeps_two_projects_apart_even_made_back_to_back() {
        // Regression: a v7 id's leading bits are a millisecond timestamp, so
        // two ids minted moments apart — exactly how two projects get
        // created in a real session — can share their *first* 8 hex
        // characters for up to about 65 seconds. Using the id's trailing,
        // random characters instead means two such ids, and two project
        // names that sanitize alike, still land in different folders.
        let first = Uuid::now_v7();
        let second = Uuid::now_v7();
        assert_ne!(
            safe_folder_name("a/b", first),
            safe_folder_name("a_b", second)
        );
    }

    #[test]
    fn scaled_repeats_pixels_by_the_integer_factor() {
        let image = RgbaImage {
            width: 2,
            height: 1,
            data: vec![255, 0, 0, 255, 0, 255, 0, 255],
        };
        let result = scaled(&image, 3).unwrap();
        assert_eq!((result.width, result.height), (6, 3));
        for y in 0..3usize {
            for x in 0..6usize {
                let expected = if x < 3 {
                    [255, 0, 0, 255]
                } else {
                    [0, 255, 0, 255]
                };
                let index = (y * 6 + x) * 4;
                assert_eq!(&result.data[index..index + 4], &expected);
            }
        }
    }

    #[test]
    fn scaled_rejects_a_scale_outside_the_allowed_range() {
        let image = solid_image(1, 1, [0, 0, 0, 255]);
        assert_eq!(
            code_of(&scaled(&image, 0).unwrap_err()),
            "export.invalid_scale"
        );
        assert_eq!(
            code_of(&scaled(&image, 17).unwrap_err()),
            "export.invalid_scale"
        );
    }

    #[test]
    fn render_sheet_stacks_two_equal_tiles_in_one_column() {
        let (store, ids) = store_with_assets(&[(4, 4), (4, 4)]);
        let sheet = render_sheet(&store, &ids, 1, 1).unwrap();
        assert_eq!((sheet.width, sheet.height), (4, 8));
    }

    #[test]
    fn render_sheet_refuses_mixed_sizes() {
        let (store, ids) = store_with_assets(&[(4, 4), (8, 4)]);
        let error = render_sheet(&store, &ids, 1, 1).unwrap_err();
        assert_eq!(code_of(&error), "export.mixed_sizes");
    }

    #[test]
    fn render_sheet_refuses_an_empty_asset_list() {
        let (store, _ids) = store_with_assets(&[]);
        let error = render_sheet(&store, &[], 1, 1).unwrap_err();
        assert_eq!(code_of(&error), "export.empty");
    }

    #[test]
    fn render_sheet_refuses_a_layout_that_would_wrap_a_u16() {
        // Regression: nine 8000x1 tiles in nine columns lay out to a sheet
        // 72000px wide. Cast down to `u16` (max 65535) that used to wrap to
        // 6464 and slip past the 8192px cap instead of being refused.
        let (store, ids) = store_with_assets(&[(8000, 1); 9]);
        let error = render_sheet(&store, &ids, 9, 1).unwrap_err();
        assert_eq!(code_of(&error), "export.invalid_scale");
    }

    #[test]
    fn compose_sheet_places_each_tile_at_its_own_slot() {
        // Three 2x2 tiles of different solid colours, two columns: tile 0 at
        // (0,0), tile 1 at (2,0), tile 2 wraps to (0,2). This checks the
        // pixel that lands at each tile's origin, not just the sheet size.
        let red = solid_image(2, 2, [255, 0, 0, 255]);
        let green = solid_image(2, 2, [0, 255, 0, 255]);
        let blue = solid_image(2, 2, [0, 0, 255, 255]);
        let sheet = compose_sheet(&[red, green, blue], 2, 1).unwrap();
        assert_eq!((sheet.width, sheet.height), (4, 4));

        let pixel_at = |x: usize, y: usize| -> [u8; 4] {
            let index = (y * usize::from(sheet.width) + x) * 4;
            sheet.data[index..index + 4].try_into().unwrap()
        };
        assert_eq!(pixel_at(0, 0), [255, 0, 0, 255]);
        assert_eq!(pixel_at(2, 0), [0, 255, 0, 255]);
        assert_eq!(pixel_at(0, 2), [0, 0, 255, 255]);
        // The bottom-right quadrant holds no tile and stays untouched.
        assert_eq!(pixel_at(2, 2), [0, 0, 0, 0]);
    }

    #[test]
    fn write_png_round_trips_a_decodable_file() {
        let directory = TempDir::new();
        let image = solid_image(2, 2, [10, 20, 30, 255]);
        let path = write_png(&directory.path, "out.png", &image, false).unwrap();
        let bytes = fs::read(&path).unwrap();
        let decoded = raster::png::decode(&bytes).unwrap();
        assert_eq!((decoded.width, decoded.height), (2, 2));
    }

    #[test]
    fn write_png_without_overwrite_refuses_an_existing_file() {
        let directory = TempDir::new();
        let image = solid_image(1, 1, [1, 2, 3, 255]);
        write_png(&directory.path, "out.png", &image, false).unwrap();
        let error = write_png(&directory.path, "out.png", &image, false).unwrap_err();
        assert_eq!(code_of(&error), "export.exists");
    }

    #[test]
    fn write_png_without_overwrite_does_not_clobber_a_file_created_after_the_check() {
        // Regression: an `exists()` check followed later by a rename leaves
        // a window in which something else can create the file; the old
        // code would then silently replace it despite `overwrite` being
        // false. Hard-linking the finished temp file onto the target closes
        // that window — simulated here by having the target already exist
        // with content of its own before `write_png` is ever called,
        // standing in for a second writer that won the race.
        let directory = TempDir::new();
        fs::write(directory.path.join("out.png"), b"raced in first").unwrap();
        let image = solid_image(1, 1, [1, 2, 3, 255]);

        let error = write_png(&directory.path, "out.png", &image, false).unwrap_err();
        assert_eq!(code_of(&error), "export.exists");
        assert_eq!(
            fs::read(directory.path.join("out.png")).unwrap(),
            b"raced in first",
            "the other writer's file must survive untouched"
        );
    }

    /// Every file directly under `directory`, for asserting nothing was left
    /// behind (a stray `.tmp` file, an empty placeholder) beyond what a test
    /// expects.
    fn entries(directory: &Path) -> Vec<PathBuf> {
        let mut found: Vec<PathBuf> = fs::read_dir(directory)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        found.sort();
        found
    }

    #[test]
    fn write_png_leaves_no_zero_byte_file_when_encoding_fails() {
        // The temp file only ever holds the fully encoded PNG — nothing is
        // written to disk before `raster::png::encode` succeeds — so an
        // encoding failure (forced here by an image whose byte count
        // disagrees with its declared size) must leave the directory
        // exactly as empty as it started, with no zero-byte or partial file
        // squatting on the name.
        let directory = TempDir::new();
        let broken = RgbaImage {
            width: 0,
            height: 1,
            data: vec![1, 2, 3, 255],
        };

        let error = write_png(&directory.path, "out.png", &broken, false).unwrap_err();
        assert_eq!(code_of(&error), "png.invalid");
        assert_eq!(entries(&directory.path), Vec::<PathBuf>::new());

        // A fresh export of the same name afterwards succeeds normally
        // rather than being wrongly told it already exists.
        let image = solid_image(1, 1, [1, 2, 3, 255]);
        let path = write_png(&directory.path, "out.png", &image, false).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn write_png_without_overwrite_leaves_only_the_final_file_behind() {
        // Whichever path a successful, no-overwrite write takes — the
        // hard-link, or (rarely) its rename fallback — the temp file it
        // worked from must be gone afterwards, so the directory holds
        // exactly the one PNG and nothing else.
        let directory = TempDir::new();
        let image = solid_image(2, 2, [10, 20, 30, 255]);

        let path = write_png(&directory.path, "out.png", &image, false).unwrap();

        assert_eq!(entries(&directory.path), vec![path.clone()]);
        let decoded = raster::png::decode(&fs::read(&path).unwrap()).unwrap();
        assert_eq!((decoded.width, decoded.height), (2, 2));
    }

    #[test]
    fn write_png_refuses_a_missing_directory() {
        let missing = std::env::temp_dir().join(format!("bitwright-missing-{}", Uuid::now_v7()));
        let image = solid_image(1, 1, [1, 2, 3, 255]);
        let error = write_png(&missing, "out.png", &image, false).unwrap_err();
        assert_eq!(code_of(&error), "export.no_directory");
    }

    #[test]
    fn render_asset_of_a_background_renders_its_tilemap() {
        let mut store = Store::memory().unwrap();
        let project = store.project_create("Demo", "hd2d").unwrap();
        let background = store
            .asset_create(project.id, "hills", "background", 8, 8)
            .unwrap();
        let tile = store
            .asset_create(project.id, "grass", "tile", 8, 8)
            .unwrap();
        let mut map = crate::raster::Tilemap::new(8, 8, 1, 1).unwrap();
        map.place(
            "ground",
            &[crate::raster::Placement {
                x: 0,
                y: 0,
                tile: Some(tile.id.0),
            }],
        )
        .unwrap();
        store.tilemap_write(background.id, &map).unwrap();

        let rendered = render_asset(&store, background.id, 1).unwrap();
        let direct = store.tilemap_render(background.id, None).unwrap();
        assert_eq!(rendered.data, direct.data);
        assert_eq!((rendered.width, rendered.height), (8, 8));
    }

    #[test]
    fn render_asset_of_a_non_background_renders_its_layer_composite() {
        let mut store = Store::memory().unwrap();
        let project = store.project_create("Demo", "hd2d").unwrap();
        let asset = store
            .asset_create(project.id, "hero", "prop", 2, 2)
            .unwrap();

        let rendered = render_asset(&store, asset.id, 1).unwrap();
        let direct = store.asset_composite(asset.id).unwrap();
        assert_eq!(rendered.data, direct.data);
        assert_eq!((rendered.width, rendered.height), (2, 2));
    }

    #[test]
    fn render_asset_scales_the_underlying_render() {
        let mut store = Store::memory().unwrap();
        let project = store.project_create("Demo", "hd2d").unwrap();
        let asset = store
            .asset_create(project.id, "hero", "prop", 2, 2)
            .unwrap();
        let rendered = render_asset(&store, asset.id, 2).unwrap();
        assert_eq!((rendered.width, rendered.height), (4, 4));
    }

    // `exports_root` is not tested here: it reads the data root through
    // `preferences::data_root_without_app()`, which is a process-global set
    // by the app's own preferences file rather than a parameter this
    // function takes, so a unit test cannot point it at an isolated
    // temporary directory without mutating state shared with every other
    // test in this binary (and with a real user's configured data root).

    #[test]
    fn write_failed_removes_the_temp_file() {
        // Regression: the temp file was only removed when the rename step
        // failed, leaving it behind whenever the initial write itself
        // failed. `write_png` now routes both failures through this one
        // helper, so testing it once covers either call site.
        let directory = TempDir::new();
        let temp = directory.path.join(".leftover.tmp");
        fs::write(&temp, b"partial").unwrap();
        assert!(temp.exists());

        let error = write_failed(
            &temp,
            &temp,
            std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied"),
        );

        assert_eq!(code_of(&error), "export.write_failed");
        assert!(!temp.exists());
    }

    const RED: [u8; 4] = [200, 30, 30, 255];
    const GREEN: [u8; 4] = [30, 200, 30, 255];
    const BLUE: [u8; 4] = [30, 30, 200, 255];

    fn slot(index: u8, rgba: [u8; 4]) -> crate::raster::PaletteSlot {
        crate::raster::PaletteSlot {
            index,
            rgba,
            name: None,
            ramp: None,
            step: None,
        }
    }

    /// A 2x1 animation of three frames: frame `k` has pixel 0 in colour `k`
    /// (red, green, blue) and pixel 1 left transparent, each shown for
    /// `durations[k]` milliseconds.
    fn animation(durations: [u32; 3]) -> (Store, Vec<AssetId>) {
        let mut store = Store::memory().unwrap();
        let project = store.project_create("Demo", "hd2d").unwrap();
        let root = store
            .asset_create(project.id, "hero", "character", 2, 1)
            .unwrap()
            .id;
        store
            .palette_write(
                root,
                crate::raster::Palette {
                    slots: vec![slot(1, RED), slot(2, GREEN), slot(3, BLUE)],
                    ramps: vec![],
                },
            )
            .unwrap();
        store.frame_add(root, true).unwrap();
        let second = store.animation_read(root).unwrap().frames[1].asset_id;
        store.frame_add(second, true).unwrap();
        let ids: Vec<AssetId> = store
            .animation_read(root)
            .unwrap()
            .frames
            .iter()
            .map(|frame| frame.asset_id)
            .collect();
        for (index, &id) in ids.iter().enumerate() {
            let mut layer = store
                .layer_read(id, crate::raster::LayerRole("silhouette"))
                .unwrap();
            layer.buffer.data[0] = index as u8 + 1;
            store.layer_write(id, layer).unwrap();
            store.frame_set_duration(id, durations[index]).unwrap();
        }
        (store, ids)
    }

    /// One decoded GIF frame: its delay and its RGBA pixels.
    struct Decoded {
        width: u16,
        height: u16,
        infinite: bool,
        frames: Vec<(u16, Vec<u8>)>,
    }

    fn decode(bytes: &[u8]) -> Decoded {
        let mut options = gif::DecodeOptions::new();
        options.set_color_output(gif::ColorOutput::RGBA);
        let mut decoder = options.read_info(bytes).unwrap();
        let mut frames = Vec::new();
        while let Some(frame) = decoder.read_next_frame().unwrap() {
            assert_eq!(frame.dispose, gif::DisposalMethod::Background);
            frames.push((frame.delay, frame.buffer.to_vec()));
        }
        Decoded {
            width: decoder.width(),
            height: decoder.height(),
            infinite: decoder.repeat() == gif::Repeat::Infinite,
            frames,
        }
    }

    fn export(store: &Store, asset: AssetId, scale: u8) -> Decoded {
        let frames = render_gif_frames(store, asset, scale).unwrap();
        decode(&encode_gif(&frames).unwrap())
    }

    /// The colour of each frame's first pixel, in the order the GIF plays.
    fn colours(decoded: &Decoded) -> Vec<[u8; 4]> {
        decoded
            .frames
            .iter()
            .map(|(_, pixels)| pixels[..4].try_into().unwrap())
            .collect()
    }

    #[test]
    fn gif_delay_rounds_to_centiseconds_with_a_floor_of_two() {
        assert_eq!(gif_delay(125), 13);
        assert_eq!(gif_delay(124), 12);
        assert_eq!(gif_delay(10), 2);
        assert_eq!(gif_delay(25), 3);
        assert_eq!(gif_delay(10_000), 1000);
        assert_eq!(gif_delay(u32::MAX), u16::MAX);
    }

    #[test]
    fn playback_order_covers_every_mode() {
        assert_eq!(playback_order(3, "forward"), vec![0, 1, 2]);
        assert_eq!(playback_order(3, "reverse"), vec![2, 1, 0]);
        assert_eq!(playback_order(4, "pingpong"), vec![0, 1, 2, 3, 2, 1]);
        assert_eq!(playback_order(2, "pingpong"), vec![0, 1]);
        assert_eq!(playback_order(1, "pingpong"), vec![0]);
    }

    #[test]
    fn export_gif_writes_every_frame_forward_with_its_delay_looping_forever() {
        let (store, ids) = animation([100, 250, 40]);
        // Any frame stands for the whole animation.
        let decoded = export(&store, ids[1], 1);
        assert!(decoded.infinite);
        assert_eq!((decoded.width, decoded.height), (2, 1));
        let delays: Vec<u16> = decoded.frames.iter().map(|(delay, _)| *delay).collect();
        assert_eq!(delays, vec![10, 25, 4]);
        assert_eq!(colours(&decoded), vec![RED, GREEN, BLUE]);
    }

    #[test]
    fn export_gif_honours_reverse_and_pingpong() {
        let (mut store, ids) = animation([100, 200, 300]);
        store.animation_set_playback(ids[0], "reverse").unwrap();
        let reverse = export(&store, ids[0], 1);
        assert_eq!(colours(&reverse), vec![BLUE, GREEN, RED]);
        let delays: Vec<u16> = reverse.frames.iter().map(|(delay, _)| *delay).collect();
        assert_eq!(delays, vec![30, 20, 10]);

        store.animation_set_playback(ids[0], "pingpong").unwrap();
        let pingpong = export(&store, ids[0], 1);
        assert_eq!(colours(&pingpong), vec![RED, GREEN, BLUE, GREEN]);
        assert_eq!(render_gif_frames(&store, ids[0], 1).unwrap().frames(), 4);
    }

    #[test]
    fn export_gif_keeps_transparent_pixels_transparent() {
        let (store, ids) = animation([100, 100, 100]);
        let decoded = export(&store, ids[0], 1);
        for (_, pixels) in &decoded.frames {
            assert_eq!(pixels[7], 0, "pixel 1 was never drawn and must stay clear");
            assert_eq!(pixels[3], 255);
        }
    }

    #[test]
    fn export_gif_scales_every_frame_nearest_neighbour() {
        let (store, ids) = animation([100, 100, 100]);
        let frames = render_gif_frames(&store, ids[0], 3).unwrap();
        assert_eq!((frames.width(), frames.height()), (6, 3));
        let decoded = decode(&encode_gif(&frames).unwrap());
        assert_eq!((decoded.width, decoded.height), (6, 3));
        let (_, pixels) = &decoded.frames[2];
        for y in 0..3usize {
            for x in 0..6usize {
                let index = (y * 6 + x) * 4;
                let alpha = pixels[index + 3];
                if x < 3 {
                    assert_eq!(&pixels[index..index + 4], &BLUE);
                } else {
                    assert_eq!(alpha, 0);
                }
            }
        }
    }

    #[test]
    fn export_gif_of_a_lone_sprite_is_one_frame() {
        let (store, ids) = store_with_assets(&[(4, 4)]);
        let decoded = export(&store, ids[0], 2);
        assert_eq!(decoded.frames.len(), 1);
        assert_eq!(decoded.frames[0].0, 13);
        assert_eq!((decoded.width, decoded.height), (8, 8));
    }

    #[test]
    fn export_gif_refuses_a_scale_outside_the_range_or_past_the_cap() {
        let (store, ids) = animation([100, 100, 100]);
        for scale in [0, 17] {
            let error = render_gif_frames(&store, ids[0], scale).err().unwrap();
            assert_eq!(code_of(&error), "export.invalid_scale");
        }
        let (store, ids) = store_with_assets(&[(1024, 1)]);
        let error = render_gif_frames(&store, ids[0], 9).err().unwrap();
        assert_eq!(code_of(&error), "export.invalid_scale");
    }

    #[test]
    fn encode_gif_maps_more_than_255_colours_to_the_nearest_kept_one() {
        // Blended layer opacity can make more colours than a GIF holds; the
        // extras are written as their nearest kept colour, not refused.
        let data: Vec<u8> = (0..300u32)
            .flat_map(|value| [(value % 256) as u8, (value / 256) as u8, 7, 255])
            .collect();
        let frames = GifFrames {
            root_id: AssetId(Uuid::now_v7()),
            images: vec![RgbaImage {
                width: 300,
                height: 1,
                data,
            }],
            sequence: vec![(0, 10)],
            scale: 1,
            width: 300,
            height: 1,
        };
        let decoded = decode(&encode_gif(&frames).unwrap());
        assert_eq!(decoded.frames.len(), 1);
        assert!(decoded.frames[0]
            .1
            .chunks_exact(4)
            .all(|pixel| pixel[3] == 255));
    }

    #[test]
    fn gif_file_name_ends_in_gif() {
        assert_eq!(
            gif_file_name("{asset}@{scale}x", "p", "hero", "k", 2).unwrap(),
            "hero@2x.gif"
        );
        assert_eq!(
            gif_file_name("run.GIF", "p", "a", "k", 1).unwrap(),
            "run.GIF"
        );
    }

    #[test]
    fn write_file_without_overwrite_refuses_an_existing_gif() {
        let directory = TempDir::new();
        let (store, ids) = animation([100, 100, 100]);
        let bytes = encode_gif(&render_gif_frames(&store, ids[0], 1).unwrap()).unwrap();
        write_file(&directory.path, "run.gif", &bytes, false).unwrap();
        let error = write_file(&directory.path, "run.gif", &bytes, false).unwrap_err();
        assert_eq!(code_of(&error), "export.exists");
        write_file(&directory.path, "run.gif", &bytes, true).unwrap();
    }

    #[test]
    fn export_gif_names_the_file_from_the_pattern_and_the_animation_root() {
        let directory = TempDir::new();
        let (store, ids) = animation([100, 100, 100]);
        // Opened on the last frame, the GIF is still named after the root.
        let (frames, name) =
            named_gif_frames(&store, ids[2], 2, "{project}-{asset}-{kind}@{scale}x").unwrap();
        assert_eq!(name, "Demo-hero-character@2x.gif");
        let result = write_gif(&directory.path, &name, &frames, false).unwrap();
        assert_eq!((result.width, result.height), (4, 2));
        assert_eq!(PathBuf::from(&result.path), directory.path.join(&name));
        let decoded = decode(&fs::read(&result.path).unwrap());
        assert_eq!(decoded.frames.len(), 3);
    }

    #[test]
    fn export_gif_makes_a_hostile_pattern_a_safe_name_inside_the_directory() {
        let (store, ids) = animation([100, 100, 100]);
        let (_, name) = named_gif_frames(&store, ids[0], 1, "../{asset}").unwrap();
        assert_eq!(name, "_hero.gif");
        let (_, name) = named_gif_frames(&store, ids[0], 1, "con").unwrap();
        assert_eq!(name, "_con.gif");
        let error = named_gif_frames(&store, ids[0], 1, " .. ").err().unwrap();
        assert_eq!(code_of(&error), "export.invalid_pattern");
    }

    #[test]
    fn export_gif_refuses_an_existing_file_unless_told_to_overwrite() {
        let directory = TempDir::new();
        let (store, ids) = animation([100, 100, 100]);
        let (frames, name) = named_gif_frames(&store, ids[0], 1, "{asset}").unwrap();
        let target = directory.path.join(&name);
        fs::write(&target, b"keep me").unwrap();

        let error = write_gif(&directory.path, &name, &frames, false).unwrap_err();
        assert_eq!(code_of(&error), "export.exists");
        assert_eq!(fs::read(&target).unwrap(), b"keep me");
        assert_eq!(entries(&directory.path), vec![target.clone()]);

        write_gif(&directory.path, &name, &frames, true).unwrap();
        assert_eq!(decode(&fs::read(&target).unwrap()).frames.len(), 3);
    }

    #[test]
    fn export_gif_refuses_a_missing_directory() {
        let directory = TempDir::new();
        let (store, ids) = animation([100, 100, 100]);
        let (frames, name) = named_gif_frames(&store, ids[0], 1, "{asset}").unwrap();
        let missing = directory.path.join("missing");
        let error = write_gif(&missing, &name, &frames, false).unwrap_err();
        assert_eq!(code_of(&error), "export.no_directory");
    }

    #[test]
    fn sheet_assets_expands_an_animation_from_any_of_its_frames() {
        let (mut store, ids) = animation([100, 100, 100]);
        let project = store.asset_read(ids[0]).unwrap().project_id;
        let lone = store
            .asset_create(project, "rock", "prop", 2, 1)
            .unwrap()
            .id;
        assert_eq!(sheet_assets(&store, &[ids[0]]).unwrap(), ids);
        assert_eq!(sheet_assets(&store, &[ids[2]]).unwrap(), ids);
        let mut expected = vec![lone];
        expected.extend(&ids);
        assert_eq!(sheet_assets(&store, &[lone, ids[1]]).unwrap(), expected);

        let sheet = render_sheet(&store, &sheet_assets(&store, &[ids[0]]).unwrap(), 3, 1).unwrap();
        assert_eq!((sheet.width, sheet.height), (6, 1));
        assert_eq!(&sheet.data[8..12], &GREEN);
    }
}
