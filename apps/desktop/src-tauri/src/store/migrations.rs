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

pub const VERSION: i64 = 4;

pub fn migrate(connection: &mut Connection) -> Result<()> {
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
    for version in current + 1..=VERSION {
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
}
