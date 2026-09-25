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

/**
 * The small toggle style shared by the fill switch and the symmetry buttons.
 *
 * A toggle that is on reads as pressed - a lifted surface, the primary text
 * and a stronger edge - rather than taking the accent, which belongs to the
 * one current tool.
 */
function toggleClass(
  on: boolean,
  off = 'bg-transparent border-transparent hover:bg-surface-content-alt',
): string {
  return cn(
    'py-1 px-1.5 text-[11px] rounded-sm border flex items-center justify-center gap-1 transition-colors',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-line-focus',
    on
      ? 'bg-surface-content-alt text-fg-primary border-line-strong font-medium'
      : cn('text-fg-secondary hover:text-fg-primary', off),
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
        'w-64 bg-surface-canvas border-r border-line-subtle flex flex-col h-full shrink-0 overflow-y-auto',
        className,
      )}
    >
      <div className="p-3 border-b border-line-subtle flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-secondary">
          {t('title')}
        </span>
        <span className="text-[11px] text-fg-secondary">{t('shortcuts')}</span>
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
                'w-full flex items-center justify-between px-2.5 py-1.5 rounded-md border text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-line-focus',
                active
                  ? 'bg-accent hover:bg-accent-hover border-accent text-accent-fg shadow-sm font-semibold'
                  : 'border-transparent text-fg-primary hover:bg-surface-content-alt',
              )}
            >
              <span className="flex items-center gap-2 min-w-0">
                <Icon
                  aria-hidden
                  strokeWidth={1.75}
                  className={cn('w-4 h-4 shrink-0', !active && 'text-fg-secondary')}
                />
                <span className="flex flex-col min-w-0">
                  <span className="text-xs leading-tight">{name}</span>
                  <span
                    className={cn(
                      'text-[11px] leading-tight truncate',
                      active ? 'text-accent-fg' : 'text-fg-secondary',
                    )}
                  >
                    {hint}
                  </span>
                </span>
              </span>
              <kbd
                className={cn(
                  'ml-1 min-w-[1.25rem] px-1.5 py-0.5 text-center font-mono text-[11px] leading-none rounded-sm border',
                  active
                    ? 'bg-accent-hover text-accent-fg border-transparent'
                    : 'bg-surface-content text-fg-secondary border-line-subtle',
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
            className={cn(
              toggleClass(
                shapeFill,
                'bg-surface-content border-line-subtle hover:bg-surface-content-alt',
              ),
              'w-full justify-between px-2.5',
            )}
          >
            <span className="font-semibold">{t('fill.label')}</span>
            <span>{shapeFill ? t('fill.on') : t('fill.off')}</span>
          </button>
        </div>
      )}

      <div className="h-px bg-line-subtle mx-2.5 my-1" />

      <div className="p-2 space-y-1.5 pb-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-fg-primary">{t('symmetry.label')}</span>
          <span className="text-[11px] text-fg-secondary">{t(`symmetry.${symmetry}`)}</span>
        </div>
        <div
          className="grid grid-cols-2 gap-0.5 rounded-md border border-line-subtle bg-surface-content p-0.5"
          role="group"
          aria-label={t('symmetry.label')}
        >
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
                {Icon && <Icon aria-hidden strokeWidth={1.75} className="w-3 h-3" />}
                <span>{t(`symmetry.${entry}`)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
