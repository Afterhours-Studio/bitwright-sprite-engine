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
 * Test setup.
 *
 * No Tauri bridge is installed. The shell helpers detect its absence and
 * report `shell.unavailable`, which is exactly the path the interface must
 * survive, so the screens render under test without any stubbing.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import '@/lib/i18n';

/**
 * jsdom ships no ResizeObserver, and `components/ui/SegmentedTabs.tsx` measures
 * its sliding indicator with one. Without this stub the component throws the
 * moment it mounts, so every test that renders the title bar depends on it:
 * it is used, even though nothing imports it by name. Do not remove it.
 *
 * Nothing has a size under jsdom, so the observer would never report anything
 * worth acting on. The interface is left as it is and the missing browser API
 * is supplied here rather than guarded against in the component.
 */
class ResizeObserverStub implements ResizeObserver {
  /** Records nothing: jsdom reports every element as zero sized. */
  observe(): void {
    return;
  }

  /** Records nothing, for the same reason. */
  unobserve(): void {
    return;
  }

  /** Nothing was observed, so there is nothing to release. */
  disconnect(): void {
    return;
  }
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub);

/**
 * jsdom lays nothing out and scrolls nothing, so `Element.scrollIntoView` is
 * absent rather than inert. `cmdk` calls it every time the command palette's
 * selection moves, including on the first render, so without this stub every
 * test that mounts the shell throws before it asserts anything. Like the
 * observer above, the missing browser API is supplied here rather than guarded
 * against in the component, because the component is correct in a browser.
 */
Element.prototype.scrollIntoView = function scrollIntoView(): void {
  return;
};

afterEach(() => {
  cleanup();
});
