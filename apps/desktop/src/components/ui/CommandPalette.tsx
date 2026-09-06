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
import { Command, defaultFilter } from 'cmdk';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useCommandPaletteShortcut } from '@/hooks/useCommandPaletteShortcut';
import { useDismiss } from '@/hooks/useDismiss';
import { cn } from '@/lib/cn';
import { LANGUAGES, setLanguage } from '@/lib/i18n';
import { useCommandPaletteStore } from '@/stores/useCommandPaletteStore';
import { useShellStore, type Screen, type Theme } from '@/stores/useShellStore';

const SCREENS: readonly Screen[] = ['generate', 'gallery', 'settings'];
const THEMES: readonly Theme[] = ['dark', 'light'];

/** One row in the palette. */
interface PaletteCommand {
  /** Stable identifier, used as the React key. */
  id: string;
  /** Label. Always a translated string, and what the search matches on. */
  label: string;
  /** Further text the search matches, so a group can be found by its name. */
  keywords: string[];
  /** What choosing the row does. */
  run: () => void;
}

/** A named set of rows, shown under a heading. */
interface PaletteGroup {
  /** Stable identifier, used as the React key. */
  id: string;
  /** Heading. Always a translated string. */
  heading: string;
  /** The rows, in order. */
  commands: PaletteCommand[];
}

/**
 * Strips accents, so that a search typed without them still matches.
 *
 * Vietnamese is read with its diacritics and typed without them far more often
 * than not, and "cai dat" has to find "Cài đặt" or the palette is useless in
 * one of the two languages this application ships. NFD splits the combining
 * marks off every accented vowel, which handles all of them; D with stroke is a
 * letter in its own right rather than an accented D, so NFD leaves it alone and
 * it is folded by hand.
 *
 * @param text - Text to fold.
 * @returns The text in lower case, with its accents removed.
 */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/đ/g, 'd');
}

/**
 * cmdk's own ranking, applied to folded text.
 *
 * The scoring is left to the library. Only the text handed to it changes, which
 * is what stops accent folding from turning into a second, worse matcher.
 *
 * @param value - The row's value.
 * @param search - What the user typed.
 * @param keywords - Further text the row matches on.
 * @returns The row's score, zero meaning no match.
 */
function filterCommands(value: string, search: string, keywords?: string[]): number {
  return defaultFilter(fold(value), fold(search), keywords?.map(fold));
}

/**
 * The command palette: a search field over everything the interface can be told
 * to do, opened from the title bar or with Ctrl+K.
 *
 * WHAT IS IN IT, AND WHAT IS DELIBERATELY NOT
 *
 * Navigation and mode switching only. Nothing here starts a run, fetches
 * weights, or removes anything, because a palette is driven by typing and
 * Enter: the user commits to a row after reading one word of it, having got
 * there through a fuzzy match they did not verify. That is a fine way to change
 * screens and an unacceptable way to spend gigabytes of bandwidth or empty the
 * gallery. Expensive and destructive actions stay where they are, on a control
 * the user has looked at.
 *
 * Every row is idempotent for the same reason. Choosing the screen already open
 * or the theme already applied does nothing, so a mistyped search costs
 * nothing.
 *
 * MOUNTED WHILE CLOSED
 *
 * Like `Overlay`, it stays in the tree and animates rather than unmounting. The
 * panel is held out of the accessibility tree and out of tab order with `inert`
 * while it is closed, so nothing in it is reachable or announced, but the
 * transition still has something to run on.
 */
export function CommandPalette(): ReactElement {
  const { t } = useTranslation();
  const open = useCommandPaletteStore((state) => state.open);
  const setOpen = useCommandPaletteStore((state) => state.setOpen);
  const setScreen = useShellStore((state) => state.setScreen);
  const setTheme = useShellStore((state) => state.setTheme);

  const panel = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');

  useCommandPaletteShortcut();

  const close = useCallback(() => {
    setOpen(false);
  }, [setOpen]);
  useDismiss(open, panel, close);

  useEffect(() => {
    if (!open) {
      return;
    }
    // Cleared as it opens rather than as it closes, so the list is not seen
    // refilling behind the closing transition.
    setSearch('');
    field.current?.focus();
  }, [open]);

  // Rebuilt when the language changes, because `t` is what changes with it.
  const groups = useMemo<PaletteGroup[]>(() => {
    const navigate = t('palette.goTo');
    const theme = t('theme.label');
    const language = t('language.label');

    return [
      {
        id: 'navigate',
        heading: navigate,
        commands: SCREENS.map((screen) => ({
          id: `screen.${screen}`,
          label: t(`nav.${screen}`),
          keywords: [navigate],
          run: () => {
            setScreen(screen);
          },
        })),
      },
      {
        id: 'theme',
        heading: theme,
        commands: THEMES.map((value) => ({
          id: `theme.${value}`,
          label: t(`theme.${value}`),
          keywords: [theme],
          run: () => {
            setTheme(value);
          },
        })),
      },
      {
        id: 'language',
        heading: language,
        commands: LANGUAGES.map((value) => ({
          id: `language.${value}`,
          label: t(`language.${value}`),
          keywords: [language],
          run: () => {
            void setLanguage(value);
          },
        })),
      },
    ];
  }, [t, setScreen, setTheme]);

  return (
    <div
      role="presentation"
      onKeyDown={(event) => {
        // The field is the only thing inside the palette that takes focus, so
        // Tab would move focus onto the interface behind it while the palette
        // is still covering the window. There is nowhere for it to go, so it
        // goes nowhere.
        if (event.key === 'Tab') {
          event.preventDefault();
        }
      }}
      // Anchored near the top rather than centred vertically. A vertically
      // centred panel climbs the window on every keystroke as the list shrinks,
      // taking the field being typed into with it.
      className={cn(
        'absolute inset-0 z-50 flex items-start justify-center p-4 pt-20',
        'transition-opacity duration-150',
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
      aria-hidden={!open}
      {...(open ? {} : { inert: '' })}
    >
      <Command
        ref={panel}
        label={t('palette.label')}
        filter={filterCommands}
        // cmdk binds Ctrl+K to "move the selection up" as a vim convenience,
        // and Ctrl+K is the key that opens and closes this palette. The
        // application's own shortcut wins.
        vimBindings={false}
        role="dialog"
        aria-modal="true"
        className={cn(
          'flex w-full max-w-xl flex-col gap-2',
          'rounded-md border border-line bg-surface-float p-2 shadow-lg',
          'origin-top transition-transform duration-150',
          open ? 'scale-100' : 'scale-95',
        )}
      >
        {/* The same treatment as `Field`, because it is the same kind of thing:
            the surface moves away from the text colour, and the border is what
            separates the field from the panel it sits on. */}
        <Command.Input
          ref={field}
          value={search}
          onValueChange={setSearch}
          placeholder={t('palette.placeholder')}
          className={cn(
            'w-full rounded-sm border border-line-input bg-surface-input px-3 py-2',
            'text-sm text-fg-primary transition-colors',
            'placeholder:text-fg-placeholder',
            'focus:border-line-focus',
          )}
        />

        <Command.List className="max-h-72 overflow-auto">
          <Command.Empty className="px-3 py-6 text-center text-sm text-fg-secondary">
            {t('palette.empty')}
          </Command.Empty>

          {groups.map((group) => (
            <Command.Group
              key={group.id}
              // A node rather than a string, so the heading is styled here
              // rather than through an attribute selector reaching into cmdk's
              // own markup.
              heading={
                <span className="block px-3 pb-1 pt-2 text-xs font-medium text-fg-secondary">
                  {group.heading}
                </span>
              }
            >
              {group.commands.map((command) => (
                <Command.Item
                  key={command.id}
                  value={command.label}
                  keywords={command.keywords}
                  onSelect={() => {
                    command.run();
                    setOpen(false);
                  }}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2',
                    'text-sm text-fg-secondary transition-colors',
                    'data-[selected=true]:bg-surface-content-alt data-[selected=true]:text-fg-primary',
                  )}
                >
                  {command.label}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
