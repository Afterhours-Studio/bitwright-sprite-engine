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
 */

import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { NumberField } from '@/components/ui/NumberField';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { Toggle } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { useEditorStore } from '@/stores/useEditorStore';
import { useGenerationStore } from '@/stores/useGenerationStore';

/** Which tab is showing. */
type Tab = 'adjust' | 'colour';

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
  const [tab, setTab] = useState<Tab>('adjust');

  const images = useGenerationStore((state) => state.images);
  const conform = useGenerationStore((state) => state.conform);
  const conforming = useGenerationStore((state) => state.conforming);
  const palette = useGenerationStore((state) => state.palette);
  const request = useGenerationStore((state) => state.request);

  const colour = useEditorStore((state) => state.colour);
  const setColour = useEditorStore((state) => state.setColour);

  const [removeBackground, setRemoveBackground] = useState(true);
  const [snapTo, setSnapTo] = useState(1);
  const [paletteSize, setPaletteSize] = useState<number | null>(32);

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

          <NumberField
            label={t('tools.snapTo')}
            value={snapTo}
            min={1}
            max={64}
            hint={t('tools.snapToHint')}
            onValueChange={(value) => {
              setSnapTo(value);
            }}
          />

          <NumberField
            clearable
            label={t('postprocess.paletteSize')}
            value={paletteSize}
            min={2}
            max={256}
            onValueChange={setPaletteSize}
          />

          <Button
            variant="primary"
            className="px-3 py-1 text-xs"
            disabled={!ready}
            onClick={() => {
              void conform(selected, {
                removeBackground,
                backgroundTolerance: request.postprocess.backgroundTolerance,
                snapTo,
                paletteSize,
                dither: request.postprocess.dither,
              });
            }}
          >
            {conforming ? t('tools.conforming') : t('tools.conform')}
          </Button>
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
