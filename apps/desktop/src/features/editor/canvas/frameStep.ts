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
 * Moves the editor one frame along the open animation.
 *
 * Shared by the stage's comma and full stop keys and by the command palette's
 * rows, so both walk the frames the same way: round from the last frame to the
 * first and back, as Aseprite's frame keys do, and through
 * `useAnimationStore.select`, which pauses a playback first and opens the
 * frame by the one path that keeps the tree and the canvas in agreement.
 */

import { useAnimationStore } from '@/stores/useAnimationStore';
import { useDocumentStore } from '@/stores/useDocumentStore';

/**
 * Opens the frame after or before the open one.
 *
 * @param delta - 1 for the next frame, -1 for the previous.
 * @returns True when another frame is being opened; false when the open
 *   document is not in an animation of more than one frame.
 */
export function stepFrame(delta: 1 | -1): boolean {
  const { animation, select } = useAnimationStore.getState();
  const open = useDocumentStore.getState().assetId;
  if (animation === null || open === null || animation.frames.length < 2) {
    return false;
  }
  const index = animation.frames.findIndex((frame) => frame.assetId === open);
  if (index < 0) {
    return false;
  }
  const count = animation.frames.length;
  const next = animation.frames[(index + delta + count) % count];
  if (next === undefined) {
    return false;
  }
  void select(next.assetId);
  return true;
}
