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

/**
 * The editor's header: where the sprite is named, where the view is chosen,
 * and where the window is dragged from.
 *
 * DRAGGING. The bar carries `data-tauri-drag-region` and each control opts
 * out with `no-drag` on itself, not on the groups around it, so the gaps
 * between controls still move the window the way an empty stretch of any
 * title bar does. A container marked no-drag would be dead space: the
 * window could not be dragged from the gaps inside it.
 *
 * NOTHING OPEN, NOTHING TO ACT ON. Every control that acts on the sprite is
 * disabled while no asset is open; the ones that move around the application
 * (home, new, settings, the agent, notifications) stay live, because they
 * are how one gets to a sprite in the first place.
 *
 * UNDO IS OFFERED WHENEVER A SPRITE IS OPEN. The op log and its cursor live in
 * SQLite and the store does not mirror whether there is anything left to
 * undo, so the only honest state for the button is "a document is open". A
 * press at the boundary comes back as a refusal and is reported like one.
 */

import {
  Bell,
  BrushCleaning,
  Download,
  Film,
  Grid3x3,
  House,
  ImageUp,
  Layers,
  ListChecks,
  Plus,
  Redo2,
  Settings,
  Undo2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { WindowControls } from '@/components/layout/WindowControls';
import { Dialog } from '@/components/ui/Dialog';
import { NotificationList } from '@/components/ui/NotificationList';
import { paintTarget } from '@/features/editor/activeLayer';
import { ExportDialog } from '@/features/editor/export/ExportDialog';
import { AgentPopover } from '@/features/editor/header/AgentPopover';
import { ReferencePanel } from '@/features/editor/reference/ReferencePanel';
import { useDismiss } from '@/hooks/useDismiss';
import { useToastAnchor } from '@/hooks/useToastAnchor';
import { cn } from '@/lib/cn';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { TILE_GUIDES, useEditorStore, type TileGuide } from '@/stores/useEditorStore';
import { useAnimationStore } from '@/stores/useAnimationStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useShellStore } from '@/stores/useShellStore';
import { useToastStore } from '@/stores/useToastStore';
import { STEPS } from '@/types/document';

/** An icon button in the middle group, idle. */
const ICON_IDLE = 'no-drag p-1.5 rounded border border-neutral-800 bg-neutral-900 text-neutral-400';

/** An icon button in the middle group, with nothing to act on. */
const ICON_DISABLED =
  'no-drag p-1.5 rounded border bg-neutral-900/40 text-neutral-600 border-neutral-800/40 cursor-not-allowed';

/** An icon button in the middle group, switched on. */
const ICON_ON = 'no-drag p-1.5 rounded border bg-sky-600 text-white border-sky-400';

/** A text toggle, on. */
const TOGGLE_ON =
  'no-drag flex items-center space-x-1.5 px-2.5 py-1.5 text-xs font-medium rounded border bg-neutral-800 text-neutral-200 border-neutral-700';

/** A text toggle, off. */
const TOGGLE_OFF =
  'no-drag flex items-center space-x-1.5 px-2.5 py-1.5 text-xs font-medium rounded border bg-neutral-900 text-neutral-500 border-neutral-800';

/** The small vertical rule between groups of controls. */
function Divider(): ReactElement {
  return <div aria-hidden="true" className="h-4 w-px bg-neutral-800" />;
}

/**
 * Whether a key press belongs to a text field, where Ctrl+Z is the field's
 * own undo and must not reach the document.
 *
 * @param target - Where the event was dispatched.
 * @returns True for inputs, text areas, selects and editable content.
 */
function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

interface IconButtonProps {
  label: string;
  disabled?: boolean;
  /** Whether a toggle is on. Left out for a button that is not a toggle. */
  on?: boolean;
  /** Extra hover classes for the idle state only. */
  hover?: string;
  onClick: () => void;
  children: ReactNode;
}

/** One of the middle group's square buttons. */
function HeaderIconButton({
  label,
  disabled = false,
  on,
  hover = 'hover:text-neutral-100 hover:bg-neutral-800',
  onClick,
  children,
}: IconButtonProps): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-pressed={on}
      className={disabled ? ICON_DISABLED : on === true ? ICON_ON : cn(ICON_IDLE, hover)}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * The sprite's name, editable in place, and its size beside it.
 *
 * The draft commits on Enter or on leaving the field, and Escape puts the
 * stored name back. Enter only blurs; the blur is what commits, so the two
 * routes cannot both send the same rename.
 */
function NameBox(): ReactElement {
  const { t } = useTranslation('studio');
  const asset = useDocumentStore((state) => state.asset);
  // The project store is the one a rename updates, so its row wins over the
  // copy the document store took when the sprite was opened.
  const listed = useProjectStore((state) =>
    asset === null ? undefined : state.assets.find((candidate) => candidate.id === asset.id),
  );
  const renameAsset = useProjectStore((state) => state.renameAsset);

  const name = listed?.name ?? asset?.name ?? '';
  const [draft, setDraft] = useState(name);
  const reverting = useRef(false);

  useEffect(() => {
    setDraft(name);
  }, [asset?.id, name]);

  const commit = (): void => {
    if (reverting.current) {
      reverting.current = false;
      return;
    }
    const next = draft.trim();
    if (asset === null || next === '' || next === name) {
      setDraft(name);
      return;
    }
    void renameAsset(asset.id, next);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      reverting.current = true;
      setDraft(name);
      event.currentTarget.blur();
    }
  };

  return (
    <div className="no-drag flex items-center space-x-2 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 px-2.5 py-1 rounded">
      <input
        type="text"
        aria-label={t('header.nameLabel')}
        placeholder={t('header.noSprite')}
        disabled={asset === null}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className="bg-transparent text-sm font-medium text-neutral-200 w-44 outline-none placeholder:text-neutral-600"
      />
      {asset !== null && (
        <span className="text-[10px] text-pink-400 bg-neutral-800 px-2 py-0.5 rounded border border-neutral-700/60 whitespace-nowrap">
          {t('header.size', { width: asset.width, height: asset.height })}
        </span>
      )}
    </div>
  );
}

/**
 * The bell, its unread count, and the list of everything raised this session.
 *
 * The bell is the toast anchor: new toasts grow out of it, so it is the only
 * element `useToastAnchor` is attached to.
 */
function Notifications(): ReactElement {
  const { t } = useTranslation();
  const unread = useToastStore((state) => state.unread);
  const markRead = useToastStore((state) => state.markRead);
  const anchor = useToastAnchor();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => {
    setOpen(false);
  }, []);
  useDismiss(open, root, dismiss);

  // The count is part of the name, not only the badge: a badge reading "3"
  // is a shape with a number in it to anything that cannot see it.
  const label =
    unread > 0
      ? `${t('notifications.label')}, ${t('notifications.unread', { count: unread })}`
      : t('notifications.label');

  return (
    <div ref={root} className="relative no-drag">
      <button
        ref={anchor}
        type="button"
        aria-label={label}
        title={t('notifications.label')}
        aria-expanded={open}
        className="relative p-1.5 rounded text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800"
        onClick={() => {
          if (!open) {
            markRead();
          }
          setOpen(!open);
        }}
      >
        <Bell aria-hidden="true" className="w-4 h-4" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-pink-600 px-1 text-[10px] font-semibold leading-none text-white"
          >
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('notifications.title')}
          className="absolute right-0 top-full mt-2 z-50 w-80 bg-neutral-950/90 backdrop-blur border border-neutral-800 rounded shadow-md p-1"
        >
          <NotificationList />
        </div>
      )}
    </div>
  );
}

/**
 * The editor's header bar.
 *
 * Takes no props: everything it shows and does is the open document, the
 * editor's view settings and the shell's screen, all read from their stores.
 *
 * @returns The `h-14` header, filling the width it is given.
 */
export function StudioHeader(): ReactElement {
  const { t } = useTranslation('studio');

  const setScreen = useShellStore((state) => state.setScreen);
  const setNewSpriteOpen = useShellStore((state) => state.setNewSpriteOpen);

  const assetId = useDocumentStore((state) => state.assetId);
  const asset = useDocumentStore((state) => state.asset);
  const layers = useDocumentStore((state) => state.layers);
  const stepState = useDocumentStore((state) => state.step);
  const undo = useDocumentStore((state) => state.undo);
  const redo = useDocumentStore((state) => state.redo);
  const write = useDocumentStore((state) => state.write);

  const targetRole = useEditorStore((state) => state.targetRole);
  const showPixelGrid = useEditorStore((state) => state.showPixelGrid);
  const setShowPixelGrid = useEditorStore((state) => state.setShowPixelGrid);
  const tileGuide = useEditorStore((state) => state.tileGuide);
  const setTileGuide = useEditorStore((state) => state.setTileGuide);
  const showLayersPanel = useEditorStore((state) => state.showLayersPanel);
  const setShowLayersPanel = useEditorStore((state) => state.setShowLayersPanel);
  const bottomPanel = useEditorStore((state) => state.bottomPanel);
  const setBottomPanel = useEditorStore((state) => state.setBottomPanel);
  // A lone sprite is an animation of one frame, and one that has not been
  // read yet is counted the same way rather than as none.
  const frameCount = useAnimationStore((state) => state.animation?.frames.length ?? 1);

  /**
   * Presses a bottom panel toggle: the one showing hides, the other takes the
   * slot, because both live in the one strip under the stage.
   *
   * @param panel - The toggle pressed.
   */
  const toggleBottomPanel = (panel: 'timeline' | 'steps'): void => {
    setBottomPanel(bottomPanel === panel ? null : panel);
  };

  const [referenceOpen, setReferenceOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // Both dialogs close the moment the open asset changes, rather than being
  // silently retargeted at whatever is open next.
  useEffect(() => {
    setExportOpen(false);
    setReferenceOpen(false);
  }, [assetId]);

  const hasAsset = assetId !== null;
  const step = stepState?.step ?? asset?.step ?? null;
  const stepNumber = step === null ? 0 : STEPS.indexOf(step) + 1;

  // The same layer the next stroke would write to, so Clear empties what the
  // pencil would draw on and nothing else. A layer that does not exist yet or
  // is locked cannot be cleared, and the button says so by being disabled.
  const target = paintTarget(step, targetRole, layers);
  const clearable = hasAsset && target.refusal === 'ready' && target.role !== null;

  useEffect(() => {
    if (!hasAsset) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || inTextField(event.target)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        void undo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        void redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [hasAsset, undo, redo]);

  const dismissReference = useCallback(() => {
    setReferenceOpen(false);
  }, []);

  return (
    <header
      data-tauri-drag-region
      className="h-14 bg-neutral-950 border-b border-neutral-800 px-4 flex items-center justify-between shrink-0"
    >
      <div data-tauri-drag-region className="flex items-center space-x-3">
        <button
          type="button"
          aria-label={t('header.home')}
          title={t('header.home')}
          className="no-drag p-1.5 rounded bg-pink-600 hover:bg-pink-500 border border-pink-500 text-white shadow-md shadow-pink-600/20"
          onClick={() => {
            setScreen('home');
          }}
        >
          <House aria-hidden="true" className="w-4 h-4" />
        </button>
        <Divider />
        <span
          data-tauri-drag-region
          className="font-semibold text-sm tracking-tight text-neutral-200"
        >
          {t('title')}
        </span>
        <NameBox />
      </div>

      <div data-tauri-drag-region className="flex items-center space-x-1.5">
        <HeaderIconButton label={t('header.undo')} disabled={!hasAsset} onClick={() => void undo()}>
          <Undo2 aria-hidden="true" className="w-4 h-4" />
        </HeaderIconButton>
        <HeaderIconButton label={t('header.redo')} disabled={!hasAsset} onClick={() => void redo()}>
          <Redo2 aria-hidden="true" className="w-4 h-4" />
        </HeaderIconButton>
        <HeaderIconButton
          label={t('header.clear')}
          disabled={!clearable}
          hover="hover:text-red-400 hover:bg-red-950/40 hover:border-red-800/60"
          onClick={() => {
            if (target.role !== null) {
              void write([{ kind: 'clear', layer: target.role }]);
            }
          }}
        >
          <BrushCleaning aria-hidden="true" className="w-4 h-4" />
        </HeaderIconButton>
        <Divider />
        <HeaderIconButton
          label={t('header.pixelGrid')}
          on={showPixelGrid}
          onClick={() => {
            setShowPixelGrid(!showPixelGrid);
          }}
        >
          <Grid3x3 aria-hidden="true" className="w-4 h-4" />
        </HeaderIconButton>
        <select
          aria-label={t('header.tileGuide')}
          value={tileGuide}
          onChange={(event) => {
            setTileGuide(Number(event.target.value) as TileGuide);
          }}
          className="no-drag w-20 rounded px-2 py-1.5 bg-neutral-800 border border-neutral-700 text-xs text-neutral-200"
        >
          {TILE_GUIDES.map((size) => (
            <option key={size} value={size}>
              {size === 0 ? t('header.tileOff') : t('header.tileSize', { size })}
            </option>
          ))}
        </select>
        <Divider />
        <button
          type="button"
          aria-pressed={showLayersPanel}
          title={t('header.layersHint')}
          className={showLayersPanel ? TOGGLE_ON : TOGGLE_OFF}
          onClick={() => {
            setShowLayersPanel(!showLayersPanel);
          }}
        >
          <Layers aria-hidden="true" className="w-3.5 h-3.5" />
          <span>{t('header.layers')}</span>
        </button>
        <button
          type="button"
          aria-pressed={bottomPanel === 'timeline'}
          title={t('header.timelineHint')}
          className={bottomPanel === 'timeline' ? TOGGLE_ON : TOGGLE_OFF}
          onClick={() => {
            toggleBottomPanel('timeline');
          }}
        >
          <Film aria-hidden="true" className="w-3.5 h-3.5" />
          <span>{t('header.timeline', { frames: frameCount })}</span>
        </button>
        <button
          type="button"
          aria-pressed={bottomPanel === 'steps'}
          title={t('header.stepsHint')}
          className={bottomPanel === 'steps' ? TOGGLE_ON : TOGGLE_OFF}
          onClick={() => {
            toggleBottomPanel('steps');
          }}
        >
          <ListChecks aria-hidden="true" className="w-3.5 h-3.5" />
          <span>{t('header.steps', { current: stepNumber, total: STEPS.length })}</span>
        </button>
        <AgentPopover />
      </div>

      <div data-tauri-drag-region className="flex items-center space-x-2">
        <button
          type="button"
          title={t('header.newHint')}
          className="no-drag flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800"
          onClick={() => {
            setNewSpriteOpen(true);
          }}
        >
          <Plus aria-hidden="true" className="w-3.5 h-3.5" />
          <span>{t('header.new')}</span>
        </button>
        <button
          type="button"
          disabled={!hasAsset}
          className={cn(
            'no-drag flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs border',
            hasAsset
              ? 'bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border-neutral-800'
              : 'bg-neutral-900/40 text-neutral-600 border-neutral-800/40 cursor-not-allowed',
          )}
          onClick={() => {
            setReferenceOpen(true);
          }}
        >
          <ImageUp
            aria-hidden="true"
            className={cn('w-3.5 h-3.5', hasAsset ? 'text-sky-400' : 'text-neutral-600')}
          />
          <span>{t('header.reference')}</span>
        </button>
        <button
          type="button"
          disabled={!hasAsset}
          className={cn(
            'no-drag flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-semibold',
            hasAsset
              ? 'bg-sky-600 hover:bg-sky-500 border border-sky-400 text-white shadow-md shadow-sky-600/30'
              : 'bg-neutral-900/40 text-neutral-600 border border-neutral-800/40 cursor-not-allowed',
          )}
          onClick={() => {
            setExportOpen(true);
          }}
        >
          <Download aria-hidden="true" className="w-3.5 h-3.5" />
          <span>{t('header.export')}</span>
        </button>
        <Notifications />
        <button
          type="button"
          aria-label={t('header.settings')}
          title={t('header.settings')}
          className="no-drag p-2 rounded-full bg-gradient-to-tr from-pink-600 to-purple-600 text-white"
          onClick={() => {
            setScreen('settings');
          }}
        >
          <Settings aria-hidden="true" className="w-3.5 h-3.5" />
        </button>
        <WindowControls />
      </div>

      <Dialog
        open={referenceOpen}
        title={t('header.referenceTitle')}
        confirmLabel={t('header.referenceDone')}
        onDismiss={dismissReference}
        onConfirm={dismissReference}
        asForm={false}
        size="lg"
        icon={<ImageUp aria-hidden="true" className="w-5 h-5" />}
      >
        {/* Mounted only while showing: the panel reads the asset's references
            on mount, and there is no reason to fetch them behind a closed
            dialog. */}
        {referenceOpen && hasAsset && <ReferencePanel />}
      </Dialog>

      {assetId !== null && exportOpen && (
        <ExportDialog
          key={assetId}
          assetId={assetId}
          open
          onClose={() => {
            setExportOpen(false);
          }}
        />
      )}
    </header>
  );
}
