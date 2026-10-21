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

//! A version is committed with its schema changes, so an interrupted upgrade
//! can never look like a successful migration on the next launch.

use super::{AppError, Result};
use rusqlite::Connection;

pub const VERSION: i64 = 8;

pub fn migrate(connection: &mut Connection) -> Result<()> {
    migrate_to(connection, VERSION)
}

/// Brings the database up to `target`, which tests use to build a database as
/// an older release left it.
fn migrate_to(connection: &mut Connection, target: i64) -> Result<()> {
    connection.pragma_update(None, "foreign_keys", "ON")?;
    let transaction = connection.transaction()?;
    transaction.execute_batch("CREATE TABLE IF NOT EXISTS schema_migration (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);")?;
    let current: i64 = transaction.query_row(
        "SELECT COALESCE(MAX(version),0) FROM schema_migration",
        [],
        |row| row.get(0),
    )?;
    if current > VERSION {
        return Err(AppError::new(
            "store.newer_schema",
            format!("database version {current}, supported {VERSION}"),
        ));
    }
    for version in current + 1..=target {
        match version {
            1 => transaction.execute_batch(include_str!("schema.sql"))?,
            // Applied state is separate from provenance. Undo and redo append
            // audit rows without destroying the original author's operation.
            2 => transaction.execute_batch("CREATE TABLE op_history (seq INTEGER PRIMARY KEY REFERENCES op(seq) ON DELETE CASCADE, asset_id TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE, applied INTEGER NOT NULL CHECK(applied IN (0,1))); CREATE INDEX history_asset_seq ON op_history(asset_id,seq);")?,
            // The undo cursor replaces the per-row applied flag, and the step
            // order gains `flats` and `cleanup`. Both are done here rather than
            // by editing migration 1, so a database made before either change
            // is carried forward instead of being read against a schema it was
            // never written to.
            3 => {
                transaction.execute_batch(
                    "CREATE TABLE op_cursor (
                         asset_id TEXT PRIMARY KEY REFERENCES asset(id) ON DELETE CASCADE,
                         seq      INTEGER NOT NULL DEFAULT 0
                     );
                     INSERT INTO op_cursor
                         SELECT a.id, COALESCE((SELECT MAX(h.seq) FROM op_history h
                                                WHERE h.asset_id = a.id AND h.applied = 1), 0)
                         FROM asset a;
                     DELETE FROM op
                         WHERE kind NOT IN ('document_undo', 'document_redo')
                           AND seq NOT IN (SELECT seq FROM op_history);
                     DROP TABLE op_history;
                     UPDATE layer SET ordinal = 50 WHERE role = 'outline';
                     UPDATE layer SET ordinal = 70 WHERE role = 'rim';
                     UPDATE layer SET ordinal = 71 WHERE role = 'accent';
                     UPDATE asset SET step = 'accent' WHERE step = 'rim';",
                )?;
                // `flats` is a new role, so an existing asset has no layer for
                // it. One is created empty rather than derived from the
                // silhouette, because guessing which material each pixel is
                // would be inventing work the artist has not done.
                let mut statement = transaction.prepare(
                    "SELECT id, width, height FROM asset
                     WHERE NOT EXISTS (SELECT 1 FROM layer
                                       WHERE asset_id = asset.id AND role = 'flats')",
                )?;
                let assets = statement
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, u16>(1)?,
                            row.get::<_, u16>(2)?,
                        ))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                for (id, width, height) in assets {
                    let buffer = crate::raster::IndexedBuffer::new(width, height)?;
                    transaction.execute(
                        "INSERT INTO layer VALUES(?1, ?2, 'flats', 20, 1, 0, 1.0, ?3)",
                        rusqlite::params![
                            uuid::Uuid::now_v7().to_string(),
                            id,
                            buffer.data
                        ],
                    )?;
                }
            }
            // Tilemaps live in their own table, one row per background asset,
            // rather than as another `layer.buffer`, because a tilemap is a
            // grid of tile ids and per-layer parallax, not indexed pixels.
            4 => transaction.execute_batch(
                "CREATE TABLE tilemap (
                     asset_id TEXT PRIMARY KEY REFERENCES asset(id) ON DELETE CASCADE,
                     data     TEXT NOT NULL,
                     updated_at INTEGER NOT NULL
                 );",
            )?,
            // An animation is an ordered row of ordinary assets. The rows
            // exist only once an asset has a second frame, so every asset
            // made before this version is a one-frame animation as it is.
            5 => transaction.execute_batch(
                "CREATE TABLE frame (
                     asset_id    TEXT PRIMARY KEY REFERENCES asset(id) ON DELETE CASCADE,
                     root_id     TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
                     position    INTEGER NOT NULL,
                     duration_ms INTEGER NOT NULL,
                     UNIQUE (root_id, position)
                 );
                 CREATE TABLE animation (
                     root_id     TEXT PRIMARY KEY REFERENCES asset(id) ON DELETE CASCADE,
                     playback    TEXT NOT NULL DEFAULT 'forward'
                 );",
            )?,
            // A style's one preset splits into an era (colour limits) and a
            // view (canvas sizes). Every preset was a top-down one, since the
            // style guide is an overworld guide. `rules` is left as it is, so
            // no saved project gates or sizes differently after the upgrade.
            // The defaults only satisfy NOT NULL for the rows the UPDATE then
            // sets; the store always writes both columns itself.
            6 => transaction.execute_batch(
                "ALTER TABLE style ADD COLUMN era TEXT NOT NULL DEFAULT '32bit';
                 ALTER TABLE style ADD COLUMN view TEXT NOT NULL DEFAULT 'topdown';
                 UPDATE style SET era = CASE preset
                                            WHEN 'snes' THEN '16bit'
                                            WHEN 'gameboy' THEN '8bit'
                                            WHEN 'custom' THEN 'custom'
                                            ELSE '32bit'
                                        END,
                                  view = 'topdown';
                 ALTER TABLE style DROP COLUMN preset;",
            )?,
            // Three things, one release:
            // - Styles gain body proportions. Every style so far was drawn
            //   to standard proportions, which is what the gates measured.
            // - Projects gain their own log, for what happens to a project or
            //   its style rather than to an asset. It has no foreign key, so
            //   the entry for a deleted project outlives it.
            // - The ramp hue rule is now measured in OKLCH rather than HSL.
            //   Rules still holding the HSL default bands get the OKLCH ones,
            //   or a palette that passed would start failing on a unit change
            //   alone. No style could be edited before this version, so any
            //   other band is one nobody has written yet; none is touched.
            7 => {
                transaction.execute_batch(
                    "ALTER TABLE style ADD COLUMN proportions TEXT NOT NULL DEFAULT 'standard';
                     CREATE TABLE project_log (
                         seq        INTEGER PRIMARY KEY AUTOINCREMENT,
                         project_id TEXT NOT NULL,
                         kind       TEXT NOT NULL,
                         payload    TEXT NOT NULL,
                         actor      TEXT NOT NULL,
                         at         INTEGER NOT NULL
                     );
                     CREATE INDEX project_log_project ON project_log (project_id, seq);",
                )?;
                let rows = {
                    let mut statement = transaction.prepare("SELECT id, rules FROM style")?;
                    let rows = statement
                        .query_map([], |row| {
                            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                        })?
                        .collect::<rusqlite::Result<Vec<_>>>()?;
                    rows
                };
                for (id, text) in rows {
                    if let Some(rewritten) = oklch_hue_bands(&text)? {
                        transaction.execute(
                            "UPDATE style SET rules=?1 WHERE id=?2",
                            rusqlite::params![rewritten, id],
                        )?;
                    }
                }
            }
            // Two things for the step workflow:
            // - Which step an asset is viewed and drawn at, and which passed
            //   steps must re-run their gates, live beside the asset rather
            //   than in it: selecting a step is a view change and stays out
            //   of the op log, and `asset.step` keeps meaning the furthest
            //   step reached.
            // - Styles gain a line mode. Every style so far derived its line
            //   from the fills after light, so each is written as `derived`
            //   explicitly rather than left to a default a later release
            //   could change.
            8 => {
                transaction.execute_batch(
                    "CREATE TABLE step_view (
                         asset_id    TEXT PRIMARY KEY REFERENCES asset(id) ON DELETE CASCADE,
                         active_step TEXT,
                         recheck     TEXT NOT NULL DEFAULT '[]'
                     );",
                )?;
                let rows = {
                    let mut statement = transaction.prepare("SELECT id, rules FROM style")?;
                    let rows = statement
                        .query_map([], |row| {
                            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                        })?
                        .collect::<rusqlite::Result<Vec<_>>>()?;
                    rows
                };
                for (id, text) in rows {
                    if let Some(rewritten) = derived_line_mode(&text)? {
                        transaction.execute(
                            "UPDATE style SET rules=?1 WHERE id=?2",
                            rusqlite::params![rewritten, id],
                        )?;
                    }
                }
            }
            _ => {
                return Err(AppError::new(
                    "store.migration_missing",
                    version.to_string(),
                ))
            }
        }
        transaction.execute(
            "INSERT INTO schema_migration(version,applied_at) VALUES(?1,?2)",
            rusqlite::params![version, super::now()],
        )?;
    }
    transaction.commit()?;
    Ok(())
}

/// The rules JSON with `lineMode: derived` added, or `None` when it already
/// names a line mode. Edited as JSON for the same reason as the hue bands.
fn derived_line_mode(text: &str) -> Result<Option<String>> {
    let mut rules: serde_json::Value = serde_json::from_str(text)?;
    let Some(object) = rules.as_object_mut() else {
        return Ok(None);
    };
    if object.contains_key("lineMode") {
        return Ok(None);
    }
    object.insert("lineMode".into(), serde_json::json!("derived"));
    Ok(Some(serde_json::to_string(&rules)?))
}

/// The rules JSON with its HSL default hue bands replaced by the OKLCH ones,
/// or `None` when it does not hold the HSL defaults. Edited as JSON rather
/// than through `StyleRules`, so every other value of the row stays as it was
/// written, fields this release does not know included.
fn oklch_hue_bands(text: &str) -> Result<Option<String>> {
    use crate::raster::palette::{
        HSL_DARKER_HUE_DEG, HSL_LIGHTER_HUE_DEG, OKLCH_DARKER_HUE_DEG, OKLCH_LIGHTER_HUE_DEG,
    };
    let mut rules: serde_json::Value = serde_json::from_str(text)?;
    let Some(shift) = rules
        .get_mut("hueShift")
        .and_then(serde_json::Value::as_object_mut)
    else {
        return Ok(None);
    };
    let band = |value: Option<&serde_json::Value>| -> Option<[f32; 2]> {
        serde_json::from_value(value?.clone()).ok()
    };
    if band(shift.get("darkerHueDeg")) != Some(HSL_DARKER_HUE_DEG)
        || band(shift.get("lighterHueDeg")) != Some(HSL_LIGHTER_HUE_DEG)
    {
        return Ok(None);
    }
    shift.insert(
        "darkerHueDeg".into(),
        serde_json::json!(OKLCH_DARKER_HUE_DEG),
    );
    shift.insert(
        "lighterHueDeg".into(),
        serde_json::json!(OKLCH_LIGHTER_HUE_DEG),
    );
    Ok(Some(serde_json::to_string(&rules)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_is_repeatable_and_preserves_rows() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate(&mut c).unwrap();
        c.execute("INSERT INTO project VALUES('p','test',NULL,1,1)", [])
            .unwrap();
        migrate(&mut c).unwrap();
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM schema_migration", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            VERSION
        );
        assert_eq!(
            c.query_row("SELECT name FROM project", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "test"
        );
        assert!(c
            .execute(
                "INSERT INTO asset VALUES('a','missing',NULL,'bad','prop',1,1,'reference',1,1)",
                []
            )
            .is_err());
    }
    #[test]
    fn upgrades_version_one_and_refuses_future_databases() {
        let mut c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("schema.sql")).unwrap();
        c.execute_batch("CREATE TABLE schema_migration(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL); INSERT INTO schema_migration VALUES(1,0);").unwrap();
        migrate(&mut c).unwrap();
        c.execute("INSERT INTO schema_migration VALUES(99,0)", [])
            .unwrap();
        assert_eq!(migrate(&mut c).unwrap_err().code, "store.newer_schema");
    }
    #[test]
    fn version_four_gains_the_animation_tables_and_keeps_its_assets() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 4).unwrap();
        c.execute_batch(
            "INSERT INTO project VALUES('p','test',NULL,1,1);
             INSERT INTO asset VALUES('a','p',NULL,'hero','character',8,8,'flats',1,1);",
        )
        .unwrap();
        assert!(c.prepare("SELECT * FROM frame").is_err());
        migrate_to(&mut c, 5).unwrap();
        assert_eq!(
            c.query_row("SELECT MAX(version) FROM schema_migration", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            5
        );
        assert_eq!(
            c.query_row("SELECT name, step FROM asset", [], |r| Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?
            )))
            .unwrap(),
            ("hero".into(), "flats".into())
        );
        // An upgraded asset is a lone frame: no rows until a second is added.
        let rows: i64 = c
            .query_row(
                "SELECT (SELECT COUNT(*) FROM frame) + (SELECT COUNT(*) FROM animation)",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rows, 0);
        c.execute_batch(
            "INSERT INTO asset VALUES('b','p',NULL,'hero #2','character',8,8,'flats',1,1);
             INSERT INTO animation VALUES('a','forward');
             INSERT INTO frame VALUES('a','a',0,125);
             INSERT INTO frame VALUES('b','a',1,125);",
        )
        .unwrap();
        // Two frames may not share a position, and deleting the root takes
        // the animation's rows with it.
        assert!(c
            .execute("UPDATE frame SET position=0 WHERE asset_id='b'", [])
            .is_err());
        c.execute("DELETE FROM asset WHERE id='a'", []).unwrap();
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM frame", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn version_five_splits_each_preset_into_an_era_and_a_view_and_keeps_its_rules() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 5).unwrap();
        // Rules as a v5 release wrote them: no `canvasByKind`, and each row
        // different, so a rewrite of any one of them would show.
        let mut rules = serde_json::to_value(crate::raster::StyleRules::default()).unwrap();
        rules.as_object_mut().unwrap().remove("canvasByKind");
        let presets = [
            ("hd2d", "32bit", 24),
            ("snes", "16bit", 16),
            ("gameboy", "8bit", 4),
            ("custom", "custom", 9),
        ];
        let mut saved = Vec::new();
        for (n, (preset, _, slots)) in presets.iter().enumerate() {
            rules["maxSlots"] = (*slots).into();
            let text = serde_json::to_string(&rules).unwrap();
            // Real ids, since the store parses them once the upgrade is read back.
            let (project, style) = (
                uuid::Uuid::now_v7().to_string(),
                uuid::Uuid::now_v7().to_string(),
            );
            c.execute(
                "INSERT INTO project VALUES(?1,?2,NULL,?3,?3)",
                rusqlite::params![project, preset, n as i64],
            )
            .unwrap();
            c.execute(
                "INSERT INTO style VALUES(?1,?2,?3,?4,?5,1,1)",
                rusqlite::params![style, project, preset, preset, text],
            )
            .unwrap();
            c.execute(
                "UPDATE project SET style_id=?1 WHERE id=?2",
                [&style, &project],
            )
            .unwrap();
            saved.push((style, text));
        }
        migrate_to(&mut c, 6).unwrap();
        assert_eq!(
            c.query_row("SELECT MAX(version) FROM schema_migration", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            6
        );
        assert!(c.prepare("SELECT preset FROM style").is_err());
        for ((style, text), (preset, era, _)) in saved.iter().zip(presets) {
            let row: (String, String, String) = c
                .query_row(
                    "SELECT era, view, rules FROM style WHERE id=?1",
                    [style],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .unwrap();
            assert_eq!(
                row,
                (era.into(), "topdown".into(), text.clone()),
                "{preset}"
            );
        }
        // The store reads the upgraded rows: the project carries its style's
        // axes, and rules without `canvasByKind` size every kind by `canvas`.
        let store = super::super::Store::from_connection(c).unwrap();
        let projects = store.project_list().unwrap();
        let axes: Vec<_> = projects
            .iter()
            .map(|p| (p.era.as_deref().unwrap(), p.view.as_deref().unwrap()))
            .collect();
        assert_eq!(
            axes,
            [
                ("32bit", "topdown"),
                ("16bit", "topdown"),
                ("8bit", "topdown"),
                ("custom", "topdown")
            ]
        );
        let style = store.style_read(projects[3].style_id.unwrap()).unwrap();
        assert_eq!((style.era.as_str(), style.rules.max_slots), ("custom", 9));
        assert!(style.rules.canvas_by_kind.is_empty());
        assert_eq!(style.rules.canvas_for("tile").width, 48);
    }
    #[test]
    fn version_six_gains_proportions_a_project_log_and_oklch_hue_bands() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 6).unwrap();
        // One style as a v6 release saved it, with the HSL hue bands, and one
        // whose bands are something else, which is left as it is.
        let mut hsl = serde_json::to_value(crate::raster::StyleRules::default()).unwrap();
        hsl["hueShift"]["darkerHueDeg"] = serde_json::json!([12.0, 20.0]);
        hsl["hueShift"]["lighterHueDeg"] = serde_json::json!([-20.0, -12.0]);
        let mut other = hsl.clone();
        other["hueShift"]["darkerHueDeg"] = serde_json::json!([10.0, 25.0]);
        let (project, old, odd) = (
            uuid::Uuid::now_v7().to_string(),
            uuid::Uuid::now_v7().to_string(),
            uuid::Uuid::now_v7().to_string(),
        );
        c.execute("INSERT INTO project VALUES(?1,'p',NULL,1,1)", [&project])
            .unwrap();
        for (id, rules) in [(&old, &hsl), (&odd, &other)] {
            c.execute(
                "INSERT INTO style(id,project_id,name,rules,created_at,updated_at,era,view)
                 VALUES(?1,?2,'s',?3,1,1,'16bit','topdown')",
                rusqlite::params![id, project, rules.to_string()],
            )
            .unwrap();
        }
        c.execute(
            "UPDATE project SET style_id=?1 WHERE id=?2",
            [&old, &project],
        )
        .unwrap();
        let untouched: String = c
            .query_row("SELECT rules FROM style WHERE id=?1", [&odd], |r| r.get(0))
            .unwrap();
        migrate(&mut c).unwrap();
        assert!(c.prepare("SELECT * FROM project_log").is_ok());
        let store = super::super::Store::from_connection(c).unwrap();
        let upgraded = store
            .style_read(uuid::Uuid::parse_str(&old).unwrap())
            .unwrap();
        assert_eq!(upgraded.proportions, "standard");
        assert_eq!(upgraded.era, "16bit");
        assert_eq!(upgraded.rules.hue_shift.darker_hue_deg, [6.0, 30.0]);
        assert_eq!(upgraded.rules.hue_shift.lighter_hue_deg, [-30.0, -6.0]);
        // Only the hue bands moved.
        assert_eq!(
            upgraded.rules.max_slots,
            crate::raster::StyleRules::default().max_slots
        );
        let kept: String = store
            .connection
            .query_row("SELECT rules FROM style WHERE id=?1", [&odd], |r| r.get(0))
            .unwrap();
        assert_eq!(kept, untouched);
        let project = store.project_list().unwrap().remove(0);
        assert_eq!(project.proportions.as_deref(), Some("standard"));
    }
    #[test]
    fn version_seven_styles_keep_deriving_their_line_and_assets_gain_a_step_view() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 7).unwrap();
        // Rules as a v7 release saved them, before line modes existed.
        let mut rules = serde_json::to_value(crate::raster::StyleRules::default()).unwrap();
        rules.as_object_mut().unwrap().remove("lineMode");
        let (project, style) = (
            uuid::Uuid::now_v7().to_string(),
            uuid::Uuid::now_v7().to_string(),
        );
        c.execute("INSERT INTO project VALUES(?1,'p',NULL,1,1)", [&project])
            .unwrap();
        c.execute(
            "INSERT INTO style(id,project_id,name,rules,created_at,updated_at,era,view,proportions)
             VALUES(?1,?2,'s',?3,1,1,'32bit','topdown','chibi')",
            rusqlite::params![style, project, rules.to_string()],
        )
        .unwrap();
        migrate(&mut c).unwrap();
        let written: String = c
            .query_row("SELECT rules FROM style WHERE id=?1", [&style], |r| {
                r.get(0)
            })
            .unwrap();
        let written: serde_json::Value = serde_json::from_str(&written).unwrap();
        assert_eq!(written["lineMode"], "derived");
        assert!(c
            .prepare("SELECT asset_id, active_step, recheck FROM step_view")
            .is_ok());
        let store = super::super::Store::from_connection(c).unwrap();
        let upgraded = store
            .style_read(uuid::Uuid::parse_str(&style).unwrap())
            .unwrap();
        assert_eq!(upgraded.rules.line_mode, "derived");
        // Nothing else about the style moved.
        assert_eq!(upgraded.proportions, "chibi");
        assert_eq!(upgraded.era, "32bit");
    }
}
