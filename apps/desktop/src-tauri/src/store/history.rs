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

//! A persisted cursor keeps undo valid across restarts. Undo and redo append
//! audit rows, while a new branch truncates the abandoned future explicitly.

use super::{AppError, AssetId, OpResult, Reference, Result, Store};
use crate::raster::{ops, Layer, LayerRole, Palette};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub(super) enum Mutation {
    Draw(Vec<crate::raster::Op>),
    Regions(Vec<(LayerRole, ops::Edit)>),
    Palette(Palette),
    Layer(Option<Layer>, LayerRole),
    Reference(Option<Reference>, Uuid),
    Step(String),
    Rename(String),
    Style(Option<Uuid>),
}
impl Mutation {
    fn kind(&self) -> &'static str {
        match self {
            Self::Draw(_) | Self::Regions(_) => "document_write_ops",
            Self::Palette(_) => "palette_write",
            Self::Layer(..) => "layer_write",
            Self::Reference(..) => "reference_write",
            Self::Step(_) => "step_advance",
            Self::Rename(_) => "asset_rename",
            Self::Style(_) => "asset_set_style",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpRecord {
    pub seq: i64,
    pub asset_id: AssetId,
    pub layer_role: Option<LayerRole>,
    pub kind: String,
    pub payload: serde_json::Value,
    pub inverse: Option<Vec<u8>>,
    pub actor: String,
    pub at: i64,
}

impl Store {
    pub fn write_ops(
        &mut self,
        id: AssetId,
        ops: Vec<crate::raster::Op>,
        actor: &str,
    ) -> Result<OpResult> {
        if ops.is_empty() || ops.len() > 4096 {
            return Err(AppError::new(
                "document.invalid_batch",
                "a batch must contain 1..=4096 operations",
            ));
        }
        self.commit(id, Mutation::Draw(ops), actor)
    }

    pub(super) fn commit(
        &mut self,
        id: AssetId,
        mutation: Mutation,
        actor: &str,
    ) -> Result<OpResult> {
        validate_actor(actor)?;
        let tx = self.connection.transaction()?;
        let (inverse, mut result) = apply(&tx, id, &mutation)?;
        tx.execute(
            "DELETE FROM op WHERE asset_id=?1 AND seq>COALESCE((SELECT seq FROM op_cursor WHERE asset_id=?1),0)",
            [id.0.to_string()],
        )?;
        result.seq = append(
            &tx,
            id,
            mutation.kind(),
            &mutation,
            &inverse,
            actor,
            &result.roles,
        )?;
        tx.execute(
            "INSERT INTO op_cursor(seq,asset_id) VALUES(?1,?2) ON CONFLICT(asset_id) DO UPDATE SET seq=excluded.seq",
            params![result.seq, id.0.to_string()],
        )?;
        trim(&tx, id, self.history_limit)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn undo(&mut self, id: AssetId, actor: &str) -> Result<OpResult> {
        self.travel(id, actor, false)
    }
    pub fn redo(&mut self, id: AssetId, actor: &str) -> Result<OpResult> {
        self.travel(id, actor, true)
    }

    fn travel(&mut self, id: AssetId, actor: &str, redo: bool) -> Result<OpResult> {
        validate_actor(actor)?;
        let tx = self.connection.transaction()?;
        super::read_asset(&tx, id)?;
        let sql = if redo {
            "SELECT seq,payload,inverse FROM op WHERE asset_id=?1 AND kind NOT IN ('document_undo','document_redo') AND seq>COALESCE((SELECT seq FROM op_cursor WHERE asset_id=?1),0) ORDER BY seq ASC LIMIT 1"
        } else {
            "SELECT seq,payload,inverse FROM op WHERE asset_id=?1 AND kind NOT IN ('document_undo','document_redo') AND seq<=COALESCE((SELECT seq FROM op_cursor WHERE asset_id=?1),0) ORDER BY seq DESC LIMIT 1"
        };
        let found: Option<(i64, String, Vec<u8>)> = tx
            .query_row(sql, [id.0.to_string()], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .optional()?;
        let Some((seq, payload, inverse)) = found else {
            return Err(AppError::new(
                if redo {
                    "document.nothing_to_redo"
                } else {
                    "document.nothing_to_undo"
                },
                "history boundary reached",
            ));
        };
        let mutation: Mutation = if redo {
            serde_json::from_str(&payload)?
        } else {
            serde_json::from_slice(&inverse)?
        };
        let (opposite, mut result) = apply(&tx, id, &mutation)?;
        let cursor = if redo {
            seq
        } else {
            tx.query_row("SELECT COALESCE(MAX(seq),0) FROM op WHERE asset_id=?1 AND seq<?2 AND kind NOT IN ('document_undo','document_redo')",params![id.0.to_string(),seq],|r|r.get(0))?
        };
        tx.execute("INSERT INTO op_cursor(asset_id,seq) VALUES(?1,?2) ON CONFLICT(asset_id) DO UPDATE SET seq=excluded.seq",params![id.0.to_string(),cursor])?;
        result.seq = append(
            &tx,
            id,
            if redo {
                "document_redo"
            } else {
                "document_undo"
            },
            &mutation,
            &opposite,
            actor,
            &result.roles,
        )?;
        trim(&tx, id, self.history_limit)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn op_log(&self, id: AssetId) -> Result<Vec<OpRecord>> {
        self.asset_read(id)?;
        let mut statement = self.connection.prepare("SELECT seq,layer_role,kind,payload,inverse,actor,at FROM op WHERE asset_id=?1 ORDER BY seq")?;
        let rows = statement
            .query_map([id.0.to_string()], |r| {
                let role: Option<String> = r.get(1)?;
                let layer_role = role
                    .map(|v| {
                        LayerRole::parse(&v).map_err(|e| {
                            rusqlite::Error::FromSqlConversionFailure(
                                1,
                                rusqlite::types::Type::Text,
                                Box::new(e),
                            )
                        })
                    })
                    .transpose()?;
                Ok(OpRecord {
                    seq: r.get(0)?,
                    asset_id: id,
                    layer_role,
                    kind: r.get(2)?,
                    payload: super::decode(r, 3)?,
                    inverse: r.get(4)?,
                    actor: r.get(5)?,
                    at: r.get(6)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn trim_history(&mut self, id: AssetId, limit: usize) -> Result<()> {
        if limit == 0 {
            return Err(AppError::new(
                "document.invalid_history_limit",
                "history bound must be positive",
            ));
        }
        self.asset_read(id)?;
        let tx = self.connection.transaction()?;
        trim(&tx, id, limit)?;
        tx.commit()?;
        Ok(())
    }
}

fn validate_actor(actor: &str) -> Result<()> {
    // A forced advance records the actor as "<actor> (forced)"; strip that
    // suffix before validating the underlying actor.
    let base = actor.strip_suffix(" (forced)").unwrap_or(actor);
    if base != "user"
        && (!base.starts_with("agent:")
            || base.len() <= 6
            || base.len() > 256
            || base.chars().any(char::is_control))
    {
        return Err(AppError::new(
            "document.invalid_actor",
            "actor must be user or agent:<session id>",
        ));
    }
    Ok(())
}
fn append(
    c: &Connection,
    id: AssetId,
    kind: &str,
    payload: &Mutation,
    inverse: &Mutation,
    actor: &str,
    roles: &[LayerRole],
) -> Result<i64> {
    let role = if roles.len() == 1 {
        Some(roles[0].0)
    } else {
        None
    };
    c.execute("INSERT INTO op(asset_id,layer_role,kind,payload,inverse,actor,at) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![id.0.to_string(),role,kind,super::json(payload)?,serde_json::to_vec(inverse)?,actor,super::now()])?;
    Ok(c.last_insert_rowid())
}
fn trim(c: &Connection, id: AssetId, limit: usize) -> Result<()> {
    c.execute("DELETE FROM op WHERE asset_id=?1 AND seq NOT IN (SELECT seq FROM op WHERE asset_id=?1 ORDER BY seq DESC LIMIT ?2)",params![id.0.to_string(),limit as i64])?;
    Ok(())
}

fn apply(c: &Connection, id: AssetId, mutation: &Mutation) -> Result<(Mutation, OpResult)> {
    let mut document = super::read_document(c, id)?;
    let mut result = OpResult {
        changed: 0,
        bounds: None,
        roles: vec![],
        seq: 0,
    };
    let inverse = match mutation {
        Mutation::Draw(operations) => {
            let mut inverses = Vec::new();
            let rules = super::effective_rules(c, &document.asset)?;
            for operation in operations {
                let role = operation.target();
                let edit = crate::raster::document_ops::apply(
                    &mut document.layers,
                    &document.palette,
                    &rules,
                    operation,
                )?;
                accumulate(&mut result, role, &edit);
                inverses.push((role, edit));
            }
            for layer in &document.layers {
                save_layer(c, id, layer)?;
            }
            inverses.reverse();
            Mutation::Regions(inverses)
        }
        Mutation::Regions(regions) => {
            let mut opposite = Vec::new();
            for (role, edit) in regions {
                let layer = document
                    .layers
                    .iter_mut()
                    .find(|l| l.role == *role)
                    .ok_or_else(|| AppError::new("document.layer_not_found", role.0))?;
                let prior = edit
                    .bounds
                    .map(|b| ops::region(&layer.buffer, b))
                    .transpose()?
                    .unwrap_or_default();
                let changed = prior
                    .iter()
                    .zip(&edit.prior)
                    .filter(|(a, b)| a != b)
                    .count();
                let reverse = ops::Edit {
                    changed,
                    bounds: edit.bounds,
                    prior,
                    // Undoing a shading pass restores bytes; it resolves
                    // nothing, so it has nothing it could have skipped.
                    skipped: 0,
                };
                ops::restore(&mut layer.buffer, edit)?;
                accumulate(&mut result, *role, &reverse);
                opposite.push((*role, reverse));
            }
            for layer in &document.layers {
                save_layer(c, id, layer)?;
            }
            opposite.reverse();
            Mutation::Regions(opposite)
        }
        Mutation::Palette(palette) => {
            palette.validate(&super::effective_rules(c, &document.asset)?)?;
            for layer in &document.layers {
                for &index in &layer.buffer.data {
                    if index != 0 {
                        palette.slot(index)?;
                    }
                }
            }
            c.execute(
                "UPDATE palette SET slots=?1,ramps=?2 WHERE asset_id=?3",
                params![
                    super::json(&palette.slots)?,
                    super::json(&palette.ramps)?,
                    id.0.to_string()
                ],
            )?;
            Mutation::Palette(document.palette)
        }
        Mutation::Layer(layer, role) => {
            let previous = document.layers.iter().find(|l| l.role == *role).cloned();
            if let Some(layer) = layer {
                if previous.as_ref().is_some_and(|old| old.id != layer.id) {
                    return Err(AppError::new(
                        "document.invalid_layer",
                        "an existing role keeps its layer id",
                    ));
                }
                layer.buffer.validate()?;
                let ordinal = crate::raster::LAYER_ROLES
                    .iter()
                    .find(|(name, _)| *name == role.0)
                    .map(|(_, n)| *n);
                if layer.role != *role
                    || Some(layer.ordinal) != ordinal
                    || layer.buffer.width != document.asset.width
                    || layer.buffer.height != document.asset.height
                    || !layer.opacity.is_finite()
                    || !(0.0..=1.0).contains(&layer.opacity)
                {
                    return Err(AppError::new(
                        "document.invalid_layer",
                        "role, ordinal, dimensions, or opacity is invalid",
                    ));
                }
                for &index in &layer.buffer.data {
                    if index != 0 {
                        document.palette.slot(index)?;
                    }
                }
                save_layer(c, id, layer)?;
            } else {
                c.execute(
                    "DELETE FROM layer WHERE asset_id=?1 AND role=?2",
                    params![id.0.to_string(), role.0],
                )?;
            }
            result.roles.push(*role);
            result.bounds = Some(ops::Bounds {
                x: 0,
                y: 0,
                width: document.asset.width,
                height: document.asset.height,
            });
            let old = previous.as_ref().map(|l| l.buffer.data.as_slice());
            let new = layer.as_ref().map(|l| l.buffer.data.as_slice());
            result.changed = (0..usize::from(document.asset.width)
                * usize::from(document.asset.height))
                .filter(|&i| old.map_or(0, |b| b[i]) != new.map_or(0, |b| b[i]))
                .count();
            Mutation::Layer(previous, *role)
        }
        Mutation::Reference(reference, key) => {
            let owner: Option<String> = c
                .query_row(
                    "SELECT asset_id FROM reference WHERE id=?1",
                    [key.to_string()],
                    |r| r.get(0),
                )
                .optional()?;
            if owner.is_some_and(|owner| owner != id.0.to_string()) {
                return Err(AppError::new(
                    "reference.invalid_owner",
                    "reference belongs to another asset",
                ));
            }
            let previous = super::read_references(c, id)?
                .into_iter()
                .find(|r| r.id == *key);
            if let Some(reference) = reference {
                if reference.asset_id != id || reference.id != *key {
                    return Err(AppError::new(
                        "reference.invalid_owner",
                        "reference belongs to another asset",
                    ));
                }
                if let Some(pixels) = &reference.conformed {
                    if pixels.iter().any(|slot| *slot > 62)
                        || pixels.len()
                            != usize::from(document.asset.width)
                                * usize::from(document.asset.height)
                    {
                        return Err(AppError::new(
                            "reference.invalid_buffer",
                            "conformed reference must match the asset dimensions",
                        ));
                    }
                }
                c.execute("INSERT INTO reference VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET name=excluded.name,source_png=excluded.source_png,conformed=excluded.conformed,conform_meta=excluded.conform_meta WHERE reference.asset_id=excluded.asset_id",params![key.to_string(),id.0.to_string(),reference.name,reference.source_png,reference.conformed,reference.conform_meta.as_ref().map(super::json).transpose()?,reference.created_at])?;
            } else {
                c.execute(
                    "DELETE FROM reference WHERE id=?1 AND asset_id=?2",
                    params![key.to_string(), id.0.to_string()],
                )?;
            }
            Mutation::Reference(previous, *key)
        }
        Mutation::Step(step) => {
            if !super::STEPS.contains(&step.as_str()) {
                return Err(AppError::new("document.invalid_step", step));
            }
            c.execute(
                "UPDATE asset SET step=?1 WHERE id=?2",
                params![step, id.0.to_string()],
            )?;
            Mutation::Step(document.asset.step)
        }
        Mutation::Rename(value) => {
            super::name(value)?;
            c.execute(
                "UPDATE asset SET name=?1 WHERE id=?2",
                params![value, id.0.to_string()],
            )?;
            Mutation::Rename(document.asset.name)
        }
        Mutation::Style(style) => {
            c.execute(
                "UPDATE asset SET style_id=?1 WHERE id=?2",
                params![style.map(|s| s.to_string()), id.0.to_string()],
            )?;
            Mutation::Style(document.asset.style_id)
        }
    };
    c.execute(
        "UPDATE asset SET updated_at=?1 WHERE id=?2",
        params![super::now(), id.0.to_string()],
    )?;
    result.roles.sort();
    result.roles.dedup();
    Ok((inverse, result))
}

fn save_layer(c: &Connection, id: AssetId, layer: &Layer) -> Result<()> {
    c.execute("INSERT INTO layer(id,asset_id,role,ordinal,visible,locked,opacity,pixels) VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(asset_id,role) DO UPDATE SET visible=excluded.visible,locked=excluded.locked,opacity=excluded.opacity,pixels=excluded.pixels",params![layer.id.to_string(),id.0.to_string(),layer.role.0,layer.ordinal,layer.visible,layer.locked,layer.opacity,layer.buffer.data])?;
    Ok(())
}
fn accumulate(result: &mut OpResult, role: LayerRole, edit: &ops::Edit) {
    result.changed += edit.changed;
    if edit.changed > 0 {
        result.roles.push(role);
    }
    if let Some(b) = edit.bounds {
        result.bounds = Some(match result.bounds {
            None => b,
            Some(a) => {
                let x = a.x.min(b.x);
                let y = a.y.min(b.y);
                ops::Bounds {
                    x,
                    y,
                    width: (u32::from(a.x) + u32::from(a.width))
                        .max(u32::from(b.x) + u32::from(b.width)) as u16
                        - x,
                    height: (u32::from(a.y) + u32::from(a.height))
                        .max(u32::from(b.y) + u32::from(b.height))
                        as u16
                        - y,
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raster::PaletteSlot;
    fn setup() -> (Store, AssetId) {
        let mut s = Store::memory().unwrap();
        let p = s.project_create("project", "hd2d").unwrap();
        let a = s.asset_create(p.id, "asset", "prop", 4, 4).unwrap();
        s.palette_write(
            a.id,
            Palette {
                slots: vec![PaletteSlot {
                    index: 1,
                    rgba: [100, 80, 60, 255],
                    name: None,
                    ramp: None,
                    step: None,
                }],
                ramps: vec![],
            },
        )
        .unwrap();
        (s, a.id)
    }
    fn draw(x: i32) -> crate::raster::Op {
        crate::raster::Op::SetPixels {
            layer: LayerRole("silhouette"),
            pixels: vec![ops::Pixel { x, y: 0, slot: 1 }],
        }
    }
    #[test]
    fn batch_undo_redo_preserves_pixels_and_authorship() {
        let (mut s, id) = setup();
        let before = s.asset_open(id).unwrap();
        let first = s
            .write_ops(id, vec![draw(0), draw(1)], "agent:session")
            .unwrap();
        assert_eq!(first.changed, 2);
        let drawn = s.asset_open(id).unwrap();
        let undone = s.undo(id, "user").unwrap();
        assert!(undone.seq > first.seq);
        assert_eq!(
            s.asset_open(id).unwrap().layers[0].buffer,
            before.layers[0].buffer
        );
        s.redo(id, "user").unwrap();
        assert_eq!(
            s.asset_open(id).unwrap().layers[0].buffer,
            drawn.layers[0].buffer
        );
        assert_eq!(s.op_log(id).unwrap()[1].actor, "agent:session");
    }
    #[test]
    fn invalid_batch_rolls_back_and_a_branch_abandons_redo() {
        let (mut s, id) = setup();
        let mut bad = draw(1);
        if let crate::raster::Op::SetPixels { layer, .. } = &mut bad {
            *layer = LayerRole("outline");
        }
        let mut layer = s.layer_read(id, bad.target()).unwrap();
        layer.locked = true;
        s.layer_write(id, layer).unwrap();
        let count = s.op_log(id).unwrap().len();
        assert!(s.write_ops(id, vec![draw(0), bad], "user").is_err());
        assert_eq!(s.op_log(id).unwrap().len(), count);
        assert_eq!(s.asset_open(id).unwrap().layers[0].buffer.data, vec![0; 16]);
        s.write_ops(id, vec![draw(0)], "user").unwrap();
        s.undo(id, "user").unwrap();
        s.write_ops(id, vec![draw(2)], "user").unwrap();
        assert_eq!(
            s.redo(id, "user").unwrap_err().code,
            "document.nothing_to_redo"
        );
    }
    #[test]
    fn palette_edits_undo_and_trimming_is_per_asset() {
        let (mut s, id) = setup();
        let p = s.palette_read(id).unwrap();
        let mut q = p.clone();
        q.slots[0].rgba = [200, 100, 50, 255];
        s.palette_write(id, q.clone()).unwrap();
        s.undo(id, "user").unwrap();
        assert_eq!(s.palette_read(id).unwrap(), p);
        s.redo(id, "user").unwrap();
        assert_eq!(s.palette_read(id).unwrap(), q);
        let project = s.project_list().unwrap()[0].id;
        let other = s.asset_create(project, "other", "tile", 2, 2).unwrap();
        s.asset_rename(other.id, "renamed").unwrap();
        s.trim_history(id, 2).unwrap();
        assert_eq!(s.op_log(id).unwrap().len(), 2);
        assert_eq!(s.op_log(other.id).unwrap().len(), 1);
    }
    #[test]
    fn undo_survives_reopening_the_database() {
        let path = std::env::temp_dir().join(format!("bitwright-test-{}.db", Uuid::now_v7()));
        let id;
        {
            let mut s = Store::open(&path).unwrap();
            let p = s.project_create("p", "hd2d").unwrap();
            id = s.asset_create(p.id, "old", "prop", 2, 2).unwrap().id;
            s.asset_rename(id, "new").unwrap();
            s.undo(id, "user").unwrap();
        }
        {
            let mut s = Store::open(&path).unwrap();
            assert_eq!(s.asset_read(id).unwrap().name, "old");
            s.redo(id, "user").unwrap();
            assert_eq!(s.asset_read(id).unwrap().name, "new");
        }
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn validate_actor_accepts_user_and_forced_actors() {
        assert!(validate_actor("user").is_ok());
        assert!(validate_actor("user (forced)").is_ok());
        assert!(validate_actor("agent:s-1").is_ok());
        assert!(validate_actor("agent:s-1 (forced)").is_ok());
    }
    #[test]
    fn validate_actor_rejects_unknown_and_malformed_actors() {
        assert_eq!(
            validate_actor("someone").unwrap_err().code,
            "document.invalid_actor"
        );
        assert_eq!(
            validate_actor("agent:").unwrap_err().code,
            "document.invalid_actor"
        );
    }
}
