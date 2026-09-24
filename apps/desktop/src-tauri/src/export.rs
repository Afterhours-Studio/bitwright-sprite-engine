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

//! Export: an explicit "Save As" that writes PNG files into a folder.
//!
//! Saving inside the document is continuous and never touches the disk as a
//! file; exporting is the one place a sprite or a sheet leaves the database
//! as a PNG a person can hand to an engine. An agent exporting through MCP
//! cannot name a folder, so its files always land under the exports folder
//! beneath the data root, which keeps a tool call from ever writing anywhere
//! else on disk.

// Registered by the integration task: `commands.rs` does not call into this
// module yet, so every item here is otherwise unreachable and would fail
// `clippy -D warnings`.
#![allow(dead_code)]

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

/// The longest file stem export writes, before the `.png` extension.
const MAX_STEM_CHARS: usize = 120;

/// Windows reserves these names regardless of extension or case.
const RESERVED_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
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
    // are the single-byte ASCII characters of ".png" or "..PNG", since a
    // UTF-8 continuation or lead byte always has its high bit set and so can
    // never equal one of those bytes after ASCII-lowercasing — only then is
    // slicing at `len() - 4` known to land on a char boundary.
    let has_png_extension = safe.to_ascii_lowercase().ends_with(".png");
    let (mut stem, extension) = if has_png_extension {
        let split = safe.len() - 4;
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

    Ok(if extension.is_empty() {
        format!("{stem}.png")
    } else {
        format!("{stem}{extension}")
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

/// Scales an image by an integer factor using nearest-neighbour sampling.
///
/// # Errors
///
/// Returns `export.invalid_scale` when `scale` is outside `1..=16`, or when
/// the scaled image would exceed [`MAX_EXPORT_SIDE`] on either side.
pub fn scaled(image: &RgbaImage, scale: u8) -> Result<RgbaImage, CommandError> {
    if !(1..=16).contains(&scale) {
        return Err(CommandError::new(
            "export.invalid_scale",
            format!("scale {scale} is outside 1..=16"),
        ));
    }
    let factor = u32::from(scale);
    let width = u32::from(image.width) * factor;
    let height = u32::from(image.height) * factor;
    if width > MAX_EXPORT_SIDE || height > MAX_EXPORT_SIDE {
        return Err(CommandError::new(
            "export.invalid_scale",
            format!("the scaled image {width}x{height} exceeds {MAX_EXPORT_SIDE}px a side"),
        ));
    }

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

/// Writes `image` as `directory/name`, refusing to clobber an existing file
/// unless `overwrite` is set.
///
/// The bytes land in a temporary file in the same directory first, then that
/// file is renamed over the target, so a process that dies mid-write leaves
/// no partial PNG behind.
///
/// # Errors
///
/// Returns `export.no_directory` when `directory` does not exist or is not a
/// directory, `export.exists` when the target is already there and
/// `overwrite` is false, and `export.write_failed` for any I/O failure.
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
    let target = directory.join(name);
    if !overwrite && target.exists() {
        return Err(CommandError::new(
            "export.exists",
            format!("{} already exists", target.display()),
        ));
    }

    let bytes = raster::png::encode(image).map_err(raster_failed)?;
    let temp = directory.join(format!(".{}.tmp", Uuid::now_v7()));
    fs::write(&temp, &bytes).map_err(|error| write_failed(&temp, &temp, error))?;
    fs::rename(&temp, &target).map_err(|error| write_failed(&temp, &target, error))?;
    Ok(target)
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

/// Exports several assets of the same size as one sprite sheet PNG.
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
    fn write_png_refuses_a_missing_directory() {
        let missing = std::env::temp_dir().join(format!("bitwright-missing-{}", Uuid::now_v7()));
        let image = solid_image(1, 1, [1, 2, 3, 255]);
        let error = write_png(&missing, "out.png", &image, false).unwrap_err();
        assert_eq!(code_of(&error), "export.no_directory");
    }

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
}
