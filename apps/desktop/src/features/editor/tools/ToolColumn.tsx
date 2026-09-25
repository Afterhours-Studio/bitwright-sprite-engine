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
 * The editor's left column: every tool, the shape fill toggle and mirror
 * symmetry (docs/architecture/studio-layout.md, "Tools column").
 *
 * It only sets editor state. Nothing here writes to a document, which is what
 * lets it sit permanently beside the canvas: a mis-click chooses a different
 * tool, it never changes a pixel.
 */

import {
  Circle,
  Eraser,
  Grid3x3,
  Hand,
  Minus,
  Moon,
  Move,
  PaintBucket,
  Paintbrush,
  Pipette,
  Plus,
  Spline,
  Square,
  SquareDashed,
  SquareSplitHorizontal,
  SquareSplitVertical,
  Sun,
  WandSparkles,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import {
  SYMMETRIES,
  TOOLS,
  TOOL_KEYS,
  useEditorStore,
  type Symmetry,
  type Tool,
} from '@/stores/useEditorStore';

/** The icon each tool is drawn with, as the layout names them. */
const TOOL_ICONS: Readonly<Record<Tool, LucideIcon>> = {
  pencil: Paintbrush,
  eraser: Eraser,
  fill: PaintBucket,
  eyedropper: Pipette,
  select: SquareDashed,
  wand: WandSparkles,
  move: Move,
  pan: Hand,
  zoom: ZoomIn,
  line: Minus,
  curve: Spline,
  rectangle: Square,
  ellipse: Circle,
  dither: Grid3x3,
  lighten: Sun,
  darken: Moon,
};

/**
 * The icon for each symmetry.
 *
 * Horizontal mirroring reflects across a vertical line, which is why it takes
 * the vertically split square; "off" has no picture, only its word.
 */
const SYMMETRY_ICONS: Readonly<Record<Symmetry, LucideIcon | null>> = {
  off: null,
  horizontal: SquareSplitVertical,
  vertical: SquareSplitHorizontal,
  both: Plus,
};

/**
 * The shape tools that can be filled. A line or a curve has no inside, so
 * offering "Fill" there would be a switch that does nothing.
 */
const FILLABLE: ReadonlySet<Tool> = new Set<Tool>(['rectangle', 'ellipse']);

/** The small toggle style shared by the fill switch and the symmetry buttons. */
function toggleClass(on: boolean): string {
  return cn(
    'py-1 px-1.5 text-[11px] rounded border flex items-center justify-center gap-1',
    on
      ? 'bg-sky-500/15 text-sky-300 border-sky-500/60'
      : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-neutral-200',
  );
}

/** Props for {@link ToolColumn}. */
export interface ToolColumnProps {
  /** Extra classes for the `aside`, for the screen that places it. */
  className?: string;
}

/**
 * The tools column. Fills the height it is given and scrolls on its own when
 * the window is too short for the whole list.
 */
export function ToolColumn({ className }: ToolColumnProps): ReactElement {
  const { t } = useTranslation('tools');
  const tool = useEditorStore((state) => state.tool);
  const setTool = useEditorStore((state) => state.setTool);
  const shapeFill = useEditorStore((state) => state.shapeFill);
  const setShapeFill = useEditorStore((state) => state.setShapeFill);
  const symmetry = useEditorStore((state) => state.symmetry);
  const setSymmetry = useEditorStore((state) => state.setSymmetry);

  return (
    <aside
      className={cn(
        'w-64 bg-neutral-950 border-r border-neutral-800 flex flex-col h-full shrink-0 overflow-y-auto',
        className,
      )}
    >
      <div className="p-3 border-b border-neutral-800/80 bg-neutral-900/40 flex justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          {t('title')}
        </span>
        <span className="text-[10px] text-neutral-500">{t('shortcuts')}</span>
      </div>

      <div className="p-2 space-y-1" role="group" aria-label={t('listLabel')}>
        {TOOLS.map((entry) => {
          const Icon = TOOL_ICONS[entry];
          const active = entry === tool;
          const name = t(`tool.${entry}.name`);
          const hint = t(`tool.${entry}.hint`);
          const key = TOOL_KEYS[entry];
          return (
            <button
              key={entry}
              type="button"
              aria-pressed={active}
              aria-label={name}
              aria-keyshortcuts={key}
              // The hint is truncated in the row; the native tooltip is the
              // one that fits a full-width row, since the shared Tooltip's
              // inline wrapper would shrink the row to its content.
              title={`${hint} (${t('keyHint', { key })})`}
              onClick={() => {
                setTool(entry);
              }}
              className={cn(
                'w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left',
                active
                  ? 'bg-pink-600 hover:bg-pink-500 border border-pink-500 text-white shadow-md shadow-pink-600/20 font-semibold'
                  : 'text-neutral-300 hover:text-neutral-50 hover:bg-neutral-900/80 bg-neutral-900/20',
              )}
            >
              <span className="flex items-center gap-2 min-w-0">
                <Icon
                  aria-hidden
                  className={cn('w-4 h-4 shrink-0', !active && 'text-neutral-400')}
                />
                <span className="flex flex-col min-w-0">
                  <span className="text-xs leading-tight">{name}</span>
                  <span
                    className={cn(
                      'text-[9px] leading-tight truncate',
                      active ? 'text-pink-200' : 'text-neutral-500',
                    )}
                  >
                    {hint}
                  </span>
                </span>
              </span>
              <kbd
                className={cn(
                  'kbd ml-1 px-1.5 py-0.5 text-[10px] rounded',
                  active
                    ? 'bg-pink-700/80 text-white border border-pink-400/40'
                    : 'bg-neutral-800 text-neutral-400 border border-neutral-700',
                )}
              >
                {key}
              </kbd>
            </button>
          );
        })}
      </div>

      {FILLABLE.has(tool) && (
        <div className="px-2 pb-2">
          <button
            type="button"
            aria-pressed={shapeFill}
            onClick={() => {
              setShapeFill(!shapeFill);
            }}
            className={cn(toggleClass(shapeFill), 'w-full justify-between px-2.5')}
          >
            <span className="font-semibold">{t('fill.label')}</span>
            <span>{shapeFill ? t('fill.on') : t('fill.off')}</span>
          </button>
        </div>
      )}

      <div className="h-px bg-neutral-800/80 mx-2.5 my-1" />

      <div className="p-2 space-y-1.5 pb-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-neutral-300">{t('symmetry.label')}</span>
          <span className="text-[11px] text-sky-400">{t(`symmetry.${symmetry}`)}</span>
        </div>
        <div className="grid grid-cols-2 gap-1" role="group" aria-label={t('symmetry.label')}>
          {SYMMETRIES.map((entry) => {
            const Icon = SYMMETRY_ICONS[entry];
            const on = entry === symmetry;
            return (
              <button
                key={entry}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setSymmetry(entry);
                }}
                className={toggleClass(on)}
              >
                {Icon && <Icon aria-hidden className="w-3 h-3" />}
                <span>{t(`symmetry.${entry}`)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
