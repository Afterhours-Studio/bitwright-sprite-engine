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
import { beforeEach, describe, expect, it } from 'vitest';

import { App } from '@/App';
import i18n, { resources } from '@/lib/i18n';
import { useGalleryStore } from '@/stores/useGalleryStore';
import { useShellStore, type Screen, type Theme } from '@/stores/useShellStore';
import { useSpriteStore } from '@/stores/useSpriteStore';

const SCREENS: Screen[] = ['editor', 'gallery', 'settings'];
const THEMES: Theme[] = ['light', 'dark'];

/** Inline colour written by a component, rather than taken from a token. */
const INLINE_COLOUR = /(?:color|background|border|fill|stroke)[^;"]*:\s*(?:#|rgba?\(|hsla?\()/i;

beforeEach(async () => {
  await i18n.changeLanguage('en');
  useShellStore.setState({
    sidecar: { ready: true, port: 51234, version: '0.1.0', error: '', detail: '' },
  });
  useGalleryStore.setState({ items: [], filter: 'all' });
  useSpriteStore.getState().close();
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

    expect(main.getByText('Open a sprite from the Gallery to edit it')).toBeInTheDocument();
  });

  it('opens the screen belonging to the tab that was clicked', () => {
    useShellStore.getState().setScreen('editor');
    render(<App />);

    const gallery = screen.getByRole('tab', { name: 'Gallery' });
    expect(gallery).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(gallery);

    const main = within(screen.getByRole('main'));

    // Both the tab and the content area are checked. A tab that reports the
    // change while the content area still shows the previous screen is the
    // failure worth catching, and only the second assertion would see it.
    expect(gallery).toHaveAttribute('aria-selected', 'true');
    expect(main.getByRole('heading', { level: 1, name: 'Gallery' })).toBeInTheDocument();
    expect(main.getByText('Nothing here yet')).toBeInTheDocument();
  });

  it('translates the interface when the language changes', async () => {
    useShellStore.getState().setScreen('editor');
    await i18n.changeLanguage('vi');
    render(<App />);

    const main = within(screen.getByRole('main'));

    // The editor has no heading: the selected tab is what names it, so the tab
    // is what this reads. The tool column is checked as well, so that
    // translated chrome around an untranslated screen would still fail. The
    // expected text is read from the locale files rather than written here, so
    // that translated strings live only under locales/vi. Scoped to the screen
    // switcher, because the canvas carries a second tab strip of its own and
    // an unscoped query would find both.
    const nav = within(screen.getByRole('tablist', { name: resources.vi.common.app.name }));
    expect(nav.getByRole('tab', { selected: true })).toHaveTextContent(
      resources.vi.common.nav.editor,
    );
    expect(main.getByText(resources.vi.editor.tools.empty)).toBeInTheDocument();
  });
});
