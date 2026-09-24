# Tilemaps and export — contract

The shapes both sides code against for backgrounds (tilemaps) and export.
Rust paths are under `apps/desktop/src-tauri/src/`, TypeScript under
`apps/desktop/src/`. Tauri renames command arguments to camelCase.

## Tilemaps

A background asset is drawn as a tilemap, not as one large canvas (see the
plan's canvas table). A tile is an ordinary `tile` asset in the same project,
drawn through the normal workflow. A tilemap is a grid of tile ids in one or
more layers; each layer has a parallax factor, so a game can scroll the far
hills slower than the near ground.

### Rust: `raster/tilemap.rs` (library crate)

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TilemapLayer {
    pub name: String,          // unique within the map, 1..=40 chars
    pub parallax: f32,         // 0.0..=4.0; 1.0 moves with the camera
    pub visible: bool,
    pub tiles: Vec<Option<Uuid>>, // row-major, len == columns * rows; None is empty
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tilemap {
    pub tile_width: u16,       // 8..=64
    pub tile_height: u16,      // 8..=64
    pub columns: u16,          // 1..=256
    pub rows: u16,             // 1..=256
    pub layers: Vec<TilemapLayer>, // back to front, 1..=8
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement { pub x: u16, pub y: u16, pub tile: Option<Uuid> }

impl Tilemap {
    pub fn new(tile_width: u16, tile_height: u16, columns: u16, rows: u16) -> Result<Self>; // one layer "ground", parallax 1.0
    pub fn validate(&self) -> Result<()>;                        // every bound above; codes below
    pub fn place(&mut self, layer: &str, placements: &[Placement]) -> Result<usize>; // cells changed
    pub fn add_layer(&mut self, name: &str, parallax: f32) -> Result<()>;           // appended in front
    pub fn remove_layer(&mut self, name: &str) -> Result<()>;                       // refuses the last one
    pub fn set_layer(&mut self, name: &str, parallax: Option<f32>, visible: Option<bool>) -> Result<()>;
    pub fn tile_ids(&self) -> BTreeSet<Uuid>;                                        // every tile placed
    /// Every visible layer, back to front, each tile drawn from `tiles`
    /// (a tile's composite); a placed tile missing from `tiles` is `tilemap.tile_missing`.
    pub fn render(&self, tiles: &HashMap<Uuid, RgbaImage>) -> Result<RgbaImage>;
    pub fn render_layer(&self, layer: &str, tiles: &HashMap<Uuid, RgbaImage>) -> Result<RgbaImage>;
}
```

The rendered map is at most 4096 pixels on each side (`MAX_SIDE`), so a map
that passes every bound can still be rendered in memory.

Error codes (`RasterError`): `tilemap.invalid_size`, `tilemap.invalid_layer`,
`tilemap.layer_exists`, `tilemap.layer_not_found`, `tilemap.last_layer`,
`tilemap.out_of_bounds`, `tilemap.tile_missing`, `tilemap.tile_size`
(a tile image whose size differs from the map's tile size).

### Store (`store/mod.rs`, migration 4 in `store/migrations.rs`)

```sql
CREATE TABLE tilemap (
  asset_id TEXT PRIMARY KEY REFERENCES asset(id) ON DELETE CASCADE,
  data     TEXT NOT NULL,          -- the Tilemap as JSON
  updated_at INTEGER NOT NULL
);
```

```rust
pub fn tilemap_read(&self, id: AssetId) -> Result<Tilemap>;           // `tilemap.none` when absent
pub fn tilemap_write(&mut self, id: AssetId, map: &Tilemap) -> Result<Tilemap>; // validates; the asset must be kind "background"
                                                                        // (`tilemap.not_background`); every placed tile must be a
                                                                        // "tile" asset of the same project with the map's tile size
                                                                        // (`tilemap.tile_invalid`)
```

### Tauri commands (`commands/tilemap.rs`)

```ts
tilemap_create(assetId, tileWidth, tileHeight, columns, rows): Tilemap   // `tilemap.exists` if one exists
tilemap_read(assetId): Tilemap
tilemap_place(assetId, layer, placements: Placement[]): Tilemap
tilemap_add_layer(assetId, name, parallax): Tilemap
tilemap_remove_layer(assetId, name): Tilemap
tilemap_set_layer(assetId, name, parallax?, visible?): Tilemap
tilemap_tiles(assetId): TileAsset[]            // the project's tile assets that fit the map, for the picker
tilemap_preview(assetId, layer?): string        // data:image/png;base64, the render (or one layer's)
```

Each write emits the existing `document://changed` event for the asset with
an empty `roles` list, so an open view reloads.

### MCP tools (`mcp/tools/tilemap.rs`)

- `create_tilemap { assetId?, tileWidth, tileHeight, columns, rows }`
- `read_tilemap { assetId?, layer? }` — a text grid, one character per cell
  (`.` empty, then `a`–`z`, `A`–`Z`, `0`–`9` per distinct tile), with a legend
  naming each tile asset, plus the layers and their parallax.
- `place_tiles { assetId?, layer, placements: [{x, y, tile}] }` — `tile` is a
  tile asset id or null.
- `tilemap_layers { assetId?, add?: {name, parallax}, remove?: name, set?: {name, parallax?, visible?} }`

### TypeScript: `types/tilemap.ts`

```ts
export interface TilemapLayer {
  name: string;
  parallax: number;
  visible: boolean;
  tiles: (string | null)[];
}
export interface Tilemap {
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  layers: TilemapLayer[];
}
export interface Placement {
  x: number;
  y: number;
  tile: string | null;
}
export interface TileAsset {
  id: string;
  name: string;
  width: number;
  height: number;
  preview: string;
} // preview: data URL
```

## Export

Export is an explicit action that writes PNG files into a folder the person
picks (the system dialog, `storage_pick_directory`). An agent exporting
through MCP cannot name a folder: its files go to the exports folder under
the data root, `<data root>/exports/<project name>/`, so a tool call can never
write anywhere else on the disk.

### Rust: `export.rs` (binary crate)

```rust
pub struct ExportOptions { pub scale: u8 /* 1..=16 */, pub pattern: String }
/// `{project}`, `{asset}`, `{kind}`, `{scale}` are replaced; the result is
/// made a safe file name (no separators, no reserved names) and gets `.png`.
pub fn file_name(pattern: &str, project: &str, asset: &str, kind: &str, scale: u8) -> Result<String, ExportError>;
/// The asset's composite at `scale` (nearest neighbour), a background's tilemap render.
pub fn render_asset(store: &Store, asset: AssetId, scale: u8) -> Result<RgbaImage, ExportError>;
/// Several assets of the same size side by side in `columns` columns, in order.
pub fn render_sheet(store: &Store, assets: &[AssetId], columns: u16, scale: u8) -> Result<RgbaImage, ExportError>;
pub fn write_png(directory: &Path, name: &str, image: &RgbaImage, overwrite: bool) -> Result<PathBuf, ExportError>;
```

Error codes: `export.invalid_scale`, `export.invalid_pattern`,
`export.mixed_sizes`, `export.empty`, `export.exists` (the file is there and
overwrite is false), `export.write_failed`, `export.no_directory`.

### Tauri commands (in `export.rs`)

```ts
export_png(assetId, directory, scale, pattern, overwrite): ExportResult
export_sheet(assetIds: string[], directory, columns, scale, name, overwrite): ExportResult
export_directory(): string        // the MCP exports folder for the current data root
interface ExportResult { path: string; width: number; height: number }
```

### MCP tools (`mcp/tools/export.rs`)

- `export_png { assetId?, scale?, name? }` — to the exports folder; `name`
  defaults to the pattern `{asset}@{scale}x`.
- `export_sheet { assetIds, columns?, scale?, name }`

### TypeScript: `types/export.ts`

```ts
export interface ExportResult {
  path: string;
  width: number;
  height: number;
}
export const DEFAULT_PATTERN = '{asset}@{scale}x';
```
