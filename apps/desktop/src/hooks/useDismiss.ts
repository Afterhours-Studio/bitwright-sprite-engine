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
import { useEffect, useRef, type RefObject } from 'react';

/**
 * The overlays that are open, oldest first.
 *
 * Every open overlay listens on the document, so without an order a single
 * Escape inside a confirmation would close the confirmation and the dialog
 * behind it at once. Only the newest overlay answers Escape; the one beneath
 * it answers the next press.
 */
const stack: symbol[] = [];

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
  const tokenRef = useRef(Symbol('overlay'));

  // Its place in the stack is taken when it opens and kept until it closes,
  // in an effect of its own: the listeners below are re-attached whenever
  // `onDismiss` changes identity, and doing this there would move a parent
  // that merely re-rendered above the confirmation it opened.
  useEffect(() => {
    if (!open) {
      return;
    }
    const token = tokenRef.current;
    stack.push(token);
    return () => {
      stack.splice(stack.indexOf(token), 1);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const token = tokenRef.current;

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && ref.current?.contains(target) === true) {
        return;
      }
      onDismiss();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && stack[stack.length - 1] === token) {
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
