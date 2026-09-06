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

import { Button } from '@/components/ui/Button';
import { TextAreaField } from '@/components/ui/Field';
import { ParameterPanel } from '@/features/generation/ParameterPanel';
import { SpriteCanvas } from '@/features/generation/SpriteCanvas';
import { useCapabilities } from '@/hooks/useCapabilities';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { useGenerationStore } from '@/stores/useGenerationStore';

/** The generate screen: prompt and canvas on the left, parameters on the right. */
export function GenerateScreen(): ReactElement {
  const { t } = useTranslation('generation');
  const translateError = useErrorMessage();

  const request = useGenerationStore((state) => state.request);
  const patch = useGenerationStore((state) => state.patch);
  const reset = useGenerationStore((state) => state.reset);
  const run = useGenerationStore((state) => state.run);
  const running = useGenerationStore((state) => state.running);
  const images = useGenerationStore((state) => state.images);
  const durationMs = useGenerationStore((state) => state.durationMs);
  const error = useGenerationStore((state) => state.error);

  const { ready } = useCapabilities();
  const message = translateError(error);
  const canGenerate = ready && !running && request.prompt.trim() !== '';

  return (
    <div className="flex h-full gap-4 p-4">
      <section className="flex min-w-0 flex-1 flex-col gap-4">
        <header>
          <h1 className="text-base font-semibold text-fg-primary">{t('title')}</h1>
          <p className="text-xs text-fg-secondary">{t('subtitle')}</p>
        </header>

        <SpriteCanvas images={images} />

        <div className="flex flex-col gap-3 rounded-lg border border-line-subtle bg-surface-content p-4 shadow-sm">
          <TextAreaField
            label={t('prompt.label')}
            value={request.prompt}
            placeholder={t('prompt.placeholder')}
            onValueChange={(value) => {
              patch({ prompt: value });
            }}
          />
          <TextAreaField
            label={t('prompt.negativeLabel')}
            value={request.negativePrompt}
            placeholder={t('prompt.negativePlaceholder')}
            rows={2}
            onValueChange={(value) => {
              patch({ negativePrompt: value });
            }}
          />

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-xs text-fg-secondary">
              {message !== null && <span>{message}</span>}
              {message === null && images.length > 0 && (
                <span>
                  {t('result.count', { count: images.length })}
                  {' - '}
                  {t('result.duration', { ms: durationMs })}
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" onClick={reset}>
                {t('actions.reset')}
              </Button>
              <Button
                variant="primary"
                disabled={!canGenerate}
                onClick={() => {
                  void run();
                }}
              >
                {running ? t('actions.generating') : t('actions.generate')}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <ParameterPanel />
    </div>
  );
}
