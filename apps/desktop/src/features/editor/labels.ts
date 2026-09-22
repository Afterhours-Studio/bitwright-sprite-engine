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
 * What a step and a layer role are called in the reading language.
 *
 * Written out key by key rather than composed as `t(\`layers.${role}\`)`,
 * because a template key is a string at compile time and defeats the whole
 * point of the typed resources in `types/i18next.d.ts`: a role renamed in the
 * union would keep compiling and start showing a raw key. Spelled out, adding
 * a role is a compile error in this file until it has a name.
 *
 * `shadow-core` and `shadow-deep` are not the step's name with a word after
 * it. A person reading the layer list wants "Core shadow", which is what an
 * artist calls the band, and the wire name is an identifier rather than a
 * label.
 */

import { useTranslation } from 'react-i18next';

import type { LayerRole, Step } from '@/types/document';

/** Every layer role's name, and every step's, in the reading language. */
export interface WorkflowLabels {
  layer: Readonly<Record<LayerRole, string>>;
  step: Readonly<Record<Step, string>>;
}

/**
 * Reads the workflow's names.
 *
 * @returns The names, which change when the language does.
 */
export function useWorkflowLabels(): WorkflowLabels {
  const { t } = useTranslation('editor');
  return {
    layer: {
      silhouette: t('layers.silhouette'),
      flats: t('layers.flats'),
      'shadow-core': t('layers.shadowCore'),
      'shadow-deep': t('layers.shadowDeep'),
      light: t('layers.light'),
      outline: t('layers.outline'),
      detail: t('layers.detail'),
      rim: t('layers.rim'),
      accent: t('layers.accent'),
    },
    step: {
      reference: t('steps.reference'),
      palette: t('steps.palette'),
      silhouette: t('steps.silhouette'),
      flats: t('steps.flats'),
      shadow: t('steps.shadow'),
      light: t('steps.light'),
      outline: t('steps.outline'),
      detail: t('steps.detail'),
      accent: t('steps.accent'),
      cleanup: t('steps.cleanup'),
      variation: t('steps.variation'),
    },
  };
}
