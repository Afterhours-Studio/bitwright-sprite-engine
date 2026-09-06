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

/** How large an element's content box is, in CSS pixels. */
export interface ElementSize {
  /** Content box width. Zero until the element has been laid out. */
  width: number;
  /** Content box height. Zero until the element has been laid out. */
  height: number;
}

/** What {@link useElementSize} hands back. */
export interface ElementSizeResult extends ElementSize {
  /** Put this on the element to be measured. */
  ref: (node: HTMLElement | null) => void;
}

/**
 * Reports the live content-box size of an element.
 *
 * The sprite stage scales its image to whatever room it has, and that number is
 * not knowable from the markup: it depends on the window, on the right panel,
 * and on whether the preview rail is showing. It has to be measured, and it has
 * to be measured again every time any of those change.
 *
 * The element is held in state rather than in a ref, because a ref does not
 * re-render and the observer has to be attached the moment the node exists. A
 * ref would attach on the first layout effect and then never learn that React
 * had swapped the node underneath it.
 *
 * `contentRect` is used rather than `getBoundingClientRect`, so the padding of
 * the measured box is already subtracted and the caller gets the room it can
 * actually put something in.
 *
 * @returns The measured size, and the ref to attach.
 */
export function useElementSize(): ElementSizeResult {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  const ref = useCallback((next: HTMLElement | null) => {
    setNode(next);
  }, []);

  useEffect(() => {
    if (node === null) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) {
        return;
      }
      const rect = entry.contentRect;
      // Only a real change is published. A resize observer fires on every
      // layout pass, and setting state to a value equal to the one already
      // held would still cost a render.
      setSize((was) =>
        was.width === rect.width && was.height === rect.height
          ? was
          : { width: rect.width, height: rect.height },
      );
    });

    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [node]);

  return { ref, width: size.width, height: size.height };
}
