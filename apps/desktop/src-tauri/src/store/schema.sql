-- Bitwright - Sprite Engine
-- Copyright (C) 2026 Afterhours Studio
--
-- This program is free software: you can redistribute it and/or modify
-- it under the terms of the GNU Affero General Public License as
-- published by the Free Software Foundation, either version 3 of the
-- License, or (at your option) any later version.
--
-- This program is distributed in the hope that it will be useful,
-- but WITHOUT ANY WARRANTY; without even the implied warranty of
-- MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
-- GNU Affero General Public License for more details.
--
-- You should have received a copy of the GNU Affero General Public License
-- along with this program. If not, see <https://www.gnu.org/licenses/>.

CREATE TABLE project (
    id           TEXT PRIMARY KEY,          -- uuid v7, so ids sort by creation
    name         TEXT NOT NULL,
    style_id     TEXT REFERENCES style(id), -- the project's default style
    created_at   INTEGER NOT NULL,          -- unix millis
    updated_at   INTEGER NOT NULL
);

CREATE TABLE style (
    id           TEXT PRIMARY KEY,
    project_id   TEXT REFERENCES project(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    preset       TEXT NOT NULL,             -- 'hd2d' | 'snes' | 'gameboy' | 'custom'
    rules        TEXT NOT NULL,             -- JSON: StyleRules, see §4
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

CREATE TABLE asset (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    style_id     TEXT REFERENCES style(id),  -- overrides the project default
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL,              -- 'character'|'prop'|'tile'|'tileset'|'background'
    width        INTEGER NOT NULL,
    height       INTEGER NOT NULL,
    step         TEXT NOT NULL,              -- current workflow step, see §6
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    UNIQUE (project_id, name)
);

CREATE TABLE palette (
    asset_id     TEXT PRIMARY KEY REFERENCES asset(id) ON DELETE CASCADE,
    slots        TEXT NOT NULL,              -- JSON: PaletteSlot[], index is slot number
    ramps        TEXT NOT NULL               -- JSON: Ramp[], see §4
);

CREATE TABLE layer (
    id           TEXT PRIMARY KEY,
    asset_id     TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
    role         TEXT NOT NULL,              -- workflow step that owns it, see §6
    ordinal      INTEGER NOT NULL,           -- composite order, low to high
    visible      INTEGER NOT NULL DEFAULT 1,
    locked       INTEGER NOT NULL DEFAULT 0,
    opacity      REAL NOT NULL DEFAULT 1.0,
    pixels       BLOB NOT NULL,              -- width*height bytes, row major, 0 = transparent
    UNIQUE (asset_id, role)
);

CREATE TABLE reference (
    id           TEXT PRIMARY KEY,
    asset_id     TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    source_png   BLOB NOT NULL,              -- the image as imported, untouched
    conformed    BLOB,                       -- indexed result of conform, may be null
    conform_meta TEXT,                       -- JSON: detected grid, palette, warnings
    created_at   INTEGER NOT NULL
);

CREATE TABLE op (
    seq          INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id     TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
    layer_role   TEXT,                       -- null for ops that are not layer writes
    kind         TEXT NOT NULL,              -- the tool or command name
    payload      TEXT NOT NULL,              -- JSON: the op's arguments
    inverse      BLOB,                       -- prior bytes of the region it overwrote
    actor        TEXT NOT NULL,              -- 'user' | 'agent:<mcp session id>'
    at           INTEGER NOT NULL
);

CREATE INDEX op_asset_seq ON op (asset_id, seq);
