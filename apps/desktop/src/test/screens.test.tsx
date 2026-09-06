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
 * Screen rendering, in both themes.
 *
 * Every screen is rendered in light and in dark, and the markup is checked for
 * inline colour. A component that reaches for a literal instead of a token
 * would pass a visual glance in one theme and fail in the other, so this is
 * checked mechanically rather than by eye.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { App } from '@/App';
import i18n, { resources } from '@/lib/i18n';
import { useEngineStore } from '@/stores/useEngineStore';
import { useGalleryStore } from '@/stores/useGalleryStore';
import { useShellStore, type Screen, type Theme } from '@/stores/useShellStore';
import type { BackendInfo } from '@/types/engine';

const BACKENDS: BackendInfo[] = [
  {
    kind: 'cuda',
    available: false,
    detail: 'backend.cuda.driver_missing',
    device: '',
    capabilities: ['batch', 'controlnet', 'ip_adapter', 'lora_hotswap'],
    selected: false,
  },
  {
    kind: 'mps',
    available: false,
    detail: 'backend.mps.not_macos',
    device: '',
    capabilities: ['batch', 'controlnet', 'lora_hotswap'],
    selected: false,
  },
  {
    kind: 'remote',
    available: true,
    detail: '',
    device: 'https://api.example.com',
    capabilities: ['batch'],
    selected: true,
  },
];

const SCREENS: Screen[] = ['generate', 'gallery', 'settings'];
const THEMES: Theme[] = ['light', 'dark'];

/** Inline colour written by a component, rather than taken from a token. */
const INLINE_COLOUR = /(?:color|background|border|fill|stroke)[^;"]*:\s*(?:#|rgba?\(|hsla?\()/i;

beforeEach(async () => {
  await i18n.changeLanguage('en');
  useEngineStore.setState({
    sidecar: { ready: true, port: 51234, version: '0.1.0', error: '', detail: '' },
    backends: BACKENDS,
    models: [],
    loading: false,
    error: null,
  });
  useGalleryStore.setState({ items: [], filter: 'all' });
});

describe('screens', () => {
  for (const theme of THEMES) {
    for (const name of SCREENS) {
      it(`renders the ${name} screen in ${theme} mode`, () => {
        useShellStore.getState().setTheme(theme);
        useShellStore.getState().setScreen(name);

        const { container } = render(<App />);

        expect(document.documentElement.dataset['theme']).toBe(theme);
        expect(container.innerHTML).not.toMatch(INLINE_COLOUR);
      });
    }
  }

  it('shows the reason an engine cannot be used, instead of hiding it', () => {
    useShellStore.getState().setScreen('settings');
    render(<App />);

    expect(
      screen.getByText('No CUDA driver was found. Install the NVIDIA driver and restart.'),
    ).toBeInTheDocument();
  });

  it('disables the batch control when the engine cannot batch', () => {
    useEngineStore.setState({
      backends: BACKENDS.map((backend) =>
        backend.kind === 'remote' ? { ...backend, capabilities: [] } : backend,
      ),
    });
    useShellStore.getState().setScreen('generate');
    render(<App />);

    expect(screen.getByLabelText('Batch size')).toBeDisabled();
  });

  it('translates the interface when the language changes', async () => {
    useShellStore.getState().setScreen('generate');
    await i18n.changeLanguage('vi');
    render(<App />);

    // The expected text is read from the locale file rather than written here,
    // so that translated strings live only under locales/vi.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      resources.vi.generation.title,
    );
  });
});
