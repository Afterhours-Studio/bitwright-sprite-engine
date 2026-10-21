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

//! Loading pictures: the file picker's work, done with an argument instead.
//!
//! The window asks a person to pick a file; an agent hands the picture over
//! either as an absolute `path` on this machine or as inline `dataBase64`
//! (with a `fileName` for the default name). Both end in the same shell
//! functions the window's commands call (`read_file`, `conform_meta`,
//! `probe_picture`, `pixelize_reference`), so the limits and error codes are
//! the window's: `reference.unreadable`, `reference.too_large`, `png.invalid`.

use super::super::error::ToolError;
use super::super::host::{with_store, DocumentHost};
use super::super::session::Session;
use super::{parse, resolve_asset, ToolResult, ToolSpec};
use crate::commands::CommandError;
use crate::reference::{self, MAX_REFERENCE_BYTES};
use crate::store::{AssetId, Reference};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;
use uuid::Uuid;

/// A `CommandError` as a `ToolError`, keeping its code. Its fields are private
/// to `commands.rs`, and reading them back through `Serialize` is simpler than
/// widening that type for this one caller.
fn tool_error(error: CommandError) -> ToolError {
    let value = serde_json::to_value(&error).unwrap_or_else(|_| json!({}));
    let text = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let code = text("code");
    let hint = match code.as_str() {
        "reference.unreadable" => "Pass an absolute path to a readable image file, or dataBase64.",
        "reference.too_large" => "A reference may be at most 20 MB.",
        _ => "Read the message; it names what was refused.",
    };
    ToolError::new(&code, text("detail"), hint)
}

fn bad_args(message: &str) -> ToolError {
    ToolError::new(
        "args.invalid",
        message,
        "Pass exactly one of path (absolute) or dataBase64 (with fileName).",
    )
}

/// The picture a tool was given, and the name its file suggests.
struct Picture {
    bytes: Vec<u8>,
    name: String,
}

/// Reads the picture from `path` or `dataBase64`, whichever was given.
fn load(
    path: Option<&str>,
    data_base64: Option<&str>,
    file_name: Option<&str>,
) -> Result<Picture, ToolError> {
    match (path, data_base64) {
        (Some(_), Some(_)) => Err(bad_args("path and dataBase64 were both given")),
        (None, None) => Err(bad_args("neither path nor dataBase64 was given")),
        (Some(path), None) => {
            if !Path::new(path).is_absolute() {
                return Err(bad_args("path must be absolute"));
            }
            Ok(Picture {
                bytes: reference::read_file(path).map_err(tool_error)?,
                name: reference::default_name(path),
            })
        }
        (None, Some(data)) => {
            // Tolerate a data URL: everything up to the first comma is its header.
            let data = data.split_once(',').map_or(data, |(_, rest)| rest);
            let bytes = reference::decode(data.trim()).map_err(tool_error)?;
            if bytes.len() as u64 > MAX_REFERENCE_BYTES {
                return Err(tool_error(CommandError::new(
                    "reference.too_large",
                    format!(
                        "the picture is {} bytes, over the {MAX_REFERENCE_BYTES} byte limit",
                        bytes.len()
                    ),
                )));
            }
            Ok(Picture {
                bytes,
                name: file_name.map_or_else(|| "reference".to_string(), reference::default_name),
            })
        }
    }
}

/// What the window's `reference_import` does after the file is read: conform
/// the picture to the asset's canvas through the engine when this host has one,
/// and store it as a reference. Without an engine the picture is stored as it
/// is, which is all a PNG needs to be pixelized.
fn import(
    host: &dyn DocumentHost,
    asset: AssetId,
    picture: Picture,
    name: Option<String>,
) -> Result<(Reference, crate::store::OpResult), ToolError> {
    let (width, height, max_slots) = with_store(host, |store| {
        let row = store.asset_read(asset)?;
        let rules = store.asset_rules(asset)?;
        Ok((u32::from(row.width), u32::from(row.height), rules.max_slots))
    })?;
    let name = name
        .filter(|given| !given.trim().is_empty())
        .unwrap_or(picture.name);
    let request = json!({
        "image": reference::encode(&picture.bytes),
        "width": width,
        "height": height,
        "removeBackground": true,
        "paletteSize": max_slots,
    });
    let (conformed, meta) = match host.conform(request) {
        Some(response) => {
            let response = response?;
            let image = response
                .get("image")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    ToolError::new(
                        "reference.unreadable",
                        "the conform response carried no image",
                        "Try another image.",
                    )
                })?;
            (
                Some(reference::decode(image).map_err(tool_error)?),
                reference::conform_meta(&response, width, height),
            )
        }
        None => (None, json!({ "width": width, "height": height })),
    };
    let stored = Reference {
        id: Uuid::now_v7(),
        asset_id: asset,
        name,
        source_png: picture.bytes,
        conformed,
        conform_meta: Some(meta),
        created_at: reference::now_millis(),
    };
    let op = with_store(host, |store| store.reference_write(stored.clone()))?;
    host.changed(asset, &op);
    Ok((stored, op))
}

fn picture_properties() -> Value {
    json!({
        "path": {
            "type": "string",
            "description": "Absolute path to an image file on this machine (at most 20 MB)."
        },
        "dataBase64": {
            "type": "string",
            "description": "The image file's bytes, base64 encoded. Use instead of path."
        },
        "fileName": {
            "type": "string",
            "description": "With dataBase64: the file's name, used for the default name."
        },
        "name": { "type": "string", "description": "What to call it; defaults to the file name." }
    })
}

// ---------------------------------------------------------------------------
// import_reference
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportReferenceArgs {
    asset_id: Option<String>,
    path: Option<String>,
    data_base64: Option<String>,
    file_name: Option<String>,
    name: Option<String>,
}

fn import_reference_schema() -> Value {
    let mut properties = picture_properties();
    properties["assetId"] = json!({ "type": "string", "format": "uuid" });
    json!({ "type": "object", "properties": properties, "additionalProperties": false })
}

fn import_reference(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: ImportReferenceArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let picture = load(
        args.path.as_deref(),
        args.data_base64.as_deref(),
        args.file_name.as_deref(),
    )?;
    let (stored, _) = import(host, asset, picture, args.name)?;
    Ok(json!({
        "reference": reference::summary(&stored),
        "hint": "Call read_reference, extract_palette or pixelize_reference with this referenceId.",
    }))
}

// ---------------------------------------------------------------------------
// png_to_pixel
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PngToPixelArgs {
    project_id: String,
    path: Option<String>,
    data_base64: Option<String>,
    file_name: Option<String>,
    name: Option<String>,
    layer: Option<String>,
    colors: Option<usize>,
}

fn png_to_pixel_schema() -> Value {
    let mut properties = picture_properties();
    properties["projectId"] = json!({ "type": "string", "format": "uuid" });
    properties["layer"] = json!({ "type": "string" });
    properties["colors"] = json!({ "type": "integer", "minimum": 1, "maximum": 62 });
    json!({
        "type": "object",
        "properties": properties,
        "required": ["projectId"],
        "additionalProperties": false
    })
}

fn png_to_pixel(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let args: PngToPixelArgs = parse(args)?;
    let project = Uuid::parse_str(&args.project_id).map_err(|_| {
        ToolError::new(
            "project.not_found",
            format!("{} does not name a project", args.project_id),
            "Call list_projects for valid ids.",
        )
    })?;
    let role = super::role(args.layer.as_deref().unwrap_or("silhouette"))?;
    let picture = load(
        args.path.as_deref(),
        args.data_base64.as_deref(),
        args.file_name.as_deref(),
    )?;

    // Measure first, so a file that is not a picture creates nothing. A file
    // that is not a PNG cannot be measured here, and takes the project's own
    // canvas, as the window does.
    let size = match reference::probe_picture(&picture.bytes) {
        Ok(probe) => Some((probe.canvas_width, probe.canvas_height)),
        Err(error) if error.code == "png.invalid" => None,
        Err(error) => return Err(error),
    };
    let name = args
        .name
        .clone()
        .filter(|given| !given.trim().is_empty())
        .unwrap_or_else(|| picture.name.clone());
    let asset = with_store(host, |store| {
        let (width, height) = match size {
            Some(size) => size,
            None => {
                let canvas = store.project_rules(project)?.canvas;
                (canvas.width, canvas.height)
            }
        };
        store.asset_create(project, &name, "character", width, height)
    })
    .map_err(|error| {
        if error.code == "asset.not_found" {
            ToolError::new(
                "project.not_found",
                error.message,
                "Call list_projects for valid ids.",
            )
        } else {
            error
        }
    })?;
    session.set_current_asset(asset.id);
    host.opened(asset.id);

    // The sprite is kept if a later step fails: it is a real row now, and the
    // error says so, so the agent can import again without choosing the size
    // twice.
    let kept = |error: ToolError| {
        ToolError::new(
            &error.code,
            format!("{} (the sprite {} was created)", error.message, asset.id.0),
            error.hint,
        )
    };
    let (stored, _) = import(host, asset.id, picture, args.name).map_err(kept)?;
    let (report, op) = {
        let arc = host.store();
        let mut store = arc.lock().map_err(|_| {
            ToolError::new(
                "store.lock_failed",
                "document store lock was poisoned",
                "Try the call again; the lock will have been released.",
            )
        })?;
        reference::pixelize_reference(
            &mut store,
            asset.id,
            stored.id,
            role,
            args.colors,
            true,
            &session.actor(),
        )
        .map_err(kept)?
    };
    host.changed(asset.id, &op);
    if report.palette_created {
        host.palette_changed(asset.id);
    }
    let mut value = serde_json::to_value(&report).unwrap_or(Value::Null);
    value["asset"] = serde_json::to_value(&asset).unwrap_or(Value::Null);
    value["referenceId"] = json!(stored.id.to_string());
    value["hint"] = json!("Call render_preview to see the result, then read_canvas to work on it.");
    Ok(value)
}

// ---------------------------------------------------------------------------

pub fn tools() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "import_reference",
            description: "Store a picture as a reference image on an asset, the way the \
                reference panel's import does. Give it as an absolute path on this machine \
                or as dataBase64 (with fileName). At most 20 MB; refused with \
                reference.unreadable or reference.too_large. Returns the reference's id, \
                size, palette and detected grid; follow with read_reference, \
                extract_palette or pixelize_reference.",
            input_schema: import_reference_schema,
            handler: import_reference,
        },
        ToolSpec {
            name: "png_to_pixel",
            description: "Make a new character sprite out of a picture in one call, like the \
                home screen's PNG to Pixel: the picture's own pixel grid is measured and the \
                sprite created at that size (16 to 512 a side), the picture is imported as \
                its reference, and it is pixelized into the silhouette layer (or `layer`) \
                with a palette made from it. Give the picture as an absolute path or as \
                dataBase64 (with fileName). A file that is not a PNG takes the project's \
                canvas and needs the app's engine; a PNG that is too large or empty creates \
                nothing. Opens the new sprite in this session.",
            input_schema: png_to_pixel_schema,
            handler: png_to_pixel,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::host::{Notice, RecordingHost};
    use crate::mcp::tools::call;
    use crate::store::Store;
    use base64::Engine as _;
    use bitwright::raster::pixelize::fixture;

    struct Fixture {
        host: RecordingHost,
        session: Session,
        project: Uuid,
        asset: AssetId,
    }

    fn fixture() -> Fixture {
        let mut store = Store::memory().unwrap();
        let project = store.project_create("demo", "32bit", "topdown").unwrap();
        let asset = store
            .asset_create(project.id, "hero", "character", 16, 16)
            .unwrap()
            .id;
        Fixture {
            host: RecordingHost::new(store),
            session: Session::new("s-1"),
            project: project.id,
            asset,
        }
    }

    fn run(f: &Fixture, tool: &str, args: Value) -> ToolResult {
        call(&f.host, &f.session, tool, args)
    }

    fn base64_of(bytes: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    /// A picture file on disk, in its own directory, removed on drop.
    struct TempFile(std::path::PathBuf);
    impl TempFile {
        fn new(name: &str, bytes: &[u8]) -> Self {
            let dir = std::env::temp_dir().join(format!("bitwright-files-{}", Uuid::now_v7()));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join(name);
            std::fs::write(&path, bytes).unwrap();
            Self(path)
        }
        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }
    impl Drop for TempFile {
        fn drop(&mut self) {
            if let Some(dir) = self.0.parent() {
                let _ = std::fs::remove_dir_all(dir);
            }
        }
    }

    #[test]
    fn import_reference_reads_a_path_and_names_it_after_the_file() {
        let f = fixture();
        let file = TempFile::new("sofia.png", &fixture::fake_png(7.5, 20, 6));
        let out = run(
            &f,
            "import_reference",
            json!({ "assetId": f.asset.0.to_string(), "path": file.path() }),
        )
        .unwrap();
        assert_eq!(out["reference"]["name"], "sofia");
        let listed = run(
            &f,
            "list_references",
            json!({ "assetId": f.asset.0.to_string() }),
        );
        assert_eq!(listed.unwrap()["references"].as_array().unwrap().len(), 1);
        assert!(f.host.notices().contains(&Notice::Changed(f.asset)));
    }

    #[test]
    fn import_reference_reads_inline_base64_and_a_custom_name() {
        let f = fixture();
        f.session.set_current_asset(f.asset);
        let data = base64_of(&fixture::fake_png(7.5, 20, 6));
        let out = run(
            &f,
            "import_reference",
            json!({ "dataBase64": data, "fileName": "walk.png", "name": "walk sheet" }),
        )
        .unwrap();
        assert_eq!(out["reference"]["name"], "walk sheet");
        let unnamed = run(
            &f,
            "import_reference",
            json!({ "dataBase64": base64_of(&fixture::blank_png(4, 4)), "fileName": "idle.png" }),
        )
        .unwrap();
        assert_eq!(unnamed["reference"]["name"], "idle");
    }

    #[test]
    fn import_reference_refuses_what_the_window_refuses() {
        let f = fixture();
        let asset = f.asset.0.to_string();
        let missing = std::env::temp_dir().join(format!("nope-{}.png", Uuid::now_v7()));
        let unreadable = run(
            &f,
            "import_reference",
            json!({ "assetId": asset, "path": missing.to_string_lossy() }),
        );
        assert_eq!(unreadable.unwrap_err().code, "reference.unreadable");
        let bad_base64 = run(
            &f,
            "import_reference",
            json!({ "assetId": asset, "dataBase64": "***" }),
        );
        assert_eq!(bad_base64.unwrap_err().code, "reference.unreadable");
        let big = base64_of(&vec![0u8; MAX_REFERENCE_BYTES as usize + 1]);
        let too_large = run(
            &f,
            "import_reference",
            json!({ "assetId": asset, "dataBase64": big }),
        );
        assert_eq!(too_large.unwrap_err().code, "reference.too_large");
    }

    #[test]
    fn import_reference_needs_exactly_one_source_and_an_asset() {
        let f = fixture();
        let asset = f.asset.0.to_string();
        let neither = run(&f, "import_reference", json!({ "assetId": asset }));
        assert_eq!(neither.unwrap_err().code, "args.invalid");
        let both = run(
            &f,
            "import_reference",
            json!({ "assetId": asset, "path": "/x.png", "dataBase64": "AA==" }),
        );
        assert_eq!(both.unwrap_err().code, "args.invalid");
        let relative = run(
            &f,
            "import_reference",
            json!({ "assetId": asset, "path": "x.png" }),
        );
        assert_eq!(relative.unwrap_err().code, "args.invalid");
        let no_asset = run(&f, "import_reference", json!({ "dataBase64": "AA==" }));
        assert_eq!(no_asset.unwrap_err().code, "asset.not_open");
        let unknown = run(
            &f,
            "import_reference",
            json!({ "assetId": Uuid::now_v7().to_string(), "dataBase64": "AA==" }),
        );
        assert_eq!(unknown.unwrap_err().code, "asset.not_found");
    }

    #[test]
    fn png_to_pixel_creates_imports_and_pixelizes_from_a_path() {
        let f = fixture();
        let file = TempFile::new("hero-art.png", &fixture::fake_png(7.5, 20, 6));
        let out = run(
            &f,
            "png_to_pixel",
            json!({ "projectId": f.project.to_string(), "path": file.path(), "colors": 3 }),
        )
        .unwrap();
        assert_eq!(out["asset"]["name"], "hero-art");
        assert_eq!(out["layer"], "silhouette");
        assert_eq!(out["paletteCreated"], json!(true));
        let created = out["asset"]["id"].as_str().unwrap();
        assert_eq!(f.session.current_asset().unwrap().0.to_string(), created);
        let canvas = run(&f, "read_canvas", json!({ "layer": "silhouette" })).unwrap();
        assert!(canvas["text"].as_str().unwrap().contains('A'));
        let refs = run(&f, "list_references", json!({})).unwrap();
        assert_eq!(refs["references"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn png_to_pixel_accepts_inline_base64() {
        let f = fixture();
        let data = base64_of(&fixture::fake_png(7.5, 20, 6));
        let out = run(
            &f,
            "png_to_pixel",
            json!({
                "projectId": f.project.to_string(),
                "dataBase64": data,
                "fileName": "knight.png",
                "name": "Knight"
            }),
        )
        .unwrap();
        assert_eq!(out["asset"]["name"], "Knight");
    }

    #[test]
    fn png_to_pixel_creates_nothing_when_the_picture_is_refused() {
        let f = fixture();
        let project = f.project.to_string();
        let before = with_store(&f.host, |s| s.asset_list(f.project))
            .unwrap()
            .len();
        let blank = run(
            &f,
            "png_to_pixel",
            json!({ "projectId": project, "dataBase64": base64_of(&fixture::blank_png(8, 8)) }),
        );
        assert_eq!(blank.unwrap_err().code, "pixelize.empty");
        let missing = std::env::temp_dir().join(format!("nope-{}.png", Uuid::now_v7()));
        let unreadable = run(
            &f,
            "png_to_pixel",
            json!({ "projectId": project, "path": missing.to_string_lossy() }),
        );
        assert_eq!(unreadable.unwrap_err().code, "reference.unreadable");
        let after = with_store(&f.host, |s| s.asset_list(f.project))
            .unwrap()
            .len();
        assert_eq!(before, after);
    }

    #[test]
    fn png_to_pixel_refuses_bad_arguments() {
        let f = fixture();
        let data = base64_of(&fixture::fake_png(7.5, 20, 6));
        let unknown = run(
            &f,
            "png_to_pixel",
            json!({ "projectId": Uuid::now_v7().to_string(), "dataBase64": data }),
        );
        assert_eq!(unknown.unwrap_err().code, "project.not_found");
        let malformed = run(
            &f,
            "png_to_pixel",
            json!({ "projectId": "x", "dataBase64": data }),
        );
        assert_eq!(malformed.unwrap_err().code, "project.not_found");
        let layer = run(
            &f,
            "png_to_pixel",
            json!({ "projectId": f.project.to_string(), "dataBase64": data, "layer": "bg" }),
        );
        assert_eq!(layer.unwrap_err().code, "layer.unknown_role");
        let neither = run(
            &f,
            "png_to_pixel",
            json!({ "projectId": f.project.to_string() }),
        );
        assert_eq!(neither.unwrap_err().code, "args.invalid");
    }
}
