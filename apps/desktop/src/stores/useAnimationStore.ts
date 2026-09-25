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
 * The animation the open document is a frame of, and its playback.
 *
 * IT FOLLOWS THE DOCUMENT, IT DOES NOT OPEN ONE
 *
 * A frame is an ordinary asset, so the open frame is whatever
 * `useDocumentStore` has open. This store reads the animation that asset
 * belongs to whenever that changes, and every action here that means "go to
 * this frame" goes through `useProjectStore.openAsset`, the one path that
 * keeps the tree's selection and the canvas in agreement. There is no second
 * notion of the current frame to drift from the first.
 *
 * THE ANIMATION IS REPLACED, NEVER PATCHED
 *
 * Every command returns the whole animation, and so does `document://animation`,
 * so each answer replaces what is held. An agent adding frames through MCP and
 * a click on the timeline therefore land the same way.
 *
 * PLAYBACK IS A VIEW, NOT AN EDIT
 *
 * Playing moves `playhead` only. The editor stays on the open frame, which is
 * why pausing needs to restore nothing: the playhead simply returns to it. A
 * playback that outlives its frames would point at rows that are gone, so it
 * stops when the document closes or the list of frames changes underneath it.
 */

import { create } from 'zustand';

import {
  animationRead,
  animationSetDuration,
  animationSetPlayback,
  frameAdd,
  frameDelete,
  frameMove,
  frameSetDuration,
  onAnimationChanged,
} from '@/lib/animation';
import i18n from '@/lib/i18n';
import { loadValue, saveValue } from '@/lib/persist';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useToastStore } from '@/stores/useToastStore';
import type { Animation, Frame, Playback } from '@/types/animation';

import type { ShellResult } from '@/lib/tauri';

/** Where the onion skin preference is kept. */
const ONION_SKIN_KEY = 'bitwright.onionSkin';

interface AnimationState {
  /** The open document's animation, or null when no document is open. */
  animation: Animation | null;
  /** True while the timer is advancing the playhead. */
  playing: boolean;
  /** Index into `animation.frames`: the frame shown while playing, else the open one. */
  playhead: number;
  /** Whether the stage draws the neighbouring frames over the open one. */
  onionSkin: boolean;
  /** Stable reason code for the last failure, or null. */
  error: string | null;

  /** Reads the animation `assetId` belongs to. */
  load: (assetId: string) => Promise<void>;
  /** Adds a frame after the open one, a copy of it or blank, and opens it. */
  add: (copy: boolean) => Promise<void>;
  /** Deletes a frame; if it was open, opens the one that takes its place. */
  remove: (assetId: string) => Promise<void>;
  /** Moves a frame to another position. */
  move: (assetId: string, to: number) => Promise<void>;
  /** Sets one frame's duration in milliseconds. */
  setDuration: (assetId: string, ms: number) => Promise<void>;
  /** Sets every frame to last `1000 / fps` milliseconds. */
  setFps: (fps: number) => Promise<void>;
  /** Sets the playback mode. */
  setPlayback: (mode: Playback) => Promise<void>;
  /** Starts playback from the open frame. */
  play: () => void;
  /** Stops playback, leaving the editor on the open frame. */
  pause: () => void;
  /** Shows or hides the onion skin, and remembers the choice. */
  toggleOnionSkin: () => void;
  /** Opens a frame in the editor. */
  select: (assetId: string) => Promise<void>;
  /**
   * Follows the open document and `document://animation`. Safe to call more
   * than once.
   */
  subscribe: () => Promise<void>;
  /** Detaches the listeners, stops playback and forgets the animation. */
  dispose: () => void;
}

/** The live subscriptions, cancelled by `dispose`. */
let listeners: (() => void)[] = [];

/** Whether subscription has been started, so a second call does not double up. */
let subscribing: Promise<void> | null = null;

/** The pending playback step, or null when not playing. */
let timer: ReturnType<typeof setTimeout> | null = null;

/** Which way a ping-pong is currently travelling: 1 forward, -1 back. */
let direction: 1 | -1 = 1;

/**
 * Counts reads, so an answer to a read that has since been overtaken is
 * dropped rather than replacing the newer one.
 */
let reads = 0;

/**
 * Reads the remembered onion skin choice.
 *
 * @returns True only when `true` was stored; anything else is off.
 */
function storedOnionSkin(): boolean {
  return loadValue(ONION_SKIN_KEY) === true;
}

/**
 * The frame that follows `index` in a playback mode.
 *
 * Ping-pong bounces off each end without showing it twice, so four frames
 * play 0 1 2 3 2 1 0 1 ..., the same order the GIF export writes.
 *
 * @param index - The frame shown now.
 * @param count - How many frames there are.
 * @param mode - The playback mode.
 * @returns The next index.
 */
function nextIndex(index: number, count: number, mode: Playback): number {
  if (count <= 1) {
    return 0;
  }
  if (mode === 'forward') {
    return (index + 1) % count;
  }
  if (mode === 'reverse') {
    return (index - 1 + count) % count;
  }
  let next = index + direction;
  if (next < 0 || next >= count) {
    direction = direction === 1 ? -1 : 1;
    next = index + direction;
  }
  return next;
}

/**
 * Whether two animations hold the same frames in the same order.
 *
 * Durations and names are left out on purpose: changing how long a frame
 * lasts while it plays is exactly what a person tuning timing does.
 */
function sameFrames(a: Animation | null, b: Animation | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return (
    a.rootId === b.rootId &&
    a.frames.length === b.frames.length &&
    a.frames.every((frame, index) => frame.assetId === b.frames[index]?.assetId)
  );
}

/**
 * Where a frame is in an animation.
 *
 * @returns Its index, or 0 when it is not there.
 */
function indexOf(animation: Animation | null, assetId: string | null): number {
  if (animation === null || assetId === null) {
    return 0;
  }
  return Math.max(
    0,
    animation.frames.findIndex((frame) => frame.assetId === assetId),
  );
}

export const useAnimationStore = create<AnimationState>((set, get) => {
  /** Cancels the pending playback step, if there is one. */
  const stopTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  /**
   * Records a failure and says so, because the timeline's controls are small
   * and have nowhere of their own to explain a refusal.
   *
   * @param code - The stable reason code the command returned.
   */
  const fail = (code: string): void => {
    set({ error: code });
    useToastStore.getState().notify({
      severity: 'error',
      titleKey: 'errors:title',
      // A code the errors namespace does not know would show as a raw key.
      messageKey: i18n.exists(`errors:${code}`) ? `errors:${code}` : 'errors:unknown',
    });
  };

  /**
   * Adopts an animation the shell sent, stopping playback when its frames are
   * no longer the ones being played.
   *
   * @param next - The animation, or null to forget it.
   */
  const adopt = (next: Animation | null): void => {
    const changed = !sameFrames(get().animation, next);
    if (get().playing && changed) {
      stopTimer();
      set({ playing: false });
    }
    if (get().playing) {
      set({ animation: next, error: null });
      return;
    }
    set({
      animation: next,
      error: null,
      playhead: indexOf(next, useDocumentStore.getState().assetId),
    });
  };

  /**
   * Adopts a command's answer, or reports its failure.
   *
   * @returns The animation, or null when the command was refused.
   */
  const apply = (result: ShellResult<Animation>): Animation | null => {
    if (!result.ok) {
      fail(result.error.code);
      return null;
    }
    adopt(result.value);
    return result.value;
  };

  /**
   * Opens a frame through the project store, after re-reading its lists so a
   * frame just added is there to be found and one just deleted is gone.
   *
   * @param assetId - The frame to open.
   * @param refresh - Whether the lists need re-reading first.
   */
  const openFrame = async (assetId: string, refresh: boolean): Promise<void> => {
    const projects = useProjectStore.getState();
    if (refresh) {
      await projects.loadAll();
    }
    const { allAssets, assets } = useProjectStore.getState();
    const row =
      allAssets.find((asset) => asset.id === assetId) ??
      assets.find((asset) => asset.id === assetId);
    if (row === undefined) {
      // Every frame shares its root's project, which is the one open, so
      // selecting by id alone still lands in the right place.
      await useProjectStore.getState().selectAsset(assetId);
      return;
    }
    await useProjectStore.getState().openAsset(row);
  };

  /**
   * The frame a whole-animation command is addressed through: the open one,
   * or the root when the open document is somehow not a frame of it.
   */
  const target = (): string | null => {
    const animation = get().animation;
    if (animation === null) {
      return null;
    }
    const open = useDocumentStore.getState().assetId;
    return open !== null && animation.frames.some((frame) => frame.assetId === open)
      ? open
      : animation.rootId;
  };

  /** Schedules the step after the frame the playhead is on. */
  const schedule = (): void => {
    const animation = get().animation;
    const frame: Frame | undefined = animation?.frames[get().playhead];
    if (animation === null || frame === undefined) {
      stopTimer();
      set({ playing: false });
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      const current = get().animation;
      if (!get().playing || current === null) {
        return;
      }
      set({ playhead: nextIndex(get().playhead, current.frames.length, current.playback) });
      schedule();
    }, frame.durationMs);
  };

  return {
    animation: null,
    playing: false,
    playhead: 0,
    onionSkin: storedOnionSkin(),
    error: null,

    load: async (assetId) => {
      reads += 1;
      const read = reads;
      const result = await animationRead(assetId);
      if (read !== reads) {
        return;
      }
      apply(result);
    },

    add: async (copy) => {
      const open = useDocumentStore.getState().assetId;
      if (open === null) {
        return;
      }
      const animation = apply(await frameAdd(open, copy));
      if (animation === null) {
        return;
      }
      const at = animation.frames.findIndex((frame) => frame.assetId === open);
      const added = animation.frames[at + 1];
      if (at < 0 || added === undefined) {
        return;
      }
      await openFrame(added.assetId, true);
    },

    remove: async (assetId) => {
      const before = get().animation;
      const index = before?.frames.findIndex((frame) => frame.assetId === assetId) ?? -1;
      const wasOpen = useDocumentStore.getState().assetId === assetId;
      const animation = apply(await frameDelete(assetId));
      if (animation === null) {
        return;
      }
      if (!wasOpen) {
        await useProjectStore.getState().loadAll();
        return;
      }
      // The frame that slid into the deleted one's place, or the new last one
      // when the last was deleted.
      const neighbour = animation.frames[Math.min(Math.max(index, 0), animation.frames.length - 1)];
      if (neighbour === undefined) {
        await useProjectStore.getState().loadAll();
        return;
      }
      await openFrame(neighbour.assetId, true);
    },

    move: async (assetId, to) => {
      apply(await frameMove(assetId, to));
    },

    setDuration: async (assetId, ms) => {
      apply(await frameSetDuration(assetId, ms));
    },

    setFps: async (fps) => {
      const id = target();
      if (id === null || !(fps > 0)) {
        return;
      }
      apply(await animationSetDuration(id, Math.round(1000 / fps)));
    },

    setPlayback: async (mode) => {
      const id = target();
      if (id === null) {
        return;
      }
      apply(await animationSetPlayback(id, mode));
    },

    play: () => {
      const animation = get().animation;
      if (get().playing || animation === null || animation.frames.length === 0) {
        return;
      }
      // A ping-pong sets off forwards; from the last frame it bounces at once.
      direction = 1;
      set({
        playing: true,
        playhead: indexOf(animation, useDocumentStore.getState().assetId),
      });
      schedule();
    },

    pause: () => {
      stopTimer();
      set({
        playing: false,
        playhead: indexOf(get().animation, useDocumentStore.getState().assetId),
      });
    },

    toggleOnionSkin: () => {
      const onionSkin = !get().onionSkin;
      set({ onionSkin });
      saveValue(ONION_SKIN_KEY, onionSkin);
    },

    select: async (assetId) => {
      // A card clicked mid-playback means "show me this one", which a stage
      // still cycling through the others would not.
      if (get().playing) {
        get().pause();
      }
      if (useDocumentStore.getState().assetId === assetId) {
        return;
      }
      await openFrame(assetId, false);
    },

    subscribe: async () => {
      subscribing ??= (async () => {
        const changed = await onAnimationChanged((event) => {
          const held = get().animation;
          const open = useDocumentStore.getState().assetId;
          // Matched on the frames as well as the root: deleting the root
          // promotes another frame, so the event names a root this store has
          // not seen yet for the animation it is showing.
          const ours =
            (held !== null && held.rootId === event.rootId) ||
            (open !== null && event.animation.frames.some((frame) => frame.assetId === open));
          if (ours) {
            adopt(event.animation);
          }
        });
        const document = useDocumentStore.subscribe((state, previous) => {
          if (state.assetId === previous.assetId) {
            return;
          }
          if (state.assetId === null) {
            reads += 1;
            stopTimer();
            set({ animation: null, playing: false, playhead: 0 });
            return;
          }
          void get().load(state.assetId);
        });
        listeners = [changed, document];

        const open = useDocumentStore.getState().assetId;
        if (open !== null) {
          await get().load(open);
        }
      })();

      await subscribing;
    },

    dispose: () => {
      for (const unlisten of listeners) {
        unlisten();
      }
      listeners = [];
      subscribing = null;
      reads += 1;
      stopTimer();
      set({ animation: null, playing: false, playhead: 0, error: null });
    },
  };
});
