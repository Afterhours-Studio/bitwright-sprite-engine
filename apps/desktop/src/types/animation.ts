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
 * Animations: an ordered row of frame assets, each with its own duration.
 *
 * The shapes match `store/animation.rs` and `commands/animation.rs` field for
 * field, in the camelCase serde gives them. See
 * `docs/architecture/animation.md`.
 */

import type { Step } from '@/types/document';

/** How the frames are walked: front to back, back to front, or bouncing. */
export type Playback = 'forward' | 'reverse' | 'pingpong';

/** Every playback mode, in the order the timeline offers them. */
export const PLAYBACKS: readonly Playback[] = ['forward', 'reverse', 'pingpong'];

/** The shortest a frame may last, in milliseconds. */
export const FRAME_DURATION_MIN = 10;

/** The longest a frame may last, in milliseconds. */
export const FRAME_DURATION_MAX = 10000;

/** How long a new frame lasts: 125 ms, which is 8 frames a second. */
export const FRAME_DURATION_DEFAULT = 125;

/**
 * One frame: an ordinary asset, and where it sits in its animation.
 *
 * The name and step are carried here so a timeline can label every card
 * without opening each frame's document.
 */
export interface Frame {
  assetId: string;
  /** 0-based; position 0 is the root. */
  position: number;
  /** 10 to 10000. */
  durationMs: number;
  name: string;
  step: Step;
  updatedAt: number;
}

/**
 * An animation, named and opened by its root.
 *
 * A lone sprite reads as an animation of one frame, so every asset has one.
 */
export interface Animation {
  rootId: string;
  playback: Playback;
  /** In position order. */
  frames: Frame[];
}

/** Emitted on `document://animation` whenever an animation changes. */
export interface AnimationEvent {
  rootId: string;
  animation: Animation;
}
