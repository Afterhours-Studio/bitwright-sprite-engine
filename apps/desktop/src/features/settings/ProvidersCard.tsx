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
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { ComboBox } from '@/components/ui/ComboBox';
import { testDraftProvider } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Field, StatusDot, Toggle } from '@/components/ui/Field';
import { NumberField } from '@/components/ui/NumberField';
import { Overlay } from '@/components/ui/Overlay';
import { Pill } from '@/components/ui/Pill';
import { Select } from '@/components/ui/Select';
import { useDismiss } from '@/hooks/useDismiss';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { useProviderStore } from '@/stores/useProviderStore';
import {
  CUSTOM_PRESET_ID,
  type AuthScheme,
  type ProviderInfo,
  type ProviderPreset,
  type ProviderSaveRequest,
} from '@/types/engine';

/** Timeout offered when a provider names none. Matches the engine's default. */
const DEFAULT_TIMEOUT_S = 120;

/** Bounds the timeout field, matching what the engine accepts. */
const MIN_TIMEOUT_S = 1;
const MAX_TIMEOUT_S = 900;

/**
 * The form's working copy of a provider.
 *
 * A separate shape from {@link ProviderInfo} on purpose: it carries the key the
 * user is typing, which no stored provider ever carries, and it omits the
 * fields the engine owns.
 */
interface Draft {
  /** Identifier being edited, empty when adding. */
  providerId: string;
  /** Catalogue entry, or {@link CUSTOM_PRESET_ID}. */
  source: string;
  name: string;
  baseUrl: string;
  model: string;
  authScheme: AuthScheme;
  authHeader: string;
  timeoutS: number;
  /** What the user has typed. Empty means "leave the stored key alone". */
  apiKey: string;
  activate: boolean;
}

/**
 * Builds the draft for a new provider.
 *
 * @returns An empty draft, set to a custom endpoint.
 */
function emptyDraft(): Draft {
  return {
    providerId: '',
    source: CUSTOM_PRESET_ID,
    name: '',
    baseUrl: '',
    model: '',
    authScheme: 'bearer',
    authHeader: '',
    timeoutS: DEFAULT_TIMEOUT_S,
    apiKey: '',
    activate: true,
  };
}

/**
 * Builds the draft for editing a stored provider.
 *
 * The key field starts empty, because the engine never sends a key back. Empty
 * therefore means "keep what is stored", which is what the hint under the field
 * says.
 *
 * @param provider - The provider being edited.
 * @returns A draft holding everything except the credential.
 */
function draftFrom(provider: ProviderInfo): Draft {
  return {
    providerId: provider.providerId,
    source: provider.kind === 'preset' ? provider.presetId : CUSTOM_PRESET_ID,
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    authScheme: provider.authScheme,
    authHeader: provider.authHeader,
    timeoutS: provider.timeoutS,
    apiKey: '',
    activate: provider.active,
  };
}

/**
 * Applies a catalogue entry to a draft.
 *
 * Only the fields the preset actually knows are overwritten, and only when the
 * user has not already typed something into them. Choosing a preset after
 * typing a name should not silently discard the name.
 *
 * @param draft - The current draft.
 * @param preset - The chosen catalogue entry, or null for a custom endpoint.
 * @returns The updated draft.
 */
function applyPreset(draft: Draft, preset: ProviderPreset | null): Draft {
  if (preset === null) {
    return { ...draft, source: CUSTOM_PRESET_ID };
  }
  return {
    ...draft,
    source: preset.presetId,
    name: draft.name === '' ? preset.name : draft.name,
    baseUrl: preset.baseUrl,
    model: draft.model === '' ? preset.defaultModel : draft.model,
    authScheme: preset.authScheme,
    authHeader: preset.authHeader,
  };
}

/**
 * Turns a draft into the request the engine expects.
 *
 * The key is omitted rather than sent empty when the user typed nothing into
 * an edit, which is what tells the engine to keep the stored one. On a new
 * provider it is sent as typed, because there is nothing to keep.
 *
 * @param draft - The form's working copy.
 * @returns The save request.
 */
function toRequest(draft: Draft): ProviderSaveRequest {
  const isNew = draft.providerId === '';
  const custom = draft.source === CUSTOM_PRESET_ID;

  return {
    providerId: draft.providerId,
    name: draft.name,
    kind: custom ? 'custom' : 'preset',
    presetId: custom ? '' : draft.source,
    baseUrl: draft.baseUrl,
    model: draft.model,
    authScheme: draft.authScheme,
    authHeader: draft.authHeader,
    extraHeaders: {},
    timeoutS: draft.timeoutS,
    ...(isNew || draft.apiKey !== '' ? { apiKey: draft.apiKey } : {}),
    activate: draft.activate,
  };
}

/**
 * AI provider configuration.
 *
 * The remote engine has to be pointed somewhere, and until this card existed
 * there was nowhere to point it: the engine reported
 * `backend.remote.endpoint_missing` and no screen could fix that. Several
 * providers can be configured here, one is active, and each is either a
 * catalogue entry chosen by name or a custom endpoint the user supplies, which
 * is what makes an aggregator or a router usable.
 *
 * NO API KEY IS EVER RENDERED HERE.
 *
 * The engine returns a presence flag and a masked hint, never the value. The
 * reveal control on the form reveals what the user is typing right now, in
 * their own input, and nothing that was stored earlier. There is no path in
 * this component that could display a stored key, because no stored key
 * reaches it.
 */
export function ProvidersCard(): ReactElement {
  const { t } = useTranslation('settings');
  const translateError = useErrorMessage();

  const providers = useProviderStore((state) => state.providers);
  const presets = useProviderStore((state) => state.presets);
  const secretStorage = useProviderStore((state) => state.secretStorage);
  const maxProviders = useProviderStore((state) => state.maxProviders);
  const error = useProviderStore((state) => state.error);
  const refresh = useProviderStore((state) => state.refresh);
  const clearError = useProviderStore((state) => state.clearError);

  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openEditor = useCallback(
    (next: Draft) => {
      clearError();
      setDraft(next);
    },
    [clearError],
  );

  const closeEditor = useCallback(() => {
    clearError();
    setDraft(null);
  }, [clearError]);

  const full = maxProviders > 0 && providers.length >= maxProviders;
  const failure = draft === null ? translateError(error) : null;

  return (
    <Card title={t('providers.title')} description={t('providers.description')}>
      {/* Where the keys live is one fact, so it reads as one block rather than
          as loose sentences at the same weight as everything else on the card.
          The weaker tier is stated, not implied: a user whose keys sit in a
          plain file has to be able to find that out here, because it is the
          thing they would want to act on. */}
      <div className="mb-4 rounded-sm border border-line bg-surface-content p-3">
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="text-fg-secondary">{t('providers.storage.label')}</span>
          <span className="font-medium text-fg-primary">
            {secretStorage === 'keychain'
              ? t('providers.storage.keychain')
              : t('providers.storage.file')}
          </span>
        </p>
        {secretStorage === 'file' && (
          <p className="mt-1 text-xs text-fg-secondary">{t('providers.storage.fileWarning')}</p>
        )}
      </div>

      {providers.length > 0 && (
        <ul className="mb-3 flex flex-col gap-3">
          {providers.map((provider) => (
            <ProviderRow
              key={provider.providerId}
              provider={provider}
              onEdit={() => {
                openEditor(draftFrom(provider));
              }}
            />
          ))}
        </ul>
      )}

      {failure !== null && <p className="mb-3 text-xs text-fg-secondary">{failure}</p>}

      {draft !== null && (
        <ProviderEditor draft={draft} presets={presets} onChange={setDraft} onClose={closeEditor} />
      )}

      {/* The prompt to add the first one and the control that does it are one
          thought, so they sit together rather than as a sentence floating above
          a button with a gap between them. */}
      {draft === null && !full && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            className="px-3 py-1 text-xs"
            onClick={() => {
              openEditor(emptyDraft());
            }}
          >
            {t('providers.add')}
          </Button>
          {providers.length === 0 && (
            <p className="text-xs text-fg-secondary">{t('providers.empty')}</p>
          )}
        </div>
      )}

      {draft === null && full && (
        <p className="text-xs text-fg-secondary">
          {t('providers.limitReached', { max: maxProviders })}
        </p>
      )}
    </Card>
  );
}

interface ProviderRowProps {
  /** The provider this row describes. */
  provider: ProviderInfo;
  /** Opens the editor on this provider. */
  onEdit: () => void;
}

/**
 * One configured provider, with everything that can be done to it.
 *
 * Laid out like the model rows on this screen: the provider describes itself
 * down the left, and the control that selects it stays at the right edge.
 *
 * Removing is destructive - it deletes a credential that cannot be recovered -
 * so it opens a confirmation rather than acting. The confirmation is the shared
 * Overlay dismissed by the shared hook, so it behaves like every other popover
 * in the interface.
 */
function ProviderRow({ provider, onEdit }: ProviderRowProps): ReactElement {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation();
  const translateError = useErrorMessage();

  const presets = useProviderStore((state) => state.presets);
  const loading = useProviderStore((state) => state.loading);
  const testing = useProviderStore((state) => state.testing);
  const result = useProviderStore((state) => state.results[provider.providerId]);
  const activate = useProviderStore((state) => state.activate);
  const remove = useProviderStore((state) => state.remove);
  const test = useProviderStore((state) => state.test);

  const anchor = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const close = useCallback(() => {
    setConfirming(false);
  }, []);
  useDismiss(confirming, anchor, close);

  const preset = presets.find((entry) => entry.presetId === provider.presetId);
  const origin =
    provider.kind === 'custom' || preset === undefined
      ? t('providers.row.custom')
      : t('providers.row.preset', { name: preset.name });

  const isTesting = testing === provider.providerId;
  const outcome = result === undefined ? null : translateError(result.code);

  return (
    <li className="flex flex-col gap-3 rounded-md border border-line bg-surface-content-alt p-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <StatusDot
            tone={provider.active ? 'ready' : 'off'}
            label={provider.active ? t('providers.row.active') : t('providers.row.use')}
          >
            <span className="truncate text-sm font-medium text-fg-primary">{provider.name}</span>
          </StatusDot>

          <p className="truncate text-xs text-fg-secondary">{provider.baseUrl}</p>
          <p className="truncate text-xs text-fg-secondary">{provider.model}</p>
          <p className="text-xs text-fg-secondary">
            {origin}
            {' - '}
            {provider.hasKey
              ? t('providers.row.keyStored', { hint: provider.keyHint })
              : t('providers.row.noKey')}
          </p>
        </div>

        <Pill
          className="shrink-0"
          tone="anchor"
          active={provider.active}
          disabled={provider.active || loading}
          onClick={() => {
            void activate(provider.providerId);
          }}
        >
          {provider.active ? t('providers.row.active') : t('providers.row.use')}
        </Pill>
      </div>

      {outcome !== null && result !== undefined && (
        <p className="text-xs text-fg-secondary">
          {result.ok
            ? t('providers.test.ok', { ms: result.latencyMs, models: result.modelCount })
            : t('providers.test.failed')}
          {' - '}
          {outcome}
        </p>
      )}

      <div ref={anchor} className="relative flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          className="px-3 py-1 text-xs"
          disabled={isTesting}
          onClick={() => {
            void test(provider.providerId);
          }}
        >
          {isTesting ? t('providers.actions.testing') : t('providers.actions.test')}
        </Button>

        <Button variant="ghost" className="px-3 py-1 text-xs" onClick={onEdit}>
          {t('providers.actions.edit')}
        </Button>

        <Button
          variant="ghost"
          className="px-3 py-1 text-xs"
          aria-haspopup="dialog"
          aria-expanded={confirming}
          onClick={() => {
            setConfirming((was) => !was);
          }}
        >
          {t('providers.actions.remove')}
        </Button>

        <Overlay open={confirming} className="w-72 p-3">
          <div
            role="dialog"
            aria-label={t('providers.confirm.title')}
            className="flex flex-col gap-2 text-start"
          >
            <p className="text-sm font-medium text-fg-primary">{t('providers.confirm.title')}</p>
            <p className="text-xs text-fg-secondary">{t('providers.confirm.body')}</p>
            <p className="truncate text-xs text-fg-secondary">{provider.name}</p>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button variant="ghost" className="px-3 py-1 text-xs" onClick={close}>
                {tCommon('actions.cancel')}
              </Button>
              <Button
                variant="primary"
                className="px-3 py-1 text-xs"
                onClick={() => {
                  close();
                  void remove(provider.providerId);
                }}
              >
                {t('providers.confirm.action')}
              </Button>
            </div>
          </div>
        </Overlay>
      </div>
    </li>
  );
}

interface ProviderEditorProps {
  /** The form's working copy. */
  draft: Draft;
  /** The built-in catalogue. */
  presets: ProviderPreset[];
  /** Called with the updated draft on every edit. */
  onChange: (draft: Draft) => void;
  /** Closes the editor without saving. */
  onClose: () => void;
}

/**
 * The add and edit form.
 *
 * One form serves both, because the fields are the same and the only real
 * difference is what an empty key field means: on a new provider it means "no
 * key", and on an edit it means "keep the one already stored". The hint under
 * the field says which.
 *
 * The reveal control toggles this input between a password field and a text
 * field. It reveals what the user is typing and nothing else; a stored key
 * never arrives here to be revealed.
 */
function ProviderEditor({ draft, presets, onChange, onClose }: ProviderEditorProps): ReactElement {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation();
  const translateError = useErrorMessage();

  const loading = useProviderStore((state) => state.loading);
  const error = useProviderStore((state) => state.error);
  const save = useProviderStore((state) => state.save);

  const [revealed, setRevealed] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [allModels, setAllModels] = useState<string[]>([]);
  // Only the models that draw are offered. A provider can list dozens that
  // cannot, and asking a text model for a picture fails in a way that reads
  // as a broken key. Everything it listed stays one press away.
  const [showAll, setShowAll] = useState(false);
  const [fetching, setFetching] = useState(false);

  /**
   * Asks the provider what it can do.
   *
   * The connection test already reads the model listing to decide whether the
   * endpoint speaks the protocol, so it reports the names too rather than
   * having a second call ask the same question.
   */
  const fetchModels = useCallback(async () => {
    setFetching(true);
    try {
      const result = await testDraftProvider(toRequest(draft));
      setModels(result.models);
      setAllModels(result.allModels);
      setShowAll(false);
    } catch {
      // The failure is already reported by the connection test; an empty list
      // is the honest state here.
      setModels([]);
      setAllModels([]);
    } finally {
      setFetching(false);
    }
  }, [draft]);

  const isNew = draft.providerId === '';
  const preset = presets.find((entry) => entry.presetId === draft.source);
  const failure = translateError(error);

  const sourceOptions = [
    ...presets.map((entry) => ({ value: entry.presetId, label: entry.name })),
    { value: CUSTOM_PRESET_ID, label: t('providers.form.sourceCustom') },
  ];

  const submit = async (): Promise<void> => {
    const stored = await save(toRequest(draft));
    if (stored) {
      onClose();
    }
  };

  return (
    <Card
      surface="alt"
      title={isNew ? t('providers.form.addTitle') : t('providers.form.editTitle')}
      className="mb-3"
    >
      <div className="flex flex-col gap-3">
        <Select
          label={t('providers.form.source')}
          value={draft.source}
          options={sourceOptions}
          onValueChange={(value) => {
            onChange(applyPreset(draft, presets.find((entry) => entry.presetId === value) ?? null));
          }}
        />

        {preset !== undefined && preset.documentationUrl !== '' && (
          // Rendered as text rather than as a link. The webview opens nothing
          // externally, so a link here would be a control that does not work.
          <p className="break-all text-xs text-fg-secondary">
            {t('providers.form.documentation')}
            {': '}
            {preset.documentationUrl}
          </p>
        )}

        <Field
          label={t('providers.form.name')}
          value={draft.name}
          placeholder={t('providers.form.namePlaceholder')}
          onChange={(event) => {
            onChange({ ...draft, name: event.target.value });
          }}
        />

        {/* The API shape a custom endpoint has to speak belongs next to the
            field where that endpoint is typed, not as a footnote under the
            whole card where it reads as a general remark about the feature. */}
        {preset === undefined && (
          <p className="text-xs text-fg-secondary">{t('providers.compatibility')}</p>
        )}

        <Field
          label={t('providers.form.baseUrl')}
          value={draft.baseUrl}
          placeholder={t('providers.form.baseUrlPlaceholder')}
          hint={t('providers.form.baseUrlHint')}
          onChange={(event) => {
            onChange({ ...draft, baseUrl: event.target.value });
          }}
        />

        <Select
          label={t('providers.form.auth')}
          value={draft.authScheme}
          options={[
            { value: 'bearer', label: t('providers.form.authBearer') },
            { value: 'header', label: t('providers.form.authHeader') },
            { value: 'none', label: t('providers.form.authNone') },
          ]}
          onValueChange={(value) => {
            onChange({ ...draft, authScheme: value as AuthScheme });
          }}
        />

        {draft.authScheme === 'header' && (
          <Field
            label={t('providers.form.authHeaderName')}
            value={draft.authHeader}
            placeholder={t('providers.form.authHeaderPlaceholder')}
            onChange={(event) => {
              onChange({ ...draft, authHeader: event.target.value });
            }}
          />
        )}

        {draft.authScheme !== 'none' && (
          <div className="flex flex-col gap-2">
            <Field
              label={t('providers.form.apiKey')}
              value={draft.apiKey}
              type={revealed ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder={t('providers.form.apiKeyPlaceholder')}
              {...(isNew ? {} : { hint: t('providers.form.apiKeyKept') })}
              onChange={(event) => {
                onChange({ ...draft, apiKey: event.target.value });
              }}
              trailing={
                // A bare icon rather than an IconButton: that carries a
                // round plate for a control standing on its own, and inside a
                // field it reads as a second control sitting on the first.
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={revealed ? t('providers.form.hide') : t('providers.form.reveal')}
                  aria-pressed={revealed}
                  onClick={() => {
                    setRevealed((was) => !was);
                  }}
                  className="flex h-8 w-8 items-center justify-center text-fg-secondary transition-colors hover:text-fg-primary"
                >
                  <EyeIcon open={revealed} />
                </button>
              }
            />
          </div>
        )}

        {/* Below the key, because it cannot be filled in until there is one:
            the list comes from the provider, and the provider will not answer
            without a credential. */}
        {/* The hint belongs to the field but is rendered below the row: a
            hint inside one column makes that column taller and drags the
            button below the input it is meant to sit beside. */}
        <div className="flex flex-col gap-1">
          <div className="flex items-end gap-2">
            <ComboBox
              className="flex-1"
              label={t('providers.form.model')}
              value={draft.model}
              options={showAll ? allModels : models}
              placeholder={t('providers.form.modelPlaceholder')}
              emptyHint={t('providers.form.modelEmpty')}
              noMatchHint={t('providers.form.modelNoMatch')}
              onValueChange={(value) => {
                onChange({ ...draft, model: value });
              }}
            />
            <Button
              variant="secondary"
              className="shrink-0 px-3 py-2 text-xs"
              disabled={fetching || draft.baseUrl.trim() === ''}
              onClick={() => {
                void fetchModels();
              }}
            >
              {fetching ? t('providers.form.fetching') : t('providers.form.fetchModels')}
            </Button>
          </div>
          {models.length === 0 ? (
            <p className="text-xs text-fg-secondary">{t('providers.form.modelHint')}</p>
          ) : (
            <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-fg-secondary">
              <span>
                {t('providers.form.modelFetched', {
                  count: showAll ? allModels.length : models.length,
                })}
              </span>
              {allModels.length > models.length && (
                <button
                  type="button"
                  onClick={() => {
                    setShowAll((was) => !was);
                  }}
                  className="text-fg-primary underline underline-offset-2"
                >
                  {showAll
                    ? t('providers.form.showDrawing', { count: models.length })
                    : t('providers.form.showAll', { count: allModels.length })}
                </button>
              )}
            </p>
          )}
        </div>

        <NumberField
          label={t('providers.form.timeout')}
          value={draft.timeoutS}
          min={MIN_TIMEOUT_S}
          max={MAX_TIMEOUT_S}
          step={10}
          onValueChange={(value) => {
            onChange({ ...draft, timeoutS: value });
          }}
        />

        <Toggle
          label={t('providers.form.makeActive')}
          checked={draft.activate}
          onCheckedChange={(checked) => {
            onChange({ ...draft, activate: checked });
          }}
        />

        {failure !== null && <p className="text-xs text-fg-secondary">{failure}</p>}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" className="px-3 py-1 text-xs" onClick={onClose}>
            {tCommon('actions.cancel')}
          </Button>
          <Button
            variant="primary"
            className="px-3 py-1 text-xs"
            disabled={loading}
            onClick={() => {
              void submit();
            }}
          >
            {tCommon('actions.save')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/**
 * The reveal control's icon.
 *
 * @param props.open - Whether the key is currently shown.
 * @returns An eye, struck through when the key is hidden.
 */
function EyeIcon({ open }: { open: boolean }): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none">
      <path
        d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3" />
      {!open && (
        <path d="M3 13L13 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      )}
    </svg>
  );
}
