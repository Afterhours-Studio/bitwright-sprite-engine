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
 * The palette: every slot the document may use, grouped by the ramp it belongs
 * to, and which of them the next stroke writes.
 *
 * A SWATCH IS NOT A COLOUR, IT IS A SLOT. What the pencil carries is the index
 * 7, and what 7 looks like is a property of the palette. That is why each
 * swatch is labelled with its number and its place in its ramp rather than with
 * a hex value: the artist has to be able to see that slot 7 is cloth-red step 2
 * of 4, because that is the fact the shading tools act on. A hex value is the
 * one thing about a slot that no tool takes as an argument.
 *
 * RAMPS FIRST, LOOSE SLOTS AFTER. A ramp is the unit the shading tools work
 * in - the engine steps along the ramp the region is already painted with -
 * so a slot that belongs to no ramp is a slot that `shade` will skip. Showing
 * them in a group of their own is how that becomes visible before a shading
 * op reports it as a count of skipped pixels.
 *
 * EDITING GOES THROUGH `palette_write`, WHICH IS CHECKED. Rust validates the
 * whole palette against the style's rules and refuses the write as a body;
 * nothing is partially applied. A refusal is shown here, beside the palette it
 * was about, with the rule it broke named - a reason code in a toast that has
 * already faded is not something a person can act on.
 */

import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { fromHex, toHex, toHexa } from '@/features/editor/colour';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { cn } from '@/lib/cn';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { useEditorStore } from '@/stores/useEditorStore';
import type { Palette, PaletteSlot } from '@/types/document';

/** The reason codes `palette_write` refuses with all begin with this. */
const PALETTE_CODE = 'palette.';

/**
 * The palette panel.
 *
 * @returns The ramps, their slots, and what is known about the chosen one.
 */
export function PalettePanel(): ReactElement {
  const { t } = useTranslation('editor');
  const translateError = useErrorMessage();

  const palette = useDocumentStore((state) => state.palette);
  const writePalette = useDocumentStore((state) => state.writePalette);
  // The store keeps one reason code for whatever failed last. Only the palette
  // family is shown here, so a failed composite or a failed layer read cannot
  // appear under the palette as though the palette had been rejected.
  const error = useDocumentStore((state) => state.error);
  const slot = useEditorStore((state) => state.slot);
  const setSlot = useEditorStore((state) => state.setSlot);

  const [editing, setEditing] = useState(false);

  if (palette === null) {
    return <p className="text-xs text-fg-secondary">{t('palette.noDocument')}</p>;
  }

  const chosen = palette.slots.find((entry) => entry.index === slot) ?? null;
  const ramped = new Set(palette.ramps.flatMap((ramp) => ramp.slots));
  const loose = palette.slots.filter((entry) => !ramped.has(entry.index));
  const refusal = error !== null && error.startsWith(PALETTE_CODE) ? translateError(error) : null;

  /**
   * Replaces one slot's colour, leaving every pixel and every ramp alone.
   *
   * @param index - The slot to recolour.
   * @param rgba - Its new bytes.
   */
  const recolour = (index: number, rgba: [number, number, number, number]): void => {
    const next: Palette = {
      ...palette,
      slots: palette.slots.map((entry) => (entry.index === index ? { ...entry, rgba } : entry)),
    };
    void writePalette(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold text-fg-primary">{t('palette.title')}</h3>
        <span className="text-[11px] text-fg-secondary">
          {t('palette.count', { count: palette.slots.length })}
        </span>
      </div>

      {palette.ramps.map((ramp) => (
        <section key={ramp.name} className="flex flex-col gap-1">
          <p className="text-[11px] font-medium text-fg-secondary">
            {t('palette.ramp', { name: ramp.name, material: ramp.material })}
          </p>
          <div className="flex flex-wrap gap-1">
            {ramp.slots.map((index, position) => {
              const entry = palette.slots.find((candidate) => candidate.index === index);
              return entry === undefined ? null : (
                <Swatch
                  key={index}
                  slot={entry}
                  chosen={entry.index === slot}
                  label={t('palette.swatchInRamp', {
                    index: entry.index,
                    ramp: ramp.name,
                    step: position + 1,
                    of: ramp.slots.length,
                  })}
                  onChoose={setSlot}
                />
              );
            })}
          </div>
        </section>
      ))}

      {loose.length > 0 && (
        <section className="flex flex-col gap-1">
          {/* Named rather than left unlabelled, because a slot outside every
              ramp is the one a shading op will skip, and the count of skipped
              pixels it reports afterwards does not say which slot did it. */}
          <p className="text-[11px] font-medium text-fg-secondary">{t('palette.unramped')}</p>
          <div className="flex flex-wrap gap-1">
            {loose.map((entry) => (
              <Swatch
                key={entry.index}
                slot={entry}
                chosen={entry.index === slot}
                label={t('palette.swatch', { index: entry.index })}
                onChoose={setSlot}
              />
            ))}
          </div>
        </section>
      )}

      <div className="rounded-sm border border-line-subtle bg-surface-content-alt p-2">
        <p className="text-[11px] text-fg-secondary">
          {chosen === null
            ? t('palette.noSlot', { index: slot })
            : describe(chosen, palette, (key, options) => t(key, options))}
        </p>
        {chosen !== null && (
          <div className="mt-2 flex items-center gap-2">
            {editing ? (
              <>
                <label className="flex items-center gap-2 text-[11px] text-fg-secondary">
                  {t('palette.colour')}
                  <input
                    type="color"
                    className="h-6 w-10 cursor-pointer rounded-sm border border-line-subtle bg-transparent"
                    defaultValue={toHex(chosen.rgba)}
                    onChange={(event) => {
                      recolour(chosen.index, fromHex(event.target.value, chosen.rgba[3]));
                    }}
                  />
                </label>
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-[11px]"
                  onClick={() => {
                    setEditing(false);
                  }}
                >
                  {t('palette.done')}
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                className="px-2 py-1 text-[11px]"
                onClick={() => {
                  setEditing(true);
                }}
              >
                {t('palette.edit')}
              </Button>
            )}
          </div>
        )}
      </div>

      {refusal !== null && (
        <p
          role="alert"
          className="rounded-sm bg-surface-content-alt p-2 text-[11px] text-[color:var(--severity-error)]"
        >
          {t('palette.refused', { reason: refusal })}
        </p>
      )}
    </div>
  );
}

interface SwatchProps {
  slot: PaletteSlot;
  chosen: boolean;
  label: string;
  onChoose: (index: number) => void;
}

/**
 * One slot, as a square that can be chosen.
 *
 * The number is drawn on the swatch rather than only in its label, because the
 * number is what every op carries and the artist has to be able to read it off
 * the palette while typing one into a readback.
 *
 * @param props - The slot, whether it is chosen, and what to call it.
 * @returns The swatch.
 */
function Swatch({ slot, chosen, label, onChoose }: SwatchProps): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      aria-label={label}
      title={label}
      onClick={() => {
        onChoose(slot.index);
      }}
      className={cn(
        'palette-swatch relative h-7 w-7 rounded-sm border text-[9px] font-semibold leading-none',
        'flex items-end justify-end p-0.5 transition-shadow',
        chosen ? 'border-accent shadow-sm ring-1 ring-accent' : 'border-line-subtle',
      )}
      // Handed over as a custom property, never as `background-color`. A
      // component that writes a colour into its own markup is what the token
      // rule forbids, and a swatch is the one colour on screen that is a pixel
      // of the sprite rather than a piece of the interface - so it is named
      // for that in the stylesheet instead of being made an exception here.
      style={{ ['--swatch' as string]: toHexa(slot.rgba) }}
    >
      <span className="rounded-[2px] bg-surface-content px-0.5 text-fg-primary">{slot.index}</span>
    </button>
  );
}

/**
 * Says what a slot is, in the terms the shading tools use.
 *
 * @param slot - The chosen slot.
 * @param palette - The palette it belongs to.
 * @param t - The editor namespace's translator.
 * @returns One line naming the ramp and the position in it, or saying there is
 *   none.
 */
function describe(
  slot: PaletteSlot,
  palette: Palette,
  t: (key: 'palette.inRamp' | 'palette.noRamp', options: Record<string, unknown>) => string,
): string {
  const ramp = palette.ramps.find((candidate) => candidate.name === slot.ramp);
  if (ramp === undefined) {
    return t('palette.noRamp', { index: slot.index });
  }
  return t('palette.inRamp', {
    index: slot.index,
    ramp: ramp.name,
    material: ramp.material,
    // One-based for a reader. `step` is zero at the darkest end on the wire,
    // because that is the position in the ramp's own array, and "step 0 of 4"
    // is not a thing anybody says out loud.
    step: (slot.step ?? 0) + 1,
    of: ramp.slots.length,
  });
}
