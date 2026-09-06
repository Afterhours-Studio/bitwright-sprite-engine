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

import { Card } from '@/components/ui/Card';
import { Field, SelectField, Toggle } from '@/components/ui/Field';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useEngineStore } from '@/stores/useEngineStore';
import { useGenerationStore } from '@/stores/useGenerationStore';

/**
 * The right hand panel of parameters.
 *
 * Each group is a card on surface-2, sitting on the panel's surface-1. Controls
 * whose capability the selected engine lacks are disabled here, with the reason
 * shown as a hint, so the user never presses generate only to be told no.
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
    <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-auto border-s border-line-subtle bg-surface-1 p-3">
      <Card title={t('parameters.title')}>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t('parameters.width')}
              type="number"
              min={8}
              max={2048}
              value={request.width}
              onChange={(event) => {
                patch({ width: Number(event.target.value) });
              }}
            />
            <Field
              label={t('parameters.height')}
              type="number"
              min={8}
              max={2048}
              value={request.height}
              onChange={(event) => {
                patch({ height: Number(event.target.value) });
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t('parameters.steps')}
              type="number"
              min={1}
              max={150}
              value={request.steps}
              onChange={(event) => {
                patch({ steps: Number(event.target.value) });
              }}
            />
            <Field
              label={t('parameters.guidance')}
              type="number"
              min={0}
              max={30}
              step={0.5}
              value={request.guidanceScale}
              onChange={(event) => {
                patch({ guidanceScale: Number(event.target.value) });
              }}
            />
          </div>

          <Field
            label={t('parameters.seed')}
            type="number"
            min={0}
            placeholder={t('parameters.seedRandom')}
            value={request.seed ?? ''}
            onChange={(event) => {
              const raw = event.target.value;
              patch({ seed: raw === '' ? null : Number(raw) });
            }}
          />

          <Field
            label={t('parameters.batch')}
            type="number"
            min={1}
            max={16}
            disabled={!canBatch}
            {...(canBatch ? {} : { hint: unsupported })}
            value={request.batchSize}
            onChange={(event) => {
              patch({ batchSize: Number(event.target.value) });
            }}
          />

          <SelectField
            label={t('parameters.model')}
            value={request.modelId}
            options={baseModels.map((model) => ({ value: model.modelId, label: model.name }))}
            onValueChange={(value) => {
              patch({ modelId: value });
            }}
          />

          <SelectField
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
        </div>
      </Card>

      <Card title={t('postprocess.title')}>
        <div className="flex flex-col gap-3">
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
          <Field
            label={t('postprocess.paletteSize')}
            type="number"
            min={2}
            max={256}
            value={request.postprocess.paletteSize ?? ''}
            onChange={(event) => {
              const raw = event.target.value;
              patchPostprocess({ paletteSize: raw === '' ? null : Number(raw) });
            }}
          />
          <Field
            label={t('postprocess.pixelGrid')}
            type="number"
            min={1}
            max={64}
            value={request.postprocess.pixelGrid ?? ''}
            onChange={(event) => {
              const raw = event.target.value;
              patchPostprocess({ pixelGrid: raw === '' ? null : Number(raw) });
            }}
          />
        </div>
      </Card>
    </aside>
  );
}
