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
 * The new sprite dialog, opened from home, the editor's header and the
 * command palette through `useShellStore.newSpriteOpen`.
 *
 * WHY THE SIZE IS CHOSEN FROM A GRID
 *
 * A sprite's size cannot change after it is created: every layer and every
 * recorded edit is measured in it. A grid of the sizes pixel art is actually
 * made at, each with what it is usually for, makes that one decision a choice
 * between known answers, and the project's own preset size is marked so the
 * size the style was written for is never a guess. Custom stays for the rest.
 */

import { ImagePlus, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useDismiss } from '@/hooks/useDismiss';
import { cn } from '@/lib/cn';
import { useProjectStore } from '@/stores/useProjectStore';
import { useShellStore } from '@/stores/useShellStore';
import { ASSET_KINDS, DEFAULT_PRESET, PRESET_CANVAS, type AssetKind } from '@/types/document';

/** The square sizes the grid offers. */
export const SPRITE_SIZES = [16, 24, 32, 48, 64, 96, 128, 192, 256, 512] as const;

/** The smallest side Custom accepts. */
export const MIN_SIDE = 16;

/** The largest side Custom accepts. */
export const MAX_SIDE = 512;

/** What the size grid has selected. */
type SizeChoice = { kind: 'square'; size: number } | { kind: 'preset' } | { kind: 'custom' };

const INPUT =
  'w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 text-xs text-neutral-100 focus:border-pink-500 focus:outline-none';
const LABEL = 'mb-1.5 block text-[11px] font-medium text-neutral-400';
const CARD = 'p-2.5 rounded border text-left';
const CARD_ON = 'bg-neutral-900 border-pink-500 ring-1 ring-pink-500/50';
const CARD_OFF = 'border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900/50';

/**
 * Whether a side typed into Custom is one a sprite can be created at.
 *
 * @param value - The side.
 * @returns True for a whole number from 16 to 512.
 */
function validSide(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_SIDE && value <= MAX_SIDE;
}

/** The new sprite dialog. Mounted once; opens when the shell says so. */
export function NewSpriteDialog(): ReactElement | null {
  const { t } = useTranslation('home');
  const { t: tp } = useTranslation('projects');
  const ids = useId();

  const open = useShellStore((state) => state.newSpriteOpen);
  const setOpen = useShellStore((state) => state.setNewSpriteOpen);
  const setScreen = useShellStore((state) => state.setScreen);
  const projects = useProjectStore((state) => state.projects);
  const selectedProject = useProjectStore((state) => state.projectId);
  const presets = useProjectStore((state) => state.presets);
  const createAssetIn = useProjectStore((state) => state.createAssetIn);

  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AssetKind>('character');
  const [size, setSize] = useState<SizeChoice>({ kind: 'preset' });
  const [customWidth, setCustomWidth] = useState('32');
  const [customHeight, setCustomHeight] = useState('32');
  const [busy, setBusy] = useState(false);

  const panel = useRef<HTMLDivElement>(null);
  const nameField = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
  }, [setOpen]);
  useDismiss(open, panel, close);

  useEffect(() => {
    if (!open) {
      return;
    }
    // Reset on every opening, with the project that is open as the default:
    // the sprite is most often meant for whatever is being worked on.
    const initial = projects.find((project) => project.id === selectedProject) ?? projects[0];
    setProjectId(initial?.id ?? '');
    setName('');
    setKind('character');
    setSize({ kind: 'preset' });
    setCustomWidth('32');
    setCustomHeight('32');
    setBusy(false);
    nameField.current?.focus();
    // Only an opening resets the form; the project list changing under an open
    // dialog must not wipe what has been typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) {
    return null;
  }

  const preset = PRESET_CANVAS[presets[projectId] ?? DEFAULT_PRESET];
  const presetSquare = preset.width === preset.height ? preset.width : null;
  // A square preset is marked on its own card; any other shape gets a card of
  // its own, so the preset is always one press away.
  const presetInGrid =
    presetSquare !== null && (SPRITE_SIZES as readonly number[]).includes(presetSquare);

  const dimensions = ((): { width: number; height: number } => {
    if (size.kind === 'square') {
      return { width: size.size, height: size.size };
    }
    if (size.kind === 'preset') {
      return preset;
    }
    return { width: Number(customWidth), height: Number(customHeight) };
  })();

  const valid =
    projects.some((project) => project.id === projectId) &&
    name.trim() !== '' &&
    validSide(dimensions.width) &&
    validSide(dimensions.height) &&
    !busy;

  const isSelected = (choice: number): boolean =>
    (size.kind === 'square' && size.size === choice) ||
    (size.kind === 'preset' && presetInGrid && presetSquare === choice);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!valid) {
      return;
    }
    setBusy(true);
    const created = await createAssetIn(
      projectId,
      name.trim(),
      kind,
      dimensions.width,
      dimensions.height,
    );
    setBusy(false);
    if (created !== null) {
      setOpen(false);
      setScreen('editor');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        className="flex max-h-full w-full flex-col overflow-hidden bg-neutral-950 border border-neutral-800 rounded-xl max-w-lg shadow-2xl text-neutral-100"
      >
        <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-900/50">
          <div className="flex items-center gap-2">
            <ImagePlus className="w-4 h-4 text-pink-500" aria-hidden="true" />
            <h2 id={`${ids}-title`} className="text-base font-semibold">
              {t('newSprite.title')}
            </h2>
          </div>
          <button
            type="button"
            aria-label={t('newSprite.close')}
            onClick={close}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          className="p-5 space-y-5 overflow-y-auto"
        >
          <div>
            <label htmlFor={`${ids}-project`} className={LABEL}>
              {t('newSprite.project')}
            </label>
            {projects.length === 0 ? (
              <p className="text-xs text-neutral-500">{t('newSprite.noProjects')}</p>
            ) : (
              <select
                id={`${ids}-project`}
                value={projectId}
                onChange={(event) => {
                  setProjectId(event.target.value);
                }}
                className={INPUT}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label htmlFor={`${ids}-name`} className={LABEL}>
              {t('newSprite.name')}
            </label>
            <input
              ref={nameField}
              id={`${ids}-name`}
              value={name}
              placeholder={t('newSprite.namePlaceholder')}
              onChange={(event) => {
                setName(event.target.value);
              }}
              className={INPUT}
            />
          </div>

          <fieldset>
            <legend className={LABEL}>{t('newSprite.kind')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {ASSET_KINDS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={kind === option}
                  onClick={() => {
                    setKind(option);
                  }}
                  className={cn(
                    'rounded border px-2.5 py-1 text-[11px] font-medium',
                    kind === option
                      ? 'bg-neutral-900 border-pink-500 text-pink-400'
                      : 'border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-100',
                  )}
                >
                  {tp(`kinds.${option}`)}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className={LABEL}>{t('newSprite.size')}</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {!presetInGrid && (
                <button
                  type="button"
                  aria-pressed={size.kind === 'preset'}
                  onClick={() => {
                    setSize({ kind: 'preset' });
                  }}
                  className={cn(CARD, size.kind === 'preset' ? CARD_ON : CARD_OFF)}
                >
                  <SizeLabel
                    size={`${preset.width}x${preset.height}`}
                    px={t('newSprite.px', {
                      size: (preset.width * preset.height).toLocaleString(),
                    })}
                    use={t('newSprite.use.preset')}
                    marker={t('newSprite.preset')}
                  />
                </button>
              )}
              {SPRITE_SIZES.map((side) => (
                <button
                  key={side}
                  type="button"
                  aria-pressed={isSelected(side)}
                  onClick={() => {
                    setSize({ kind: 'square', size: side });
                  }}
                  className={cn(CARD, isSelected(side) ? CARD_ON : CARD_OFF)}
                >
                  <SizeLabel
                    size={`${side}x${side}`}
                    px={t('newSprite.px', { size: (side * side).toLocaleString() })}
                    use={t(`newSprite.use.${side}`)}
                    marker={presetSquare === side ? t('newSprite.preset') : undefined}
                  />
                </button>
              ))}
              <div className={cn('col-span-2', CARD, size.kind === 'custom' ? CARD_ON : CARD_OFF)}>
                <button
                  type="button"
                  aria-pressed={size.kind === 'custom'}
                  onClick={() => {
                    setSize({ kind: 'custom' });
                  }}
                  className="w-full text-left"
                >
                  <span className="block text-xs font-semibold text-pink-400">
                    {t('newSprite.custom')}
                  </span>
                  <span className="block text-[10px] text-neutral-500">
                    {t('newSprite.customRange')}
                  </span>
                </button>
                {size.kind === 'custom' && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor={`${ids}-width`} className={LABEL}>
                        {t('newSprite.width')}
                      </label>
                      <input
                        id={`${ids}-width`}
                        type="number"
                        min={MIN_SIDE}
                        max={MAX_SIDE}
                        value={customWidth}
                        aria-invalid={!validSide(Number(customWidth))}
                        onChange={(event) => {
                          setCustomWidth(event.target.value);
                        }}
                        className={INPUT}
                      />
                    </div>
                    <div>
                      <label htmlFor={`${ids}-height`} className={LABEL}>
                        {t('newSprite.height')}
                      </label>
                      <input
                        id={`${ids}-height`}
                        type="number"
                        min={MIN_SIDE}
                        max={MAX_SIDE}
                        value={customHeight}
                        aria-invalid={!validSide(Number(customHeight))}
                        onChange={(event) => {
                          setCustomHeight(event.target.value);
                        }}
                        className={INPUT}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </fieldset>

          <button
            type="submit"
            disabled={!valid}
            className="w-full py-2.5 bg-pink-600 hover:bg-pink-500 text-white font-semibold text-xs rounded disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-pink-600"
          >
            {t('newSprite.submit', {
              width: Number.isFinite(dimensions.width) ? dimensions.width : 0,
              height: Number.isFinite(dimensions.height) ? dimensions.height : 0,
            })}
          </button>
        </form>
      </div>
    </div>
  );
}

/** The three lines of a size card, and the preset marker when it applies. */
function SizeLabel({
  size,
  px,
  use,
  marker,
}: {
  size: string;
  px: string;
  use: string;
  marker?: string | undefined;
}): ReactElement {
  return (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-pink-400">{size}</span>
        {marker !== undefined && (
          <span className="rounded bg-pink-950/80 px-1.5 py-0.5 text-[9px] font-medium text-pink-400 border border-pink-700/50">
            {marker}
          </span>
        )}
      </span>
      <span className="block text-[10px] text-neutral-500">{px}</span>
      <span className="block text-[10px] text-neutral-400">{use}</span>
    </>
  );
}
