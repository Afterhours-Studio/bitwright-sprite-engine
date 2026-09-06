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

/** The available themes. Dark is the default. */
export type Theme = 'dark' | 'light';

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
}

/**
 * Reads the stored theme.
 *
 * @returns The theme to start in. Dark unless the user chose otherwise.
 */
export function storedTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
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
  theme?: Theme;
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

  setScreen: (screen) => {
    set({ screen });
  },

  setTheme: (theme) => {
    set({ theme });
    applyRootAttributes({ theme });
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // A theme that cannot be stored still applies for this session.
    }
  },

  toggleTheme: () => {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
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
}));
