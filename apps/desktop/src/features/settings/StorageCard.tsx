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
import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Overlay } from '@/components/ui/Overlay';
import { useDismiss } from '@/hooks/useDismiss';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { formatBytes, type ByteUnits } from '@/lib/format';
import { useShellStore } from '@/stores/useShellStore';
import { useStorageStore } from '@/stores/useStorageStore';
import type { StorageInfo } from '@/types/engine';

/**
 * The storage location: where everything the application writes is kept.
 *
 * The default location is under the user's profile, which on Windows means the
 * system drive. A user whose system drive is full has to be able to point this
 * at another volume, and that is the whole purpose of this card.
 *
 * Choosing a folder does not apply it. The picker produces a candidate that
 * the engine has already created, proved writable, and reported the free space
 * for; a second, explicit press is what moves where the library lands. A
 * change this consequential is not something a single press should be able to
 * do by accident.
 *
 * Nothing is moved on disk. What is already written stays at the old
 * location, and the card says so afterwards rather than letting the user
 * assume it followed.
 *
 * Reads the store directly, so the screen can mount it as `<StorageCard />`
 * with nothing to wire up.
 *
 * @returns The storage card.
 */
export function StorageCard(): ReactElement {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation();
  const translateError = useErrorMessage();

  const info = useStorageStore((state) => state.info);
  const candidate = useStorageStore((state) => state.candidate);
  const leftBehind = useStorageStore((state) => state.leftBehind);
  const loading = useStorageStore((state) => state.loading);
  const error = useStorageStore((state) => state.error);
  const refresh = useStorageStore((state) => state.refresh);
  const browse = useStorageStore((state) => state.browse);
  const proposeDefault = useStorageStore((state) => state.proposeDefault);
  const clearCandidate = useStorageStore((state) => state.clearCandidate);
  const apply = useStorageStore((state) => state.apply);

  // The location comes from the engine, so there is nothing to ask for until
  // the engine is answering. Asking anyway would fill the card with
  // "the engine is still starting" every time the screen opens during startup.
  const engineReady = useShellStore((state) => state.sidecar.ready);

  const units: ByteUnits = {
    megabytes: tCommon('units.megabytes'),
    gigabytes: tCommon('units.gigabytes'),
  };

  const anchor = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    clearCandidate();
  }, [clearCandidate]);
  useDismiss(candidate !== null, anchor, close);

  useEffect(() => {
    if (engineReady) {
      void refresh();
    }
  }, [engineReady, refresh]);

  const failure = translateError(error);
  const unknownSpace = t('storage.unknownSpace');

  return (
    <Card title={t('storage.title')} description={t('storage.description')}>
      <div className="flex flex-col gap-3">
        <div className="rounded-md border border-line bg-surface-content-alt p-3">
          {/* Two columns, so the paths and the sizes line up with each other
              rather than starting wherever their label happens to end. */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs text-fg-secondary">
            <dt>{t('storage.current')}</dt>
            <dd className="break-all text-fg-primary">{info === null ? '-' : info.root}</dd>

            <dt>{t('storage.free')}</dt>
            <dd className="text-fg-primary">
              {info === null || info.freeBytes === null
                ? unknownSpace
                : formatBytes(info.freeBytes, units)}
            </dd>

            <dt>{t('storage.used')}</dt>
            <dd className="text-fg-primary">
              {info === null ? '-' : formatBytes(info.usedBytes, units)}
            </dd>
          </dl>

          {info?.isDefault === true && (
            <p className="mt-2 text-xs text-fg-secondary">{t('storage.isDefault')}</p>
          )}
        </div>

        <div ref={anchor} className="relative flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            className="px-3 py-1 text-xs"
            disabled={loading || !engineReady}
            aria-haspopup="dialog"
            aria-expanded={candidate !== null}
            onClick={() => {
              void browse();
            }}
          >
            {t('storage.browse')}
          </Button>

          <Button
            variant="ghost"
            className="px-3 py-1 text-xs"
            disabled={loading || !engineReady || info === null || info.isDefault}
            onClick={() => {
              void proposeDefault();
            }}
          >
            {t('storage.reset')}
          </Button>

          {/* Hung from the start edge, because the buttons sit against the
              start edge of the card. */}
          <Overlay open={candidate !== null} className="w-80 p-3">
            {candidate !== null && (
              <Proposal
                candidate={candidate}
                units={units}
                busy={loading}
                onCancel={close}
                onConfirm={() => {
                  void apply();
                }}
              />
            )}
          </Overlay>
        </div>

        {leftBehind !== null && (
          <p className="text-xs text-fg-secondary">
            {t('storage.leftBehind', { path: leftBehind })}
          </p>
        )}

        {failure !== null && <p className="text-xs text-fg-secondary">{failure}</p>}
      </div>
    </Card>
  );
}

interface ProposalProps {
  /** The checked location awaiting confirmation. */
  candidate: StorageInfo;
  /** Translated unit words. */
  units: ByteUnits;
  /** Whether a request is in flight, which disables the confirmation. */
  busy: boolean;
  /** Called when the user backs out. */
  onCancel: () => void;
  /** Called when the user confirms. */
  onConfirm: () => void;
}

/**
 * The confirmation for a location the user picked.
 *
 * It states the free space it found before the user commits, because that is
 * the one fact about a volume that decides whether choosing it was a mistake,
 * and it is not visible in a folder picker.
 *
 * @param props - The proposal and its actions.
 * @returns The confirmation panel.
 */
function Proposal({ candidate, units, busy, onCancel, onConfirm }: ProposalProps): ReactElement {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation();

  const free = candidate.freeBytes;

  return (
    <div role="dialog" aria-label={t('storage.confirmTitle')} className="flex flex-col gap-2">
      <p className="text-sm font-medium text-fg-primary">{t('storage.confirmTitle')}</p>
      <p className="break-all text-xs text-fg-primary">{candidate.root}</p>
      <p className="text-xs text-fg-secondary">
        {t('storage.free')}
        {': '}
        {free === null ? t('storage.unknownSpace') : formatBytes(free, units)}
      </p>
      <p className="text-xs text-fg-secondary">{t('storage.confirmBody')}</p>

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button variant="ghost" className="px-3 py-1 text-xs" onClick={onCancel}>
          {tCommon('actions.cancel')}
        </Button>
        <Button variant="primary" className="px-3 py-1 text-xs" disabled={busy} onClick={onConfirm}>
          {t('storage.confirmAction')}
        </Button>
      </div>
    </div>
  );
}
