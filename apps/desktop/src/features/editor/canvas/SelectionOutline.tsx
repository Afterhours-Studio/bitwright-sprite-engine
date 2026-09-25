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
 * The marching ants: the selection's edge, drawn over the sprite.
 *
 * AN SVG IN DOCUMENT UNITS. The path is built in document pixels by
 * `selectionOutline` and the view box is the document, so the outline scales
 * with the zoom for free and every edge sits exactly on a pixel boundary. The
 * stroke is `non-scaling-stroke`, so it stays one CSS pixel wide at 64x
 * instead of growing into a bar as wide as a sprite pixel.
 *
 * TWO DASHED PATHS, dark under light, offset by one dash. Either colour alone
 * disappears against a sprite painted in it; the pair reads on anything. The
 * march is an SMIL `animate` on the dash offset rather than a CSS keyframe,
 * because it belongs to this component and a keyframe would have to live in
 * the global stylesheet.
 */

import type { ReactElement } from 'react';

import { selectionOutline } from '@/lib/selection';
import type { Selection } from '@/stores/useEditorStore';
import type { Point } from '@/types/document';

/** The dash length, in CSS pixels. */
const DASH = 4;

export interface SelectionOutlineProps {
  /** The selection to outline. */
  selection: Selection;
  /** A shift to draw it at, in document pixels, while it is being moved. */
  offset?: Point | undefined;
  /** The drawn width of the document, in CSS pixels. */
  width: number;
  /** The drawn height of the document, in CSS pixels. */
  height: number;
}

/**
 * The selection's outline.
 *
 * @param props - The selection, where to draw it, and the drawn size.
 * @returns The overlay.
 */
export function SelectionOutline({
  selection,
  offset,
  width,
  height,
}: SelectionOutlineProps): ReactElement | null {
  const d = selectionOutline(selection, offset);
  if (d === '') {
    return null;
  }
  return (
    <svg
      aria-hidden="true"
      data-testid="selection-outline"
      className="pointer-events-none absolute inset-0 overflow-visible"
      width={width}
      height={height}
      viewBox={`0 0 ${String(selection.width)} ${String(selection.height)}`}
      preserveAspectRatio="none"
    >
      <path
        d={d}
        fill="none"
        className="stroke-surface-canvas"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={d}
        fill="none"
        className="stroke-fg-primary"
        strokeWidth={1}
        strokeDasharray={`${String(DASH)} ${String(DASH)}`}
        vectorEffect="non-scaling-stroke"
      >
        <animate
          attributeName="stroke-dashoffset"
          from="0"
          to={String(DASH * 2)}
          dur="0.6s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}
