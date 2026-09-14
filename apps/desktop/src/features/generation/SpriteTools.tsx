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
 * The second column of the canvas: what to do to the sprite in front of you.
 *
 * Two tabs, because the two things a person does here are different in kind.
 * Adjust corrects what the model got wrong - a diffusion model produces an
 * image that looks like pixel art without being it, with drifting cell
 * boundaries, anti-aliased edges and hundreds of nearly identical colours.
 * Colour is for painting, and its palette is the one the sprite actually uses,
 * which is only a palette at all once Adjust has made it one.
 *
 * Both act on the sprite that exists, never on the request. Nothing here
 * regenerates anything.
 *
 * History sits above both tabs rather than inside either, because taking a
 * stroke back is not a colour decision or a correction: it belongs to the
 * sprite, which is what this whole column is about. It is beside the sprite
 * rather than in the dock because of the dock's own rule - nothing in there
 * acts on its own press - and an undo that opened a popover first would be
 * absurd. The Edit menu carries the same two actions with their accelerators,
 * which is where a person who already knows them will look; this is where a
 * person who is painting is looking.
 */

import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { NumberField } from '@/components/ui/NumberField';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Field';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { cn } from '@/lib/cn';
import { canRedo, canUndo, useCanvasStore } from '@/stores/useCanvasStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { useGenerationStore } from '@/stores/useGenerationStore';
import { DITHER_MODES, type DitherMode } from '@/types/engine';

/** Which tab is showing. */
type Tab = 'adjust' | 'colour';

/** How much of a cell has to be subject before that cell is drawn at all. */
const ALPHA_STEP = 0.05;

/**
 * The tabs and their contents.
 *
 * @param props.selected - Which sprite of a batch is being looked at. Passed
 *   rather than read from a store, because the selection belongs to the screen
 *   that draws the stage, and two copies of it would drift apart.
 * @returns The tool column.
 */
export function SpriteTools({ selected }: { selected: number }): ReactElement {
  const { t } = useTranslation('generation');
  const translateWarning = useErrorMessage();
  const [tab, setTab] = useState<Tab>('adjust');

  const images = useGenerationStore((state) => state.images);
  const conform = useGenerationStore((state) => state.conform);
  const conforming = useGenerationStore((state) => state.conforming);
  const palette = useGenerationStore((state) => state.palette);
  const detected = useGenerationStore((state) => state.detected);
  const warnings = useGenerationStore((state) => state.conformWarnings);
  const request = useGenerationStore((state) => state.request);

  const colour = useEditorStore((state) => state.colour);
  const setColour = useEditorStore((state) => state.setColour);

  const undoable = useCanvasStore(canUndo);
  const redoable = useCanvasStore(canRedo);
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);

  const [removeBackground, setRemoveBackground] = useState(true);
  // Seeded from the size that was asked for, because that is the answer almost
  // every time. Emptying a field hands the decision back to the engine, which
  // measures the grid the model actually drew rather than the one it was told
  // to draw.
  const [width, setWidth] = useState<number | null>(request.width);
  const [height, setHeight] = useState<number | null>(request.height);
  const [paletteSize, setPaletteSize] = useState<number | null>(32);
  const [dither, setDither] = useState<DitherMode>('none');
  const [alphaThreshold, setAlphaThreshold] = useState(0.5);

  const image = images[selected];
  const ready = image !== undefined && !conforming;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <SegmentedTabs
        label={t('tools.label')}
        value={tab}
        segments={[
          { value: 'adjust', label: t('tools.adjust') },
          { value: 'colour', label: t('tools.colour') },
        ]}
        onValueChange={(value) => {
          setTab(value as Tab);
        }}
      />

      {image !== undefined && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-fg-secondary">{t('tools.history')}</span>
          <div className="flex gap-1.5">
            <IconButton
              label={t('tools.undo')}
              disabled={!undoable}
              className="h-7 w-7"
              onClick={undo}
            >
              <UndoIcon />
            </IconButton>
            <IconButton
              label={t('tools.redo')}
              disabled={!redoable}
              className="h-7 w-7"
              onClick={redo}
            >
              <RedoIcon />
            </IconButton>
          </div>
        </div>
      )}

      {image === undefined ? (
        // Stated rather than shown as disabled controls: there is nothing to
        // adjust and nothing to take a palette from until a sprite exists.
        <p className="text-xs text-fg-secondary">{t('tools.empty')}</p>
      ) : tab === 'adjust' ? (
        <div className="flex min-h-0 flex-col gap-3 overflow-auto">
          <p className="text-xs text-fg-secondary">{t('tools.adjustHint')}</p>

          <Toggle
            label={t('postprocess.removeBackground')}
            checked={removeBackground}
            onCheckedChange={setRemoveBackground}
          />

          <div className="grid grid-cols-2 gap-2">
            <NumberField
              clearable
              label={t('tools.targetWidth')}
              value={width}
              min={1}
              max={1024}
              onValueChange={setWidth}
            />
            <NumberField
              clearable
              label={t('tools.targetHeight')}
              value={height}
              min={1}
              max={1024}
              onValueChange={setHeight}
            />
          </div>
          <p className="text-xs text-fg-secondary">{t('tools.targetHint')}</p>

          <NumberField
            clearable
            label={t('postprocess.paletteSize')}
            value={paletteSize}
            min={2}
            max={256}
            onValueChange={setPaletteSize}
          />

          <Select
            label={t('tools.dither')}
            value={dither}
            options={DITHER_MODES.map((mode) => ({
              value: mode,
              label: t(`tools.dithers.${mode}`),
            }))}
            hint={t('tools.ditherHint')}
            onValueChange={(value) => {
              setDither(value as DitherMode);
            }}
          />

          <NumberField
            mode="decimal"
            label={t('tools.alphaThreshold')}
            value={alphaThreshold}
            min={ALPHA_STEP}
            max={1 - ALPHA_STEP}
            step={ALPHA_STEP}
            hint={t('tools.alphaThresholdHint')}
            onValueChange={setAlphaThreshold}
          />

          <Button
            variant="primary"
            className="px-3 py-1 text-xs"
            disabled={!ready}
            onClick={() => {
              void conform(selected, {
                width,
                height,
                removeBackground,
                backgroundTolerance: request.postprocess.backgroundTolerance,
                paletteSize,
                dither,
                alphaThreshold,
              });
            }}
          >
            {conforming ? t('tools.conforming') : t('tools.conform')}
          </Button>

          {detected !== null && (
            // The measurement, not a setting. It is the only thing that says
            // whether there was a grid to find: a confidence near zero means
            // the render was never pixel art and this was a resize.
            <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-fg-secondary">
              <dt>{t('tools.detectedCell')}</dt>
              <dd className="tabular-nums">
                {t('tools.detectedCellValue', {
                  width: detected.cellWidth.toFixed(2),
                  height: detected.cellHeight.toFixed(2),
                })}
              </dd>
              <dt>{t('tools.detectedPhase')}</dt>
              <dd className="tabular-nums">
                {t('tools.detectedPhaseValue', {
                  x: detected.phaseX.toFixed(2),
                  y: detected.phaseY.toFixed(2),
                })}
              </dd>
              <dt>{t('tools.detectedConfidence')}</dt>
              <dd className="tabular-nums">
                {t('tools.detectedConfidenceValue', {
                  percent: Math.round(detected.confidence * 100),
                })}
              </dd>
            </dl>
          )}

          {warnings.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-fg-secondary">
              {warnings.map((code) => (
                <li key={code}>{translateWarning(code)}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-col gap-3 overflow-auto">
          {palette.length === 0 ? (
            // A palette is what Adjust produces. Before that the sprite has
            // hundreds of nearly identical colours, which is a gradient rather
            // than something to paint from.
            <p className="text-xs text-fg-secondary">{t('tools.noPalette')}</p>
          ) : (
            <>
              <p className="text-xs text-fg-secondary">{t('tools.paletteHint')}</p>
              <ul className="grid grid-cols-6 gap-1.5">
                {palette.map((entry) => (
                  <li key={entry}>
                    <button
                      type="button"
                      aria-label={entry}
                      aria-pressed={colour === entry}
                      onClick={() => {
                        setColour(entry);
                      }}
                      className={cn(
                        'aspect-square w-full rounded-sm border transition-colors',
                        colour === entry ? 'border-line-focus' : 'border-line-subtle',
                      )}
                      // The one place a colour cannot come from a token: it is
                      // the sprite's own colour, not the interface's.
                      style={{ backgroundColor: entry }}
                    />
                  </li>
                ))}
              </ul>
              {colour !== null && (
                <p className="text-xs tabular-nums text-fg-secondary">{colour}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** An arrow turning back on itself. */
function UndoIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
      <path
        d="M3.2 7.2h6.3a3.3 3.3 0 0 1 0 6.6H6.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M5.6 4.4 2.8 7.2l2.8 2.8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The same arrow, the other way round. */
function RedoIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
      <path
        d="M12.8 7.2H6.5a3.3 3.3 0 0 0 0 6.6h3.1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M10.4 4.4l2.8 2.8-2.8 2.8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
