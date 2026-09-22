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
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { IconButton } from '@/components/ui/IconButton';
import { Menu, type MenuGroup } from '@/components/ui/Menu';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { Tooltip } from '@/components/ui/Tooltip';
import { useWindowControls } from '@/hooks/useWindowControls';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { useCommandPaletteStore } from '@/stores/useCommandPaletteStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { useStorageStore } from '@/stores/useStorageStore';
import { useToastStore } from '@/stores/useToastStore';
import { ApiError } from '@/lib/api';
import { appVersion, openDirectory, openExternal } from '@/lib/tauri';
import { useShellStore, type Screen } from '@/stores/useShellStore';

const SCREENS: readonly Screen[] = ['editor', 'gallery', 'settings'];

/**
 * The window's own title bar, drawn because the system decorations are off.
 *
 * Dragging: the header itself carries `data-tauri-drag-region`, and only the
 * controls opt out with `.no-drag`. The containers around them do not, so the
 * gaps between the three clusters drag the window like any other empty part of
 * a title bar. Marking a whole flex container as no-drag, which is what this
 * did before, turns every gap inside it into dead space that looks draggable
 * and is not. `Tooltip` adds a wrapper inside those controls, which carries
 * neither attribute nor class, so it changes nothing about either region.
 *
 * Padding: the row is inset from the window frame at both ends, so the first
 * control is not touching the edge. The start inset is written as a `calc`
 * that ADDS to `--titlebar-inset-start` rather than as a padding utility,
 * because an inline style beats a class: `px-2` plus an inline
 * `padding-inline-start` is not two paddings, it is the inline one, which is
 * how the hamburger ended up flush against the frame. The token is 0 except on
 * macOS, where it clears the traffic lights, and this composes with it.
 *
 * Every icon-only control is wrapped in `Tooltip`, which is the only way the
 * user can find out what one does. The label is the same translated string as
 * the `aria-label`, so the two never drift apart.
 *
 * Platforms differ in ways that cannot be papered over:
 *
 *   macOS   The system draws the traffic lights over the top left of the
 *           client area. We draw no buttons and leave room through the
 *           `--titlebar-inset-start` token, set by `[data-platform]`.
 *   Windows Nothing is drawn for us. We draw minimize, maximize, and close on
 *           the right, in that order, with the system red on close hover.
 *   Linux   Nothing is drawn for us either, and placement varies by desktop
 *           environment. The right is the common default.
 */
/** The project's home, and the only host the shell will open besides the licence. */
const REPOSITORY_URL = 'https://github.com/Afterhours-Studio/bitwright-sprite-engine';

/** The licence this application is distributed under. */
const LICENCE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

export function TitleBar(): ReactElement {
  const { t } = useTranslation();
  const platform = useShellStore((state) => state.platform);
  const screen = useShellStore((state) => state.screen);
  const setScreen = useShellStore((state) => state.setScreen);
  const theme = useShellStore((state) => state.theme);
  const toggleTheme = useShellStore((state) => state.toggleTheme);
  const { maximized, minimize, toggleMaximize, close } = useWindowControls();

  const showPixelGrid = useEditorStore((state) => state.showPixelGrid);
  const setShowPixelGrid = useEditorStore((state) => state.setShowPixelGrid);
  const showCheckerboard = useEditorStore((state) => state.showCheckerboard);
  const setShowCheckerboard = useEditorStore((state) => state.setShowCheckerboard);
  const storage = useStorageStore((state) => state.info);
  const refreshStorage = useStorageStore((state) => state.refresh);
  const notify = useToastStore((state) => state.notify);
  const undo = useDocumentStore((state) => state.undo);
  const redo = useDocumentStore((state) => state.redo);
  const openDocument = useDocumentStore((state) => state.assetId);

  // Offered only on the screen that holds the sprite, and only with a document
  // open. There is no "can undo" to ask for: the op log and its cursor live in
  // SQLite, and the only way to learn that a boundary has been reached is to
  // walk into it, which comes back as `document.nothing_to_undo` and is
  // reported like any other refusal. Greying the item out on a guess would be
  // the interface asserting something it does not know.
  const editing = screen === 'editor';
  const undoable = editing && openDocument !== null;
  const redoable = undoable;

  const systemControls = platform?.systemWindowControls ?? false;

  const groups: MenuGroup[] = [
    {
      id: 'file',
      label: t('menu.file'),
      items: [
        { id: 'editor', label: t('menu.editor'), accelerator: 'Ctrl+E' },
        { id: 'gallery', label: t('menu.gallery'), accelerator: 'Ctrl+G' },
        { id: 'sprites-folder', label: t('menu.spritesFolder') },
        { id: 'quit', label: t('menu.quit'), accelerator: 'Alt+F4' },
      ],
    },
    {
      id: 'edit',
      label: t('menu.edit'),
      items: [
        { id: 'undo', label: t('menu.undo'), accelerator: 'Ctrl+Z', disabled: !undoable },
        { id: 'redo', label: t('menu.redo'), accelerator: 'Ctrl+Y', disabled: !redoable },
        { id: 'settings', label: t('menu.settings'), accelerator: 'Ctrl+,' },
      ],
    },
    {
      id: 'view',
      label: t('menu.view'),
      items: [
        { id: 'palette', label: t('menu.commandPalette'), accelerator: 'Ctrl+K' },
        { id: 'pixel-grid', label: t('menu.pixelGrid'), checked: showPixelGrid },
        { id: 'checkerboard', label: t('menu.checkerboard'), checked: showCheckerboard },
        { id: 'theme', label: t('theme.toggle'), accelerator: 'Ctrl+Shift+L' },
      ],
    },
    {
      id: 'help',
      label: t('menu.help'),
      items: [
        { id: 'docs', label: t('menu.documentation') },
        { id: 'issue', label: t('menu.reportIssue') },
        { id: 'licence', label: t('menu.licence') },
        { id: 'about', label: t('menu.about') },
      ],
    },
  ];

  /**
   * Opens the directory sprites are written to.
   *
   * The storage report is what knows where they are, and it is loaded when the
   * settings screen is first opened rather than at startup, so it may not be
   * there yet when someone reaches for this on a fresh launch.
   */
  const openSpritesFolder = async (): Promise<void> => {
    const info = storage ?? (await refreshStorage().then(() => useStorageStore.getState().info));
    if (info === null) {
      notify({ severity: 'warning', messageKey: 'errors:shell.no_storage_info' });
      return;
    }

    try {
      await openDirectory(info.spritesDir);
    } catch (error) {
      notify({
        severity: 'warning',
        messageKey: `errors:${error instanceof ApiError ? error.code : 'unknown'}`,
      });
    }
  };

  /** Opens a project link, reporting a refusal rather than failing silently. */
  const openLink = async (url: string): Promise<void> => {
    try {
      await openExternal(url);
    } catch (error) {
      notify({
        severity: 'warning',
        messageKey: `errors:${error instanceof ApiError ? error.code : 'unknown'}`,
      });
    }
  };

  const onMenuSelect = (groupId: string, itemId: string): void => {
    if (groupId === 'file') {
      if (itemId === 'editor') {
        setScreen('editor');
      }
      if (itemId === 'gallery') {
        setScreen('gallery');
      }
      if (itemId === 'sprites-folder') {
        void openSpritesFolder();
      }
      if (itemId === 'quit') {
        void close();
      }
    }

    if (groupId === 'edit') {
      if (itemId === 'undo' && undoable) {
        void undo();
      }
      if (itemId === 'redo' && redoable) {
        void redo();
      }
      if (itemId === 'settings') {
        setScreen('settings');
      }
    }

    if (groupId === 'view') {
      if (itemId === 'palette') {
        useCommandPaletteStore.getState().setOpen(true);
      }
      if (itemId === 'pixel-grid') {
        setShowPixelGrid(!showPixelGrid);
      }
      if (itemId === 'checkerboard') {
        setShowCheckerboard(!showCheckerboard);
      }
      if (itemId === 'theme') {
        toggleTheme();
      }
    }

    if (groupId === 'help') {
      if (itemId === 'docs') {
        void openLink(REPOSITORY_URL);
      }
      if (itemId === 'issue') {
        void openLink(`${REPOSITORY_URL}/issues`);
      }
      if (itemId === 'licence') {
        void openLink(LICENCE_URL);
      }
      if (itemId === 'about') {
        // The shell's version rather than the engine's: this is the
        // application the user installed, and the engine reports its own on
        // the settings screen.
        void appVersion().then(
          (result) => {
            notify({
              severity: 'info',
              titleKey: 'common:app.name',
              messageKey: 'common:menu.aboutBody',
              values: { version: result.ok ? result.value : '' },
            });
          },
          () => {
            notify({ severity: 'warning', messageKey: 'errors:unknown' });
          },
        );
      }
    }
  };

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={() => {
        void toggleMaximize();
      }}
      className="flex h-titlebar shrink-0 select-none items-center gap-3 pe-3"
      style={{ paddingInlineStart: 'calc(var(--titlebar-inset-start) + var(--space-3))' }}
    >
      <div data-tauri-drag-region className="flex shrink-0 items-center gap-2">
        {/* Two ways of reaching a command, so they are one group: the menu
            lists them, the search finds them. Navigation through what has
            already been seen is a different kind of thing and gets a group of
            its own after this one.

            A flex container rather than a bare block, so that the tooltip's
            inline-flex wrapper does not sit on a text baseline and leave
            descender space under the button, which would push it out of line
            with the controls beside it. */}
        <div className="no-drag flex items-center gap-1">
          <Tooltip label={t('menu.label')}>
            <Menu groups={groups} label={t('menu.label')} onSelect={onMenuSelect}>
              <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true" fill="none">
                <path
                  d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </Menu>
          </Tooltip>

          {/* The palette is reached through its store rather than a hook, so
              that the title bar does not re-render every time it opens or
              closes. Nothing here depends on whether it is showing. */}
          <Tooltip label={t('menu.search')}>
            <IconButton
              label={t('menu.search')}
              onClick={() => {
                useCommandPaletteStore.getState().setOpen(true);
              }}
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true" fill="none">
                <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.4" />
                <path
                  d="M10.1 10.1L13.5 13.5"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </IconButton>
          </Tooltip>
        </div>

        {/* Baseline aligned rather than centre aligned. The name and the
            tagline are different sizes, so centring each on its own line box
            leaves the larger one sitting lower than everything beside it. */}
        <div data-tauri-drag-region className="flex items-baseline gap-2 ps-1">
          <span
            data-tauri-drag-region
            // A step up from text-base, which cleared about eleven pixels
            // against a thirty-six pixel button and read as a caption placed
            // next to the controls rather than as the application's name.
            // Matching that button outright would take a fifty pixel face,
            // which fills a fifty-two pixel bar edge to edge.
            className="text-xl font-semibold uppercase leading-none tracking-wide text-fg-primary"
          >
            {t('app.name')}
          </span>
          <span
            data-tauri-drag-region
            className="hidden text-sm leading-none text-fg-secondary lg:inline"
          >
            {t('app.tagline')}
          </span>
        </div>
      </div>

      <div data-tauri-drag-region className="flex flex-1 justify-center">
        <div className="no-drag">
          <SegmentedTabs
            label={t('app.name')}
            value={screen}
            segments={SCREENS.map((item) => ({ value: item, label: t(`nav.${item}`) }))}
            onValueChange={(value) => {
              setScreen(value as Screen);
            }}
          />
        </div>
      </div>

      <div data-tauri-drag-region className="flex shrink-0 items-center gap-2">
        <div className="no-drag flex items-center gap-1">
          <Tooltip label={t('theme.toggle')}>
            <IconButton
              label={t('theme.toggle')}
              onClick={() => {
                toggleTheme();
              }}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </IconButton>
          </Tooltip>

          {/* A gap, because these are not the same kind of control: the one
              before acts on the application and the three after act on the
              window. An evenly spaced run put the theme toggle one slot from
              close, which is a misfire waiting to happen. */}
          {!systemControls && (
            <>
              <span aria-hidden="true" className="w-2" />
              <Tooltip label={t('window.minimize')}>
                <IconButton label={t('window.minimize')} onClick={() => void minimize()}>
                  <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
                    <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
                  </svg>
                </IconButton>
              </Tooltip>

              <Tooltip label={maximized ? t('window.restore') : t('window.maximize')}>
                <IconButton
                  label={maximized ? t('window.restore') : t('window.maximize')}
                  onClick={() => void toggleMaximize()}
                >
                  <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
                    <rect
                      x="0.5"
                      y="0.5"
                      width="9"
                      height="9"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1"
                    />
                  </svg>
                </IconButton>
              </Tooltip>

              <Tooltip label={t('window.close')}>
                <IconButton label={t('window.close')} danger onClick={() => void close()}>
                  <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
                    <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
                  </svg>
                </IconButton>
              </Tooltip>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/** Shown while the dark theme is active, because it switches to light. */
function SunIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true" fill="none">
      <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M12.8 3.2l-1.4 1.4M4.6 11.4l-1.4 1.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Shown while the light theme is active, because it switches to dark. */
function MoonIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true" fill="none">
      <path
        d="M13.5 9.5A5.8 5.8 0 0 1 6.5 2.5a5.8 5.8 0 1 0 7 7Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
