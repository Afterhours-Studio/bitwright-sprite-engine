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
import { useEffect, type RefObject } from 'react';

/**
 * Closes an overlay on Escape, or on a press outside it.
 *
 * Pointer down rather than click, so that the overlay closes as the press
 * begins rather than after it completes. A click listener lets the press land
 * on whatever was underneath before the overlay goes away.
 *
 * @param open - Whether the overlay is showing.
 * @param ref - The overlay's outermost element.
 * @param onDismiss - Called when the overlay should close.
 */
export function useDismiss(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
): void {
  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && ref.current?.contains(target) === true) {
        return;
      }
      onDismiss();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDismiss();
      }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, ref, onDismiss]);
}
