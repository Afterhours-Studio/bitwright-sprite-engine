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

//! SQLite is the document, rather than a checkpoint of an in-memory editor.
//! Every committed edit and its inverse therefore share one transaction.

mod history;
pub mod migrations;
pub mod models;
mod workflow;
pub use models::*;

use crate::raster::{
    IndexedBuffer, Layer, LayerRole, Palette, RgbaImage, StyleRules, Tilemap, LAYER_ROLES,
};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{de::DeserializeOwned, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("{code}: {detail}")]
pub struct AppError {
    pub code: String,
    pub detail: String,
}
impl AppError {
    pub fn new(code: &str, detail: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            detail: detail.into(),
        }
    }
}
impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        let code = match &error {
            rusqlite::Error::QueryReturnedNoRows => "document.not_found",
            rusqlite::Error::SqliteFailure(e, _)
                if e.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                "store.constraint"
            }
            _ => "store.database_failed",
        };
        Self::new(code, error.to_string())
    }
}
impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        Self::new("document.invalid_json", e.to_string())
    }
}
impl From<crate::raster::RasterError> for AppError {
    fn from(e: crate::raster::RasterError) -> Self {
        Self::new(&e.code, e.detail)
    }
}
pub type Result<T> = std::result::Result<T, AppError>;
pub(crate) fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
pub(crate) fn json(value: &impl Serialize) -> Result<String> {
    Ok(serde_json::to_string(value)?)
}
fn decode<T: DeserializeOwned>(row: &Row<'_>, index: usize) -> rusqlite::Result<T> {
    let text: String = row.get(index)?;
    serde_json::from_str(&text).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, Box::new(e))
    })
}
fn uuid(row: &Row<'_>, index: usize) -> rusqlite::Result<Uuid> {
    let text: String = row.get(index)?;
    Uuid::parse_str(&text).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, Box::new(e))
    })
}
fn optional_uuid(row: &Row<'_>, index: usize) -> rusqlite::Result<Option<Uuid>> {
    let text: Option<String> = row.get(index)?;
    text.map(|text| {
        Uuid::parse_str(&text).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(
                index,
                rusqlite::types::Type::Text,
                Box::new(e),
            )
        })
    })
    .transpose()
}
fn name(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > 1024 || value.chars().any(char::is_control) {
        return Err(AppError::new(
            "document.invalid_name",
            "name must be nonempty, at most 1024 bytes, and contain no control characters",
        ));
    }
    Ok(())
}

pub struct Store {
    connection: Connection,
    history_limit: usize,
}
impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::from_connection(Connection::open(path)?)
    }
    pub fn memory() -> Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }
    fn from_connection(mut connection: Connection) -> Result<Self> {
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        migrations::migrate(&mut connection)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        Ok(Self {
            connection,
            history_limit: 10_000,
        })
    }
    pub fn project_list(&self) -> Result<Vec<Project>> {
        let mut statement = self.connection.prepare(
            "SELECT id,name,style_id,created_at,updated_at FROM project ORDER BY created_at,id",
        )?;
        let rows = statement
            .query_map([], project_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
    pub fn project_read(&self, id: Uuid) -> Result<Project> {
        Ok(self.connection.query_row(
            "SELECT id,name,style_id,created_at,updated_at FROM project WHERE id=?1",
            [id.to_string()],
            project_row,
        )?)
    }
    pub fn project_create(&mut self, value: &str, preset: &str) -> Result<Project> {
        name(value)?;
        let rules = StyleRules::preset(preset)?;
        let id = Uuid::now_v7();
        let style = Uuid::now_v7();
        let at = now();
        let tx = self.connection.transaction()?;
        tx.execute(
            "INSERT INTO project VALUES(?1,?2,NULL,?3,?3)",
            params![id.to_string(), value, at],
        )?;
        tx.execute(
            "INSERT INTO style VALUES(?1,?2,?3,?4,?5,?6,?6)",
            params![
                style.to_string(),
                id.to_string(),
                value,
                preset,
                json(&rules)?,
                at
            ],
        )?;
        tx.execute(
            "UPDATE project SET style_id=?1 WHERE id=?2",
            params![style.to_string(), id.to_string()],
        )?;
        tx.commit()?;
        self.project_read(id)
    }
    pub fn project_rename(&mut self, id: Uuid, value: &str) -> Result<Project> {
        name(value)?;
        self.project_read(id)?;
        self.connection.execute(
            "UPDATE project SET name=?1,updated_at=?2 WHERE id=?3",
            params![value, now(), id.to_string()],
        )?;
        self.project_read(id)
    }
    pub fn project_delete(&mut self, id: Uuid) -> Result<()> {
        self.project_read(id)?;
        let tx = self.connection.transaction()?;
        tx.execute("UPDATE project SET style_id=NULL WHERE style_id IN (SELECT id FROM style WHERE project_id=?1)",[id.to_string()])?;
        tx.execute("UPDATE asset SET style_id=NULL WHERE style_id IN (SELECT id FROM style WHERE project_id=?1)",[id.to_string()])?;
        tx.execute("DELETE FROM project WHERE id=?1", [id.to_string()])?;
        tx.commit()?;
        Ok(())
    }
    pub fn project_set_style(&mut self, id: Uuid, style: Option<Uuid>) -> Result<Project> {
        self.project_read(id)?;
        if let Some(style) = style {
            self.style_read(style)?;
        }
        self.connection.execute(
            "UPDATE project SET style_id=?1,updated_at=?2 WHERE id=?3",
            params![style.map(|s| s.to_string()), now(), id.to_string()],
        )?;
        self.project_read(id)
    }
    pub fn style_read(&self, id: Uuid) -> Result<Style> {
        Ok(self.connection.query_row(
            "SELECT id,project_id,name,preset,rules,created_at,updated_at FROM style WHERE id=?1",
            [id.to_string()],
            style_row,
        )?)
    }
    pub fn asset_rules(&self, id: AssetId) -> Result<StyleRules> {
        effective_rules(&self.connection, &self.asset_read(id)?)
    }
    pub fn project_rules(&self, id: Uuid) -> Result<StyleRules> {
        let project = self.project_read(id)?;
        match project.style_id {
            Some(style_id) => Ok(self.style_read(style_id)?.rules),
            None => Ok(StyleRules::default()),
        }
    }
    pub fn style_list(&self, project: Option<Uuid>) -> Result<Vec<Style>> {
        let mut statement = self.connection.prepare("SELECT id,project_id,name,preset,rules,created_at,updated_at FROM style WHERE project_id IS ?1 ORDER BY created_at,id")?;
        let rows = statement
            .query_map([project.map(|id| id.to_string())], style_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
    pub fn style_create(
        &mut self,
        project: Option<Uuid>,
        value: &str,
        preset: &str,
        rules: StyleRules,
    ) -> Result<Style> {
        name(value)?;
        StyleRules::preset(preset)?;
        validate_rules(&rules)?;
        let id = Uuid::now_v7();
        self.connection.execute(
            "INSERT INTO style VALUES(?1,?2,?3,?4,?5,?6,?6)",
            params![
                id.to_string(),
                project.map(|s| s.to_string()),
                value,
                preset,
                json(&rules)?,
                now()
            ],
        )?;
        self.style_read(id)
    }
    pub fn style_update(&mut self, style: &Style) -> Result<Style> {
        name(&style.name)?;
        StyleRules::preset(&style.preset)?;
        validate_rules(&style.rules)?;
        self.style_read(style.id)?;
        self.connection.execute(
            "UPDATE style SET name=?1,preset=?2,rules=?3,updated_at=?4 WHERE id=?5",
            params![
                style.name,
                style.preset,
                json(&style.rules)?,
                now(),
                style.id.to_string()
            ],
        )?;
        self.style_read(style.id)
    }
    pub fn style_delete(&mut self, id: Uuid) -> Result<()> {
        self.style_read(id)?;
        let tx = self.connection.transaction()?;
        tx.execute(
            "UPDATE project SET style_id=NULL WHERE style_id=?1",
            [id.to_string()],
        )?;
        tx.execute(
            "UPDATE asset SET style_id=NULL WHERE style_id=?1",
            [id.to_string()],
        )?;
        tx.execute("DELETE FROM style WHERE id=?1", [id.to_string()])?;
        tx.commit()?;
        Ok(())
    }
    pub fn asset_list(&self, project: Uuid) -> Result<Vec<Asset>> {
        self.project_read(project)?;
        let mut statement = self.connection.prepare("SELECT id,project_id,style_id,name,kind,width,height,step,created_at,updated_at FROM asset WHERE project_id=?1 ORDER BY created_at,id")?;
        let rows = statement
            .query_map([project.to_string()], asset_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
    pub fn asset_read(&self, id: AssetId) -> Result<Asset> {
        read_asset(&self.connection, id)
    }
    pub fn asset_create(
        &mut self,
        project: Uuid,
        value: &str,
        kind: &str,
        width: u16,
        height: u16,
    ) -> Result<Asset> {
        name(value)?;
        self.project_read(project)?;
        if !["character", "prop", "tile", "tileset", "background"].contains(&kind) {
            return Err(AppError::new("asset.invalid_kind", kind));
        }
        let buffer = IndexedBuffer::new(width, height)?;
        let id = AssetId(Uuid::now_v7());
        let at = now();
        let tx = self.connection.transaction()?;
        tx.execute(
            "INSERT INTO asset VALUES(?1,?2,NULL,?3,?4,?5,?6,'reference',?7,?7)",
            params![
                id.0.to_string(),
                project.to_string(),
                value,
                kind,
                width,
                height,
                at
            ],
        )?;
        tx.execute(
            "INSERT INTO palette VALUES(?1,'[]','[]')",
            [id.0.to_string()],
        )?;
        for (role, ordinal) in LAYER_ROLES {
            tx.execute(
                "INSERT INTO layer VALUES(?1,?2,?3,?4,1,0,1.0,?5)",
                params![
                    Uuid::now_v7().to_string(),
                    id.0.to_string(),
                    role,
                    ordinal,
                    buffer.data
                ],
            )?;
        }
        tx.commit()?;
        self.asset_read(id)
    }
    pub fn asset_rename(&mut self, id: AssetId, value: &str) -> Result<Asset> {
        name(value)?;
        self.commit(id, history::Mutation::Rename(value.into()), "user")?;
        self.asset_read(id)
    }
    pub fn asset_delete(&mut self, id: AssetId) -> Result<()> {
        self.asset_read(id)?;
        self.connection
            .execute("DELETE FROM asset WHERE id=?1", [id.0.to_string()])?;
        Ok(())
    }
    pub fn asset_set_style(&mut self, id: AssetId, style: Option<Uuid>) -> Result<Asset> {
        if let Some(style) = style {
            self.style_read(style)?;
        }
        self.commit(id, history::Mutation::Style(style), "user")?;
        self.asset_read(id)
    }
    pub fn asset_open(&self, id: AssetId) -> Result<Document> {
        read_document(&self.connection, id)
    }
    pub fn palette_read(&self, id: AssetId) -> Result<Palette> {
        read_palette(&self.connection, id)
    }
    pub fn layer_read(&self, id: AssetId, role: LayerRole) -> Result<Layer> {
        self.asset_open(id)?
            .layers
            .into_iter()
            .find(|l| l.role == role)
            .ok_or_else(|| AppError::new("document.layer_not_found", role.0))
    }
    pub fn palette_write(&mut self, id: AssetId, palette: Palette) -> Result<(Palette, OpResult)> {
        self.palette_write_as(id, palette, "user")
    }
    /// Records who wrote the palette: the op log carries the actor, so a
    /// palette set by an agent reads back as that agent's write.
    pub fn palette_write_as(
        &mut self,
        id: AssetId,
        palette: Palette,
        actor: &str,
    ) -> Result<(Palette, OpResult)> {
        let result = self.commit(id, history::Mutation::Palette(palette), actor)?;
        Ok((self.palette_read(id)?, result))
    }
    pub fn palette_delete(&mut self, id: AssetId) -> Result<OpResult> {
        self.commit(id, history::Mutation::Palette(Palette::default()), "user")
    }
    pub fn layer_write(&mut self, id: AssetId, layer: Layer) -> Result<OpResult> {
        self.layer_write_as(id, layer, "user")
    }
    /// Records who wrote the layer, so a layer painted by an agent reads back
    /// in the op log as that agent's write rather than the person's.
    pub fn layer_write_as(&mut self, id: AssetId, layer: Layer, actor: &str) -> Result<OpResult> {
        self.commit(
            id,
            history::Mutation::Layer(Some(layer.clone()), layer.role),
            actor,
        )
    }
    pub fn layer_delete(&mut self, id: AssetId, role: LayerRole) -> Result<OpResult> {
        self.commit(id, history::Mutation::Layer(None, role), "user")
    }
    pub fn reference_list(&self, id: AssetId) -> Result<Vec<Reference>> {
        self.asset_read(id)?;
        read_references(&self.connection, id)
    }
    pub fn reference_read(&self, id: AssetId, reference: Uuid) -> Result<Reference> {
        self.reference_list(id)?
            .into_iter()
            .find(|r| r.id == reference)
            .ok_or_else(|| AppError::new("reference.not_found", reference.to_string()))
    }
    pub fn reference_write(&mut self, reference: Reference) -> Result<OpResult> {
        name(&reference.name)?;
        self.commit(
            reference.asset_id,
            history::Mutation::Reference(Some(reference.clone()), reference.id),
            "user",
        )
    }
    pub fn reference_delete(&mut self, id: AssetId, reference: Uuid) -> Result<OpResult> {
        self.reference_read(id, reference)?;
        self.commit(id, history::Mutation::Reference(None, reference), "user")
    }
    pub fn tilemap_read(&self, id: AssetId) -> Result<Tilemap> {
        self.asset_read(id)?;
        let data: Option<String> = self
            .connection
            .query_row(
                "SELECT data FROM tilemap WHERE asset_id=?1",
                [id.0.to_string()],
                |r| r.get(0),
            )
            .optional()?;
        let data = data.ok_or_else(|| AppError::new("tilemap.none", id.0.to_string()))?;
        Ok(serde_json::from_str(&data)?)
    }

    /// The asset's layers composited through its palette, as RGBA.
    pub fn asset_composite(&self, id: AssetId) -> Result<RgbaImage> {
        let document = self.asset_open(id)?;
        Ok(crate::raster::composite(
            document.asset.width,
            document.asset.height,
            &document.layers,
            &document.palette,
        )?)
    }

    /// A background's tilemap rendered from its tiles' composites: the whole
    /// map, or one layer of it.
    pub fn tilemap_render(&self, id: AssetId, layer: Option<&str>) -> Result<RgbaImage> {
        let map = self.tilemap_read(id)?;
        let mut tiles = HashMap::new();
        for tile in map.tile_ids() {
            tiles.insert(tile, self.asset_composite(AssetId(tile))?);
        }
        Ok(match layer {
            Some(layer) => map.render_layer(layer, &tiles)?,
            None => map.render(&tiles)?,
        })
    }

    pub fn tilemap_write(&mut self, id: AssetId, map: &Tilemap) -> Result<Tilemap> {
        let asset = self.asset_read(id)?;
        if asset.kind != "background" {
            return Err(AppError::new("tilemap.not_background", asset.kind));
        }
        map.validate()?;
        for tile in map.tile_ids() {
            let valid = match self.asset_read(AssetId(tile)) {
                Ok(t) => {
                    t.kind == "tile"
                        && t.project_id == asset.project_id
                        && t.width == map.tile_width
                        && t.height == map.tile_height
                }
                // Only a missing tile is the caller's mistake; any other
                // failure is the store's and keeps its own code.
                Err(error) if error.code == "document.not_found" => false,
                Err(error) => return Err(error),
            };
            if !valid {
                return Err(AppError::new("tilemap.tile_invalid", tile.to_string()));
            }
        }
        self.connection.execute(
            "INSERT INTO tilemap(asset_id,data,updated_at) VALUES(?1,?2,?3)
             ON CONFLICT(asset_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            params![id.0.to_string(), json(map)?, now()],
        )?;
        self.tilemap_read(id)
    }
}

fn project_row(r: &Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: uuid(r, 0)?,
        name: r.get(1)?,
        style_id: optional_uuid(r, 2)?,
        created_at: r.get(3)?,
        updated_at: r.get(4)?,
    })
}
fn style_row(r: &Row<'_>) -> rusqlite::Result<Style> {
    Ok(Style {
        id: uuid(r, 0)?,
        project_id: optional_uuid(r, 1)?,
        name: r.get(2)?,
        preset: r.get(3)?,
        rules: decode(r, 4)?,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
    })
}
fn asset_row(r: &Row<'_>) -> rusqlite::Result<Asset> {
    Ok(Asset {
        id: AssetId(uuid(r, 0)?),
        project_id: uuid(r, 1)?,
        style_id: optional_uuid(r, 2)?,
        name: r.get(3)?,
        kind: r.get(4)?,
        width: r.get(5)?,
        height: r.get(6)?,
        step: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
    })
}
fn read_asset(c: &Connection, id: AssetId) -> Result<Asset> {
    Ok(c.query_row("SELECT id,project_id,style_id,name,kind,width,height,step,created_at,updated_at FROM asset WHERE id=?1",[id.0.to_string()],asset_row)?)
}
fn read_palette(c: &Connection, id: AssetId) -> Result<Palette> {
    Ok(c.query_row(
        "SELECT slots,ramps FROM palette WHERE asset_id=?1",
        [id.0.to_string()],
        |r| {
            Ok(Palette {
                slots: decode(r, 0)?,
                ramps: decode(r, 1)?,
            })
        },
    )?)
}
fn read_document(c: &Connection, id: AssetId) -> Result<Document> {
    let asset = read_asset(c, id)?;
    let palette = read_palette(c, id)?;
    let mut statement = c.prepare("SELECT id,role,ordinal,visible,locked,opacity,pixels FROM layer WHERE asset_id=?1 ORDER BY ordinal")?;
    let layers = statement
        .query_map([id.0.to_string()], |r| {
            let role: String = r.get(1)?;
            Ok(Layer {
                id: uuid(r, 0)?,
                role: LayerRole::parse(&role).map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        1,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })?,
                ordinal: r.get(2)?,
                visible: r.get(3)?,
                locked: r.get(4)?,
                opacity: r.get(5)?,
                buffer: IndexedBuffer {
                    width: asset.width,
                    height: asset.height,
                    data: r.get(6)?,
                },
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for layer in &layers {
        layer.buffer.validate()?;
    }
    Ok(Document {
        asset,
        palette,
        layers,
    })
}
fn read_references(c: &Connection, id: AssetId) -> Result<Vec<Reference>> {
    let mut statement = c.prepare("SELECT id,name,source_png,conformed,conform_meta,created_at FROM reference WHERE asset_id=?1 ORDER BY created_at,id")?;
    let rows = statement
        .query_map([id.0.to_string()], |r| {
            let meta: Option<String> = r.get(4)?;
            let conform_meta = meta
                .map(|v| {
                    serde_json::from_str(&v).map_err(|e| {
                        rusqlite::Error::FromSqlConversionFailure(
                            4,
                            rusqlite::types::Type::Text,
                            Box::new(e),
                        )
                    })
                })
                .transpose()?;
            Ok(Reference {
                id: uuid(r, 0)?,
                asset_id: id,
                name: r.get(1)?,
                source_png: r.get(2)?,
                conformed: r.get(3)?,
                conform_meta,
                created_at: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}
fn effective_rules(c: &Connection, asset: &Asset) -> Result<StyleRules> {
    let rules: Option<String> = c.query_row("SELECT rules FROM style WHERE id=COALESCE(?1,(SELECT style_id FROM project WHERE id=?2))",params![asset.style_id.map(|s|s.to_string()),asset.project_id.to_string()],|r|r.get(0)).optional()?;
    Ok(rules
        .map(|r| serde_json::from_str(&r))
        .transpose()?
        .unwrap_or_default())
}
fn validate_rules(rules: &StyleRules) -> Result<()> {
    if rules.max_slots == 0
        || rules.max_slots > 62
        || rules.ramp_steps.min == 0
        || rules.ramp_steps.min > rules.ramp_steps.max
        || rules.ramp_steps.max > 62
        || !rules.noise_budget.is_finite()
        || !(0.0..=1.0).contains(&rules.noise_budget)
    {
        return Err(AppError::new(
            "style.invalid_rules",
            "invalid palette or noise limits",
        ));
    }
    IndexedBuffer::new(rules.canvas.width, rules.canvas.height)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raster::{Canvas, Material, PaletteSlot, Ramp, RampSteps};

    fn store() -> (Store, Uuid) {
        let mut store = Store::memory().unwrap();
        let project = store.project_create("project", "hd2d").unwrap();
        (store, project.id)
    }

    fn one_tile(tile: Uuid) -> Tilemap {
        let mut map = Tilemap::new(16, 16, 4, 3).unwrap();
        map.place(
            "ground",
            &[crate::raster::Placement {
                x: 1,
                y: 2,
                tile: Some(tile),
            }],
        )
        .unwrap();
        map
    }

    #[test]
    fn a_tilemap_is_written_and_read_back() {
        let (mut store, project) = store();
        let background = store
            .asset_create(project, "hills", "background", 64, 48)
            .unwrap();
        let tile = store
            .asset_create(project, "grass", "tile", 16, 16)
            .unwrap();
        let map = one_tile(tile.id.0);
        let written = store.tilemap_write(background.id, &map).unwrap();
        assert_eq!(written, map);
        assert_eq!(store.tilemap_read(background.id).unwrap(), map);
    }

    #[test]
    fn a_tilemap_is_refused_on_a_non_background_asset() {
        let (mut store, project) = store();
        let hero = store
            .asset_create(project, "hero", "character", 16, 16)
            .unwrap();
        let map = Tilemap::new(16, 16, 4, 3).unwrap();
        let error = store.tilemap_write(hero.id, &map).unwrap_err();
        assert_eq!(error.code, "tilemap.not_background");
    }

    #[test]
    fn a_tilemap_refuses_tiles_it_cannot_use() {
        let (mut store, project) = store();
        let background = store
            .asset_create(project, "hills", "background", 64, 48)
            .unwrap();
        let elsewhere = store.project_create("other", "hd2d").unwrap();
        let foreign = store
            .asset_create(elsewhere.id, "grass", "tile", 16, 16)
            .unwrap();
        let prop = store.asset_create(project, "rock", "prop", 16, 16).unwrap();
        let large = store.asset_create(project, "big", "tile", 32, 32).unwrap();
        for wrong in [foreign.id, prop.id, large.id] {
            let error = store
                .tilemap_write(background.id, &one_tile(wrong.0))
                .unwrap_err();
            assert_eq!(error.code, "tilemap.tile_invalid");
        }
    }

    #[test]
    fn reading_a_missing_tilemap_says_so() {
        let (mut store, project) = store();
        let background = store
            .asset_create(project, "hills", "background", 64, 48)
            .unwrap();
        let error = store.tilemap_read(background.id).unwrap_err();
        assert_eq!(error.code, "tilemap.none");
    }

    #[test]
    fn a_tilemap_renders_from_its_tiles_composites() {
        let (mut store, project) = store();
        let background = store
            .asset_create(project, "hills", "background", 64, 48)
            .unwrap();
        let tile = store
            .asset_create(project, "grass", "tile", 16, 16)
            .unwrap();
        store
            .tilemap_write(background.id, &one_tile(tile.id.0))
            .unwrap();
        let image = store.tilemap_render(background.id, None).unwrap();
        assert_eq!((image.width, image.height), (64, 48));
        let layer = store.tilemap_render(background.id, Some("ground")).unwrap();
        assert_eq!(layer.data, image.data);
        assert_eq!(
            store
                .tilemap_render(background.id, Some("sky"))
                .unwrap_err()
                .code,
            "tilemap.layer_not_found"
        );
    }

    #[test]
    fn deleting_the_asset_deletes_its_tilemap() {
        let (mut store, project) = store();
        let background = store
            .asset_create(project, "hills", "background", 64, 48)
            .unwrap();
        store
            .tilemap_write(background.id, &Tilemap::new(16, 16, 4, 3).unwrap())
            .unwrap();
        store.asset_delete(background.id).unwrap();
        let rows: i64 = store
            .connection
            .query_row("SELECT COUNT(*) FROM tilemap", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0);
    }

    #[test]
    fn a_new_asset_starts_at_the_first_step_with_every_layer_role_present() {
        let (mut store, project) = store();
        let asset = store
            .asset_create(project, "hero", "character", 8, 8)
            .unwrap();
        assert_eq!(asset.step, "reference");
        let document = store.asset_open(asset.id).unwrap();
        let roles: Vec<(&str, i32)> = document
            .layers
            .iter()
            .map(|layer| (layer.role.0, layer.ordinal))
            .collect();
        // In composite order, which is what the document model fixes.
        assert_eq!(roles, LAYER_ROLES.to_vec());
        assert!(document
            .layers
            .iter()
            .all(|layer| layer.buffer.data == vec![0; 64]));
        assert_eq!(document.palette, Palette::default());
    }

    #[test]
    fn a_project_is_created_with_its_own_style_taken_from_the_preset() {
        let (store, project) = store();
        let style = store.project_read(project).unwrap().style_id.unwrap();
        assert_eq!(store.style_read(style).unwrap().preset, "hd2d");
        assert_eq!(store.style_read(style).unwrap().rules.max_slots, 24);
        assert_eq!(
            Store::memory()
                .unwrap()
                .project_create("project", "vector")
                .unwrap_err()
                .code,
            "style.invalid_preset"
        );
    }

    #[test]
    fn an_asset_style_overrides_the_project_one_and_falls_back_when_deleted() {
        let (mut store, project) = store();
        let asset = store.asset_create(project, "hero", "prop", 4, 4).unwrap();
        let rules = StyleRules {
            max_slots: 8,
            ..StyleRules::default()
        };
        let style = store
            .style_create(Some(project), "terse", "custom", rules)
            .unwrap();
        store.asset_set_style(asset.id, Some(style.id)).unwrap();
        let read = store.asset_read(asset.id).unwrap();
        assert_eq!(
            effective_rules(&store.connection, &read).unwrap().max_slots,
            8
        );
        // Deleting the style must not orphan the asset: it falls back to the
        // project's, because an asset with no resolvable rules cannot be gated.
        store.style_delete(style.id).unwrap();
        let read = store.asset_read(asset.id).unwrap();
        assert!(read.style_id.is_none());
        assert_eq!(
            effective_rules(&store.connection, &read).unwrap().max_slots,
            24
        );
    }

    #[test]
    fn rules_that_could_not_describe_a_palette_are_refused() {
        let (mut store, project) = store();
        let bad = [
            StyleRules {
                max_slots: 0,
                ..StyleRules::default()
            },
            StyleRules {
                max_slots: 200,
                ..StyleRules::default()
            },
            StyleRules {
                ramp_steps: RampSteps { min: 4, max: 2 },
                ..StyleRules::default()
            },
            StyleRules {
                noise_budget: f32::NAN,
                ..StyleRules::default()
            },
            StyleRules {
                canvas: Canvas {
                    width: 0,
                    height: 8,
                },
                ..StyleRules::default()
            },
        ];
        for rules in bad {
            assert!(store
                .style_create(Some(project), "bad", "custom", rules)
                .is_err());
        }
    }

    #[test]
    fn names_and_kinds_are_checked_before_anything_is_written() {
        let (mut store, project) = store();
        for bad in ["", "   ", "line\nbreak"] {
            assert_eq!(
                store
                    .asset_create(project, bad, "prop", 4, 4)
                    .unwrap_err()
                    .code,
                "document.invalid_name"
            );
        }
        assert_eq!(
            store
                .asset_create(project, "hero", "spaceship", 4, 4)
                .unwrap_err()
                .code,
            "asset.invalid_kind"
        );
        assert!(store.asset_list(project).unwrap().is_empty());
        store.asset_create(project, "hero", "prop", 4, 4).unwrap();
        // The schema makes a name unique within its project, and reusing one is
        // a conflict rather than a silent second asset.
        assert!(store.asset_create(project, "hero", "prop", 4, 4).is_err());
    }

    #[test]
    fn deleting_a_project_takes_its_assets_and_leaves_the_others_alone() {
        let (mut store, project) = store();
        let kept = store.project_create("other", "snes").unwrap();
        let doomed = store.asset_create(project, "hero", "prop", 4, 4).unwrap();
        let survivor = store.asset_create(kept.id, "tile", "tile", 4, 4).unwrap();
        store.project_delete(project).unwrap();
        assert!(store.asset_read(doomed.id).is_err());
        assert_eq!(store.asset_read(survivor.id).unwrap().name, "tile");
        assert_eq!(store.project_list().unwrap().len(), 1);
    }

    #[test]
    fn a_layer_write_must_match_the_role_ordinal_and_canvas_it_claims() {
        let (mut store, project) = store();
        let asset = store.asset_create(project, "hero", "prop", 4, 4).unwrap();
        let original = store.layer_read(asset.id, LayerRole("flats")).unwrap();
        let mut wrong_ordinal = original.clone();
        wrong_ordinal.ordinal = 99;
        assert_eq!(
            store.layer_write(asset.id, wrong_ordinal).unwrap_err().code,
            "document.invalid_layer"
        );
        let mut wrong_size = original.clone();
        wrong_size.buffer = IndexedBuffer::new(2, 2).unwrap();
        assert_eq!(
            store.layer_write(asset.id, wrong_size).unwrap_err().code,
            "document.invalid_layer"
        );
        let mut foreign = original.clone();
        foreign.id = Uuid::now_v7();
        assert_eq!(
            store.layer_write(asset.id, foreign).unwrap_err().code,
            "document.invalid_layer"
        );
        // A pixel pointing at a slot the palette does not hold is the same kind
        // of fault, caught before the layer is stored rather than at composite.
        let mut unpainted = original;
        unpainted.buffer.data[0] = 1;
        assert_eq!(
            store.layer_write(asset.id, unpainted).unwrap_err().code,
            "palette.unknown_slot"
        );
    }

    #[test]
    fn a_palette_cannot_be_narrowed_under_the_pixels_already_using_it() {
        let (mut store, project) = store();
        let asset = store.asset_create(project, "hero", "prop", 4, 4).unwrap();
        let palette = Palette {
            slots: vec![PaletteSlot {
                index: 1,
                rgba: [90, 70, 50, 255],
                name: None,
                ramp: Some("cloth".into()),
                step: Some(0),
            }],
            ramps: vec![Ramp {
                name: "cloth".into(),
                material: Material::Cloth,
                slots: vec![1],
            }],
        };
        store.palette_write(asset.id, palette).unwrap();
        let mut layer = store.layer_read(asset.id, LayerRole("flats")).unwrap();
        layer.buffer.data[0] = 1;
        store.layer_write(asset.id, layer).unwrap();
        assert_eq!(
            store.palette_delete(asset.id).unwrap_err().code,
            "palette.unknown_slot"
        );
        assert_eq!(store.palette_read(asset.id).unwrap().slots.len(), 1);
    }

    #[test]
    fn a_write_records_the_actor_it_was_given() {
        let (mut store, project) = store();
        let asset = store.asset_create(project, "hero", "prop", 4, 4).unwrap();
        let palette = Palette {
            slots: vec![PaletteSlot {
                index: 1,
                rgba: [10, 20, 30, 255],
                name: None,
                ramp: None,
                step: None,
            }],
            ramps: vec![],
        };

        store
            .palette_write_as(asset.id, palette.clone(), "agent:palette-bot")
            .unwrap();
        let layer = store.layer_read(asset.id, LayerRole("flats")).unwrap();
        store
            .layer_write_as(asset.id, layer.clone(), "agent:painter")
            .unwrap();

        let log = store.op_log(asset.id).unwrap();
        let palette_op = log
            .iter()
            .find(|op| op.kind == "palette_write")
            .expect("the palette write is in the log");
        assert_eq!(palette_op.actor, "agent:palette-bot");
        let layer_op = log
            .iter()
            .find(|op| op.kind == "layer_write")
            .expect("the layer write is in the log");
        assert_eq!(layer_op.actor, "agent:painter");

        // The plain writers keep recording the person using the editor.
        store.palette_write(asset.id, palette).unwrap();
        store.layer_write(asset.id, layer).unwrap();
        let log = store.op_log(asset.id).unwrap();
        assert_eq!(log[log.len() - 2].actor, "user");
        assert_eq!(log[log.len() - 1].actor, "user");
    }

    #[test]
    fn a_reference_belongs_to_one_asset_and_is_read_back_as_it_was_stored() {
        let (mut store, project) = store();
        let asset = store.asset_create(project, "hero", "prop", 2, 2).unwrap();
        let other = store
            .asset_create(project, "villain", "prop", 2, 2)
            .unwrap();
        let png = |width: u16, height: u16| {
            crate::raster::png::encode(&crate::raster::RgbaImage {
                width,
                height,
                data: vec![255; usize::from(width) * usize::from(height) * 4],
            })
            .unwrap()
        };
        let reference = Reference {
            id: Uuid::now_v7(),
            asset_id: asset.id,
            name: "photo".into(),
            source_png: vec![1, 2, 3],
            conformed: Some(png(2, 2)),
            conform_meta: None,
            created_at: now(),
        };
        store.reference_write(reference.clone()).unwrap();
        let read = store.reference_read(asset.id, reference.id).unwrap();
        assert_eq!(read.source_png, vec![1, 2, 3]);
        assert!(store.reference_list(other.id).unwrap().is_empty());
        // A conformed buffer that is not the asset's own size would misalign
        // against every layer it is compared with.
        let mut ragged = reference.clone();
        ragged.id = Uuid::now_v7();
        ragged.conformed = Some(png(3, 3));
        assert_eq!(
            store.reference_write(ragged.clone()).unwrap_err().code,
            "reference.invalid_buffer"
        );
        // Nor may it be anything but a PNG.
        ragged.conformed = Some(vec![0; 16]);
        assert_eq!(
            store.reference_write(ragged).unwrap_err().code,
            "reference.invalid_buffer"
        );
        // And claiming another asset's reference id is refused outright.
        let mut stolen = reference;
        stolen.asset_id = other.id;
        assert_eq!(
            store.reference_write(stolen).unwrap_err().code,
            "reference.invalid_owner"
        );
    }

    #[test]
    fn asset_rules_returns_effective_rules_for_an_asset() {
        let (mut store, project) = store();
        let asset = store.asset_create(project, "hero", "prop", 4, 4).unwrap();
        let rules = store.asset_rules(asset.id).unwrap();
        // The default project style is hd2d which has max_slots == 24.
        assert_eq!(rules.max_slots, 24);
    }

    #[test]
    fn project_rules_returns_project_style_rules() {
        let (store, project) = store();
        let rules = store.project_rules(project).unwrap();
        assert_eq!(rules.max_slots, 24);
    }

    #[test]
    fn project_rules_returns_default_when_project_has_no_style() {
        let store = Store::memory().unwrap();
        let id = Uuid::now_v7();
        store
            .connection
            .execute(
                "INSERT INTO project VALUES(?1,?2,NULL,?3,?3)",
                params![id.to_string(), "orphan", now()],
            )
            .unwrap();
        let rules = store.project_rules(id).unwrap();
        assert_eq!(rules.max_slots, StyleRules::default().max_slots);
    }

    #[test]
    fn a_project_is_renamed_and_an_invalid_name_is_refused() {
        let (mut store, project) = store();
        let renamed = store.project_rename(project, "new name").unwrap();
        assert_eq!(renamed.name, "new name");
        assert_eq!(store.project_read(project).unwrap().name, "new name");
        assert_eq!(
            store.project_rename(project, "").unwrap_err().code,
            "document.invalid_name"
        );
        // The failed rename must not have taken effect.
        assert_eq!(store.project_read(project).unwrap().name, "new name");
    }

    #[test]
    fn style_list_is_scoped_by_project_including_project_less_styles() {
        let (mut store, project) = store();
        let other = store.project_create("other", "hd2d").unwrap();
        let global = store
            .style_create(None, "global", "custom", StyleRules::default())
            .unwrap();

        let for_project = store.style_list(Some(project)).unwrap();
        assert_eq!(for_project.len(), 1);
        assert_eq!(for_project[0].project_id, Some(project));

        let for_other = store.style_list(Some(other.id)).unwrap();
        assert_eq!(for_other.len(), 1);
        assert_eq!(for_other[0].project_id, Some(other.id));

        let project_less = store.style_list(None).unwrap();
        assert_eq!(project_less.len(), 1);
        assert_eq!(project_less[0].id, global.id);
    }

    #[test]
    fn style_update_round_trips_through_style_read() {
        let (mut store, project) = store();
        let mut style = store
            .style_create(Some(project), "original", "custom", StyleRules::default())
            .unwrap();
        style.name = "renamed".into();
        style.rules = StyleRules {
            max_slots: 12,
            ..StyleRules::default()
        };
        let updated = store.style_update(&style).unwrap();
        assert_eq!(updated.name, "renamed");
        assert_eq!(updated.rules.max_slots, 12);
        let read_back = store.style_read(style.id).unwrap();
        assert_eq!(read_back.name, "renamed");
        assert_eq!(read_back.rules.max_slots, 12);
    }

    #[test]
    fn reference_delete_removes_it_from_the_list_and_errors_on_a_missing_one() {
        let (mut store, project) = store();
        let asset = store.asset_create(project, "hero", "prop", 2, 2).unwrap();
        let reference = Reference {
            id: Uuid::now_v7(),
            asset_id: asset.id,
            name: "photo".into(),
            source_png: vec![1, 2, 3],
            conformed: None,
            conform_meta: None,
            created_at: now(),
        };
        store.reference_write(reference.clone()).unwrap();
        assert_eq!(store.reference_list(asset.id).unwrap().len(), 1);

        store.reference_delete(asset.id, reference.id).unwrap();
        assert!(store.reference_list(asset.id).unwrap().is_empty());

        assert_eq!(
            store
                .reference_delete(asset.id, reference.id)
                .unwrap_err()
                .code,
            "reference.not_found"
        );
        assert_eq!(
            store
                .reference_delete(asset.id, Uuid::now_v7())
                .unwrap_err()
                .code,
            "reference.not_found"
        );
    }

    #[test]
    fn asset_composite_renders_known_pixels_through_the_palette() {
        let (mut store, project) = store();
        let asset = store.asset_create(project, "hero", "prop", 2, 2).unwrap();
        let palette = Palette {
            slots: vec![PaletteSlot {
                index: 1,
                rgba: [10, 20, 30, 255],
                name: None,
                ramp: None,
                step: None,
            }],
            ramps: vec![],
        };
        store.palette_write(asset.id, palette).unwrap();
        let mut layer = store.layer_read(asset.id, LayerRole("flats")).unwrap();
        layer.buffer.data[0] = 1;
        store.layer_write(asset.id, layer).unwrap();

        let image = store.asset_composite(asset.id).unwrap();
        assert_eq!((image.width, image.height), (2, 2));
        assert_eq!(&image.data[0..4], &[10, 20, 30, 255]);
        // The other three pixels are untouched and remain transparent.
        for pixel in image.data[4..].chunks_exact(4) {
            assert_eq!(pixel, &[0, 0, 0, 0]);
        }
    }
}
