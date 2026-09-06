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
 * Notifications: the toasts on screen, the queue behind them, and the history
 * the notification bell reads.
 *
 * WHY A NOTIFICATION HOLDS A KEY AND NOT A SENTENCE
 *
 * Every message is stored as an i18next key plus its interpolation values, and
 * translated where it is drawn. Storing the finished sentence would freeze the
 * language a notification was raised in, so switching to Vietnamese would leave
 * a panel of English history behind it. It also keeps `i18n` out of this file,
 * which is what lets a store or a hook raise a notification without being a
 * component.
 *
 * WHY THE TIMERS LIVE HERE
 *
 * Auto-dismissal, the pause while the pointer rests on a toast, and the delay
 * that lets the exit transition finish are three timers belonging to one
 * notification. Held in a component they would be spread across three effects
 * whose cleanups have to agree; held here they are one map with one owner, and
 * `dispose` empties it. That is the whole guarantee: no timer outlives the
 * layer that showed the toast it belongs to.
 *
 * WHY DISMISSAL IS TWO STEPS
 *
 * `dismiss` marks a toast `leaving` and only removes it once the exit
 * transition has had time to run. Removing it immediately would unmount the
 * element mid-transition, so a dismissed toast would vanish rather than
 * animate, and the toasts above it would jump into its place.
 */

import { create } from 'zustand';

/** How serious a notification is. Decides its colour and its timeout. */
export type ToastSeverity = 'info' | 'success' | 'warning' | 'error';

/** The bell's position on screen, in viewport coordinates. */
export interface ToastAnchor {
  /** Horizontal centre of the bell. */
  x: number;
  /** Vertical centre of the bell. */
  y: number;
}

/** A notification, on screen or in the history. */
export interface ToastNotification {
  /** Stable identifier, and the React key. */
  id: string;
  /** How serious it is. */
  severity: ToastSeverity;
  /** i18next key for the heading, namespace included, or null for none. */
  titleKey: string | null;
  /** i18next key for the body, namespace included. */
  messageKey: string;
  /** Interpolation values for both keys, or null when there are none. */
  values: Record<string, string | number> | null;
  /** When it was raised, in epoch milliseconds. */
  createdAt: number;
  /** True once the exit transition has started. Never true in the history. */
  leaving: boolean;
}

/** What a caller passes to raise a notification. */
export interface ToastInput {
  /** How serious it is. */
  severity: ToastSeverity;
  /** i18next key for the body, namespace included, e.g. `errors:sidecar.exited`. */
  messageKey: string;
  /** i18next key for the heading, namespace included. */
  titleKey?: string;
  /** Interpolation values for both keys. */
  values?: Record<string, string | number>;
  /** Overrides the severity's own timeout. `Infinity` never auto-dismisses. */
  timeoutMs?: number;
}

/**
 * How long each severity stays on screen, in milliseconds.
 *
 * The numbers come from what the reader has to do with the message, not from a
 * house style:
 *
 *   success  4000  Confirms something the user just asked for and is already
 *                  expecting. It carries no decision, so it is the shortest.
 *   info     5000  One line the user did not ask for. Five seconds covers
 *                  reading a short sentence twice at an unhurried pace.
 *   warning  8000  Something the user did not ask for AND has to decide about.
 *                  Long enough to read it and then look at what it refers to.
 *   error    never Errors do not auto-dismiss at all. An error is the one kind
 *                  of message that may need to be copied, acted on, or read
 *                  after the user has looked away, and there is no timeout
 *                  short enough to be tidy and long enough to be safe. It is
 *                  dismissed by hand, or it is left to be found in the bell.
 *
 * The reference implementation this was modelled on used a single four second
 * timeout for everything, which is what made its errors unreadable.
 */
export const SEVERITY_TIMEOUT_MS: Record<ToastSeverity, number> = {
  success: 4000,
  info: 5000,
  warning: 8000,
  error: Number.POSITIVE_INFINITY,
};

/**
 * How many toasts are on screen at once.
 *
 * Three. A fourth would reach the middle of the window, and a stack tall enough
 * to need scanning has stopped being a notification and become a list. Anything
 * beyond three waits in `queued` and is shown as a slot frees up, so a burst is
 * delayed rather than dropped.
 */
export const MAX_VISIBLE = 3;

/**
 * How many dismissed notifications the bell keeps.
 *
 * Fifty. The history is session-scoped and never written to disk, so the limit
 * is not about storage but about what the panel is for: catching up on what was
 * missed. Fifty entries is far more than anyone scrolls back through, and it
 * bounds a run that fails in a loop rather than letting it grow without end.
 */
export const HISTORY_LIMIT = 50;

/**
 * How long the exit animation runs, in milliseconds.
 *
 * This has to agree with `Toast.tsx`, where the exit is in two halves: the card
 * fades back into the bell over `duration-200`, and only then does its slot in
 * the stack close, over a second `duration-200` held back by `delay-200`. The
 * sum is what this is. Set it shorter and the toast is unmounted mid-animation;
 * set it longer and an empty slot is left standing after the toast has gone.
 */
export const EXIT_MS = 400;

interface ToastState {
  /** The toasts on screen, oldest first. The last one is nearest the dock. */
  visible: ToastNotification[];
  /** Notifications waiting for a slot, oldest first. */
  queued: ToastNotification[];
  /** Dismissed notifications, newest first, capped at {@link HISTORY_LIMIT}. */
  history: ToastNotification[];
  /** How many have been raised since the history was last opened. */
  unread: number;
  /** Where the notification bell is, or null when it is not mounted. */
  bellAnchor: ToastAnchor | null;

  /** Raises a notification. Returns its id. */
  notify: (input: ToastInput) => string;
  /** Dismisses one notification, by hand or on its timeout. */
  dismiss: (id: string) => void;
  /** Dismisses everything on screen and empties the queue. */
  dismissAll: () => void;
  /** Holds a toast's timeout while the pointer or focus is on it. */
  pause: (id: string) => void;
  /** Resumes a held timeout with the time that was left on it. */
  resume: (id: string) => void;
  /** Clears the unread count. Called when the bell's panel opens. */
  markRead: () => void;
  /** Empties the history. */
  clearHistory: () => void;
  /** Records where the bell is, or that it has gone. */
  setBellAnchor: (anchor: ToastAnchor | null) => void;
  /** Clears every timer and empties the screen. Called when the layer unmounts. */
  dispose: () => void;
}

/** One running timer, with enough state to be paused and resumed. */
interface Timer {
  /** The handle to clear. */
  handle: ReturnType<typeof setTimeout>;
  /** When it was last started, so pausing can work out what is left. */
  startedAt: number;
  /** How long it had left when it was last started. */
  remaining: number;
}

let counter = 0;

/**
 * Returns an id no live notification is using.
 *
 * A counter rather than a timestamp: two notifications raised in the same
 * millisecond, which a failing loop does constantly, would collide and React
 * would reuse one element for both.
 *
 * @returns A fresh identifier.
 */
function nextId(): string {
  counter += 1;
  return `toast-${String(counter)}`;
}

/**
 * Merges notifications into the history, within the cap.
 *
 * Ordered by when each one was raised rather than by when it was dismissed,
 * which are not the same order and cannot be. An error never dismisses itself,
 * so it is still on screen while the info toasts raised after it come and go,
 * and it reaches the history last. Sorting is what stops it from being filed as
 * though it were the most recent thing that happened.
 *
 * @param history - The history as it stands, newest first.
 * @param archived - Notifications leaving the screen.
 * @returns The new history, newest first.
 */
function archive(history: ToastNotification[], archived: ToastNotification[]): ToastNotification[] {
  const entries = archived.map((item) => ({ ...item, leaving: false }));
  return [...entries, ...history]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, HISTORY_LIMIT);
}

export const useToastStore = create<ToastState>((set, get) => {
  /**
   * Every timer this store owns, keyed by the notification it belongs to.
   *
   * The exit timer is keyed separately, because a toast being dismissed has an
   * exit timer running while its dismissal timer is already gone, and one map
   * entry per notification could not hold both.
   */
  const timers = new Map<string, Timer>();

  /** The key an exit timer is stored under. */
  const exitKey = (id: string): string => `exit:${id}`;

  /**
   * Clears one timer. Safe when none is running.
   *
   * @param key - Which timer.
   */
  const clearTimer = (key: string): void => {
    const timer = timers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer.handle);
      timers.delete(key);
    }
  };

  /**
   * Starts a timer, replacing whatever was under that key.
   *
   * A non-finite delay starts nothing at all, which is how an error toast ends
   * up with no dismissal timer rather than one that never fires.
   *
   * @param key - Which timer.
   * @param delay - How long to wait, in milliseconds.
   * @param run - What to do when it fires.
   */
  const startTimer = (key: string, delay: number, run: () => void): void => {
    clearTimer(key);
    if (!Number.isFinite(delay)) {
      return;
    }
    const handle = setTimeout(
      () => {
        // Dropped before the callback runs, so that a callback which dismisses
        // cannot find a stale entry and clear a timer it does not own.
        timers.delete(key);
        run();
      },
      Math.max(0, delay),
    );
    timers.set(key, { handle, startedAt: Date.now(), remaining: delay });
  };

  /**
   * Arms a toast's dismissal timer.
   *
   * @param toast - The toast that has just become visible.
   */
  const arm = (toast: ToastNotification, timeoutMs: number): void => {
    startTimer(toast.id, timeoutMs, () => {
      get().dismiss(toast.id);
    });
  };

  /**
   * How much time each notification still has to run.
   *
   * Written when the notification is raised, rewritten by `pause` with what was
   * left, and read by `resume` and by the promotion of a queued toast. It is
   * the remaining time and not the original timeout, which is what stops a
   * pointer resting on a toast and leaving repeatedly from renewing it.
   */
  const timeouts = new Map<string, number>();

  /**
   * Takes one notification off the screen and moves it into the history,
   * promoting whatever was waiting behind it.
   *
   * @param id - Which notification.
   */
  const remove = (id: string): void => {
    clearTimer(id);
    clearTimer(exitKey(id));
    timeouts.delete(id);

    const { visible, queued, history } = get();
    const departing = visible.filter((item) => item.id === id);
    if (departing.length === 0) {
      return;
    }

    const remaining = visible.filter((item) => item.id !== id);
    const promoted = queued.slice(0, Math.max(0, MAX_VISIBLE - remaining.length));

    set({
      visible: [...remaining, ...promoted],
      queued: queued.slice(promoted.length),
      history: archive(history, departing),
    });

    // Armed only once the notification is actually on screen, so a queued
    // toast does not spend its timeout waiting for a slot.
    for (const toast of promoted) {
      arm(toast, timeouts.get(toast.id) ?? SEVERITY_TIMEOUT_MS[toast.severity]);
    }
  };

  return {
    visible: [],
    queued: [],
    history: [],
    unread: 0,
    bellAnchor: null,

    notify: (input) => {
      const toast: ToastNotification = {
        id: nextId(),
        severity: input.severity,
        titleKey: input.titleKey ?? null,
        messageKey: input.messageKey,
        values: input.values ?? null,
        createdAt: Date.now(),
        leaving: false,
      };
      const timeoutMs = input.timeoutMs ?? SEVERITY_TIMEOUT_MS[input.severity];
      timeouts.set(toast.id, timeoutMs);

      const { visible, queued, unread } = get();
      if (visible.length < MAX_VISIBLE) {
        set({ visible: [...visible, toast], unread: unread + 1 });
        arm(toast, timeoutMs);
      } else {
        // Queued, never dropped. A burst that discards its own tail loses
        // exactly the notification that explains the ones before it.
        set({ queued: [...queued, toast], unread: unread + 1 });
      }

      return toast.id;
    },

    dismiss: (id) => {
      const { visible, queued, history } = get();

      const onScreen = visible.find((item) => item.id === id);
      if (onScreen === undefined) {
        // Still waiting for a slot: it has no element and nothing to animate,
        // so it goes straight to the history.
        const waiting = queued.filter((item) => item.id === id);
        if (waiting.length === 0) {
          return;
        }
        timeouts.delete(id);
        set({
          queued: queued.filter((item) => item.id !== id),
          history: archive(history, waiting),
        });
        return;
      }

      if (onScreen.leaving) {
        return;
      }

      // The dismissal timer goes now; the exit timer replaces it. Both are
      // cleared again by `remove`, so neither can outlive the toast.
      clearTimer(id);
      set({
        visible: visible.map((item) => (item.id === id ? { ...item, leaving: true } : item)),
      });
      startTimer(exitKey(id), EXIT_MS, () => {
        remove(id);
      });
    },

    dismissAll: () => {
      const { visible, queued } = get();
      set({ queued: [], history: archive(get().history, queued) });
      for (const item of queued) {
        timeouts.delete(item.id);
      }
      for (const toast of visible) {
        get().dismiss(toast.id);
      }
    },

    pause: (id) => {
      const timer = timers.get(id);
      if (timer === undefined) {
        return;
      }
      clearTimeout(timer.handle);
      timers.delete(id);
      // What is left, not what it started with. Pausing twice, or hovering
      // repeatedly, must not hand the toast its full timeout back.
      timeouts.set(id, Math.max(0, timer.remaining - (Date.now() - timer.startedAt)));
    },

    resume: (id) => {
      const toast = get().visible.find((item) => item.id === id);
      if (toast === undefined || toast.leaving || timers.has(id)) {
        return;
      }
      arm(toast, timeouts.get(id) ?? SEVERITY_TIMEOUT_MS[toast.severity]);
    },

    markRead: () => {
      set({ unread: 0 });
    },

    clearHistory: () => {
      set({ history: [] });
    },

    setBellAnchor: (bellAnchor) => {
      set({ bellAnchor });
    },

    dispose: () => {
      for (const key of [...timers.keys()]) {
        clearTimer(key);
      }
      timeouts.clear();

      // The screen is emptied as well as the timers. Leaving toasts behind
      // would strand them: nothing is drawing them, and their timers are gone,
      // so a layer that mounted again would show notifications that could never
      // dismiss themselves. React's strict mode does exactly that in
      // development, mounting, unmounting, and mounting again.
      const { visible, queued, history } = get();
      set({ visible: [], queued: [], history: archive(history, [...visible, ...queued]) });
    },
  };
});
