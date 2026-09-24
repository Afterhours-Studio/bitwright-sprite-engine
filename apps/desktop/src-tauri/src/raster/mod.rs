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

//! Pixels stay indexed until the display asks for a composite, so editing cannot
//! introduce colours that do not belong to the document's palette.

pub mod color;
pub mod document_ops;
pub mod gates;
pub mod grid;
pub mod ops;
pub mod palette;
pub mod png;
pub mod shading;

pub use document_ops::Op;
pub use palette::{Canvas, Material, Palette, PaletteSlot, Ramp, RampSteps, StyleRules};
use serde::{Deserialize, Deserializer, Serialize};
pub use shading::Direction;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IndexedBuffer {
    pub width: u16,
    pub height: u16,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("{code}: {detail}")]
pub struct RasterError {
    pub code: String,
    pub detail: String,
}

impl RasterError {
    pub fn new(code: &str, detail: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            detail: detail.into(),
        }
    }
}

pub type Result<T> = std::result::Result<T, RasterError>;

impl IndexedBuffer {
    pub fn new(width: u16, height: u16) -> Result<Self> {
        // A bounded allocation keeps malformed IPC from exhausting the shell.
        if width == 0 || height == 0 || usize::from(width) * usize::from(height) > 16_777_216 {
            return Err(RasterError::new(
                "document.invalid_dimensions",
                "canvas must contain 1..=16777216 pixels",
            ));
        }
        Ok(Self {
            width,
            height,
            data: vec![0; usize::from(width) * usize::from(height)],
        })
    }

    pub fn validate(&self) -> Result<()> {
        if self.width == 0
            || self.height == 0
            || self.data.len() != usize::from(self.width) * usize::from(self.height)
            || self.data.len() > 16_777_216
            || self.data.iter().any(|v| *v > 62)
        {
            return Err(RasterError::new(
                "document.invalid_buffer",
                "invalid dimensions, byte count, or palette index",
            ));
        }
        Ok(())
    }

    pub fn offset(&self, x: i32, y: i32) -> Option<usize> {
        (x >= 0 && y >= 0 && x < i32::from(self.width) && y < i32::from(self.height))
            .then(|| y as usize * usize::from(self.width) + x as usize)
    }

    pub fn get(&self, x: i32, y: i32) -> u8 {
        self.offset(x, y)
            .and_then(|i| self.data.get(i))
            .copied()
            .unwrap_or(0)
    }
}

/// Every layer role, with the ordinal it composites at.
///
/// The order is the drawing order from the document model, and it is not the
/// obvious one. `outline` sits at 50, after `light`, because an outline's colour
/// is derived from the fill beside it and so cannot be chosen until those fills
/// exist. `rim` and `accent` sit at the top because they are the highest
/// contrast pixels on the sprite and are placed last, against a budget.
///
/// Two steps own no layer and so appear nowhere here: `cleanup` anti-aliases
/// and despeckles the layers that already exist, and `variation` forks the
/// asset with a new palette rather than painting anything.
pub const LAYER_ROLES: [(&str, i32); 9] = [
    ("silhouette", 10),
    ("flats", 20),
    ("shadow-core", 30),
    ("shadow-deep", 31),
    ("light", 40),
    ("outline", 50),
    ("detail", 60),
    ("rim", 70),
    ("accent", 71),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct LayerRole(pub &'static str);

impl LayerRole {
    pub fn parse(value: &str) -> Result<Self> {
        LAYER_ROLES
            .iter()
            .find(|(role, _)| *role == value)
            .map(|(role, _)| Self(role))
            .ok_or_else(|| RasterError::new("document.invalid_role", value))
    }
}

impl<'de> Deserialize<'de> for LayerRole {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        Self::parse(&String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Layer {
    pub id: Uuid,
    pub role: LayerRole,
    pub ordinal: i32,
    pub visible: bool,
    pub locked: bool,
    pub opacity: f32,
    pub buffer: IndexedBuffer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RgbaImage {
    pub width: u16,
    pub height: u16,
    pub data: Vec<u8>,
}

pub fn composite(
    width: u16,
    height: u16,
    layers: &[Layer],
    palette: &Palette,
) -> Result<RgbaImage> {
    let canvas = IndexedBuffer::new(width, height)?;
    let mut pixels = vec![([0.0; 3], 0.0_f32); canvas.data.len()];
    let mut sorted: Vec<_> = layers.iter().collect();
    sorted.sort_by_key(|layer| layer.ordinal);
    for layer in sorted {
        layer.buffer.validate()?;
        if layer.buffer.width != width
            || layer.buffer.height != height
            || !layer.opacity.is_finite()
            || !(0.0..=1.0).contains(&layer.opacity)
        {
            return Err(RasterError::new(
                "document.invalid_layer",
                "layer dimensions or opacity are invalid",
            ));
        }
        if !layer.visible {
            continue;
        }
        for (index, &slot) in layer.buffer.data.iter().enumerate() {
            if slot == 0 {
                continue;
            }
            let rgba = palette.slot(slot)?.rgba;
            let alpha = f32::from(rgba[3]) / 255.0 * layer.opacity;
            let source = color::srgb_to_oklab(rgba);
            let (dest, old_alpha) = &mut pixels[index];
            let combined = alpha + *old_alpha * (1.0 - alpha);
            if combined > 0.0 {
                for channel in 0..3 {
                    dest[channel] = (source[channel] * alpha
                        + dest[channel] * *old_alpha * (1.0 - alpha))
                        / combined;
                }
            }
            *old_alpha = combined;
        }
    }
    let mut data = Vec::with_capacity(pixels.len() * 4);
    for (lab, alpha) in pixels {
        let rgb = color::oklab_to_srgb(lab);
        data.extend_from_slice(&[rgb[0], rgb[1], rgb[2], (alpha * 255.0).round() as u8]);
    }
    Ok(RgbaImage {
        width,
        height,
        data,
    })
}
