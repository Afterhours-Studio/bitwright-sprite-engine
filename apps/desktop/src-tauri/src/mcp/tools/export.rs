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

//! Export: writes a PNG into the MCP exports folder.
//!
//! An agent cannot name a folder. Its files always land under
//! `crate::export::exports_root()/<safe project folder>/`, which is created
//! from the project's own name the same way a file name is made safe, so a
//! tool call can never write anywhere else on disk.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use super::super::error::ToolError;
use super::super::host::DocumentHost;
use super::super::session::Session;
use super::{asset_id, parse, resolve_asset, ToolResult, ToolSpec};
use crate::commands::CommandError;
use crate::export::{self, ExportResult};
use crate::store::AppError;

/// The pattern `export_png` uses when the caller gives no `name`.
const DEFAULT_PATTERN: &str = "{asset}@{scale}x";

/// Turns a [`CommandError`] into a [`ToolError`], keeping its code. Its
/// fields are private to `commands.rs` — reading them back out through
/// `Serialize` is simpler than adding an accessor there just for this.
fn tool_error(error: CommandError) -> ToolError {
    let value = serde_json::to_value(&error).unwrap_or_else(|_| json!({}));
    let code = value
        .get("code")
        .and_then(Value::as_str)
        .unwrap_or("export.failed")
        .to_string();
    let detail = value
        .get("detail")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    ToolError::from(AppError::new(&code, detail))
}

/// The refusal for a poisoned store lock, phrased the way `with_store` phrases
/// it — export needs its own since it also renders and writes outside the
/// lock, which `with_store` does not support.
fn lock_failed<T>(_: T) -> ToolError {
    ToolError::new(
        "store.lock_failed",
        "document store lock was poisoned",
        "Try the call again; the lock will have been released.",
    )
}

/// The project's folder under the exports root, creating it if needed.
///
/// Only the project's name and id are needed for this, both already read out
/// of the store by the time it is called — callers create the folder after
/// releasing the store lock, so the filesystem call never holds it up.
fn project_folder(root: &Path, project_name: &str, project_id: Uuid) -> Result<PathBuf, ToolError> {
    let dir = root.join(export::safe_folder_name(project_name, project_id));
    fs::create_dir_all(&dir).map_err(|error| {
        ToolError::new(
            "export.no_directory",
            format!("{}: {error}", dir.display()),
            "The exports folder could not be created; check the data root is writable.",
        )
    })?;
    Ok(dir)
}

fn export_result(path: PathBuf, image: &crate::raster::RgbaImage) -> Value {
    serde_json::to_value(ExportResult {
        path: path.to_string_lossy().into_owned(),
        width: u32::from(image.width),
        height: u32::from(image.height),
    })
    .expect("ExportResult is plain data and always serializes")
}

// ---------------------------------------------------------------------------
// export_png
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExportPngArgs {
    asset_id: Option<String>,
    scale: Option<u8>,
    name: Option<String>,
    overwrite: Option<bool>,
}

fn export_png_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetId": {
                "type": "string",
                "description": "The asset to export; defaults to the session's open asset.",
            },
            "scale": {
                "type": "integer",
                "minimum": 1,
                "maximum": 16,
                "description": "Integer upscale factor, nearest-neighbour. Defaults to 1.",
            },
            "name": {
                "type": "string",
                "description": "A file name pattern: {project}, {asset}, {kind} and {scale} \
                    are substituted, then the result is made a safe file name. Defaults to \
                    '{asset}@{scale}x'.",
            },
            "overwrite": {
                "type": "boolean",
                "description": "Replace a file already at that name instead of refusing. \
                    Defaults to false.",
            },
        },
        "additionalProperties": false,
    })
}

/// The body of `export_png`, taking the exports root explicitly so tests
/// never touch the real one.
fn export_png_at(
    host: &dyn DocumentHost,
    session: &Session,
    args: Value,
    root: &Path,
) -> ToolResult {
    let args: ExportPngArgs = parse(args)?;
    let asset = resolve_asset(session, args.asset_id.as_deref())?;
    let scale = args.scale.unwrap_or(1);
    let pattern = args.name.unwrap_or_else(|| DEFAULT_PATTERN.to_string());
    let overwrite = args.overwrite.unwrap_or(false);

    let arc = host.store();
    let (name, project_name, project_id, image) = {
        let store = arc.lock().map_err(lock_failed)?;
        let asset_record = store.asset_read(asset).map_err(ToolError::from)?;
        let project = store
            .project_read(asset_record.project_id)
            .map_err(ToolError::from)?;
        let image = export::render_asset(&store, asset, scale).map_err(tool_error)?;
        let name = export::file_name(
            &pattern,
            &project.name,
            &asset_record.name,
            &asset_record.kind,
            scale,
        )
        .map_err(tool_error)?;
        (name, project.name, project.id, image)
    };

    // The folder is created only after the lock above is released: it needs
    // nothing from the store but the project's name and id, and creating a
    // directory is a filesystem call that has no business holding up every
    // other tool waiting on the same document lock.
    let directory = project_folder(root, &project_name, project_id)?;
    let path = export::write_png(&directory, &name, &image, overwrite).map_err(tool_error)?;
    Ok(export_result(path, &image))
}

fn export_png(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let root = export::exports_root().map_err(tool_error)?;
    export_png_at(host, session, args, &root)
}

// ---------------------------------------------------------------------------
// export_sheet
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExportSheetArgs {
    asset_ids: Vec<String>,
    columns: Option<u16>,
    scale: Option<u8>,
    name: String,
    overwrite: Option<bool>,
}

fn export_sheet_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "assetIds": {
                "type": "array",
                "items": { "type": "string" },
                "description": "The assets to lay out, in order, all the same size and all in \
                    one project.",
            },
            "columns": {
                "type": "integer",
                "minimum": 1,
                "description": "How many assets per row. Defaults to the number of assets \
                    (one row).",
            },
            "scale": {
                "type": "integer",
                "minimum": 1,
                "maximum": 16,
                "description": "Integer upscale factor, nearest-neighbour. Defaults to 1.",
            },
            "name": {
                "type": "string",
                "description": "A file name pattern: {project} and {scale} are substituted \
                    ({asset} and {kind} become 'sheet'), then the result is made a safe file \
                    name.",
            },
            "overwrite": {
                "type": "boolean",
                "description": "Replace a file already at that name instead of refusing. \
                    Defaults to false.",
            },
        },
        "required": ["assetIds", "name"],
        "additionalProperties": false,
    })
}

fn export_sheet_at(
    host: &dyn DocumentHost,
    _session: &Session,
    args: Value,
    root: &Path,
) -> ToolResult {
    let args: ExportSheetArgs = parse(args)?;
    if args.asset_ids.is_empty() {
        return Err(ToolError::new(
            "export.empty",
            "no assets to lay out in a sheet",
            "Pass at least one assetId.",
        ));
    }
    let mut assets = Vec::with_capacity(args.asset_ids.len());
    for raw in &args.asset_ids {
        assets.push(asset_id(raw)?);
    }
    let scale = args.scale.unwrap_or(1);
    let columns = args
        .columns
        .unwrap_or_else(|| u16::try_from(assets.len()).unwrap_or(u16::MAX));
    let overwrite = args.overwrite.unwrap_or(false);

    let arc = host.store();
    let (name, project_name, project_id, image) = {
        let store = arc.lock().map_err(lock_failed)?;
        let first = store.asset_read(assets[0]).map_err(ToolError::from)?;
        for &other in &assets[1..] {
            let record = store.asset_read(other).map_err(ToolError::from)?;
            if record.project_id != first.project_id {
                return Err(ToolError::new(
                    "export.mixed_projects",
                    "every asset in a sheet must belong to one project",
                    "Export each project's assets in their own call.",
                ));
            }
        }
        let project = store
            .project_read(first.project_id)
            .map_err(ToolError::from)?;
        let image = export::render_sheet(&store, &assets, columns, scale).map_err(tool_error)?;
        let name = export::file_name(&args.name, &project.name, "sheet", "sheet", scale)
            .map_err(tool_error)?;
        (name, project.name, project.id, image)
    };

    // See `export_png_at`: the folder is created only once the store lock
    // above is released.
    let directory = project_folder(root, &project_name, project_id)?;
    let path = export::write_png(&directory, &name, &image, overwrite).map_err(tool_error)?;
    Ok(export_result(path, &image))
}

fn export_sheet(host: &dyn DocumentHost, session: &Session, args: Value) -> ToolResult {
    let root = export::exports_root().map_err(tool_error)?;
    export_sheet_at(host, session, args, &root)
}

// ---------------------------------------------------------------------------

pub fn tools() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "export_png",
            description: "Export one asset's render as a PNG. A background exports its \
                tilemap; anything else exports its layer composite. The file goes to the \
                exports folder, under a folder named for the asset's project; the returned \
                path is where the person can find it.",
            input_schema: export_png_schema,
            handler: export_png,
        },
        ToolSpec {
            name: "export_sheet",
            description: "Export several same-sized assets from one project as a single sprite \
                sheet PNG, laid left to right and wrapped after `columns`. The file goes to \
                the exports folder, under a folder named for the assets' project; the returned \
                path is where the person can find it.",
            input_schema: export_sheet_schema,
            handler: export_sheet,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::host::HeadlessHost;
    use crate::raster;
    use crate::store::Store;
    use std::process;
    use uuid::Uuid;

    struct TempDir {
        path: PathBuf,
    }
    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "bitwright-mcp-export-test-{}-{}",
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

    fn setup() -> (HeadlessHost, Session, Uuid, TempDir) {
        let mut store = Store::memory().unwrap();
        let project = store.project_create("Demo Project", "hd2d").unwrap();
        let host = HeadlessHost::new(store);
        (host, Session::new("test"), project.id, TempDir::new())
    }

    fn make_asset(host: &HeadlessHost, project: Uuid, name: &str, size: u16) -> Uuid {
        let arc = host.store();
        let mut store = arc.lock().unwrap();
        store
            .asset_create(project, name, "prop", size, size)
            .unwrap()
            .id
            .0
    }

    /// The exact folder `setup`'s "Demo Project" lands in, name and id both.
    fn demo_project_dir(root: &Path, project: Uuid) -> PathBuf {
        root.join(export::safe_folder_name("Demo Project", project))
    }

    #[test]
    fn export_png_writes_a_decodable_file_with_the_default_name() {
        let (host, session, project, root) = setup();
        let asset = make_asset(&host, project, "hero", 4);

        let result = export_png_at(
            &host,
            &session,
            json!({ "assetId": asset.to_string() }),
            &root.path,
        )
        .unwrap();

        let path = PathBuf::from(result["path"].as_str().unwrap());
        assert_eq!(
            path.parent(),
            Some(demo_project_dir(&root.path, project).as_path())
        );
        assert_eq!(path.file_name().unwrap().to_str().unwrap(), "hero@1x.png");
        let bytes = fs::read(&path).unwrap();
        let decoded = raster::png::decode(&bytes).unwrap();
        assert_eq!((decoded.width, decoded.height), (4, 4));
        assert_eq!(result["width"], 4);
        assert_eq!(result["height"], 4);
    }

    #[test]
    fn export_png_without_overwrite_refuses_a_second_export() {
        let (host, session, project, root) = setup();
        let asset = make_asset(&host, project, "hero", 4);
        let args = json!({ "assetId": asset.to_string() });

        export_png_at(&host, &session, args.clone(), &root.path).unwrap();
        let error = export_png_at(&host, &session, args, &root.path).unwrap_err();
        assert_eq!(error.code, "export.exists");
    }

    #[test]
    fn export_png_with_overwrite_replaces_the_file() {
        let (host, session, project, root) = setup();
        let asset = make_asset(&host, project, "hero", 4);

        export_png_at(
            &host,
            &session,
            json!({ "assetId": asset.to_string() }),
            &root.path,
        )
        .unwrap();
        let result = export_png_at(
            &host,
            &session,
            json!({ "assetId": asset.to_string(), "overwrite": true }),
            &root.path,
        )
        .unwrap();
        assert_eq!(result["width"], 4);
    }

    #[test]
    fn export_sheet_of_two_same_sized_assets_writes_one_combined_image() {
        let (host, session, project, root) = setup();
        let first = make_asset(&host, project, "tile-a", 4);
        let second = make_asset(&host, project, "tile-b", 4);

        let result = export_sheet_at(
            &host,
            &session,
            json!({
                "assetIds": [first.to_string(), second.to_string()],
                "name": "sheet",
            }),
            &root.path,
        )
        .unwrap();

        // Default columns is the asset count, so two tiles lay out side by
        // side in one row: twice as wide as one tile, not twice as tall.
        assert_eq!(result["width"], 8);
        assert_eq!(result["height"], 4);
        let path = PathBuf::from(result["path"].as_str().unwrap());
        let bytes = fs::read(&path).unwrap();
        let decoded = raster::png::decode(&bytes).unwrap();
        assert_eq!((decoded.width, decoded.height), (8, 4));
    }

    #[test]
    fn export_sheet_refuses_assets_from_two_projects() {
        let (host, session, project, root) = setup();
        let arc = host.store();
        let other_project = {
            let mut store = arc.lock().unwrap();
            store.project_create("Other Project", "hd2d").unwrap().id
        };
        let first = make_asset(&host, project, "tile-a", 4);
        let second = make_asset(&host, other_project, "tile-b", 4);

        let error = export_sheet_at(
            &host,
            &session,
            json!({
                "assetIds": [first.to_string(), second.to_string()],
                "name": "sheet",
            }),
            &root.path,
        )
        .unwrap_err();
        assert_eq!(error.code, "export.mixed_projects");
    }

    #[test]
    fn an_agent_supplied_name_with_traversal_stays_inside_the_project_folder() {
        let (host, session, project, root) = setup();
        let asset = make_asset(&host, project, "hero", 4);

        let result = export_png_at(
            &host,
            &session,
            json!({ "assetId": asset.to_string(), "name": "../../evil" }),
            &root.path,
        )
        .unwrap();

        let path = PathBuf::from(result["path"].as_str().unwrap());
        let project_dir = demo_project_dir(&root.path, project);
        assert!(
            path.starts_with(&project_dir),
            "{} escaped {}",
            path.display(),
            project_dir.display()
        );
        // The path has exactly one more component than the project folder: no
        // extra directory was created or traversed into.
        assert_eq!(path.parent().map(Path::to_path_buf), Some(project_dir));
    }

    #[test]
    fn a_hostile_asset_name_with_the_default_pattern_stays_inside_the_project_folder() {
        let (host, session, project, root) = setup();
        // The asset name flows straight into the default `{asset}@{scale}x`
        // pattern with nothing in between to catch it.
        let asset = make_asset(&host, project, "../../evil", 4);

        let result = export_png_at(
            &host,
            &session,
            json!({ "assetId": asset.to_string() }),
            &root.path,
        )
        .unwrap();

        let path = PathBuf::from(result["path"].as_str().unwrap());
        assert_eq!(
            path.parent(),
            Some(demo_project_dir(&root.path, project).as_path())
        );
    }

    #[test]
    fn hostile_project_names_still_land_in_one_folder_under_the_root() {
        // `file_name` already sanitizes an agent-controlled `name` pattern —
        // this covers the other agent-invisible input to the folder path,
        // the project's own name, which nothing in the MCP surface lets an
        // agent set directly but which a person can still set to anything.
        for hostile in ["../x", "C:\\x", "\\\\srv\\s", "CON"] {
            let mut store = Store::memory().unwrap();
            let project = store.project_create(hostile, "hd2d").unwrap();
            let asset = store
                .asset_create(project.id, "hero", "prop", 4, 4)
                .unwrap()
                .id;
            let host = HeadlessHost::new(store);
            let session = Session::new("test");
            let root = TempDir::new();

            let result = export_png_at(
                &host,
                &session,
                json!({ "assetId": asset.0.to_string() }),
                &root.path,
            )
            .unwrap_or_else(|error| panic!("{hostile:?}: {}: {}", error.code, error.message));

            let path = PathBuf::from(result["path"].as_str().unwrap());
            let expected_dir = root
                .path
                .join(export::safe_folder_name(hostile, project.id));
            assert_eq!(
                path.parent(),
                Some(expected_dir.as_path()),
                "{hostile:?} escaped its project folder: {}",
                path.display()
            );
            // Only ever one folder directly under the root for this project,
            // however hostile its name.
            let entries: Vec<_> = fs::read_dir(&root.path)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .collect();
            assert_eq!(entries, vec![expected_dir], "{hostile:?}");
        }
    }
}
