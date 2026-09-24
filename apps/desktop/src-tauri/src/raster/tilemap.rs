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

//! Backgrounds are drawn as tilemaps: a grid of tile ids in one or more
//! parallax layers, rather than as one large canvas, so a game can scroll
//! the far hills slower than the near ground.

use crate::raster::{RasterError, Result, RgbaImage};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TilemapLayer {
    pub name: String,
    pub parallax: f32,
    pub visible: bool,
    pub tiles: Vec<Option<Uuid>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tilemap {
    pub tile_width: u16,
    pub tile_height: u16,
    pub columns: u16,
    pub rows: u16,
    pub layers: Vec<TilemapLayer>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub x: u16,
    pub y: u16,
    pub tile: Option<Uuid>,
}

fn invalid_size(detail: impl Into<String>) -> RasterError {
    RasterError::new("tilemap.invalid_size", detail)
}

/// The widest or tallest a rendered map may be, in pixels.
pub const MAX_SIDE: u32 = 4096;

impl Tilemap {
    pub fn new(tile_width: u16, tile_height: u16, columns: u16, rows: u16) -> Result<Self> {
        let map = Self {
            tile_width,
            tile_height,
            columns,
            rows,
            layers: vec![TilemapLayer {
                name: "ground".into(),
                parallax: 1.0,
                visible: true,
                tiles: vec![None; columns as usize * rows as usize],
            }],
        };
        map.validate()?;
        Ok(map)
    }

    pub fn validate(&self) -> Result<()> {
        if !(8..=64).contains(&self.tile_width) || !(8..=64).contains(&self.tile_height) {
            return Err(invalid_size("tile_width and tile_height must be 8..=64"));
        }
        if !(1..=256).contains(&self.columns) || !(1..=256).contains(&self.rows) {
            return Err(invalid_size("columns and rows must be 1..=256"));
        }
        // Each bound alone allows a 16384-pixel square; the rendered image is
        // held whole, so its sides are capped too (4096 px is 64 MB of RGBA).
        if u32::from(self.columns) * u32::from(self.tile_width) > MAX_SIDE
            || u32::from(self.rows) * u32::from(self.tile_height) > MAX_SIDE
        {
            return Err(invalid_size(
                "the rendered map may be at most 4096 pixels on a side",
            ));
        }
        if !(1..=8).contains(&self.layers.len()) {
            return Err(invalid_size("a tilemap has 1..=8 layers"));
        }
        let expected = self.columns as usize * self.rows as usize;
        let mut names = BTreeSet::new();
        for layer in &self.layers {
            if layer.name.is_empty() || layer.name.chars().count() > 40 {
                return Err(RasterError::new(
                    "tilemap.invalid_layer",
                    format!("layer name '{}' must be 1..=40 chars", layer.name),
                ));
            }
            if !names.insert(layer.name.clone()) {
                return Err(RasterError::new(
                    "tilemap.invalid_layer",
                    format!("layer name '{}' is not unique", layer.name),
                ));
            }
            if !(0.0..=4.0).contains(&layer.parallax) {
                return Err(RasterError::new(
                    "tilemap.invalid_layer",
                    format!("layer '{}' parallax must be 0.0..=4.0", layer.name),
                ));
            }
            if layer.tiles.len() != expected {
                return Err(RasterError::new(
                    "tilemap.invalid_layer",
                    format!(
                        "layer '{}' has {} tiles, expected {}",
                        layer.name,
                        layer.tiles.len(),
                        expected
                    ),
                ));
            }
        }
        Ok(())
    }

    fn layer_mut(&mut self, name: &str) -> Result<&mut TilemapLayer> {
        self.layers
            .iter_mut()
            .find(|l| l.name == name)
            .ok_or_else(|| RasterError::new("tilemap.layer_not_found", name))
    }

    fn layer(&self, name: &str) -> Result<&TilemapLayer> {
        self.layers
            .iter()
            .find(|l| l.name == name)
            .ok_or_else(|| RasterError::new("tilemap.layer_not_found", name))
    }

    pub fn place(&mut self, layer: &str, placements: &[Placement]) -> Result<usize> {
        let columns = self.columns;
        let rows = self.rows;
        for placement in placements {
            if placement.x >= columns || placement.y >= rows {
                return Err(RasterError::new(
                    "tilemap.out_of_bounds",
                    format!("({}, {})", placement.x, placement.y),
                ));
            }
        }
        let target = self.layer_mut(layer)?;
        let mut changed = 0;
        for placement in placements {
            let index = placement.y as usize * columns as usize + placement.x as usize;
            if target.tiles[index] != placement.tile {
                target.tiles[index] = placement.tile;
                changed += 1;
            }
        }
        Ok(changed)
    }

    pub fn add_layer(&mut self, name: &str, parallax: f32) -> Result<()> {
        if self.layers.iter().any(|l| l.name == name) {
            return Err(RasterError::new("tilemap.layer_exists", name));
        }
        let expected = self.columns as usize * self.rows as usize;
        // Changed on a copy and kept only once it validates, so a refused
        // layer never lingers in the map the caller still holds.
        let mut candidate = self.clone();
        candidate.layers.push(TilemapLayer {
            name: name.to_string(),
            parallax,
            visible: true,
            tiles: vec![None; expected],
        });
        candidate.validate()?;
        *self = candidate;
        Ok(())
    }

    pub fn remove_layer(&mut self, name: &str) -> Result<()> {
        let index = self
            .layers
            .iter()
            .position(|l| l.name == name)
            .ok_or_else(|| RasterError::new("tilemap.layer_not_found", name))?;
        if self.layers.len() <= 1 {
            return Err(RasterError::new("tilemap.last_layer", name));
        }
        self.layers.remove(index);
        Ok(())
    }

    pub fn set_layer(
        &mut self,
        name: &str,
        parallax: Option<f32>,
        visible: Option<bool>,
    ) -> Result<()> {
        let mut candidate = self.clone();
        let layer = candidate.layer_mut(name)?;
        if let Some(parallax) = parallax {
            layer.parallax = parallax;
        }
        if let Some(visible) = visible {
            layer.visible = visible;
        }
        candidate.validate()?;
        *self = candidate;
        Ok(())
    }

    pub fn tile_ids(&self) -> BTreeSet<Uuid> {
        self.layers
            .iter()
            .flat_map(|l| l.tiles.iter().filter_map(|t| *t))
            .collect()
    }

    pub fn render(&self, tiles: &HashMap<Uuid, RgbaImage>) -> Result<RgbaImage> {
        let width = self.columns as usize * self.tile_width as usize;
        let height = self.rows as usize * self.tile_height as usize;
        let mut canvas = vec![0u8; width * height * 4];
        for layer in &self.layers {
            if !layer.visible {
                continue;
            }
            self.composite_layer(layer, tiles, &mut canvas, width)?;
        }
        Ok(RgbaImage {
            width: width as u16,
            height: height as u16,
            data: canvas,
        })
    }

    pub fn render_layer(&self, layer: &str, tiles: &HashMap<Uuid, RgbaImage>) -> Result<RgbaImage> {
        let layer = self.layer(layer)?;
        let width = self.columns as usize * self.tile_width as usize;
        let height = self.rows as usize * self.tile_height as usize;
        let mut canvas = vec![0u8; width * height * 4];
        self.composite_layer(layer, tiles, &mut canvas, width)?;
        Ok(RgbaImage {
            width: width as u16,
            height: height as u16,
            data: canvas,
        })
    }

    fn composite_layer(
        &self,
        layer: &TilemapLayer,
        tiles: &HashMap<Uuid, RgbaImage>,
        canvas: &mut [u8],
        canvas_width: usize,
    ) -> Result<()> {
        let tw = self.tile_width as usize;
        let th = self.tile_height as usize;
        for row in 0..self.rows as usize {
            for col in 0..self.columns as usize {
                let index = row * self.columns as usize + col;
                let Some(id) = layer.tiles[index] else {
                    continue;
                };
                let tile = tiles
                    .get(&id)
                    .ok_or_else(|| RasterError::new("tilemap.tile_missing", id.to_string()))?;
                if tile.width as usize != tw || tile.height as usize != th {
                    return Err(RasterError::new(
                        "tilemap.tile_size",
                        format!(
                            "tile {} is {}x{}, expected {}x{}",
                            id, tile.width, tile.height, tw, th
                        ),
                    ));
                }
                let base_x = col * tw;
                let base_y = row * th;
                for y in 0..th {
                    for x in 0..tw {
                        let src = (y * tw + x) * 4;
                        let sr = tile.data[src] as f32;
                        let sg = tile.data[src + 1] as f32;
                        let sb = tile.data[src + 2] as f32;
                        let sa = tile.data[src + 3] as f32 / 255.0;
                        if sa <= 0.0 {
                            continue;
                        }
                        let dst = ((base_y + y) * canvas_width + (base_x + x)) * 4;
                        let dr = canvas[dst] as f32;
                        let dg = canvas[dst + 1] as f32;
                        let db = canvas[dst + 2] as f32;
                        let da = canvas[dst + 3] as f32 / 255.0;
                        let out_a = sa + da * (1.0 - sa);
                        if out_a <= 0.0 {
                            canvas[dst] = 0;
                            canvas[dst + 1] = 0;
                            canvas[dst + 2] = 0;
                            canvas[dst + 3] = 0;
                            continue;
                        }
                        let out_r = (sr * sa + dr * da * (1.0 - sa)) / out_a;
                        let out_g = (sg * sa + dg * da * (1.0 - sa)) / out_a;
                        let out_b = (sb * sa + db * da * (1.0 - sa)) / out_a;
                        canvas[dst] = out_r.round().clamp(0.0, 255.0) as u8;
                        canvas[dst + 1] = out_g.round().clamp(0.0, 255.0) as u8;
                        canvas[dst + 2] = out_b.round().clamp(0.0, 255.0) as u8;
                        canvas[dst + 3] = (out_a * 255.0).round().clamp(0.0, 255.0) as u8;
                    }
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(width: u16, height: u16, rgba: [u8; 4]) -> RgbaImage {
        let mut data = Vec::with_capacity(width as usize * height as usize * 4);
        for _ in 0..(width as usize * height as usize) {
            data.extend_from_slice(&rgba);
        }
        RgbaImage {
            width,
            height,
            data,
        }
    }

    #[test]
    fn new_has_one_ground_layer() {
        let map = Tilemap::new(16, 16, 4, 3).unwrap();
        assert_eq!(map.layers.len(), 1);
        assert_eq!(map.layers[0].name, "ground");
        assert_eq!(map.layers[0].parallax, 1.0);
        assert_eq!(map.layers[0].tiles.len(), 12);
    }

    #[test]
    fn bounds_are_refused_with_the_right_code() {
        assert_eq!(
            Tilemap::new(4, 16, 4, 3).unwrap_err().code,
            "tilemap.invalid_size"
        );
        assert_eq!(
            Tilemap::new(16, 16, 0, 3).unwrap_err().code,
            "tilemap.invalid_size"
        );
        let mut map = Tilemap::new(16, 16, 4, 3).unwrap();
        assert_eq!(
            map.add_layer("x", 5.0).unwrap_err().code,
            "tilemap.invalid_layer"
        );
        assert_eq!(
            map.add_layer("", 1.0).unwrap_err().code,
            "tilemap.invalid_layer"
        );
    }

    #[test]
    fn place_counts_changes_and_refuses_out_of_bounds_atomically() {
        let mut map = Tilemap::new(16, 16, 4, 3).unwrap();
        let tile = Uuid::now_v7();
        let changed = map
            .place(
                "ground",
                &[
                    Placement {
                        x: 0,
                        y: 0,
                        tile: Some(tile),
                    },
                    Placement {
                        x: 0,
                        y: 0,
                        tile: Some(tile),
                    },
                    Placement {
                        x: 1,
                        y: 0,
                        tile: None,
                    },
                ],
            )
            .unwrap();
        assert_eq!(changed, 1);

        let before = map.clone();
        let err = map
            .place(
                "ground",
                &[
                    Placement {
                        x: 0,
                        y: 0,
                        tile: None,
                    },
                    Placement {
                        x: 99,
                        y: 0,
                        tile: None,
                    },
                ],
            )
            .unwrap_err();
        assert_eq!(err.code, "tilemap.out_of_bounds");
        assert_eq!(map, before);
    }

    #[test]
    fn add_remove_set_layer() {
        let mut map = Tilemap::new(16, 16, 4, 3).unwrap();
        map.add_layer("sky", 0.5).unwrap();
        assert_eq!(map.layers.len(), 2);
        assert_eq!(map.layers[1].name, "sky");
        assert_eq!(
            map.add_layer("sky", 0.5).unwrap_err().code,
            "tilemap.layer_exists"
        );

        map.set_layer("sky", Some(0.25), Some(false)).unwrap();
        assert_eq!(map.layers[1].parallax, 0.25);
        assert!(!map.layers[1].visible);
        assert_eq!(
            map.set_layer("missing", None, None).unwrap_err().code,
            "tilemap.layer_not_found"
        );

        map.remove_layer("sky").unwrap();
        assert_eq!(map.layers.len(), 1);
        assert_eq!(
            map.remove_layer("ground").unwrap_err().code,
            "tilemap.last_layer"
        );
    }

    #[test]
    fn a_map_too_large_to_render_is_refused() {
        assert_eq!(
            Tilemap::new(64, 64, 256, 1).unwrap_err().code,
            "tilemap.invalid_size"
        );
        assert!(Tilemap::new(16, 16, 256, 256).is_ok());
    }

    #[test]
    fn a_refused_layer_change_leaves_the_map_as_it_was() {
        let mut map = Tilemap::new(16, 16, 4, 3).unwrap();
        let before = map.clone();
        assert_eq!(
            map.add_layer("far", 9.0).unwrap_err().code,
            "tilemap.invalid_layer"
        );
        assert_eq!(
            map.set_layer("ground", Some(9.0), None).unwrap_err().code,
            "tilemap.invalid_layer"
        );
        assert_eq!(map, before);
        assert_eq!(
            map.remove_layer("missing").unwrap_err().code,
            "tilemap.layer_not_found"
        );
    }

    #[test]
    fn render_composites_two_layers_with_transparency() {
        let mut map = Tilemap::new(8, 8, 2, 1).unwrap();
        let back_tile = Uuid::now_v7();
        let front_tile = Uuid::now_v7();
        map.place(
            "ground",
            &[Placement {
                x: 0,
                y: 0,
                tile: Some(back_tile),
            }],
        )
        .unwrap();
        map.add_layer("fg", 1.0).unwrap();
        map.place(
            "fg",
            &[Placement {
                x: 0,
                y: 0,
                tile: Some(front_tile),
            }],
        )
        .unwrap();

        let mut tiles = HashMap::new();
        tiles.insert(back_tile, solid(8, 8, [255, 0, 0, 255]));
        // half-transparent tile: some blending happens over the red tile.
        tiles.insert(front_tile, solid(8, 8, [0, 255, 0, 128]));

        let image = map.render(&tiles).unwrap();
        assert_eq!(image.width, 16);
        assert_eq!(image.height, 8);
        let pixel = &image.data[0..4];
        // green over red, alpha 0.5 -> roughly (127,128,0,255)
        assert!(pixel[1] > pixel[0]);
        assert_eq!(pixel[3], 255);
        // The second column tile has nothing placed, so it stays transparent.
        let empty_pixel = &image.data[8 * 4..8 * 4 + 4];
        assert_eq!(empty_pixel, &[0, 0, 0, 0]);
    }

    #[test]
    fn render_skips_a_hidden_layer() {
        let mut map = Tilemap::new(8, 8, 1, 1).unwrap();
        let tile = Uuid::now_v7();
        map.add_layer("fg", 1.0).unwrap();
        map.place(
            "fg",
            &[Placement {
                x: 0,
                y: 0,
                tile: Some(tile),
            }],
        )
        .unwrap();
        map.set_layer("fg", None, Some(false)).unwrap();

        let mut tiles = HashMap::new();
        tiles.insert(tile, solid(8, 8, [255, 0, 0, 255]));
        let image = map.render(&tiles).unwrap();
        assert_eq!(&image.data[0..4], &[0, 0, 0, 0]);
    }

    #[test]
    fn render_reports_missing_or_wrong_sized_tile() {
        let mut map = Tilemap::new(8, 8, 1, 1).unwrap();
        let tile = Uuid::now_v7();
        map.place(
            "ground",
            &[Placement {
                x: 0,
                y: 0,
                tile: Some(tile),
            }],
        )
        .unwrap();
        let empty: HashMap<Uuid, RgbaImage> = HashMap::new();
        assert_eq!(map.render(&empty).unwrap_err().code, "tilemap.tile_missing");

        let mut wrong = HashMap::new();
        wrong.insert(tile, solid(9, 9, [1, 2, 3, 4]));
        assert_eq!(map.render(&wrong).unwrap_err().code, "tilemap.tile_size");
    }
}
