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

import { useCallback, useEffect, useState } from 'react';

import { useToastStore } from '@/stores/useToastStore';

/**
 * Publishes the notification bell's position, so a new toast can grow out of
 * it.
 *
 * The dock puts the returned callback on the bell button and does nothing else:
 *
 *   const anchor = useToastAnchor();
 *   <button ref={anchor} ...>
 *
 * WHY A REF CALLBACK AND A PIECE OF STATE, RATHER THAN A REF OBJECT
 *
 * A `useRef` object is filled in during commit and never tells anyone it
 * changed, so there is no moment at which measuring is correct. Holding the
 * element in state instead gives the effect below something to depend on: it
 * runs when the bell appears, again when it is replaced by a different element,
 * and its cleanup runs when it goes. The callback itself is stable, so the dock
 * re-rendering does not detach and reattach the bell on every pass.
 *
 * WHAT IS PUBLISHED, AND WHY IT IS A POINT
 *
 * The bell's centre, in viewport coordinates, taken from its bounding
 * rectangle. The centre is the whole of what a transform origin needs; keeping
 * the rest of the rectangle in the store would be four numbers where two are
 * read, and two of them would silently go stale.
 *
 * WHAT MAKES IT SURVIVE
 *
 * Three things move the bell: the window resizing, the dock's own layout
 * changing as chips expand and collapse, and the bell being replaced when the
 * dock re-renders. A `ResizeObserver` on the button covers the second, the
 * resize listener covers the first, and the state-held element covers the
 * third. Nothing here polls.
 *
 * @returns A ref callback for the bell button.
 */
export function useToastAnchor(): (node: HTMLElement | null) => void {
  const setBellAnchor = useToastStore((state) => state.setBellAnchor);
  const [bell, setBell] = useState<HTMLElement | null>(null);

  const ref = useCallback((node: HTMLElement | null) => {
    setBell(node);
  }, []);

  useEffect(() => {
    if (bell === null) {
      setBellAnchor(null);
      return;
    }

    const publish = (): void => {
      const rect = bell.getBoundingClientRect();
      setBellAnchor({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    };

    publish();

    const observer = new ResizeObserver(publish);
    observer.observe(bell);
    window.addEventListener('resize', publish);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', publish);
      // Cleared rather than left behind. A stale anchor is worse than none:
      // the toast layer falls back cleanly when it has no anchor, and grows
      // out of the wrong place when it has a wrong one.
      setBellAnchor(null);
    };
  }, [bell, setBellAnchor]);

  return ref;
}
