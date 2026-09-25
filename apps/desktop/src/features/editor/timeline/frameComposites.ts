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
 * The composites the timeline has already asked for, one per frame.
 *
 * Every card and the bar's live preview draw a frame's composite, and playback
 * shows the same few frames over and over at up to 24 a second. Asking Rust to
 * flatten a frame on every tick would put the whole animation on the wire per
 * second, so each frame's picture is kept under a revision - its update time,
 * plus the op log sequence for the open frame, which moves on every stroke
 * before the row's update time is read again.
 *
 * Only the newest revision of each frame is held. A frame being drawn on makes
 * a new revision per stroke, and keeping every old one would grow without end
 * while showing none of them.
 *
 * Kept apart from the components so tests can empty it between runs.
 */

import { documentComposite } from '@/lib/document';
import type { RgbaImage } from '@/types/document';

/** A frame's newest composite and the revision it was read at. */
interface Entry {
  revision: string;
  /** Null when the shell refused the read. */
  image: Promise<RgbaImage | null>;
}

/** The newest composite of each frame, by asset id. */
const cache = new Map<string, Entry>();

/**
 * Reads a frame's composite, once per revision.
 *
 * @param assetId - The frame to composite.
 * @param revision - Anything whose change means the picture changed.
 * @returns The image, or null when the shell refused.
 */
export function frameComposite(assetId: string, revision: string): Promise<RgbaImage | null> {
  const held = cache.get(assetId);
  if (held !== undefined && held.revision === revision) {
    return held.image;
  }
  const image = documentComposite(assetId).then((result) => (result.ok ? result.value : null));
  cache.set(assetId, { revision, image });
  return image;
}

/** Forgets every cached composite. Tests call it so one run cannot feed the next. */
export function clearFrameComposites(): void {
  cache.clear();
}
