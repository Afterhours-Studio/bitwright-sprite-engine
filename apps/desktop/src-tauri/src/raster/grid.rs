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

//! Rulers are presentation metadata; removing them must recover the same bytes.

use super::{IndexedBuffer, RasterError, Result};
const ALPHABET: &[u8] = b".ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

pub fn render(buffer: &IndexedBuffer, rulers: bool) -> Result<String> {
    buffer.validate()?;
    let mut lines = Vec::new();
    if rulers {
        let mut ruler = vec![b' '; usize::from(buffer.width)];
        for column in (0..usize::from(buffer.width)).step_by(5) {
            let label = column.to_string();
            // A label is drawn whole or not at all. A clipped "1" standing for
            // column 15 reads back as column 1, so it must never be drawn.
            if column + label.len() > usize::from(buffer.width) {
                continue;
            }
            for (offset, byte) in label.bytes().enumerate() {
                ruler[column + offset] = byte;
            }
        }
        lines.push(format!(
            "      {}",
            String::from_utf8(ruler).expect("rulers are ASCII")
        ));
    }
    for (y, row) in buffer.data.chunks(usize::from(buffer.width)).enumerate() {
        let body = row
            .iter()
            .map(|slot| {
                ALPHABET.get(usize::from(*slot)).copied().ok_or_else(|| {
                    RasterError::new("grid.unrepresentable_slot", "slot 63 has no grid character")
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let body = String::from_utf8(body).expect("the grid alphabet is ASCII");
        lines.push(if rulers {
            format!("{y:3} | {body}")
        } else {
            body
        });
    }
    Ok(lines.join("\n"))
}

pub fn parse(text: &str) -> Result<IndexedBuffer> {
    let mut rows = Vec::new();
    let mut expected_row = None;
    let mut ruled = None;
    for (line_index, line) in text.lines().enumerate() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line_index == 0
            && line.starts_with("      ")
            && line.chars().all(|c| c == ' ' || c.is_ascii_digit())
        {
            continue;
        }
        let (body, has_ruler) = if let Some((label, body)) = line.split_once(" | ") {
            let row = label
                .trim()
                .parse::<usize>()
                .map_err(|_| RasterError::new("grid.invalid_ruler", label))?;
            if expected_row.is_some_and(|expected| expected != row) {
                return Err(RasterError::new(
                    "grid.invalid_ruler",
                    "row rulers must be consecutive",
                ));
            }
            expected_row = Some(row + 1);
            (body, true)
        } else {
            (line, false)
        };
        if ruled.is_some_and(|value| value != has_ruler) {
            return Err(RasterError::new(
                "grid.invalid_ruler",
                "mixed ruled and unruled rows",
            ));
        }
        ruled = Some(has_ruler);
        let row = body
            .bytes()
            .map(|c| {
                ALPHABET
                    .iter()
                    .position(|b| *b == c)
                    .map(|v| v as u8)
                    .ok_or_else(|| RasterError::new("grid.invalid_character", format!("byte {c}")))
            })
            .collect::<Result<Vec<_>>>()?;
        if row.is_empty()
            || rows
                .first()
                .is_some_and(|first: &Vec<u8>| first.len() != row.len())
        {
            return Err(RasterError::new(
                "grid.unequal_rows",
                "grid rows must have the same nonzero width",
            ));
        }
        rows.push(row);
    }
    let width = rows.first().map_or(0, Vec::len);
    let mut buffer = IndexedBuffer::new(
        u16::try_from(width).map_err(|_| RasterError::new("grid.too_large", "width"))?,
        u16::try_from(rows.len()).map_err(|_| RasterError::new("grid.too_large", "height"))?,
    )?;
    buffer.data = rows.into_iter().flatten().collect();
    Ok(buffer)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_symbols_round_trip_with_and_without_rulers() {
        let buffer = IndexedBuffer {
            width: 63,
            height: 2,
            data: (0..63).chain(0..63).collect(),
        };
        for ruled in [false, true] {
            assert_eq!(parse(&render(&buffer, ruled).unwrap()).unwrap(), buffer);
        }
    }
    /// A label that does not fit is not drawn at all: a clipped "1" standing
    /// for column 15 reads back as column 1.
    #[test]
    fn ruler_labels_are_never_clipped() {
        let ruler = |width: u16| {
            let buffer = IndexedBuffer::new(width, 1).unwrap();
            render(&buffer, true)
                .unwrap()
                .lines()
                .next()
                .unwrap()
                .trim_end()
                .to_string()
        };
        // Columns 0, 5 and 10 fit; column 15 needs two cells and only one is
        // left, so the whole label is dropped rather than drawn as "1".
        assert_eq!(ruler(16), "      0    5    10");
        assert_eq!(ruler(17), "      0    5    10   15");
    }

    #[test]
    fn refuses_unknown_symbols_ragged_rows_and_unrepresentable_slots() {
        for text in ["A?", "AA\nA", "A ", "  0 | AA\n  2 | AA"] {
            assert!(parse(text).is_err(), "{text}");
        }
        assert!(render(
            &IndexedBuffer {
                width: 1,
                height: 1,
                data: vec![63]
            },
            false
        )
        .is_err());
    }
}
