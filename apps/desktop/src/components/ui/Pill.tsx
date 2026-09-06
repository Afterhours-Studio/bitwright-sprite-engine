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

import type { ButtonHTMLAttributes, ReactNode, ReactElement } from 'react';

import { cn } from '@/lib/cn';

export interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Whether this pill is the current choice. */
  active?: boolean;
  /** Optional leading element, such as a status dot. */
  leading?: ReactNode;
  /** Label. Always a translated string. */
  children: ReactNode;
}

/**
 * A pill shaped toggle, used for navigation and for filters.
 *
 * The active state is the one place the accent colour appears in bulk. Keeping
 * it rare is what makes it read as a state rather than as decoration.
 */
export function Pill({
  active = false,
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
        // Sized to its content. A caller that wants a full-width pill passes
        // `w-full`; the reverse does not work, because two width utilities
        // have equal specificity and Tailwind's own order decides the winner.
        'inline-flex items-center gap-2 rounded-pill px-4 py-2',
        'text-left text-sm font-medium transition-colors',
        disabled && 'cursor-not-allowed bg-surface-disabled text-fg-muted',
        !disabled && active && 'bg-accent text-accent-fg',
        !disabled && !active && 'bg-transparent text-fg-secondary hover:bg-surface-2',
        className,
      )}
      {...rest}
    >
      {leading}
      <span className="truncate">{children}</span>
    </button>
  );
}
