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

/**
 * The shapes the sidecar HTTP API exchanges.
 *
 * These mirror the Pydantic models in `bitwright_engine/api/schemas`. Changing
 * one without the other breaks the sidecar's routes at run time, so the two are
 * reviewed together.
 */

/**
 * One data root, as reported by `GET /v1/storage`.
 *
 * Everything the application writes lands under this, so the volume it sits on
 * is the one the user has to be able to choose.
 */
export interface StorageInfo {
  /**
   * The directory that holds everything the application writes: the database,
   * the sprites, and the imported reference images.
   */
  root: string;
  /** The per-user default, so the interface can offer to go back to it. */
  defaultRoot: string;
  /** Whether `root` is that default. */
  isDefault: boolean;
  /** Free space on the volume behind `root`, or null when it cannot be read. */
  freeBytes: number | null;
  /** Size of that volume, or null for the same reason. */
  totalBytes: number | null;
  /** Bytes already taken by the files under this root. */
  usedBytes: number;
}

/** The outcome of moving the data root, from `POST /v1/storage`. */
export interface StorageChange {
  /** The root now in use. */
  current: StorageInfo;
  /** The root that was in use, and whatever is still sitting in it. */
  previous: StorageInfo;
  /**
   * Always false. The application never moves data on its own, so what was
   * already written stays where it is and the user has to be told.
   */
  dataMoved: boolean;
}

/**
 * How to break up a band the palette cannot render smoothly.
 *
 * Ordered is what sprite work wants, for a mechanical reason rather than an
 * aesthetic one: error diffusion is content dependent, so two frames of a walk
 * cycle that differ by three pixels dither differently across the whole sprite
 * and the flat areas crawl during playback.
 */
export type DitherMode = 'none' | 'bayer2' | 'bayer4' | 'bayer8' | 'floyd_steinberg';

/** Every dither mode, in the order the interface offers them. */
export const DITHER_MODES: readonly DitherMode[] = [
  'none',
  'bayer2',
  'bayer4',
  'bayer8',
  'floyd_steinberg',
];

/** What to correct about a sprite that already exists. */
export interface ConformOptions {
  /** Cells across to produce, or null to let the engine find the count. */
  width: number | null;
  /** Cells down to produce, on the same terms. */
  height: number | null;
  /** Whether to make the background transparent. */
  removeBackground: boolean;
  /** How close a pixel must be to the corner colour to count as background. */
  backgroundTolerance: number;
  /** Colours to reduce to, or null to leave them alone. */
  paletteSize: number | null;
  /** Which dither to apply while snapping to the palette. */
  dither: DitherMode;
  /** How much of a cell has to be subject for that cell to come out opaque. */
  alphaThreshold: number;
}

/**
 * The grid the engine found in the image.
 *
 * This is the number that says whether the result can be trusted. A cell size
 * nothing like the one that was expected, or a confidence near zero, means the
 * image was not an upscaled sprite and what came back is a resize rather than
 * a correction.
 */
export interface DetectedGrid {
  /** Source pixels per cell across, which is fractional in general. */
  cellWidth: number;
  /** Source pixels per cell down. */
  cellHeight: number;
  /** Where the first column boundary sat, in source pixels. */
  phaseX: number;
  /** Where the first row boundary sat. */
  phaseY: number;
  /** Share of the edge energy that lined up with the grid, 0 to 1. */
  confidence: number;
}

/** A corrected sprite. */
export interface ConformResponse {
  /** The result, base64 encoded PNG. */
  image: string;
  /** Result width in pixels. */
  width: number;
  /** Result height in pixels. */
  height: number;
  /** Every colour the result uses, most used first. */
  palette: string[];
  /** The grid the image turned out to be drawn on. */
  detected: DetectedGrid;
  /** How long the correction took, in milliseconds. */
  durationMs: number;
  /** Stable reason codes for anything the user should know. */
  warnings: string[];
}
