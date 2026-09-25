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
import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/cn';

/** Which edge of the trigger the overlay lines up with. */
export type OverlayAlign = 'start' | 'end' | 'center';

export interface OverlayProps {
  /** Whether the overlay is showing. */
  open: boolean;
  /** Which edge to align to. */
  align?: OverlayAlign;
  /** Overlay content. */
  children: ReactNode;
  /** Extra classes for layout only, never colour. */
  className?: string;
}

const ALIGN: Record<OverlayAlign, string> = {
  start: 'start-0',
  end: 'end-0',
  center: 'start-1/2 -translate-x-1/2',
};

/**
 * The floating panel every dropdown and menu is built from.
 *
 * It stays mounted while closed and animates out, so that dismissing does not
 * snap. `hidden` would remove it from the layout immediately and skip the
 * transition, so visibility and pointer events are what get toggled.
 *
 * Sits on --surface-float, which is the only surface above a card, and is held
 * apart from it by shadow in light mode and by a lightness step in dark.
 */
export function Overlay({
  open,
  align = 'start',
  children,
  className,
}: OverlayProps): ReactElement {
  return (
    <div
      role="presentation"
      className={cn(
        'absolute top-[calc(100%+6px)] z-50 min-w-full',
        'rounded-md border border-line bg-surface-float p-1 shadow-md',
        'origin-top transition-[opacity,transform] duration-150',
        ALIGN[align],
        open
          ? 'pointer-events-auto scale-100 opacity-100'
          : 'pointer-events-none scale-95 opacity-0',
        className,
      )}
      // Kept out of the accessibility tree and out of tab order while closed,
      // without removing it from the layout and losing the transition.
      aria-hidden={!open}
      {...(open ? {} : { inert: '' })}
    >
      {children}
    </div>
  );
}
