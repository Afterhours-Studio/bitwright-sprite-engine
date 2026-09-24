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
 * The shapes that come back from the reference commands in
 * `commands/reference.rs`.
 */

/** A grid the conform step believes it found in the reference, and how sure it is. */
export interface DetectedGrid {
  cellWidth: number;
  cellHeight: number;
  confidence: number;
}

/** One imported reference, conformed to the asset's size. */
export interface ReferenceSummary {
  id: string;
  assetId: string;
  name: string;
  createdAt: number;
  width: number;
  height: number;
  palette: string[];
  detected: DetectedGrid | null;
  warnings: string[];
}
