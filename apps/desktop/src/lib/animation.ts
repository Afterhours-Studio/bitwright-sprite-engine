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
 * The animation commands, one function per command in
 * `commands/animation.rs`, named after it, so that a command can be found from
 * either side by searching for the same word.
 *
 * Every one returns a {@link ShellResult} rather than throwing, like the rest
 * of the bridge in `lib/tauri.ts`: outside a Tauri window they all report
 * `shell.unavailable`, which is what lets the interface render under Vitest.
 *
 * Argument names are camelCase because Tauri 2 renames command arguments for
 * the webview, so Rust's `asset_id` is `assetId` here. Getting one wrong is
 * not a compile error on either side - it arrives as a missing argument at run
 * time - which is why the names are written once, here, and nowhere else.
 *
 * Every command that takes an animation accepts any of its frames, because
 * the frame on screen is what a caller has to hand, not the root.
 */

import { invoke, on } from '@/lib/tauri';
import type { ShellResult } from '@/lib/tauri';
import type { Animation, AnimationEvent, Playback } from '@/types/animation';
import type { ExportResult } from '@/types/export';
import type { UnlistenFn } from '@tauri-apps/api/event';

/** The events the animation side of the shell emits. */
export const ANIMATION_EVENTS = {
  changed: 'document://animation',
} as const;

/** Reads the animation a frame belongs to; a lone sprite reads as one frame. */
export function animationRead(assetId: string): Promise<ShellResult<Animation>> {
  return invoke<Animation>('animation_read', { assetId });
}

/**
 * Inserts a frame straight after `assetId`.
 *
 * `copy` duplicates that frame's layers, palette and step; otherwise the new
 * frame starts with empty layers and the same palette.
 */
export function frameAdd(assetId: string, copy: boolean): Promise<ShellResult<Animation>> {
  return invoke<Animation>('frame_add', { assetId, copy });
}

/**
 * Deletes a frame. Refused with `animation.last_frame` for the only one;
 * deleting the root promotes the next frame to root.
 */
export function frameDelete(assetId: string): Promise<ShellResult<Animation>> {
  return invoke<Animation>('frame_delete', { assetId });
}

/** Moves a frame to position `to`, clamped to the last position. */
export function frameMove(assetId: string, to: number): Promise<ShellResult<Animation>> {
  return invoke<Animation>('frame_move', { assetId, to });
}

/** Sets one frame's duration. Refused with `animation.invalid_duration` outside 10..=10000. */
export function frameSetDuration(assetId: string, ms: number): Promise<ShellResult<Animation>> {
  return invoke<Animation>('frame_set_duration', { assetId, ms });
}

/** Sets every frame's duration at once, which is what the FPS control means. */
export function animationSetDuration(assetId: string, ms: number): Promise<ShellResult<Animation>> {
  return invoke<Animation>('animation_set_duration', { assetId, ms });
}

/** Sets the playback mode. Refused with `animation.invalid_playback` for anything else. */
export function animationSetPlayback(
  assetId: string,
  mode: Playback,
): Promise<ShellResult<Animation>> {
  return invoke<Animation>('animation_set_playback', { assetId, mode });
}

/**
 * Renders the animation at `scale` as a looping GIF, honouring its playback
 * and durations.
 *
 * `path` is the file to write; without one the shell writes into the exports
 * folder, as it does for an agent. The key is left out entirely when there is
 * no path, which the Rust side reads as `None`.
 */
export function exportGif(
  assetId: string,
  scale: number,
  path?: string,
): Promise<ShellResult<ExportResult>> {
  return invoke<ExportResult>(
    'export_gif',
    path === undefined ? { assetId, scale } : { assetId, scale, path },
  );
}

/**
 * Subscribes to animation changes, from this window or from an agent.
 *
 * The payload carries the whole animation, which is small, so a timeline
 * follows an agent adding frames without a read per event.
 */
export function onAnimationChanged(handler: (event: AnimationEvent) => void): Promise<UnlistenFn> {
  return on<AnimationEvent>(ANIMATION_EVENTS.changed, handler);
}
