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

//! Reference images: the pictures a person imports to draw against.
//!
//! An import keeps two payloads. The bytes the person picked stay untouched so
//! the reference can be re-conformed at another size later, while the conformed
//! PNG is what the canvas actually shows behind the sprite. Conforming happens
//! in the sidecar, so the shell only moves bytes and reads the answer back.

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Runtime, State};
use uuid::Uuid;

use crate::commands::{
    document::{notify_changed, DocumentState, PaletteEvent, EVENT_PALETTE},
    CommandError,
};
use crate::engine::{self, Method};
use crate::mcp::error::ToolError;
use crate::raster::Palette;
use crate::store::models::{AssetId, OpResult, Reference};
use crate::store::Store;

/// The largest file the shell will read. Anything bigger is almost certainly
/// the wrong file, and reading it would block the shell for seconds.
const MAX_REFERENCE_BYTES: u64 = 20 * 1024 * 1024;

/// The prefix of a PNG carried inline to the webview.
const PNG_DATA_URL_PREFIX: &str = "data:image/png;base64,";

/// The grid the sidecar believes the reference is built from.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedGrid {
    pub cell_width: f64,
    pub cell_height: f64,
    pub confidence: f64,
}

/// What the frontend is told about a stored reference.
///
/// The pixels never travel with this: the list is drawn for every asset, while
/// the image itself is asked for one reference at a time by `reference_preview`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSummary {
    pub id: Uuid,
    pub asset_id: AssetId,
    pub name: String,
    pub created_at: i64,
    pub width: u32,
    pub height: u32,
    pub palette: Vec<String>,
    pub detected: Option<DetectedGrid>,
    pub warnings: Vec<String>,
}

/// The summary of a stored reference, read from its conform_meta.
pub fn summary(reference: &Reference) -> ReferenceSummary {
    let meta = reference.conform_meta.as_ref();
    let list = |key: &str| -> Vec<String> {
        meta.and_then(|meta| meta.get(key))
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    };
    ReferenceSummary {
        id: reference.id,
        asset_id: reference.asset_id,
        name: reference.name.clone(),
        created_at: reference.created_at,
        width: dimension(meta, "width"),
        height: dimension(meta, "height"),
        palette: list("palette"),
        detected: meta
            .and_then(|meta| meta.get("detected"))
            .and_then(detected),
        warnings: list("warnings"),
    }
}

/// A size the sidecar reported, or zero when it did not report one.
fn dimension(meta: Option<&Value>, key: &str) -> u32 {
    meta.and_then(|meta| meta.get(key))
        .and_then(Value::as_u64)
        .unwrap_or(0)
        .try_into()
        .unwrap_or(0)
}

/// The detected grid, tolerating either naming the sidecar has used.
fn detected(value: &Value) -> Option<DetectedGrid> {
    let number = |keys: &[&str]| -> Option<f64> {
        keys.iter()
            .filter_map(|key| value.get(*key))
            .find_map(Value::as_f64)
    };
    Some(DetectedGrid {
        cell_width: number(&["cellWidth", "cell_width"])?,
        cell_height: number(&["cellHeight", "cell_height"])?,
        confidence: number(&["confidence"]).unwrap_or(0.0),
    })
}

/// Inlines bytes as a PNG the webview can show without another round trip.
fn data_url(bytes: &[u8]) -> String {
    format!(
        "{PNG_DATA_URL_PREFIX}{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn decode(text: &str) -> Result<Vec<u8>, CommandError> {
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .map_err(|error| CommandError::new("reference.unreadable", error.to_string()))
}

fn lock_failed() -> CommandError {
    CommandError::new("store.lock_failed", "document store lock was poisoned")
}

fn worker_failed(error: impl std::fmt::Display) -> CommandError {
    CommandError::new("store.worker_failed", error.to_string())
}

fn app_failed(error: crate::store::AppError) -> CommandError {
    CommandError::new(error.code, error.detail)
}

fn tool_failed(error: ToolError) -> CommandError {
    CommandError::new(error.code, format!("{}: {}", error.message, error.hint))
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis() as i64)
        .unwrap_or(0)
}

/// Reads the picked file, refusing one that is too big to be a reference.
fn read_file(path: &str) -> Result<Vec<u8>, CommandError> {
    let file = Path::new(path);
    let metadata = fs::metadata(file)
        .map_err(|error| CommandError::new("reference.unreadable", format!("{path}: {error}")))?;
    if !metadata.is_file() {
        return Err(CommandError::new(
            "reference.unreadable",
            format!("{path} is not a file"),
        ));
    }
    if metadata.len() > MAX_REFERENCE_BYTES {
        return Err(CommandError::new(
            "reference.too_large",
            format!(
                "{path} is {} bytes, over the {MAX_REFERENCE_BYTES} byte limit",
                metadata.len()
            ),
        ));
    }
    fs::read(file)
        .map_err(|error| CommandError::new("reference.unreadable", format!("{path}: {error}")))
}

/// Falls back to the file stem, which is the name the person recognises.
fn default_name(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(str::to_string)
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "reference".to_string())
}

/// Keeps the fields the shell understands, dropping anything the sidecar left
/// out so a missing key never arrives as a JSON null.
fn conform_meta(response: &Value, width: u32, height: u32) -> Value {
    let mut meta = Map::new();
    meta.insert(
        "width".to_string(),
        response
            .get("width")
            .cloned()
            .unwrap_or_else(|| json!(width)),
    );
    meta.insert(
        "height".to_string(),
        response
            .get("height")
            .cloned()
            .unwrap_or_else(|| json!(height)),
    );
    for key in ["palette", "detected", "warnings"] {
        if let Some(value) = response.get(key) {
            meta.insert(key.to_string(), value.clone());
        }
    }
    Value::Object(meta)
}

/// Opens the system's own file picker for an image to import as a reference.
///
/// The path it returns is what `reference_import` reads; the webview never
/// reads the file itself.
///
/// # Errors
///
/// Returns `reference.picker_failed` when the dialog could not be shown, or was
/// closed in a way that lost its answer.
#[tauri::command]
pub async fn reference_pick_file<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<String>, CommandError> {
    use tauri_plugin_dialog::DialogExt;

    let (sender, receiver) = tokio::sync::oneshot::channel();
    // The callback form, not the blocking one: on macOS and Linux the dialog
    // has to run on the main thread, and a command never does.
    app.dialog()
        .file()
        .add_filter("Image", &["png", "jpg", "jpeg", "webp", "gif", "bmp"])
        .pick_file(move |picked| {
            let _ = sender.send(picked);
        });
    let picked = receiver.await.map_err(|error| {
        CommandError::new("reference.picker_failed", format!("no answer: {error}"))
    })?;
    Ok(picked
        .and_then(|file| file.into_path().ok())
        .map(|path| path.display().to_string()))
}

/// Imports a picture the person picked and stores it on the asset.
///
/// # Errors
///
/// Returns `reference.too_large` for a file over 20 MB, `reference.unreadable`
/// when it cannot be read, `store.lock_failed` when the store is poisoned, and
/// the engine's reason code when conforming fails.
#[tauri::command]
pub async fn reference_import<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    path: String,
    name: Option<String>,
) -> Result<ReferenceSummary, CommandError> {
    let bytes = read_file(&path)?;
    let name = name
        .filter(|given| !given.trim().is_empty())
        .unwrap_or_else(|| default_name(&path));

    let store = state.store();
    let (width, height, max_slots) = tauri::async_runtime::spawn_blocking(move || {
        let store = store.lock().map_err(|_| lock_failed())?;
        let asset = store.asset_read(asset_id).map_err(app_failed)?;
        let rules = store.asset_rules(asset_id).map_err(app_failed)?;
        Ok::<_, CommandError>((
            u32::from(asset.width),
            u32::from(asset.height),
            rules.max_slots,
        ))
    })
    .await
    .map_err(worker_failed)??;

    let response = engine::call(
        &app,
        Method::Post,
        "/v1/conform",
        Some(json!({
            "image": encode(&bytes),
            "width": width,
            "height": height,
            "removeBackground": true,
            "paletteSize": max_slots,
        })),
    )
    .await
    .map_err(CommandError::from)?;

    let conformed = decode(
        response
            .get("image")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                CommandError::new(
                    "reference.unreadable",
                    "the conform response carried no image",
                )
            })?,
    )?;

    let reference = Reference {
        id: Uuid::now_v7(),
        asset_id,
        name,
        source_png: bytes,
        conformed: Some(conformed),
        conform_meta: Some(conform_meta(&response, width, height)),
        created_at: now_millis(),
    };

    let store = state.store();
    let stored = tauri::async_runtime::spawn_blocking(move || {
        let mut store = store.lock().map_err(|_| lock_failed())?;
        store
            .reference_write(reference.clone())
            .map_err(app_failed)?;
        store
            .reference_read(reference.asset_id, reference.id)
            .map_err(app_failed)
    })
    .await
    .map_err(worker_failed)??;

    Ok(summary(&stored))
}

/// Every reference stored on an asset, newest metadata included.
///
/// # Errors
///
/// Returns `store.lock_failed` when the store is poisoned and the store's
/// reason code when the asset is missing.
#[tauri::command]
pub async fn reference_list(
    state: State<'_, DocumentState>,
    asset_id: AssetId,
) -> Result<Vec<ReferenceSummary>, CommandError> {
    let store = state.store();
    let references = tauri::async_runtime::spawn_blocking(move || {
        let store = store.lock().map_err(|_| lock_failed())?;
        store.reference_list(asset_id).map_err(app_failed)
    })
    .await
    .map_err(worker_failed)??;
    Ok(references.iter().map(summary).collect())
}

/// The conformed PNG of one reference, inlined as a data URL.
///
/// # Errors
///
/// Returns `reference.not_found` when the reference is not on the asset and
/// `reference.not_conformed` when it was stored without a conformed image.
#[tauri::command]
pub async fn reference_preview(
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    reference_id: Uuid,
) -> Result<String, CommandError> {
    let store = state.store();
    let url = tauri::async_runtime::spawn_blocking(move || {
        let store = store.lock().map_err(|_| lock_failed())?;
        let reference = store
            .reference_read(asset_id, reference_id)
            .map_err(app_failed)?;
        reference.conformed.as_deref().map(data_url).ok_or_else(|| {
            CommandError::new(
                "reference.not_conformed",
                format!("reference {reference_id} has no conformed image"),
            )
        })
    })
    .await
    .map_err(worker_failed)??;
    Ok(url)
}

/// Drops a reference from the asset.
///
/// # Errors
///
/// Returns `store.lock_failed` when the store is poisoned and the store's
/// reason code when the reference is missing.
#[tauri::command]
pub async fn reference_delete(
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    reference_id: Uuid,
) -> Result<(), CommandError> {
    let store = state.store();
    tauri::async_runtime::spawn_blocking(move || {
        let mut store = store.lock().map_err(|_| lock_failed())?;
        store
            .reference_delete(asset_id, reference_id)
            .map_err(app_failed)
    })
    .await
    .map_err(worker_failed)??;
    Ok(())
}

/// Turns a reference's colours into a palette, checks it against the asset's
/// style, and writes it — the part of `reference_apply_palette` that only
/// touches the store, so it runs the same under a test as under the window.
fn apply_reference_palette(
    store: &mut Store,
    asset_id: AssetId,
    reference_id: Uuid,
    max_slots: u8,
) -> Result<(Palette, OpResult), CommandError> {
    let reference = store
        .reference_read(asset_id, reference_id)
        .map_err(app_failed)?;
    let rules = store.asset_rules(asset_id).map_err(app_failed)?;
    let ramps = crate::mcp::tools::reference::extracted_ramps(&reference, max_slots as usize)
        .map_err(tool_failed)?;
    let ramps: Vec<_> = serde_json::from_value(ramps).map_err(|error| {
        CommandError::new(
            "reference.invalid_ramp",
            format!("extract_palette produced ramps set_palette cannot read: {error}"),
        )
    })?;
    let palette = crate::mcp::tools::palette::build_palette(&ramps).map_err(tool_failed)?;
    crate::mcp::tools::palette::check_palette(&palette, &rules).map_err(tool_failed)?;
    store.palette_write(asset_id, palette).map_err(app_failed)
}

/// Extracts the reference's colours into ramps and makes them the asset's
/// palette in one step, the way a person would after eyeballing `extract_palette`
/// and handing its ramps straight to `set_palette`.
///
/// # Errors
///
/// Returns `store.lock_failed` when the store is poisoned, the store's reason
/// code when the asset or reference is missing, and `palette.rule_violation`
/// (or another `args.invalid`/`palette.*` code) when the extracted ramps do
/// not pass the asset's style rules.
#[tauri::command]
pub async fn reference_apply_palette<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DocumentState>,
    asset_id: AssetId,
    reference_id: Uuid,
    max_slots: Option<u8>,
) -> Result<Palette, CommandError> {
    let max_slots = max_slots.unwrap_or(32);
    let store = state.store();
    let (palette, op) = tauri::async_runtime::spawn_blocking(move || {
        let mut store = store.lock().map_err(|_| lock_failed())?;
        apply_reference_palette(&mut store, asset_id, reference_id, max_slots)
    })
    .await
    .map_err(worker_failed)??;

    // Like a palette written by hand: the history moves, and the palette
    // panel reloads.
    notify_changed(&app, &state, asset_id, &op);
    let _ = app.emit(EVENT_PALETTE, PaletteEvent { asset_id });
    Ok(palette)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored(conform_meta: Option<Value>) -> Reference {
        Reference {
            id: Uuid::now_v7(),
            asset_id: AssetId(Uuid::now_v7()),
            name: "walk-cycle-sheet".to_string(),
            source_png: vec![137, 80, 78, 71],
            conformed: Some(vec![137, 80, 78, 71]),
            conform_meta,
            created_at: 1_700_000_000_000,
        }
    }

    #[test]
    fn summary_reads_a_full_conform_meta() {
        let reference = stored(Some(json!({
            "width": 64,
            "height": 64,
            "palette": ["#101820", "#f7f3ee"],
            "detected": { "cellWidth": 32.0, "cellHeight": 32.0, "confidence": 0.87 },
            "warnings": ["palette clipped"],
        })));
        let summary = summary(&reference);
        assert_eq!(summary.id, reference.id);
        assert_eq!(summary.asset_id, reference.asset_id);
        assert_eq!(summary.name, "walk-cycle-sheet");
        assert_eq!(summary.created_at, 1_700_000_000_000);
        assert_eq!((summary.width, summary.height), (64, 64));
        assert_eq!(summary.palette, vec!["#101820", "#f7f3ee"]);
        assert_eq!(summary.warnings, vec!["palette clipped"]);
        let detected = summary.detected.expect("the grid was detected");
        assert_eq!(detected.cell_width, 32.0);
        assert_eq!(detected.cell_height, 32.0);
        assert_eq!(detected.confidence, 0.87);
    }

    #[test]
    fn summary_of_a_reference_never_conformed_is_empty_but_identifying() {
        let reference = stored(None);
        let summary = summary(&reference);
        assert_eq!(summary.width, 0);
        assert_eq!(summary.height, 0);
        assert!(summary.palette.is_empty());
        assert!(summary.warnings.is_empty());
        assert!(summary.detected.is_none());
        assert_eq!(summary.name, "walk-cycle-sheet");
    }

    #[test]
    fn a_meta_without_detection_reports_no_grid() {
        let reference = stored(Some(json!({
            "width": 48,
            "height": 32,
            "palette": [],
            "warnings": [],
        })));
        let summary = summary(&reference);
        assert!(summary.detected.is_none());
        assert_eq!((summary.width, summary.height), (48, 32));
    }

    #[test]
    fn summary_reaches_the_frontend_in_camel_case() {
        let reference = stored(Some(json!({
            "width": 16,
            "height": 16,
            "detected": { "cellWidth": 8.0, "cellHeight": 8.0, "confidence": 1.0 },
        })));
        let wire = serde_json::to_value(summary(&reference)).unwrap();
        assert!(wire.get("assetId").is_some());
        assert!(wire.get("createdAt").is_some());
        assert!(wire.get("detected").unwrap().get("cellWidth").is_some());
        assert!(wire.get("cell_width").is_none());
    }

    #[test]
    fn a_preview_is_inlined_as_a_png_data_url() {
        assert_eq!(data_url(b"ab"), format!("{PNG_DATA_URL_PREFIX}YWI="));
        assert!(data_url(&[]).starts_with("data:image/png;base64,"));
    }

    #[test]
    fn the_name_falls_back_to_the_file_stem() {
        assert_eq!(default_name("D:/art/walk cycle.PNG"), "walk cycle");
        assert_eq!(default_name("sheet."), "sheet");
        assert_eq!(default_name(""), "reference");
    }

    #[test]
    fn conform_meta_keeps_only_what_the_sidecar_reported() {
        let meta = conform_meta(
            &json!({ "palette": ["#000000"], "extra": "ignored" }),
            96,
            48,
        );
        assert_eq!(meta["width"], json!(96));
        assert_eq!(meta["height"], json!(48));
        assert_eq!(meta["palette"], json!(["#000000"]));
        assert!(meta.get("detected").is_none());
        assert!(meta.get("extra").is_none());
    }

    #[test]
    fn a_directory_is_refused_as_unreadable() {
        // A directory has metadata but is not a file, so the same guard that
        // reads size also rejects the path the dialog should never return.
        let error = read_file(env!("CARGO_MANIFEST_DIR")).unwrap_err();
        let error = serde_json::to_value(&error).unwrap();
        assert_eq!(error["code"], "reference.unreadable");
    }

    // -----------------------------------------------------------------
    // apply_reference_palette
    // -----------------------------------------------------------------

    /// A conformed PNG the size of the test asset, one `colours` entry per
    /// pixel in a single row — enough for `extracted_ramps` to read the
    /// colours back in the same order they were given, without a
    /// `conform_meta.palette` hint.
    fn conformed_png(colours: &[[u8; 4]]) -> Vec<u8> {
        let mut data = Vec::with_capacity(colours.len() * 4);
        for rgba in colours {
            data.extend_from_slice(rgba);
        }
        let image = crate::raster::RgbaImage {
            width: colours.len() as u16,
            height: 1,
            data,
        };
        crate::raster::png::encode(&image).expect("a small RGBA image encodes")
    }

    /// A project, a character asset the size of `colours`, and a stored
    /// reference conformed to it.
    fn setup_with_reference(colours: &[[u8; 4]]) -> (Store, AssetId, Uuid) {
        let mut store = Store::memory().unwrap();
        let project = store.project_create("demo", "hd2d").unwrap();
        let asset = store
            .asset_create(project.id, "hero", "character", colours.len() as u16, 1)
            .unwrap();
        let reference_id = Uuid::now_v7();
        store
            .reference_write(Reference {
                id: reference_id,
                asset_id: asset.id,
                name: "sheet".to_string(),
                source_png: conformed_png(colours),
                conformed: Some(conformed_png(colours)),
                conform_meta: None,
                created_at: 1_700_000_000_000,
            })
            .unwrap();
        (store, asset.id, reference_id)
    }

    /// Three 3-step ramps, one per RGB primary's neighbourhood (blue, green,
    /// amber), each built to the hd2d style guide's §2.4 step-lightness,
    /// hue-shift and chroma-shift bounds for a non-skin material, and placed
    /// so the darkest slot of the blue ramp sits at the value floor and the
    /// lightest slot of the amber ramp sits at the value ceiling. Together
    /// they pass the hd2d gate as a whole the way palette.rs's own
    /// documented example does with seven ramps — no single 3-4 step ramp
    /// can span the floor to the ceiling on its own at the style's own
    /// per-step budget.
    const PASSING_RAMPS: [[u8; 4]; 9] = [
        [0x00, 0x04, 0x25, 255],
        [0x00, 0x1E, 0x46, 255],
        [0x10, 0x40, 0x5C, 255],
        [0x31, 0x50, 0x22, 255],
        [0x52, 0x6D, 0x34, 255],
        [0x80, 0x8D, 0x5D, 255],
        [0xBB, 0x8D, 0x52, 255],
        [0xE7, 0xA7, 0x83, 255],
        [0xFF, 0xC9, 0xBF, 255],
    ];

    /// A flat grey ramp: same lightness step, no hue shift, which the hd2d
    /// style gate refuses.
    const GREY_RAMP: [[u8; 4]; 4] = [
        [0x30, 0x30, 0x30, 255],
        [0x60, 0x60, 0x60, 255],
        [0x90, 0x90, 0x90, 255],
        [0xC0, 0xC0, 0xC0, 255],
    ];

    #[test]
    fn a_passing_reference_becomes_the_assets_palette() {
        let (mut store, asset_id, reference_id) = setup_with_reference(&PASSING_RAMPS);
        let (palette, _) = apply_reference_palette(&mut store, asset_id, reference_id, 32)
            .unwrap_or_else(|error| panic!("expected the reference's colours to pass: {error:?}"));
        assert_eq!(palette.slots.len(), 9);
        assert_eq!(palette.ramps.len(), 3);
        let hexes: Vec<String> = palette
            .slots
            .iter()
            .map(|slot| hex_of_test(&slot.rgba))
            .collect();
        for rgba in &PASSING_RAMPS {
            let hex = hex_of_test(rgba);
            assert!(hexes.contains(&hex), "missing {hex} in {hexes:?}");
        }
        // The write actually landed on the asset, not just in the return value.
        let document = store.asset_open(asset_id).unwrap();
        assert_eq!(document.palette.slots.len(), 9);
    }

    #[test]
    fn a_flat_ramp_is_refused_as_a_rule_violation() {
        let (mut store, asset_id, reference_id) = setup_with_reference(&GREY_RAMP);
        let error = apply_reference_palette(&mut store, asset_id, reference_id, 32).unwrap_err();
        let error = serde_json::to_value(&error).unwrap();
        assert_eq!(error["code"], "palette.rule_violation");
    }

    fn hex_of_test(rgba: &[u8; 4]) -> String {
        format!("#{:02X}{:02X}{:02X}", rgba[0], rgba[1], rgba[2])
    }
}
