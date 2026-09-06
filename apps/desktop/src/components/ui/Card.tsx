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

import type { ReactNode, ReactElement } from 'react';

import { cn } from '@/lib/cn';

export interface CardProps {
  /** Heading. Always a translated string. Omit for an unlabelled card. */
  title?: string;
  /** Supporting line under the heading. */
  description?: string;
  /** Card body. */
  children: ReactNode;
  /** Extra classes for layout only, never colour. */
  className?: string;
}

/**
 * A raised group of related controls.
 *
 * A card is always surface-2 and always sits on surface-1, one step below.
 * Nesting a card inside a card would put two surfaces of the same step
 * together, and the boundary between them would disappear.
 *
 * The border carries the separation in dark mode, where the shadow is close to
 * invisible; the shadow carries it in light mode. Both are always present, so
 * neither theme depends on a single signal.
 */
export function Card({ title, description, children, className }: CardProps): ReactElement {
  return (
    <section
      className={cn('rounded-md border border-line-subtle bg-surface-2 p-4 shadow-sm', className)}
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
