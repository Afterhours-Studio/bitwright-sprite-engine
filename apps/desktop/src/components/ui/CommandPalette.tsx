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

import { stepFrame } from '@/features/editor/canvas/frameStep';
import { useCommandPaletteShortcut } from '@/hooks/useCommandPaletteShortcut';
import { useDismiss } from '@/hooks/useDismiss';
import { cn } from '@/lib/cn';
import { exportDirectory } from '@/lib/export';
import { LANGUAGES, setLanguage } from '@/lib/i18n';
import { openDirectory, openExternal, type ShellResult } from '@/lib/tauri';
import { useAnimationStore } from '@/stores/useAnimationStore';
import { useCommandPaletteStore } from '@/stores/useCommandPaletteStore';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { TOOLS, TOOL_KEYS, useEditorStore } from '@/stores/useEditorStore';
import { useShellStore, type Screen, type Theme } from '@/stores/useShellStore';
import { useToastStore } from '@/stores/useToastStore';

const SCREENS = ['home', 'editor', 'settings'] as const satisfies readonly Screen[];
const THEMES: readonly Theme[] = ['dark', 'light'];

/** The project's home, and the only host the palette opens besides the licence. */
const REPOSITORY_URL = 'https://github.com/Afterhours-Studio/bitwright-sprite-engine';

/** The licence this application is distributed under. */
const LICENCE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

/** One row in the palette. */
interface PaletteCommand {
  /** Stable identifier, used as the React key. */
  id: string;
  /** Label. Always a translated string, and what the search matches on. */
  label: string;
  /** Further text the search matches, so a group can be found by its name. */
  keywords: string[];
  /** The key that does the same thing outside the palette, if there is one. */
  shortcut?: string;
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
 * Says so when a shell command did not go through.
 *
 * `shell.unavailable` is left alone: it only means the page is not inside a
 * Tauri window, which is not a failure of the thing asked for.
 *
 * @param result - What the command returned.
 */
function report(result: ShellResult<unknown>): void {
  if (result.ok || result.error.code === 'shell.unavailable') {
    return;
  }
  useToastStore.getState().notify({
    severity: 'warning',
    messageKey: `errors:${result.error.code}`,
  });
}

/** Opens the directory exports are written to, creating it first if need be. */
async function openExportsFolder(): Promise<void> {
  const directory = await exportDirectory();
  if (!directory.ok) {
    report(directory);
    return;
  }
  report(await openDirectory(directory.value));
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
 * to do, opened with Ctrl+K (Cmd+K on macOS) from any screen.
 *
 * WHAT IS IN IT, AND WHAT IS DELIBERATELY NOT
 *
 * Navigation, view settings, tool choice, the animation's playback and a few
 * links. Nothing here overwrites a document or removes anything, because a
 * palette is driven by typing and Enter: the user commits to a row after
 * reading one word of it, having got there through a fuzzy match they did not
 * verify. That is a fine way to change screens and an unacceptable way to
 * overwrite a layer or delete a sprite. Adding a frame is the one row that
 * writes, and it only adds: a copy of the open frame, which the timeline's
 * delete takes away again. Expensive and destructive actions stay where they
 * are, on a control the user has looked at.
 *
 * Every row says what it will do rather than naming a switch to flip. A view
 * toggle reads "Show pixel grid" or "Hide pixel grid" depending on what is on
 * screen, so a row chosen after reading it does what it said, and choosing the
 * screen already open or the theme already applied does nothing. The
 * checkerboard behind transparent pixels has no control of its own on the
 * studio layout, so this is where it is reached.
 *
 * The editor's rows - the view toggles and the tools - are listed only while
 * the editor is showing, which is the only place they change anything a person
 * can see. The editor itself is offered only with a document open, because
 * with none it is home.
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
  const { t: tTools } = useTranslation('tools');
  const open = useCommandPaletteStore((state) => state.open);
  const setOpen = useCommandPaletteStore((state) => state.setOpen);
  const screen = useShellStore((state) => state.screen);
  const setScreen = useShellStore((state) => state.setScreen);
  const setTheme = useShellStore((state) => state.setTheme);
  const setNewSpriteOpen = useShellStore((state) => state.setNewSpriteOpen);
  const hasDocument = useDocumentStore((state) => state.assetId !== null);

  const showPixelGrid = useEditorStore((state) => state.showPixelGrid);
  const showCheckerboard = useEditorStore((state) => state.showCheckerboard);
  const tileGuide = useEditorStore((state) => state.tileGuide);
  const showLayersPanel = useEditorStore((state) => state.showLayersPanel);
  const bottomPanel = useEditorStore((state) => state.bottomPanel);
  const setTool = useEditorStore((state) => state.setTool);
  const setShowPixelGrid = useEditorStore((state) => state.setShowPixelGrid);
  const setShowCheckerboard = useEditorStore((state) => state.setShowCheckerboard);
  const setTileGuide = useEditorStore((state) => state.setTileGuide);
  const setShowLayersPanel = useEditorStore((state) => state.setShowLayersPanel);
  const setBottomPanel = useEditorStore((state) => state.setBottomPanel);

  const hasAnimation = useAnimationStore((state) => state.animation !== null);
  const frameCount = useAnimationStore((state) => state.animation?.frames.length ?? 0);
  const playing = useAnimationStore((state) => state.playing);
  const onionSkin = useAnimationStore((state) => state.onionSkin);

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

  const editing = screen === 'editor';

  // Rebuilt when the language changes, because `t` is what changes with it,
  // and when a toggle does, because each toggle's row says which way it goes.
  const groups = useMemo<PaletteGroup[]>(() => {
    const navigate = t('palette.goTo');
    const create = t('palette.create');
    const view = t('palette.view');
    const tools = tTools('title');
    const theme = t('theme.label');
    const language = t('language.label');
    const help = t('palette.help');

    /** A view toggle's row, labelled with what choosing it will do. */
    const toggle = (
      id: string,
      on: boolean,
      labels: { show: string; hide: string },
      set: (next: boolean) => void,
    ): PaletteCommand => ({
      id: `view.${id}`,
      label: on ? labels.hide : labels.show,
      keywords: [view],
      run: () => {
        set(!on);
      },
    });

    const result: PaletteGroup[] = [
      {
        id: 'navigate',
        heading: navigate,
        commands: SCREENS.filter((item) => item !== 'editor' || hasDocument).map((item) => ({
          id: `screen.${item}`,
          label: t(`nav.${item}`),
          keywords: [navigate],
          run: () => {
            setScreen(item);
          },
        })),
      },
      {
        id: 'create',
        heading: create,
        commands: [
          {
            id: 'create.sprite',
            label: t('palette.newSprite'),
            keywords: [create],
            run: () => {
              setNewSpriteOpen(true);
            },
          },
        ],
      },
    ];

    if (editing) {
      const viewCommands: PaletteCommand[] = [
        toggle(
          'pixelGrid',
          showPixelGrid,
          { show: t('palette.showPixelGrid'), hide: t('palette.hidePixelGrid') },
          setShowPixelGrid,
        ),
        toggle(
          'checkerboard',
          showCheckerboard,
          { show: t('palette.showCheckerboard'), hide: t('palette.hideCheckerboard') },
          setShowCheckerboard,
        ),
        toggle(
          'layersPanel',
          showLayersPanel,
          { show: t('palette.showLayersPanel'), hide: t('palette.hideLayersPanel') },
          setShowLayersPanel,
        ),
        // The two strips share the slot under the stage, so showing one puts
        // it in the other's place and hiding the one showing leaves it empty.
        toggle(
          'timeline',
          bottomPanel === 'timeline',
          { show: t('palette.showTimeline'), hide: t('palette.hideTimeline') },
          (show) => {
            setBottomPanel(show ? 'timeline' : null);
          },
        ),
        toggle(
          'stepsStrip',
          bottomPanel === 'steps',
          { show: t('palette.showStepsStrip'), hide: t('palette.hideStepsStrip') },
          (show) => {
            setBottomPanel(show ? 'steps' : null);
          },
        ),
      ];
      // Only while a guide is showing: turning off what is already off would
      // be a row that does nothing, and the sizes are chosen in the header.
      if (tileGuide !== 0) {
        viewCommands.push({
          id: 'view.tileGuideOff',
          label: t('palette.tileGuideOff'),
          keywords: [view],
          run: () => {
            setTileGuide(0);
          },
        });
      }

      result.push({ id: 'view', heading: view, commands: viewCommands });

      if (hasDocument && hasAnimation) {
        const animation = t('palette.animation');
        const animate = useAnimationStore.getState();
        const animationCommands: PaletteCommand[] = [];
        // Playing and stepping need a second frame; with one they would be
        // rows that do nothing.
        if (frameCount > 1) {
          animationCommands.push(
            {
              id: 'animation.play',
              label: playing ? t('palette.pause') : t('palette.play'),
              keywords: [animation],
              run: () => {
                if (useAnimationStore.getState().playing) {
                  animate.pause();
                } else {
                  animate.play();
                }
              },
            },
            {
              id: 'animation.next',
              label: t('palette.nextFrame'),
              keywords: [animation],
              shortcut: '.',
              run: () => {
                stepFrame(1);
              },
            },
            {
              id: 'animation.previous',
              label: t('palette.previousFrame'),
              keywords: [animation],
              shortcut: ',',
              run: () => {
                stepFrame(-1);
              },
            },
          );
        }
        animationCommands.push(
          {
            id: 'animation.onionSkin',
            label: onionSkin ? t('palette.hideOnionSkin') : t('palette.showOnionSkin'),
            keywords: [animation, view],
            run: () => {
              animate.toggleOnionSkin();
            },
          },
          {
            id: 'animation.addFrame',
            label: t('palette.addFrame'),
            keywords: [animation],
            run: () => {
              void animate.add(true);
            },
          },
        );
        result.push({ id: 'animation', heading: animation, commands: animationCommands });
      }

      result.push({
        id: 'tools',
        heading: tools,
        commands: TOOLS.map((tool) => ({
          id: `tool.${tool}`,
          label: tTools(`tool.${tool}.name`),
          keywords: [tools],
          shortcut: TOOL_KEYS[tool],
          run: () => {
            setTool(tool);
          },
        })),
      });
    }

    result.push(
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
      {
        id: 'help',
        heading: help,
        commands: [
          {
            id: 'help.exports',
            label: t('palette.exportsFolder'),
            keywords: [help],
            run: () => {
              void openExportsFolder();
            },
          },
          {
            id: 'help.docs',
            label: t('palette.documentation'),
            keywords: [help],
            run: () => {
              void openExternal(REPOSITORY_URL).then(report);
            },
          },
          {
            id: 'help.issue',
            label: t('palette.reportIssue'),
            keywords: [help],
            run: () => {
              void openExternal(`${REPOSITORY_URL}/issues`).then(report);
            },
          },
          {
            id: 'help.licence',
            label: t('palette.licence'),
            keywords: [help],
            run: () => {
              void openExternal(LICENCE_URL).then(report);
            },
          },
        ],
      },
    );

    return result;
  }, [
    t,
    tTools,
    editing,
    hasDocument,
    showPixelGrid,
    showCheckerboard,
    tileGuide,
    showLayersPanel,
    bottomPanel,
    hasAnimation,
    frameCount,
    playing,
    onionSkin,
    setScreen,
    setTheme,
    setNewSpriteOpen,
    setTool,
    setShowPixelGrid,
    setShowCheckerboard,
    setTileGuide,
    setShowLayersPanel,
    setBottomPanel,
  ]);

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
        'bg-black/60 backdrop-blur-sm transition-opacity duration-150',
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
        aria-label={t('palette.label')}
        className={cn(
          'flex w-full max-w-xl flex-col overflow-hidden',
          'bg-neutral-950 border border-neutral-800 rounded-xl shadow-2xl',
          'origin-top transition-transform duration-150',
          open ? 'scale-100' : 'scale-95',
        )}
      >
        <div className="p-3 border-b border-neutral-800 bg-neutral-900/50">
          <Command.Input
            ref={field}
            value={search}
            onValueChange={setSearch}
            placeholder={t('palette.placeholder')}
            className={cn(
              'w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5',
              'text-xs text-neutral-200 placeholder:text-neutral-500',
              'focus:border-pink-500',
            )}
          />
        </div>

        <Command.List className="max-h-80 overflow-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-xs text-neutral-500">
            {t('palette.empty')}
          </Command.Empty>

          {groups.map((group) => (
            <Command.Group
              key={group.id}
              // A node rather than a string, so the heading is styled here
              // rather than through an attribute selector reaching into cmdk's
              // own markup.
              heading={
                <span className="block px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
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
                    'flex cursor-pointer items-center justify-between gap-3 rounded px-2.5 py-1.5',
                    'text-xs text-neutral-300',
                    'data-[selected=true]:bg-pink-600 data-[selected=true]:text-white',
                  )}
                >
                  <span className="truncate">{command.label}</span>
                  {command.shortcut !== undefined && (
                    <kbd className="kbd px-1.5 py-0.5 text-[10px] rounded bg-neutral-800 text-neutral-400 border border-neutral-700">
                      {command.shortcut}
                    </kbd>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
