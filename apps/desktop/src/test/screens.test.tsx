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
 *
 * Navigation is the segmented tab control in the title bar, so the screens are
 * reached through `role="tab"` rather than through a sidebar, and the window
 * chrome is queried apart from the screen: `<main>` holds the current screen,
 * and everything else in the window belongs to the title bar.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { App } from '@/App';
import i18n, { resources } from '@/lib/i18n';
import { useShellStore, type Screen, type Theme } from '@/stores/useShellStore';
import { useDocumentStore } from '@/stores/useDocumentStore';
import type { Asset } from '@/types/document';

const SCREENS: Screen[] = ['editor', 'settings'];
const THEMES: Theme[] = ['light', 'dark'];

/** Inline colour written by a component, rather than taken from a token. */
const INLINE_COLOUR = /(?:color|background|border|fill|stroke)[^;"]*:\s*(?:#|rgba?\(|hsla?\()/i;

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
    ...overrides,
  };
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  useShellStore.setState({
    sidecar: { ready: true, port: 51234, version: '0.1.0', error: '', detail: '' },
  });
  useDocumentStore.getState().close();
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

  it('says what to do with an editor that has no sprite open', () => {
    useShellStore.getState().setScreen('editor');
    render(<App />);

    const main = within(screen.getByRole('main'));

    expect(main.getByText('Select a sprite in the project tree to edit it')).toBeInTheDocument();
  });

  it('opens the screen belonging to the tab that was clicked', () => {
    useShellStore.getState().setScreen('editor');
    render(<App />);

    const settings = screen.getByRole('tab', { name: 'Settings' });
    expect(settings).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(settings);

    const main = within(screen.getByRole('main'));

    // Both the tab and the content area are checked. A tab that reports the
    // change while the content area still shows the previous screen is the
    // failure worth catching, and only the second assertion would see it.
    expect(settings).toHaveAttribute('aria-selected', 'true');
    expect(main.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(main.getByText('Storage Location')).toBeInTheDocument();
  });

  it('translates the interface when the language changes', async () => {
    useShellStore.getState().setScreen('editor');
    await i18n.changeLanguage('vi');
    render(<App />);

    const main = within(screen.getByRole('main'));

    // The editor has no heading: the selected tab is what names it, so the tab
    // is what this reads. The stage is checked as well, so that translated
    // chrome around an untranslated screen would still fail. The expected text
    // is read from the locale files rather than written here, so that
    // translated strings live only under locales/vi. Scoped to the screen
    // switcher, because the window carries other tab strips of its own and an
    // unscoped query would find both.
    const nav = within(screen.getByRole('tablist', { name: resources.vi.common.app.name }));
    expect(nav.getByRole('tab', { selected: true })).toHaveTextContent(
      resources.vi.common.nav.editor,
    );
    expect(main.getByText(resources.vi.editor.canvas.empty)).toBeInTheDocument();
  });

  it('shows the tilemap editor instead of the canvas for a background asset', () => {
    useShellStore.getState().setScreen('editor');
    useDocumentStore.setState({ assetId: 'asset-1', asset: asset({ kind: 'background' }) });

    const { unmount } = render(<App />);

    const main = within(screen.getByRole('main'));

    // The tilemap editor's own heading stands in for the whole component; the
    // canvas is checked absent by its zoom-in button, which DocumentCanvas
    // renders whether or not an asset is open, so its absence proves
    // DocumentCanvas itself is not on screen rather than merely idle.
    expect(main.getByRole('heading', { level: 3, name: 'Tilemap' })).toBeInTheDocument();
    expect(
      main.queryByRole('button', { name: resources.en.editor.canvas.zoomIn }),
    ).not.toBeInTheDocument();
    unmount();

    // The other side of the same check: a non-background asset gets the
    // canvas, not the tilemap editor.
    useDocumentStore.setState({ assetId: 'asset-1', asset: asset({ kind: 'prop' }) });
    render(<App />);
    const mainAgain = within(screen.getByRole('main'));

    expect(
      mainAgain.getByRole('button', { name: resources.en.editor.canvas.zoomIn }),
    ).toBeInTheDocument();
    expect(mainAgain.queryByRole('heading', { level: 3, name: 'Tilemap' })).not.toBeInTheDocument();
  });

  it('opens the export dialog from the Export control', () => {
    useShellStore.getState().setScreen('editor');
    render(<App />);

    // Disabled with nothing open: there is nothing yet to export.
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();

    act(() => {
      useDocumentStore.setState({ assetId: 'asset-1', asset: asset() });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(screen.getByRole('heading', { level: 2, name: 'Export' })).toBeInTheDocument();
  });

  it('closes the export dialog when the open asset changes', () => {
    useShellStore.getState().setScreen('editor');
    useDocumentStore.setState({ assetId: 'asset-1', asset: asset() });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Export' })).toBeInTheDocument();

    // Switching the open asset must close the dialog rather than leave it
    // open and quietly retargeted at the new one.
    act(() => {
      useDocumentStore.setState({ assetId: 'asset-2', asset: asset({ id: 'asset-2' }) });
    });

    expect(screen.queryByRole('heading', { level: 2, name: 'Export' })).not.toBeInTheDocument();
  });

  it('shows the reference panel in the tool panel', () => {
    useShellStore.getState().setScreen('editor');
    useDocumentStore.setState({ assetId: 'asset-1', asset: asset() });

    render(<App />);

    const main = within(screen.getByRole('main'));

    expect(main.getByRole('heading', { level: 3, name: 'Reference' })).toBeInTheDocument();
  });
});
