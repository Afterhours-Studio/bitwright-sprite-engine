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
 * Small lists that outlive the window.
 *
 * A record of what happened is worth little if closing the application throws
 * it away: a download that failed overnight, or the notification explaining
 * why, is exactly what someone comes back to look for.
 *
 * Every access is wrapped, because storage is not always there. A private
 * window, cleared site data, or a browser configured to refuse it all make the
 * accessor itself throw rather than merely return nothing, and a history that
 * cannot be saved must not be a history that stops the application.
 */

/** Keys this application stores under, so they can be seen in one place. */
export const STORAGE_KEYS = {
  /** Dismissed notifications, newest first. */
  notifications: 'bitwright.notifications',
  /** Finished transfers, newest first. */
  downloads: 'bitwright.downloads',
  /** What the canvas draws over the sprite. */
  view: 'bitwright.view',
  /** The generation request, minus anything a run produced. */
  request: 'bitwright.request',
} as const;

/**
 * Reads a stored value that is not a list.
 *
 * The caller states the shape, because this cannot know it: a record written
 * by an older version may be missing fields, so every caller merges what it
 * reads over its own defaults rather than trusting it whole.
 *
 * @param key - Where it is kept.
 * @returns The parsed value, or null when there is none or it cannot be read.
 */
export function loadValue(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Writes a value that is not a list.
 *
 * @param key - Where to keep it.
 * @param value - What to write.
 */
export function saveValue(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A preference that cannot be written still holds for this session.
  }
}

/**
 * Reads a stored list.
 *
 * Anything that is not an array of objects is treated as absent rather than as
 * an error: the shape can change between versions, and a reader that throws on
 * an old record would take the window down at startup.
 *
 * @param key - Where the list is kept.
 * @param limit - How many entries to keep, newest first.
 * @returns The entries, or an empty list.
 */
export function loadList<T>(key: string, limit: number): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry) => typeof entry === 'object' && entry !== null)
      .slice(0, limit) as T[];
  } catch {
    return [];
  }
}

/**
 * Writes a list, keeping only the newest entries.
 *
 * @param key - Where to keep it.
 * @param entries - The entries, newest first.
 * @param limit - How many to keep.
 */
export function saveList(key: string, entries: readonly unknown[], limit: number): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(entries.slice(0, limit)));
  } catch {
    // A history that cannot be written is still a history for this session.
  }
}
