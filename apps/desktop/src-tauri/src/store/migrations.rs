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

pub const VERSION: i64 = 2;

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
            _ => return Err(AppError::new("store.migration_missing",version.to_string())),
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
