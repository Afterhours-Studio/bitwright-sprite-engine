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
import { useId, useState, type ReactElement, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface DisclosureProps {
  /** The always-visible heading. Always a translated string. */
  summary: string;
  /** Controlled state; leave undefined for uncontrolled. */
  open?: boolean;
  /** Initial state when uncontrolled. Default false. */
  defaultOpen?: boolean;
  /** Called with the new state on every toggle. */
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  /** Extra classes for layout only, never colour. */
  className?: string;
}

/**
 * A section that folds away behind its own heading.
 *
 * Written rather than using `<details>` and `<summary>`, because the native
 * element snaps open and shut with no transition: there is no way to animate
 * its height, and the browser draws the marker triangle itself, in its own
 * colour and with its own spacing. It looks like a different interface from
 * everything around it.
 *
 * The behaviour worth keeping is kept: the heading is a real button, so it is
 * reached by Tab and toggled with Enter or Space, and it reports its state
 * through `aria-expanded` and `aria-controls`. The body stays mounted while
 * closed, so the height can animate rather than disappearing between frames,
 * but it is kept out of the accessibility tree and out of tab order while
 * hidden.
 */
export function Disclosure({
  summary,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  children,
  className,
}: DisclosureProps): ReactElement {
  const id = useId();
  const headerId = `${id}-header`;
  const bodyId = `${id}-body`;
  const [inner, setInner] = useState(defaultOpen);
  const open = controlledOpen ?? inner;

  const toggle = (): void => {
    const next = !open;
    setInner(next);
    onOpenChange?.(next);
  };

  return (
    <div className={className}>
      <button
        id={headerId}
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggle}
        className={cn(
          'flex items-center gap-1.5 rounded-sm text-xs font-medium',
          'text-fg-secondary transition-colors hover:text-fg-primary',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-line-focus',
        )}
      >
        <Chevron open={open} />
        {summary}
      </button>

      <div
        id={bodyId}
        role="region"
        aria-labelledby={headerId}
        aria-hidden={!open}
        {...(open ? {} : { inert: '' })}
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pt-2">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** The disclosure arrow, which turns as the section opens. */
function Chevron({ open }: { open: boolean }): ReactElement {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={cn('h-3 w-3 shrink-0 transition-transform duration-150', !open && '-rotate-90')}
      fill="none"
    >
      <path
        d="M2.5 4.5L6 8l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
