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

pub const VERSION: i64 = 6;

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
        migrate(&mut c).unwrap();
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
}
