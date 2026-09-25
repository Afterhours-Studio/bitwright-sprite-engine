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
 * A group of related content: a settings section, in the studio's look.
 *
 * A faint lift off the page (`bg-neutral-900/40`) with a hairline border,
 * which is how the reference separates sections without a card stack. A card
 * nested inside another takes `surface="alt"`, a step stronger, so the two
 * still read as two when one sits on the other. The neutral scale inverts in
 * the light theme, so the same classes hold there.
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
        'rounded border border-neutral-800',
        surface === 'content' && 'bg-neutral-900/40 p-4',
        surface === 'alt' && 'bg-neutral-900/70 p-3',
        className,
      )}
    >
      {title !== undefined && (
        <header className="mb-3">
          <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
          {description !== undefined && (
            <p className="mt-1 text-xs text-neutral-400">{description}</p>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
