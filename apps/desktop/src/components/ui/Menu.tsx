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
import { useCallback, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { Overlay, type OverlayAlign } from '@/components/ui/Overlay';
import { useDismiss } from '@/hooks/useDismiss';
import { cn } from '@/lib/cn';

/** One command in a menu. */
export interface MenuItem {
  /** Stable identifier, returned to the caller. */
  id: string;
  /** Label. Always a translated string. */
  label: string;
  /** Keyboard accelerator, shown right aligned. Not bound by this component. */
  accelerator?: string;
  /** Whether the command can be used. */
  disabled?: boolean;
}

/** A named group of commands, shown as a submenu. */
export interface MenuGroup {
  id: string;
  label: string;
  items: MenuItem[];
}

export interface MenuProps {
  /** The groups, in order. */
  groups: MenuGroup[];
  /** Accessible name for the trigger. Always a translated string. */
  label: string;
  /** Which edge the panel aligns to. */
  align?: OverlayAlign;
  /** The trigger's contents. */
  children: ReactNode;
  /** Called with the group and item chosen. */
  onSelect: (groupId: string, itemId: string) => void;
}

/**
 * A menu bar button with submenus, in the shape of a desktop application menu.
 *
 * Hovering a group opens its submenu, which is what a menu bar does; clicking
 * one also opens it, for a pointer that does not hover, such as a touch
 * screen.
 *
 * The accelerators are labels only. Binding them is the application's job,
 * because the same command has to work when the menu is closed.
 */
export function Menu({
  groups,
  label,
  align = 'start',
  children,
  onSelect,
}: MenuProps): ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setOpenGroup(null);
  }, []);
  useDismiss(open, container, close);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((was) => !was);
          setOpenGroup(null);
        }}
        className={cn(
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          'text-fg-secondary transition-colors hover:text-fg-primary',
          open ? 'bg-surface-content-alt' : 'bg-surface-content shadow-sm',
        )}
      >
        {children}
      </button>

      <Overlay open={open} align={align} className="w-44">
        <ul role="menu" aria-label={label}>
          {groups.map((group) => (
            <li
              key={group.id}
              className="relative"
              onPointerEnter={() => {
                setOpenGroup(group.id);
              }}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openGroup === group.id}
                onClick={() => {
                  setOpenGroup((current) => (current === group.id ? null : group.id));
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-sm px-3 py-2',
                  'text-left text-sm transition-colors',
                  openGroup === group.id
                    ? 'bg-surface-content-alt text-fg-primary'
                    : 'bg-transparent text-fg-secondary',
                )}
              >
                <span>{group.label}</span>
                <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3" fill="none">
                  <path
                    d="M4.5 2.5L8 6l-3.5 3.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>

              <div
                className={cn(
                  'absolute start-[calc(100%+4px)] top-0 z-50 w-52',
                  'rounded-md border border-line bg-surface-float p-1 shadow-md',
                  'origin-top-left transition-[opacity,transform] duration-150',
                  openGroup === group.id
                    ? 'pointer-events-auto scale-100 opacity-100'
                    : 'pointer-events-none scale-95 opacity-0',
                )}
                aria-hidden={openGroup !== group.id}
              >
                <ul role="menu" aria-label={group.label}>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={item.disabled ?? false}
                        onClick={() => {
                          onSelect(group.id, item.id);
                          close();
                        }}
                        className={cn(
                          'flex w-full items-center justify-between gap-4 rounded-sm px-3 py-2',
                          'text-left text-sm transition-colors',
                          item.disabled === true
                            ? 'cursor-not-allowed text-fg-muted'
                            : 'text-fg-secondary hover:bg-surface-content-alt hover:text-fg-primary',
                        )}
                      >
                        <span>{item.label}</span>
                        {item.accelerator !== undefined && (
                          <span className="text-xs text-fg-muted">{item.accelerator}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      </Overlay>
    </div>
  );
}
