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
 * Shell state: theme toggling, platform and vibrancy facts, sidecar status and
 * the reported application version.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { PlatformInfo, SidecarStatus, VibrancyState } from '@/lib/tauri';
import { useShellStore } from '@/stores/useShellStore';

beforeEach(() => {
  useShellStore.setState({
    screen: 'editor',
    theme: 'dark',
    platform: null,
    vibrancy: { applied: false, effect: '', reason: '' },
    sidecar: { ready: false, port: 0, version: '', error: '', detail: '' },
    appVersion: '',
  });
});

describe('toggleTheme', () => {
  it('switches a dark theme to light', () => {
    useShellStore.setState({ theme: 'dark' });
    useShellStore.getState().toggleTheme();
    expect(useShellStore.getState().theme).toBe('light');
  });

  it('switches a light theme to dark', () => {
    useShellStore.setState({ theme: 'light' });
    useShellStore.getState().toggleTheme();
    expect(useShellStore.getState().theme).toBe('dark');
  });
});

describe('setPlatform', () => {
  it('records the platform facts reported by the shell', () => {
    const platform: PlatformInfo = { os: 'windows', systemWindowControls: false };
    useShellStore.getState().setPlatform(platform);
    expect(useShellStore.getState().platform).toEqual(platform);
  });
});

describe('setVibrancy', () => {
  it('records the vibrancy state reported by the shell', () => {
    const vibrancy: VibrancyState = { applied: true, effect: 'mica', reason: '' };
    useShellStore.getState().setVibrancy(vibrancy);
    expect(useShellStore.getState().vibrancy).toEqual(vibrancy);
  });
});

describe('setSidecar', () => {
  it('records what the shell last said about the sidecar', () => {
    const sidecar: SidecarStatus = {
      ready: true,
      port: 5175,
      version: '0.2.0',
      error: '',
      detail: '',
    };
    useShellStore.getState().setSidecar(sidecar);
    expect(useShellStore.getState().sidecar).toEqual(sidecar);
  });
});

describe('setAppVersion', () => {
  it('records the application version reported by the shell', () => {
    useShellStore.getState().setAppVersion('0.2.0');
    expect(useShellStore.getState().appVersion).toBe('0.2.0');
  });
});
