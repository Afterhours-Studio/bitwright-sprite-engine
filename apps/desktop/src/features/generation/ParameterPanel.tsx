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

import { Toggle } from '@/components/ui/Field';
import { NumberField } from '@/components/ui/NumberField';
import { Pill } from '@/components/ui/Pill';
import { Select } from '@/components/ui/Select';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useEngineStore } from '@/stores/useEngineStore';
import { useGenerationStore } from '@/stores/useGenerationStore';

/**
 * The sprite sizes worth reaching in one press.
 *
 * Powers of two, and square, because that is what a tile sheet and an atlas
 * packer both want. They used to sit in a dock popover, which was the one part
 * of that popover the panel did not already own; the rest of it was a second
 * copy of the two fields below. The presets moved here with it, so that the
 * size is set in exactly one place and setting it is still one press.
 */
const SIZE_PRESETS: readonly { readonly width: number; readonly height: number }[] = [
  { width: 16, height: 16 },
  { width: 32, height: 32 },
  { width: 64, height: 64 },
  { width: 128, height: 128 },
];

/**
 * The right hand column of parameters.
 *
 * One container that scrolls inside itself, rather than loose cards scrolling
 * in the page. Loose cards leave the scrollbar out in the canvas with nothing
 * beside it, and the cards slide out from under the title bar with no edge to
 * pass behind.
 *
 * Controls whose capability the selected engine lacks are disabled here, with
 * the reason as a hint, so the user never presses generate only to be told no.
 * The reason is secondary text: it is information they have to act on.
 */
export function ParameterPanel(): ReactElement {
  const { t } = useTranslation('generation');
  const request = useGenerationStore((state) => state.request);
  const patch = useGenerationStore((state) => state.patch);
  const patchPostprocess = useGenerationStore((state) => state.patchPostprocess);
  const models = useEngineStore((state) => state.models);
  const { supports } = useCapabilities();

  const canBatch = supports('batch');
  const canLora = supports('lora_hotswap');
  const unsupported = t('capability.unsupported');

  const baseModels = models.filter((model) => model.kind === 'base');
  const loraModels = models.filter((model) => model.kind === 'lora');

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-line-subtle bg-surface-content shadow-sm">
      <div className="flex flex-col gap-5 overflow-auto p-4">
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-fg-primary">{t('parameters.title')}</h2>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-secondary">{t('parameters.presets')}</span>
            <div className="flex flex-wrap gap-2">
              {SIZE_PRESETS.map((preset) => (
                <Pill
                  key={`${String(preset.width)}x${String(preset.height)}`}
                  tone="anchor"
                  active={request.width === preset.width && request.height === preset.height}
                  onClick={() => {
                    patch({ width: preset.width, height: preset.height });
                  }}
                >
                  {t('parameters.dimensions', { width: preset.width, height: preset.height })}
                </Pill>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label={t('parameters.width')}
              min={8}
              max={2048}
              value={request.width}
              onValueChange={(width) => {
                patch({ width });
              }}
            />
            <NumberField
              label={t('parameters.height')}
              min={8}
              max={2048}
              value={request.height}
              onValueChange={(height) => {
                patch({ height });
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label={t('parameters.steps')}
              min={1}
              max={150}
              value={request.steps}
              onValueChange={(steps) => {
                patch({ steps });
              }}
            />
            {/* The one parameter here that is genuinely fractional. */}
            <NumberField
              label={t('parameters.guidance')}
              mode="decimal"
              min={0}
              max={30}
              step={0.5}
              value={request.guidanceScale}
              onValueChange={(guidanceScale) => {
                patch({ guidanceScale });
              }}
            />
          </div>

          {/* No stepper. A seed is an integer but not a quantity: the sprite
              from seed 41 tells you nothing about the one from seed 42, so a
              button that nudges it by one is an affordance that promises
              something it cannot do. Empty means the engine picks one. */}
          <NumberField
            label={t('parameters.seed')}
            clearable
            stepper={false}
            min={0}
            max={2147483647}
            placeholder={t('parameters.seedRandom')}
            value={request.seed}
            onValueChange={(seed) => {
              patch({ seed });
            }}
          />

          <NumberField
            label={t('parameters.batch')}
            min={1}
            max={16}
            disabled={!canBatch}
            {...(canBatch ? {} : { hint: unsupported })}
            value={request.batchSize}
            onValueChange={(batchSize) => {
              patch({ batchSize });
            }}
          />

          <Select
            label={t('parameters.model')}
            value={request.modelId}
            options={baseModels.map((model) => ({ value: model.modelId, label: model.name }))}
            onValueChange={(value) => {
              patch({ modelId: value });
            }}
          />

          <Select
            label={t('parameters.lora')}
            value={request.loraId ?? ''}
            disabled={!canLora}
            {...(canLora ? {} : { hint: unsupported })}
            options={[
              { value: '', label: t('parameters.loraNone') },
              ...loraModels.map((model) => ({ value: model.modelId, label: model.name })),
            ]}
            onValueChange={(value) => {
              patch({ loraId: value === '' ? null : value });
            }}
          />
        </section>

        <section className="flex flex-col gap-3 border-t border-line-subtle pt-4">
          <h2 className="text-sm font-semibold text-fg-primary">{t('postprocess.title')}</h2>

          <Toggle
            label={t('postprocess.removeBackground')}
            checked={request.postprocess.removeBackground}
            onCheckedChange={(checked) => {
              patchPostprocess({ removeBackground: checked });
            }}
          />
          <Toggle
            label={t('postprocess.dither')}
            checked={request.postprocess.dither}
            onCheckedChange={(checked) => {
              patchPostprocess({ dither: checked });
            }}
          />
          <NumberField
            label={t('postprocess.paletteSize')}
            clearable
            min={2}
            max={256}
            value={request.postprocess.paletteSize}
            onValueChange={(paletteSize) => {
              patchPostprocess({ paletteSize });
            }}
          />
          {/* Named for what it does to the image, not for the lines a viewer
              sees. It resamples the sprite onto blocks of this size inside the
              engine and hands back a different image; the dock's Pixel Grid
              draws over the sprite and changes nothing. Two controls that both
              read "Pixel Grid" would be two controls nobody could tell apart,
              so the hint states the difference where it is read. */}
          <NumberField
            label={t('postprocess.pixelGrid')}
            hint={t('postprocess.pixelGridHint')}
            clearable
            min={1}
            max={64}
            value={request.postprocess.pixelGrid}
            onValueChange={(pixelGrid) => {
              patchPostprocess({ pixelGrid });
            }}
          />
        </section>
      </div>
    </aside>
  );
}
