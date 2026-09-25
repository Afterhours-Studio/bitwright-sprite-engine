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
 * The composites of other frames of the open animation, for the onion skin
 * and for playback.
 *
 * RUST COMPOSITES THESE TOO, for the reason `useComposite` gives: a second
 * answer to "what does this frame look like" could disagree with the export.
 * Each frame is its own asset, so each is one `document_composite` call.
 *
 * CACHED BY FRAME AND REVISION. A frame's picture changes only when the frame
 * is written, and every write moves its `updatedAt`, which the animation
 * carries for every frame. So `assetId:updatedAt` names one picture for good,
 * and a playback cycling through the same eight frames asks Rust for each of
 * them once rather than on every tick. The cache is shared by every mount and
 * bounded, so walking through a long animation cannot keep every frame it
 * ever showed in memory.
 *
 * The open frame is not asked for here: the stage already holds its live
 * composite, which follows every stroke, where the revision the animation
 * holds for it is only as fresh as the last time the animation was read.
 */

import { useEffect, useRef, useState } from 'react';

import { documentComposite } from '@/lib/document';
import type { Frame } from '@/types/animation';
import type { RgbaImage } from '@/types/document';

/** How many frame pictures are kept. Well past any onion skin or loop. */
const CACHE_LIMIT = 64;

/** Pictures by `assetId:updatedAt`, oldest first. */
const cache = new Map<string, RgbaImage>();

/** Keys whose composite has been asked for and not yet answered. */
const inflight = new Set<string>();

/** The part of a frame that names one revision of its picture. */
export type FrameRevision = Pick<Frame, 'assetId' | 'updatedAt'>;

/**
 * The cache key for one revision of a frame.
 *
 * @param frame - The frame.
 * @returns `assetId:updatedAt`.
 */
function keyOf(frame: FrameRevision): string {
  return `${frame.assetId}:${String(frame.updatedAt)}`;
}

/**
 * Keeps a picture, dropping the oldest once the cache is full.
 *
 * @param key - The frame revision.
 * @param image - Its composite.
 */
function remember(key: string, image: RgbaImage): void {
  cache.delete(key);
  cache.set(key, image);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      return;
    }
    cache.delete(oldest);
  }
}

/**
 * Keeps the composites of the given frames.
 *
 * @param frames - The frames wanted, in any order.
 * @returns Each frame's picture by asset id, for those that have arrived. A
 *   frame whose composite failed is simply absent: a missing ghost is a lesser
 *   fault than an error over a stage that is otherwise fine.
 */
export function useFrameComposites(
  frames: readonly FrameRevision[],
): ReadonlyMap<string, RgbaImage> {
  const key = frames.map(keyOf).join('|');
  // Only its setter is used: a picture landing in the cache is a reason to
  // render again, and the render reads the cache.
  const [, setArrivals] = useState(0);

  // The frames of the latest render, read by the effect so that it depends on
  // their revisions rather than on an array rebuilt on every render.
  const latest = useRef(frames);
  latest.current = frames;

  // Held across effects rather than per effect: an answer asked for by an
  // earlier set of frames may be wanted by the current one too, where it is
  // skipped as in flight, so it has to be able to redraw when it lands.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    for (const frame of latest.current) {
      const revision = keyOf(frame);
      if (cache.has(revision) || inflight.has(revision)) {
        continue;
      }
      inflight.add(revision);
      void documentComposite(frame.assetId).then((result) => {
        inflight.delete(revision);
        if (result.ok) {
          remember(revision, result.value);
        }
        if (mounted.current) {
          setArrivals((count) => count + 1);
        }
      });
    }
  }, [key]);

  // Rebuilt on every render, which is a lookup per wanted frame; the pictures
  // in it are the cached objects themselves, so a canvas drawing one is not
  // redrawn unless its frame's revision changed.
  const images = new Map<string, RgbaImage>();
  for (const frame of frames) {
    const image = cache.get(keyOf(frame));
    if (image !== undefined) {
      images.set(frame.assetId, image);
    }
  }
  return images;
}
