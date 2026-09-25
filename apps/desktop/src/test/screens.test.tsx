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
 * The application as a whole: which screen `screen` puts in the window, how
 * the editor is composed, and what the settings screen holds.
 *
 * Every screen is also rendered in light and in dark and the markup checked
 * for inline colour. A component that reaches for a literal instead of a token
 * would pass a visual glance in one theme and fail in the other, so this is
 * checked mechanically rather than by eye.
 *
 * No bridge is installed (see `test/setup.ts`), so every command answers
 * `shell.unavailable` and the screens render the way they do in a browser.
 */

import {
  fireEvent,
  render,
  screen,
  within,
  type BoundFunctions,
  type queries,
} from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { App } from '@/App';
import i18n, { resources } from '@/lib/i18n';
import { useCommandPaletteStore } from '@/stores/useCommandPaletteStore';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useShellStore, type Screen, type Theme } from '@/stores/useShellStore';
import type { Asset } from '@/types/document';

const SCREENS: Screen[] = ['home', 'editor', 'settings'];
const THEMES: Theme[] = ['light', 'dark'];

/** Inline colour written by a component, rather than taken from a token. */
const INLINE_COLOUR = /(?:color|background|border|fill|stroke)[^;"]*:\s*(?:#|rgba?\(|hsla?\()/i;

const en = resources.en;

/**
 * A minimal asset row, as `useDocumentStore` would hold one for an open
 * document.
 *
 * @param overrides - Fields to override, most often `kind`.
 * @returns The asset.
 */
function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    projectId: 'project-1',
    styleId: null,
    name: 'Hero',
    kind: 'prop',
    width: 32,
    height: 32,
    step: 'reference',
    createdAt: 0,
    updatedAt: 0,
    rootId: null,
    frames: 1,
    ...overrides,
  };
}

/** Puts a document in the store, the way a successful open would. */
function openDocument(overrides: Partial<Asset> = {}): void {
  const row = asset(overrides);
  useDocumentStore.setState({ assetId: row.id, asset: row });
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  useShellStore.setState({
    screen: 'home',
    newSpriteOpen: false,
    sidecar: { ready: true, port: 51234, version: '0.1.0', error: '', detail: '' },
  });
  useEditorStore.setState({ showLayersPanel: true, bottomPanel: 'steps', tileGuide: 0 });
  useCommandPaletteStore.setState({ open: false });
  useProjectStore.setState({ projects: [], assets: [], allAssets: [] });
  useDocumentStore.getState().close();
});

describe('themes', () => {
  for (const theme of THEMES) {
    for (const name of SCREENS) {
      it(`renders the ${name} screen in ${theme} mode without inline colour`, () => {
        if (name === 'editor') {
          openDocument();
        }
        useShellStore.getState().setTheme(theme);
        useShellStore.getState().setScreen(name);

        const { container } = render(<App />);

        expect(document.documentElement.dataset['theme']).toBe(theme);
        expect(container.innerHTML).not.toMatch(INLINE_COLOUR);
      });
    }
  }
});

describe('routing', () => {
  it('opens on home', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: en.home.sidebar.recent }),
    ).toBeInTheDocument();
  });

  it('shows the editor for an open document', () => {
    openDocument();
    useShellStore.getState().setScreen('editor');
    render(<App />);

    expect(screen.getByRole('main', { name: en.editor.stage.label })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: en.studio.header.nameLabel })).toHaveValue('Hero');
  });

  it('goes home when the editor is asked for with nothing open', () => {
    useShellStore.getState().setScreen('editor');
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: en.home.sidebar.recent }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('main', { name: en.editor.stage.label })).not.toBeInTheDocument();
    // Written back, so everything reading the store agrees with the window.
    expect(useShellStore.getState().screen).toBe('home');
  });

  it('shows settings, and goes home from its sidebar', () => {
    useShellStore.getState().setScreen('settings');
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: en.settings.title })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: en.home.sidebar.recent }));

    expect(useShellStore.getState().screen).toBe('home');
    expect(
      screen.getByRole('heading', { level: 1, name: en.home.sidebar.recent }),
    ).toBeInTheDocument();
  });

  it('goes back home from the editor header', () => {
    openDocument();
    useShellStore.getState().setScreen('editor');
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: en.studio.header.home }));

    expect(useShellStore.getState().screen).toBe('home');
  });

  it('translates the interface when the language changes', async () => {
    await i18n.changeLanguage('vi');
    useShellStore.getState().setScreen('settings');
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: resources.vi.settings.title }),
    ).toBeInTheDocument();
  });
});

describe('editor', () => {
  beforeEach(() => {
    useShellStore.getState().setScreen('editor');
  });

  it('lays out the tools, the colour panel, the layers panel and the steps strip', () => {
    openDocument();
    render(<App />);

    expect(screen.getByRole('group', { name: en.tools.listLabel })).toBeInTheDocument();
    expect(
      screen.getByRole('complementary', { name: en.panels.colour.region }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('complementary', { name: en.panels.layers.region }),
    ).toBeInTheDocument();
    // No step has been read for this document, so the strip says so in place.
    expect(screen.getByText(en.editor.step.noDocument)).toBeInTheDocument();
  });

  it('hides the layers panel and the steps strip when they are toggled off', () => {
    openDocument();
    render(<App />);

    act(() => {
      useEditorStore.getState().setShowLayersPanel(false);
      useEditorStore.getState().setBottomPanel(null);
    });

    expect(
      screen.queryByRole('complementary', { name: en.panels.layers.region }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(en.editor.step.noDocument)).not.toBeInTheDocument();
    // The colour panel is not a toggle: it stays.
    expect(
      screen.getByRole('complementary', { name: en.panels.colour.region }),
    ).toBeInTheDocument();
  });

  it('shows the tilemap editor instead of the canvas for a background asset', () => {
    openDocument({ kind: 'background' });
    const { unmount } = render(<App />);

    const stage = within(screen.getByRole('main', { name: en.editor.stage.label }));
    expect(stage.getByRole('heading', { level: 3, name: en.tilemap.title })).toBeInTheDocument();
    unmount();

    openDocument({ kind: 'prop' });
    render(<App />);

    const again = within(screen.getByRole('main', { name: en.editor.stage.label }));
    expect(
      again.queryByRole('heading', { level: 3, name: en.tilemap.title }),
    ).not.toBeInTheDocument();
  });

  it('follows a rename of the open asset in the header', () => {
    openDocument();
    render(<App />);

    // What `renameAsset` leaves behind once the shell has answered: the
    // project store's rows carry the new name, and nothing else does.
    act(() => {
      useProjectStore.setState({ allAssets: [asset({ name: 'Knight' })] });
    });

    expect(useDocumentStore.getState().asset?.name).toBe('Knight');
    expect(screen.getByRole('textbox', { name: en.studio.header.nameLabel })).toHaveValue('Knight');
  });
});

describe('settings', () => {
  it('holds the storage, agent, appearance, language and about sections', () => {
    useShellStore.getState().setScreen('settings');
    render(<App />);

    const main = within(screen.getByRole('main'));
    expect(main.getByText(en.settings.storage.title)).toBeInTheDocument();
    expect(main.getByText(en.settings.mcp.title)).toBeInTheDocument();
    expect(main.getByRole('region', { name: en.settings.appearance.title })).toBeInTheDocument();
    expect(main.getByRole('region', { name: en.common.language.label })).toBeInTheDocument();
    expect(main.getByRole('region', { name: en.settings.about.title })).toBeInTheDocument();
    expect(main.getByText('0.1.0')).toBeInTheDocument();
  });

  it('applies a theme chosen in the appearance section', () => {
    useShellStore.getState().setTheme('dark');
    useShellStore.getState().setScreen('settings');
    render(<App />);

    const appearance = within(screen.getByRole('region', { name: en.settings.appearance.title }));
    fireEvent.click(appearance.getByRole('button', { name: en.common.theme.light }));

    expect(useShellStore.getState().theme).toBe('light');
    expect(appearance.getByRole('button', { name: en.common.theme.light })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('switches the language from the language section', async () => {
    useShellStore.getState().setScreen('settings');
    render(<App />);

    const language = within(screen.getByRole('region', { name: en.common.language.label }));
    await act(async () => {
      fireEvent.click(language.getByRole('button', { name: en.common.language.vi }));
      await Promise.resolve();
    });

    expect(i18n.language).toBe('vi');
  });
});

describe('command palette', () => {
  /** Opens the palette and returns its dialog. */
  function openPalette(): BoundFunctions<typeof queries> {
    act(() => {
      useCommandPaletteStore.getState().setOpen(true);
    });
    return within(screen.getByRole('dialog', { name: en.common.palette.label }));
  }

  it('offers the editor only with a document open', () => {
    render(<App />);
    const palette = openPalette();

    expect(palette.getByRole('option', { name: en.common.nav.home })).toBeInTheDocument();
    expect(palette.getByRole('option', { name: en.common.nav.settings })).toBeInTheDocument();
    expect(palette.queryByRole('option', { name: en.common.nav.editor })).not.toBeInTheDocument();
  });

  it('toggles the editor view settings, saying which way each goes', () => {
    openDocument();
    useShellStore.getState().setScreen('editor');
    useEditorStore.setState({ showCheckerboard: true, showPixelGrid: false });
    render(<App />);
    const palette = openPalette();

    fireEvent.click(palette.getByRole('option', { name: en.common.palette.hideCheckerboard }));
    expect(useEditorStore.getState().showCheckerboard).toBe(false);

    const again = openPalette();
    fireEvent.click(again.getByRole('option', { name: en.common.palette.showPixelGrid }));
    expect(useEditorStore.getState().showPixelGrid).toBe(true);

    fireEvent.click(openPalette().getByRole('option', { name: en.common.palette.hideLayersPanel }));
    expect(useEditorStore.getState().showLayersPanel).toBe(false);

    fireEvent.click(openPalette().getByRole('option', { name: en.common.palette.hideStepsStrip }));
    expect(useEditorStore.getState().bottomPanel).toBeNull();
  });

  it('turns the tile guide off only while one is showing', () => {
    openDocument();
    useShellStore.getState().setScreen('editor');
    render(<App />);

    expect(
      openPalette().queryByRole('option', { name: en.common.palette.tileGuideOff }),
    ).not.toBeInTheDocument();

    act(() => {
      useCommandPaletteStore.getState().setOpen(false);
      useEditorStore.getState().setTileGuide(16);
    });
    fireEvent.click(openPalette().getByRole('option', { name: en.common.palette.tileGuideOff }));

    expect(useEditorStore.getState().tileGuide).toBe(0);
  });

  it('chooses a tool in the editor', () => {
    openDocument();
    useShellStore.getState().setScreen('editor');
    useEditorStore.setState({ tool: 'pencil' });
    render(<App />);

    fireEvent.click(openPalette().getByRole('option', { name: /Magic wand/ }));

    expect(useEditorStore.getState().tool).toBe('wand');
  });

  it('lists no editor rows away from the editor', () => {
    render(<App />);
    const palette = openPalette();

    expect(
      palette.queryByRole('option', { name: en.common.palette.showPixelGrid }),
    ).not.toBeInTheDocument();
    expect(palette.queryByRole('option', { name: /Magic wand/ })).not.toBeInTheDocument();
  });

  it('opens the new sprite dialog', () => {
    render(<App />);

    fireEvent.click(openPalette().getByRole('option', { name: en.common.palette.newSprite }));

    expect(useShellStore.getState().newSpriteOpen).toBe(true);
  });
});
