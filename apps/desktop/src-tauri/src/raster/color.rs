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

/// The Oklab hue angle, for comparing two colours the eye calls the same family.
pub fn hue(lab: [f32; 3]) -> f32 {
    lab[2].atan2(lab[1]).to_degrees().rem_euclid(360.0)
}

/// The Oklab chroma, which is how far a colour sits from the neutral axis.
///
/// Ramp validation cares about this because the hue-shift rule asks a shadow
/// step to gain a little chroma and a light step to lose it, and a rotation
/// measured on a colour with no chroma at all is floating point noise.
pub fn chroma(lab: [f32; 3]) -> f32 {
    lab[1].hypot(lab[2])
}

/// The HSL hue angle, in the units the style rules are written in.
///
/// The `hueShift` bounds in `StyleRules` come from the HD-2D style guide, which
/// states them as HSL degrees. Oklab hue degrees are a different scale, so a
/// rule that says "rotate 12 to 20 degrees" has to be checked here rather than
/// against `hue`, or the numbers would be compared against the wrong unit.
pub fn hsl_hue(rgba: [u8; 4]) -> f32 {
    let [r, g, b] = [
        f32::from(rgba[0]) / 255.0,
        f32::from(rgba[1]) / 255.0,
        f32::from(rgba[2]) / 255.0,
    ];
    let high = r.max(g).max(b);
    let low = r.min(g).min(b);
    let span = high - low;
    if span <= f32::EPSILON {
        // A grey has no hue. Reporting zero rather than an arbitrary angle keeps
        // a greyscale ramp from appearing to rotate when it does not.
        return 0.0;
    }
    let degrees = if high == r {
        60.0 * (((g - b) / span) % 6.0)
    } else if high == g {
        60.0 * ((b - r) / span + 2.0)
    } else {
        60.0 * ((r - g) / span + 4.0)
    };
    degrees.rem_euclid(360.0)
}

/// The signed shortest rotation from `b` to `a`, in degrees.
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

    #[test]
    fn hsl_hue_matches_the_style_guide_worked_examples() {
        // The style guide quotes its ramps in HSL, so the conversion has to land
        // on the angles it names or the hue-shift gate checks the wrong thing.
        // This is its worked example, the blue cloth base hsl(220, 55%, 48%).
        assert!((hsl_hue([55, 100, 190, 255]) - 220.0).abs() < 1.0);
        assert!((hsl_hue([255, 0, 0, 255]) - 0.0).abs() < 0.001);
        assert!((hsl_hue([0, 255, 0, 255]) - 120.0).abs() < 0.001);
        assert!((hsl_hue([0, 0, 255, 255]) - 240.0).abs() < 0.001);
        assert_eq!(hsl_hue([128, 128, 128, 255]), 0.0);
    }

    #[test]
    fn chroma_separates_a_grey_from_a_saturated_colour() {
        assert!(chroma(srgb_to_oklab([128, 128, 128, 255])) < 0.001);
        assert!(chroma(srgb_to_oklab([255, 0, 0, 255])) > 0.2);
    }
}
