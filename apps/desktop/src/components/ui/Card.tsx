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

/** Which surface a card is painted with. */
export type CardSurface = 'content' | 'alt';

export interface CardProps {
  /** Heading. Always a translated string. Omit for an unlabelled card. */
  title?: string;
  /** Supporting line under the heading. */
  description?: string;
  /** Which surface to use. `alt` is for a card nested inside another card. */
  surface?: CardSurface;
  /** Card body. */
  children: ReactNode;
  /** Extra classes for layout only, never colour. */
  className?: string;
}

/**
 * A group of related content.
 *
 * A card is the default text-bearing surface. In light mode it is white and is
 * held apart from the grey canvas by lightness, and from a nested card by its
 * border; in dark mode both boundaries are real lightness steps. A nested card
 * uses `surface="alt"` and a full-strength border, because in light mode that
 * border is the only thing separating two near-white surfaces.
 */
export function Card({
  title,
  description,
  surface = 'content',
  children,
  className,
}: CardProps): ReactElement {
  return (
    <section
      className={cn(
        'rounded-lg p-4',
        surface === 'content' && 'border border-line-subtle bg-surface-content shadow-sm',
        surface === 'alt' && 'border border-line bg-surface-content-alt',
        className,
      )}
    >
      {title !== undefined && (
        <header className="mb-3">
          <h2 className="text-sm font-semibold text-fg-primary">{title}</h2>
          {description !== undefined && (
            <p className="mt-1 text-xs text-fg-secondary">{description}</p>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
