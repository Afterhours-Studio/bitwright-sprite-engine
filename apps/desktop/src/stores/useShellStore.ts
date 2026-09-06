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
 * Shell state: which screen is open, the theme, the platform, and whether the
 * window background effect is active.
 *
 * The theme and the vibrancy flag are written onto the root element as data
 * attributes, because that is what selects the token set in `tokens.css`. The
 * vibrancy flag is never inferred: it comes from Rust, which knows whether the
 * effect actually applied.
 */

import { create } from 'zustand';

import type { GpuReport, PlatformInfo, VibrancyState } from '@/lib/tauri';

/** The screens the application has. */
export type Screen = 'generate' | 'gallery' | 'settings';

/** What the user chose. Dark is the default. */
export type Theme = 'dark' | 'light' | 'system';

/** What is actually painted. `system` resolves to one of these. */
export type ResolvedTheme = 'dark' | 'light';

/** The choices offered, in the order they are listed. */
export const THEMES: Theme[] = ['system', 'dark', 'light'];

const THEME_KEY = 'bitwright.theme';

interface ShellState {
  /** Which screen is open. */
  screen: Screen;
  /** The active theme. */
  theme: Theme;
  /** Host platform facts, or null before the shell has answered. */
  platform: PlatformInfo | null;
  /** Whether a window background effect is active. */
  vibrancy: VibrancyState;
  /** The startup GPU probe, or null before it has finished. */
  gpu: GpuReport | null;
  /** The application's own version, or empty before the shell has answered. */
  appVersion: string;

  /** Opens a screen. */
  setScreen: (screen: Screen) => void;
  /** Applies a theme and remembers it. */
  setTheme: (theme: Theme) => void;
  /** Switches between dark and light. */
  toggleTheme: () => void;
  /** Records the platform facts reported by the shell. */
  setPlatform: (platform: PlatformInfo) => void;
  /** Records whether a background effect was applied. */
  setVibrancy: (vibrancy: VibrancyState) => void;
  /** Records the startup GPU probe. */
  setGpu: (gpu: GpuReport) => void;
  /** Records the application version reported by the shell. */
  setAppVersion: (version: string) => void;
}

/**
 * Reads the stored theme.
 *
 * @returns The theme to start in. Dark unless the user chose otherwise.
 */
export function storedTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'system' ? stored : 'dark';
  } catch {
    return 'dark';
  }
}

/**
 * Resolves a choice to the theme that is actually painted.
 *
 * @param theme - What the user chose.
 * @returns The theme to write onto the root element.
 */
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== 'system') {
    return theme;
  }
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark';
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * Follows the system preference for as long as the choice is `system`.
 *
 * The query has to stay attached rather than being read once at startup:
 * Windows and macOS both switch appearance on a schedule, and an application
 * that read the preference at launch stays wrong until it is restarted.
 *
 * @param onChange - Called with the newly resolved theme.
 * @returns A function that detaches the listener.
 */
export function watchSystemTheme(onChange: (theme: ResolvedTheme) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const query = window.matchMedia('(prefers-color-scheme: light)');
  const listener = (event: MediaQueryListEvent): void => {
    onChange(event.matches ? 'light' : 'dark');
  };
  query.addEventListener('change', listener);
  return () => {
    query.removeEventListener('change', listener);
  };
}

/**
 * Writes the theme, platform, and vibrancy state onto the root element.
 *
 * CSS, not JavaScript, decides what those attributes mean. Keeping the write
 * in one place is what stops a component from setting a colour directly.
 *
 * @param attributes - Attributes to apply.
 */
export function applyRootAttributes(attributes: {
  theme?: ResolvedTheme;
  platform?: PlatformInfo['os'];
  vibrancy?: boolean;
}): void {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  if (attributes.theme !== undefined) {
    root.dataset['theme'] = attributes.theme;
  }
  if (attributes.platform !== undefined) {
    root.dataset['platform'] = attributes.platform;
  }
  if (attributes.vibrancy !== undefined) {
    root.dataset['vibrancy'] = attributes.vibrancy ? 'on' : 'off';
  }
}

export const useShellStore = create<ShellState>((set, get) => ({
  screen: 'generate',
  theme: storedTheme(),
  platform: null,
  // Opaque tokens are the safe default: an active effect with opaque surfaces
  // merely looks flat, while transparent surfaces with no effect leave text on
  // the wallpaper.
  vibrancy: { applied: false, effect: '', reason: '' },
  gpu: null,
  appVersion: '',

  setScreen: (screen) => {
    set({ screen });
  },

  setTheme: (theme) => {
    set({ theme });
    applyRootAttributes({ theme: resolveTheme(theme) });
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // A theme that cannot be stored still applies for this session.
    }
  },

  toggleTheme: () => {
    // Toggling from `system` commits to the opposite of what is on screen,
    // which is what pressing a light/dark switch is asking for. Leaving it on
    // `system` and flipping nothing would read as a broken button.
    get().setTheme(resolveTheme(get().theme) === 'dark' ? 'light' : 'dark');
  },

  setPlatform: (platform) => {
    set({ platform });
    applyRootAttributes({ platform: platform.os });
  },

  setVibrancy: (vibrancy) => {
    set({ vibrancy });
    applyRootAttributes({ vibrancy: vibrancy.applied });
  },

  setGpu: (gpu) => {
    set({ gpu });
  },

  setAppVersion: (version) => {
    set({ appVersion: version });
  },
}));
