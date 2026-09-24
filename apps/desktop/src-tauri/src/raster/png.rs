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

//! The only place a sprite leaves or enters the editor as ordinary pixels.
//!
//! Everything inside the document stays indexed; a PNG is what an agent or an
//! artist brings in from outside, and what the webview draws. Both crossings
//! live here so the size ceiling, the colour-type widening and the palette
//! mapping are decided once rather than at each call site.
//!
//! This module is itself called `png`, so every mention of the crate below is
//! written as an absolute path (`::png::...`) to keep the two apart.

use std::io::Cursor;

use base64::Engine as _;

use crate::raster::palette::Palette;
use crate::raster::{IndexedBuffer, RasterError, RgbaImage};

use super::Result;

/// The longest edge a decoded reference may have.
///
/// A reference image only ever has to cover a sprite, and the buffer that
/// holds it is 8-bit RGBA, so 4096x4096 is already 64 MiB. Reading a
/// decompression bomb off disk would otherwise stall the shell, so the header
/// is inspected before the decoder runs and the allocation ceiling handed to
/// the decoder itself.
const MAX_DIMENSION: u32 = 4096;

/// The most pixels a decoded frame may hold.
///
/// Equal to the square of [`MAX_DIMENSION`], so it is a second, independent
/// statement of the same budget: no single frame may be larger than the
/// largest legal image.
const MAX_PIXELS: usize = 16_777_216;

/// What the decoder may allocate: one worst-case frame plus its row scratch.
const MAX_ALLOC_BYTES: usize = MAX_PIXELS * 4 + (1 << 20);

/// Decodes a PNG of any colour type and bit depth into 8-bit RGBA.
/// Refuses (RasterError "png.invalid") anything that is not a PNG, and anything
/// larger than 4096x4096 ("png.too_large").
pub fn decode(bytes: &[u8]) -> Result<RgbaImage> {
    // The signature is checked before the decoder runs so a JPEG, a text file
    // or a truncated download reports "not a PNG" instead of a decoder message
    // that describes the wrong problem.
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(RasterError::new(
            "png.invalid",
            "bytes do not begin with the PNG signature",
        ));
    }

    // The IHDR is the first chunk of every PNG, so the two 32-bit dimensions
    // can be read straight out of the header. Rejecting here means a 100k x
    // 100k file is refused without the decoder ever being pointed at its
    // (absurd) allocation, and without a 64 MiB buffer being reserved first.
    if let Some((width, height)) = header_dimensions(bytes) {
        check_dimensions(width, height)?;
    }

    let mut decoder = ::png::Decoder::new_with_limits(
        Cursor::new(bytes),
        ::png::Limits {
            bytes: MAX_ALLOC_BYTES,
        },
    );
    decoder.set_transformations(::png::Transformations::EXPAND | ::png::Transformations::STRIP_16);

    let mut reader = match decoder.read_info() {
        Ok(reader) => reader,
        Err(error) => return Err(invalid(error)),
    };

    check_dimensions(reader.info().width, reader.info().height)?;

    // EXPAND plus STRIP_16 always yields 8 bits per sample, and the only
    // colour types left are Grey, GreyAlpha, Rgb and Rgba, so the row length
    // is known without trusting the file's own numbers.
    let (color_type, bit_depth) = reader.output_color_type();
    if bit_depth as u8 != 8 {
        return Err(RasterError::new(
            "png.invalid",
            format!("decoder kept {bit_depth:?} bits per sample"),
        ));
    }
    let channels = channels_of(color_type)?;

    let mut png_data = vec![0u8; reader.output_buffer_size()];
    let output = reader.next_frame(&mut png_data).map_err(invalid)?;
    let (width, height) = (output.width, output.height);
    check_dimensions(width, height)?;

    let pixels = usize::try_from(width)
        .and_then(|w| usize::try_from(height).map(|h| w * h))
        .map_err(|_| RasterError::new("png.too_large", "frame dimensions overflow a usize"))?;
    if pixels > MAX_PIXELS {
        return Err(RasterError::new(
            "png.too_large",
            "decoded frame exceeds the pixel ceiling",
        ));
    }
    let needed = pixels
        .checked_mul(channels)
        .filter(|needed| *needed <= png_data.len())
        .ok_or_else(|| {
            RasterError::new(
                "png.invalid",
                "decoded frame does not fit the buffer it was written into",
            )
        })?;
    let png_data = &png_data[..needed];

    let mut data = Vec::with_capacity(pixels * 4);
    match channels {
        4 => data.extend_from_slice(png_data),
        3 => {
            for rgb in png_data.chunks_exact(3) {
                data.extend_from_slice(&[rgb[0], rgb[1], rgb[2], 255]);
            }
        }
        2 => {
            for ga in png_data.chunks_exact(2) {
                data.extend_from_slice(&[ga[0], ga[0], ga[0], ga[1]]);
            }
        }
        _ => {
            for &g in png_data {
                data.extend_from_slice(&[g, g, g, 255]);
            }
        }
    }

    Ok(RgbaImage {
        width: width as u16,
        height: height as u16,
        data,
    })
}

/// Encodes RGBA as an 8-bit RGBA PNG.
pub fn encode(image: &RgbaImage) -> Result<Vec<u8>> {
    let expected = usize::from(image.width) * usize::from(image.height) * 4;
    if image.width == 0 || image.height == 0 || image.data.len() != expected {
        return Err(RasterError::new(
            "png.invalid",
            "image dimensions disagree with its byte count",
        ));
    }

    let mut cursor = Cursor::new(Vec::with_capacity(expected / 2));
    {
        let mut encoder =
            ::png::Encoder::new(&mut cursor, u32::from(image.width), u32::from(image.height));
        encoder.set_color(::png::ColorType::Rgba);
        encoder.set_depth(::png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(invalid)?;
        writer.write_image_data(&image.data).map_err(invalid)?;
    }
    Ok(cursor.into_inner())
}

/// Base64 of an encoded PNG, which is the only form the webview accepts.
pub fn encode_base64(image: &RgbaImage) -> Result<String> {
    Ok(base64::engine::general_purpose::STANDARD.encode(encode(image)?))
}

/// Maps an image onto a palette: a pixel whose alpha is below `alpha_threshold`
/// becomes slot 0; every other pixel becomes `palette.nearest(rgba)` (0 when the
/// palette is empty).
pub fn index(image: &RgbaImage, palette: &Palette, alpha_threshold: u8) -> Result<IndexedBuffer> {
    let expected = usize::from(image.width) * usize::from(image.height) * 4;
    if image.data.len() != expected {
        return Err(RasterError::new(
            "png.invalid",
            "image dimensions disagree with its byte count",
        ));
    }
    let mut buffer = IndexedBuffer::new(image.width, image.height)?;
    for (pixel, slot) in image.data.chunks_exact(4).zip(&mut buffer.data) {
        let rgba = [pixel[0], pixel[1], pixel[2], pixel[3]];
        if rgba[3] < alpha_threshold {
            *slot = 0;
        } else {
            *slot = palette.nearest(rgba).unwrap_or(0);
        }
    }
    buffer.validate()?;
    Ok(buffer)
}

/// Renders an indexed buffer through its palette as RGBA, slot 0 transparent,
/// so a layer or composite can be encoded; an unknown slot is palette.unknown_slot.
pub fn colour(buffer: &IndexedBuffer, palette: &Palette) -> Result<RgbaImage> {
    buffer.validate()?;
    let mut data = Vec::with_capacity(buffer.data.len() * 4);
    for &slot in &buffer.data {
        // Slot 0 is the empty pixel, and it is not in the palette: it is the
        // absence of a pixel, so it resolves to fully transparent rather than
        // to whatever colour happens to sit at the bottom of a ramp.
        if slot == 0 {
            data.extend_from_slice(&[0, 0, 0, 0]);
            continue;
        }
        data.extend_from_slice(&palette.slot(slot)?.rgba);
    }
    Ok(RgbaImage {
        width: buffer.width,
        height: buffer.height,
        data,
    })
}

/// Both edges must be non-zero and no longer than the ceiling.
fn check_dimensions(width: u32, height: u32) -> Result<()> {
    if width == 0 || height == 0 || width > MAX_DIMENSION || height > MAX_DIMENSION {
        return Err(RasterError::new(
            "png.too_large",
            format!("{width}x{height} exceeds the {MAX_DIMENSION}x{MAX_DIMENSION} ceiling"),
        ));
    }
    Ok(())
}

/// The number of bytes per pixel the decoder will emit for this colour type.
fn channels_of(color_type: ::png::ColorType) -> Result<usize> {
    match color_type {
        ::png::ColorType::Grayscale => Ok(1),
        ::png::ColorType::GrayscaleAlpha => Ok(2),
        ::png::ColorType::Rgb => Ok(3),
        ::png::ColorType::Rgba => Ok(4),
        other => Err(RasterError::new(
            "png.invalid",
            format!("decoder returned unsupported colour type {other:?}"),
        )),
    }
}

/// Width and height straight out of the IHDR, if the file is shaped like one.
///
/// Returns `None` for anything that is not an IHDR-headed PNG; the decoder
/// itself then produces the real diagnosis.
fn header_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    // 8-byte signature, then a 4-byte big-endian chunk length of 13, then the
    // chunk type, then the two dimensions.
    if bytes.get(8..12)? != 13u32.to_be_bytes() {
        return None;
    }
    if bytes.get(12..16)? != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?);
    let height = u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?);
    Some((width, height))
}

fn invalid(error: impl std::fmt::Display) -> RasterError {
    RasterError::new("png.invalid", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{check_dimensions, colour, decode, encode, encode_base64, index, RgbaImage};
    use crate::raster::{IndexedBuffer, Palette, PaletteSlot};

    fn image(width: u16, height: u16, data: Vec<u8>) -> RgbaImage {
        RgbaImage {
            width,
            height,
            data,
        }
    }

    fn palette() -> Palette {
        Palette {
            slots: vec![
                PaletteSlot {
                    index: 1,
                    rgba: [10, 20, 30, 255],
                    name: None,
                    ramp: None,
                    step: None,
                },
                PaletteSlot {
                    index: 2,
                    rgba: [200, 100, 50, 255],
                    name: None,
                    ramp: None,
                    step: None,
                },
            ],
            ramps: vec![],
        }
    }

    /// Encodes a PNG of an arbitrary colour type and bit depth, the way an
    /// outside tool would, so the widening paths of `decode` get exercised.
    fn foreign_png(
        width: u32,
        height: u32,
        color: ::png::ColorType,
        depth: ::png::BitDepth,
        data: &[u8],
    ) -> Vec<u8> {
        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            let mut encoder = ::png::Encoder::new(&mut cursor, width, height);
            encoder.set_color(color);
            encoder.set_depth(depth);
            let mut writer = encoder.write_header().expect("write header");
            writer.write_image_data(data).expect("write data");
        }
        cursor.into_inner()
    }

    /// A well-formed IHDR for `width`x`height` followed by nothing else: the
    /// header check has to reject it before the decoder ever allocates.
    fn header_only(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes
    }

    #[test]
    fn encode_then_decode_round_trips() {
        let original = image(
            3,
            2,
            vec![
                10, 20, 30, 255, 0, 0, 0, 0, 200, 100, 50, 128, //
                1, 2, 3, 4, 250, 240, 230, 255, 9, 9, 9, 255,
            ],
        );
        let bytes = encode(&original).expect("encode");
        let back = decode(&bytes).expect("decode");
        assert_eq!(back.width, 3);
        assert_eq!(back.height, 2);
        assert_eq!(back.data, original.data);
    }

    #[test]
    fn decoding_non_png_bytes_is_invalid() {
        let error = decode(b"\xff\xd8\xff\xe0 not a png at all").unwrap_err();
        assert_eq!(error.code, "png.invalid");
    }

    #[test]
    fn decoding_truncated_png_is_invalid() {
        let original = image(1, 1, vec![5, 6, 7, 255]);
        let mut bytes = encode(&original).expect("encode");
        bytes.truncate(12);
        let error = decode(&bytes).unwrap_err();
        assert_eq!(error.code, "png.invalid");
    }

    #[test]
    fn decoding_a_header_beyond_the_ceiling_is_too_large() {
        let error = decode(&header_only(8192, 1)).unwrap_err();
        assert_eq!(error.code, "png.too_large");
        assert!(error.detail.contains("8192x1"), "{}", error.detail);
    }

    #[test]
    fn decoding_a_header_of_zero_size_is_too_large() {
        let error = decode(&header_only(0, 0)).unwrap_err();
        assert_eq!(error.code, "png.too_large");
    }

    #[test]
    fn the_ceiling_accepts_its_own_square_and_refuses_one_more() {
        check_dimensions(4096, 4096).expect("at the ceiling");
        assert_eq!(check_dimensions(4097, 1).unwrap_err().code, "png.too_large");
        assert_eq!(check_dimensions(1, 0).unwrap_err().code, "png.too_large");
    }

    #[test]
    fn decodes_greyscale_as_opaque_rgba() {
        let bytes = foreign_png(
            2,
            1,
            ::png::ColorType::Grayscale,
            ::png::BitDepth::Eight,
            &[0x12, 0xfe],
        );
        let back = decode(&bytes).expect("decode grey");
        assert_eq!(back.width, 2);
        assert_eq!(back.height, 1);
        assert_eq!(
            back.data,
            vec![0x12, 0x12, 0x12, 255, 0xfe, 0xfe, 0xfe, 255]
        );
    }

    #[test]
    fn decodes_greyscale_alpha_as_rgba() {
        let bytes = foreign_png(
            1,
            2,
            ::png::ColorType::GrayscaleAlpha,
            ::png::BitDepth::Eight,
            &[40, 200, 60, 0],
        );
        let back = decode(&bytes).expect("decode ga");
        assert_eq!(back.data, vec![40, 40, 40, 200, 60, 60, 60, 0]);
    }

    #[test]
    fn decodes_rgb_as_opaque_rgba() {
        let bytes = foreign_png(
            2,
            1,
            ::png::ColorType::Rgb,
            ::png::BitDepth::Eight,
            &[1, 2, 3, 4, 5, 6],
        );
        let back = decode(&bytes).expect("decode rgb");
        assert_eq!(back.data, vec![1, 2, 3, 255, 4, 5, 6, 255]);
    }

    #[test]
    fn decodes_low_bit_depths_up_to_eight_bits() {
        // Two pixels packed into the low two bits of one byte, palette-free.
        let bytes = foreign_png(
            2,
            1,
            ::png::ColorType::Grayscale,
            ::png::BitDepth::Two,
            &[0b00_01_10_11],
        );
        let back = decode(&bytes).expect("decode 2-bit");
        assert_eq!(back.width, 2);
        assert_eq!(back.data.len(), 8);
        assert_eq!(back.data[0], 0);
        assert_eq!(back.data[4], 0x55);
    }

    #[test]
    fn decodes_sixteen_bits_by_keeping_the_high_byte() {
        // One RGBA pixel at 16 bits a channel: R 0x1234, G 0x5678, B 0x9aff, A 0xbcde.
        let bytes = foreign_png(
            1,
            1,
            ::png::ColorType::Rgba,
            ::png::BitDepth::Sixteen,
            &[0x12, 0x34, 0x56, 0x78, 0x9a, 0xff, 0xbc, 0xde],
        );
        let back = decode(&bytes).expect("decode 16-bit");
        assert_eq!(back.data, vec![0x12, 0x56, 0x9a, 0xbc]);
    }

    #[test]
    fn encodes_an_image_whose_data_is_too_short() {
        let error = encode(&image(2, 2, vec![0; 15])).unwrap_err();
        assert_eq!(error.code, "png.invalid");
        let error = encode(&image(0, 1, vec![])).unwrap_err();
        assert_eq!(error.code, "png.invalid");
    }

    #[test]
    fn encode_base64_round_trips_through_the_standard_alphabet() {
        use base64::Engine as _;

        let original = image(2, 1, vec![7, 8, 9, 255, 0, 0, 0, 0]);
        let text = encode_base64(&original).expect("encode_base64");
        assert!(text.starts_with("iVBORw0KGgo"), "{text}");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&text)
            .expect("base64");
        let back = decode(&bytes).expect("decode");
        assert_eq!(back.data, original.data);
    }

    #[test]
    fn index_maps_nearest_slots_and_transparency() {
        let source = image(
            3,
            1,
            vec![
                12, 18, 32, 255, // near slot 1
                195, 105, 45, 255, // near slot 2
                12, 18, 32, 10, // translucent
            ],
        );
        let buffer = index(&source, &palette(), 128).expect("index");
        assert_eq!(buffer.width, 3);
        assert_eq!(buffer.height, 1);
        assert_eq!(buffer.data, vec![1, 2, 0]);
    }

    #[test]
    fn index_of_empty_palette_is_all_slot_zero() {
        let source = image(2, 1, vec![1, 2, 3, 255, 4, 5, 6, 255]);
        let buffer = index(&source, &Palette::default(), 128).expect("index");
        assert_eq!(buffer.data, vec![0, 0]);
    }

    #[test]
    fn index_rejects_a_buffer_that_disagrees_with_its_size() {
        let source = image(2, 1, vec![1, 2, 3, 255]);
        let error = index(&source, &Palette::default(), 128).unwrap_err();
        assert_eq!(error.code, "png.invalid");
    }

    #[test]
    fn colour_then_index_round_trips_the_buffer() {
        let buffer = IndexedBuffer {
            width: 3,
            height: 1,
            data: vec![0, 1, 2],
        };
        let painted = colour(&buffer, &palette()).expect("colour");
        assert_eq!(
            painted.data,
            vec![0, 0, 0, 0, 10, 20, 30, 255, 200, 100, 50, 255]
        );
        let back = index(&painted, &palette(), 128).expect("index");
        assert_eq!(back.data, buffer.data);
    }

    #[test]
    fn colour_rejects_a_slot_the_palette_does_not_have() {
        let buffer = IndexedBuffer {
            width: 1,
            height: 1,
            data: vec![9],
        };
        let error = colour(&buffer, &palette()).unwrap_err();
        assert_eq!(error.code, "palette.unknown_slot");
    }
}
