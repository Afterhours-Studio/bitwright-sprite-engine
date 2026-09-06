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
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * How an active pill is marked.
 *
 * Two levels, because the interface has two levels of pill row. Primary
 * navigation takes the accent, so that exactly one thing on screen is yellow.
 * A secondary row of filters takes the anchor colour instead, which reads as
 * selected without competing with the navigation for attention.
 */
export type PillTone = 'accent' | 'anchor';

export interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Whether this pill is the current choice. */
  active?: boolean;
  /** How the active state is marked. */
  tone?: PillTone;
  /** Optional leading element, such as a status dot. */
  leading?: ReactNode;
  /** Label. Always a translated string. */
  children: ReactNode;
}

const ACTIVE: Record<PillTone, string> = {
  accent: 'bg-accent text-accent-fg',
  anchor: 'bg-surface-anchor text-fg-on-anchor',
};

/**
 * A pill shaped toggle, used for navigation and for filters.
 *
 * Sized to its content. A caller that wants a full-width pill passes `w-full`;
 * the reverse does not work, because two width utilities have equal specificity
 * and Tailwind's own emission order decides the winner.
 */
export function Pill({
  active = false,
  tone = 'accent',
  leading,
  className,
  disabled,
  children,
  ...rest
}: PillProps): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-2 rounded-pill px-4 py-2',
        'text-left text-sm font-medium transition-colors',
        disabled && 'cursor-not-allowed bg-surface-disabled text-fg-muted',
        !disabled && active && ACTIVE[tone],
        !disabled &&
          !active &&
          'bg-surface-content text-fg-secondary shadow-sm hover:text-fg-primary',
        className,
      )}
      {...rest}
    >
      {leading}
      <span className="truncate">{children}</span>
    </button>
  );
}
