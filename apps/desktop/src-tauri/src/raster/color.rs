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

//! Perceptual calculations share one conversion so gates and previews agree.

pub fn srgb_to_oklab(rgba: [u8; 4]) -> [f32; 3] {
    let linear = |v: u8| {
        let v = f32::from(v) / 255.0;
        if v <= 0.04045 {
            v / 12.92
        } else {
            ((v + 0.055) / 1.055).powf(2.4)
        }
    };
    let [r, g, b] = [linear(rgba[0]), linear(rgba[1]), linear(rgba[2])];
    let l = (0.41222146 * r + 0.53633255 * g + 0.051445995 * b).cbrt();
    let m = (0.2119035 * r + 0.6806995 * g + 0.10739696 * b).cbrt();
    let s = (0.08830246 * r + 0.28171885 * g + 0.6299787 * b).cbrt();
    [
        0.21045426 * l + 0.7936178 * m - 0.004072047 * s,
        1.9779985 * l - 2.4285922 * m + 0.4505937 * s,
        0.025904037 * l + 0.78277177 * m - 0.80867577 * s,
    ]
}

pub fn oklab_to_srgb([l, a, b]: [f32; 3]) -> [u8; 3] {
    let x = (l + 0.39633778 * a + 0.21580376 * b).powi(3);
    let y = (l - 0.105561346 * a - 0.06385417 * b).powi(3);
    let z = (l - 0.08948418 * a - 1.2914855 * b).powi(3);
    let encode = |v: f32| {
        let v = if v <= 0.0031308 {
            12.92 * v
        } else {
            1.055 * v.powf(1.0 / 2.4) - 0.055
        };
        (v.clamp(0.0, 1.0) * 255.0).round() as u8
    };
    [
        encode(4.0767417 * x - 3.3077116 * y + 0.23096994 * z),
        encode(-1.268438 * x + 2.6097574 * y - 0.34131938 * z),
        encode(-0.0041960863 * x - 0.7034186 * y + 1.7076147 * z),
    ]
}

pub fn distance(a: [u8; 4], b: [u8; 4]) -> f32 {
    let a = srgb_to_oklab(a);
    let b = srgb_to_oklab(b);
    a.iter()
        .zip(b)
        .map(|(x, y)| (x - y).powi(2))
        .sum::<f32>()
        .sqrt()
}

pub fn hue(lab: [f32; 3]) -> f32 {
    lab[2].atan2(lab[1]).to_degrees().rem_euclid(360.0)
}
pub fn angle_delta(a: f32, b: f32) -> f32 {
    (a - b + 180.0).rem_euclid(360.0) - 180.0
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn srgb_round_trips_and_red_matches_reference() {
        for rgb in [
            [0, 0, 0, 255],
            [255, 255, 255, 255],
            [255, 0, 0, 255],
            [23, 105, 212, 255],
        ] {
            assert_eq!(oklab_to_srgb(srgb_to_oklab(rgb)), rgb[..3]);
        }
        assert!((srgb_to_oklab([255, 0, 0, 255])[0] - 0.627955).abs() < 0.00001);
        assert!(distance([0, 0, 0, 255], [255, 255, 255, 255]) > 0.99);
    }
}
