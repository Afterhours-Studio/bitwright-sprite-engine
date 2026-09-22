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

use crate::raster::{IndexedBuffer, Layer, LayerRole, Palette, StyleRules, LAYER_ROLES};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{de::DeserializeOwned, Serialize};
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
        let result = self.commit(id, history::Mutation::Palette(palette), "user")?;
        Ok((self.palette_read(id)?, result))
    }
    pub fn palette_delete(&mut self, id: AssetId) -> Result<OpResult> {
        self.commit(id, history::Mutation::Palette(Palette::default()), "user")
    }
    pub fn layer_write(&mut self, id: AssetId, layer: Layer) -> Result<OpResult> {
        self.commit(
            id,
            history::Mutation::Layer(Some(layer.clone()), layer.role),
            "user",
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
        || rules.max_slots > 63
        || rules.ramp_steps.min == 0
        || rules.ramp_steps.min > rules.ramp_steps.max
        || rules.ramp_steps.max > 63
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
