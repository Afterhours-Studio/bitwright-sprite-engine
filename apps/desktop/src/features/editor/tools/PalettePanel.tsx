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
 * The colour column: which slots the next stroke writes, how wide it is, and
 * every slot the document may use.
 *
 * A SWATCH IS NOT A COLOUR, IT IS A SLOT. What the pencil carries is the index
 * 7, and what 7 looks like is a property of the palette. The readout beside
 * the chips shows the primary slot's number next to its hex for that reason:
 * the hex is what a person recognises, the number is what every op carries.
 *
 * RAMPS HAVE A TAB OF THEIR OWN. A ramp is the unit the shading tools work in
 * - the engine steps along the ramp a region is already painted with - so a
 * slot that belongs to no ramp is one `shade` will skip. The Ramps tab shows
 * each ramp in order, darkest first, and the loose slots as a group of their
 * own, which is how that becomes visible before a shading op reports it as a
 * count of skipped pixels.
 *
 * EDITING GOES THROUGH `palette_write`, WHICH IS CHECKED. Rust validates the
 * whole palette and refuses the write as a body; nothing is partially applied.
 * The structural rules are ones this panel can see coming, so it keeps to them
 * rather than letting Rust say no: slots are numbered 1 to n without gaps,
 * which is why only the last slot can be removed and a new one is always n+1;
 * there are at most as many as the style allows and never more than 62; and a
 * slot that any layer's pixels still use cannot go, so the panel counts those
 * pixels and says so instead of sending a write that would come back
 * `palette.unknown_slot`. Anything Rust still refuses is shown here, beside the
 * palette it was about, with the rule it broke named.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Circle, Minus, Plus, Square } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { fromHex, toHex, toHexa } from '@/features/editor/colour';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { cn } from '@/lib/cn';
import { styleRead } from '@/lib/document';
import { useDocumentStore } from '@/stores/useDocumentStore';
import {
  MAX_BRUSH_SIZE,
  MAX_SLOT,
  MIN_BRUSH_SIZE,
  useEditorStore,
  type BrushShape,
} from '@/stores/useEditorStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { Layer, Palette, PaletteSlot, Style, StylePreset } from '@/types/document';

/** The reason codes `palette_write` refuses with all begin with this. */
const PALETTE_CODE = 'palette.';

/** The brush sizes offered as cards; the stepper covers the rest. */
const BRUSH_CARDS = [1, 2, 3, 4] as const;

/**
 * The dot drawn on each brush card, growing with the size it stands for.
 *
 * Classes rather than a computed width, so the dot stays inside the design
 * system's spacing scale.
 */
const BRUSH_DOT: Readonly<Record<(typeof BRUSH_CARDS)[number], string>> = {
  1: 'w-1 h-1',
  2: 'w-1.5 h-1.5',
  3: 'w-2 h-2',
  4: 'w-2.5 h-2.5',
};

/** The two views the column offers. */
type PaletteTab = 'swatches' | 'ramps';

/**
 * The colour column.
 *
 * Fills the height it is given and scrolls its body on its own, so the chips
 * and the brush stay in reach however long the palette is.
 *
 * @returns The column.
 */
export function PalettePanel(): ReactElement {
  const { t } = useTranslation('panels');

  const palette = useDocumentStore((state) => state.palette);
  const [tab, setTab] = useState<PaletteTab>('swatches');

  return (
    <aside
      aria-label={t('colour.region')}
      className="w-64 bg-neutral-950 border-l border-neutral-800 flex flex-col h-full shrink-0"
    >
      <div className="p-3 border-b border-neutral-800 bg-neutral-900/40 shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-neutral-300">{t('colour.title')}</h3>
          <div
            role="tablist"
            aria-label={t('colour.tabs.label')}
            className="flex space-x-1 bg-neutral-900 p-0.5 rounded border border-neutral-800"
          >
            {(['swatches', 'ramps'] as const).map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={tab === name}
                onClick={() => {
                  setTab(name);
                }}
                className={cn(
                  'px-2 py-0.5 text-[11px] font-medium rounded',
                  tab === name ? 'bg-neutral-800 text-neutral-50' : 'text-neutral-400',
                )}
              >
                {name === 'swatches' ? t('colour.tabs.swatches') : t('colour.tabs.ramps')}
              </button>
            ))}
          </div>
        </div>

        <SlotChips palette={palette} />
        <BrushBlock />
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {palette === null ? (
          <NoDocument />
        ) : tab === 'swatches' ? (
          <SwatchesTab palette={palette} />
        ) : (
          <RampsTab palette={palette} />
        )}
        <Refusal />
      </div>
    </aside>
  );
}

/**
 * Says there is nothing to show, in the editor's own words for it.
 *
 * @returns The line.
 */
function NoDocument(): ReactElement {
  const { t } = useTranslation('editor');
  return <p className="text-xs text-neutral-500">{t('palette.noDocument')}</p>;
}

/**
 * The palette refusal, when the last thing that failed was a palette write.
 *
 * The store keeps one reason code for whatever failed last. Only the palette
 * family is shown here, so a failed composite or a failed layer read cannot
 * appear under the palette as though the palette had been rejected.
 *
 * @returns The alert, or nothing.
 */
function Refusal(): ReactElement | null {
  const { t } = useTranslation('editor');
  const translateError = useErrorMessage();
  const error = useDocumentStore((state) => state.error);
  if (error === null || !error.startsWith(PALETTE_CODE)) {
    return null;
  }
  return (
    <p role="alert" className="rounded bg-neutral-900 p-2 text-[11px] text-red-400">
      {t('palette.refused', { reason: translateError(error) })}
    </p>
  );
}

interface PaletteProps {
  palette: Palette;
}

/**
 * The primary and secondary chips, the swap, and the primary slot's readout.
 *
 * @param props - The palette, or null when no document is open.
 * @returns The row.
 */
function SlotChips({ palette }: { palette: Palette | null }): ReactElement {
  const { t } = useTranslation('panels');
  const slot = useEditorStore((state) => state.slot);
  const secondarySlot = useEditorStore((state) => state.secondarySlot);
  const swapSlots = useEditorStore((state) => state.swapSlots);

  const primary = findSlot(palette, slot);
  const secondary = findSlot(palette, secondarySlot);

  return (
    <div className="mt-3 flex items-center space-x-2">
      <div className="relative w-12 h-10 shrink-0">
        <span
          role="img"
          aria-label={t('colour.secondary', { index: secondarySlot })}
          className="palette-swatch absolute bottom-0 right-0 w-7 h-7 border border-neutral-800"
          style={swatchStyle(secondary)}
        />
        <span
          role="img"
          aria-label={t('colour.primary', { index: slot })}
          className="palette-swatch absolute top-0 left-0 w-8 h-8 ring-1 ring-white z-20"
          style={swatchStyle(primary)}
        />
      </div>
      <button
        type="button"
        aria-label={t('colour.swap')}
        title={t('colour.swap')}
        onClick={swapSlots}
        className="p-1 rounded text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800"
      >
        <ArrowLeftRight className="w-3.5 h-3.5" />
      </button>
      <div className="flex-1 min-w-0 bg-neutral-900 border border-neutral-800 px-2 py-1 rounded">
        <p className="text-[10px] text-neutral-500 uppercase">{t('colour.pri')}</p>
        <p className="text-xs font-medium text-neutral-200 truncate" data-testid="slot-readout">
          {primary === null ? t('colour.missing') : toHex(primary.rgba)} / {slot}
        </p>
      </div>
    </div>
  );
}

/**
 * The brush size cards, the footprint toggle and the stepper.
 *
 * The cards cover the sizes sprite work actually uses; the stepper reaches the
 * rest, up to the store's ceiling, which is where the store clamps anyway.
 *
 * @returns The block.
 */
function BrushBlock(): ReactElement {
  const { t } = useTranslation('panels');
  const brushSize = useEditorStore((state) => state.brushSize);
  const brushShape = useEditorStore((state) => state.brushShape);
  const setBrushSize = useEditorStore((state) => state.setBrushSize);
  const setBrushShape = useEditorStore((state) => state.setBrushShape);

  const footprints: readonly { shape: BrushShape; label: string; icon: ReactElement }[] = [
    { shape: 'circle', label: t('colour.brush.circle'), icon: <Circle className="w-3 h-3" /> },
    { shape: 'square', label: t('colour.brush.square'), icon: <Square className="w-3 h-3" /> },
  ];

  return (
    <div className="mt-3 pt-2.5 border-t border-neutral-800/80">
      <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-300">
        <span>{t('colour.brush.label')}</span>
        <span className="text-pink-400">{t('colour.brush.value', { size: brushSize })}</span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {BRUSH_CARDS.map((size) => (
          <button
            key={size}
            type="button"
            aria-pressed={brushSize === size}
            aria-label={t('colour.brush.size', { size })}
            onClick={() => {
              setBrushSize(size);
            }}
            className={cn(
              'py-2 px-1 rounded flex flex-col items-center border',
              brushSize === size
                ? 'bg-pink-600 border-pink-500 text-white'
                : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200',
            )}
          >
            <span className="flex h-3 items-center">
              <span
                className={cn(
                  'bg-current',
                  BRUSH_DOT[size],
                  brushShape === 'circle' ? 'rounded-full' : 'rounded-none',
                )}
              />
            </span>
            <span className="mt-1 text-[10px]">{size}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div
          role="group"
          aria-label={t('colour.brush.footprint')}
          className="flex space-x-1 bg-neutral-900 p-0.5 rounded border border-neutral-800"
        >
          {footprints.map(({ shape, label, icon }) => (
            <button
              key={shape}
              type="button"
              aria-pressed={brushShape === shape}
              aria-label={label}
              title={label}
              onClick={() => {
                setBrushShape(shape);
              }}
              className={cn(
                'p-1 rounded',
                brushShape === shape ? 'bg-neutral-800 text-neutral-50' : 'text-neutral-400',
              )}
            >
              {icon}
            </button>
          ))}
        </div>
        <div className="flex items-center space-x-1">
          <button
            type="button"
            aria-label={t('colour.brush.smaller')}
            disabled={brushSize <= MIN_BRUSH_SIZE}
            onClick={() => {
              setBrushSize(brushSize - 1);
            }}
            className="p-1 rounded border border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-neutral-100 disabled:text-neutral-600 disabled:cursor-not-allowed"
          >
            <Minus className="w-3 h-3" />
          </button>
          <span className="w-6 text-center text-xs tabular-nums text-neutral-200">{brushSize}</span>
          <button
            type="button"
            aria-label={t('colour.brush.larger')}
            disabled={brushSize >= MAX_BRUSH_SIZE}
            onClick={() => {
              setBrushSize(brushSize + 1);
            }}
            className="p-1 rounded border border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-neutral-100 disabled:text-neutral-600 disabled:cursor-not-allowed"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The Swatches tab: the style, the count with add and remove, and the grid.
 *
 * @param props - The open palette.
 * @returns The tab body.
 */
function SwatchesTab({ palette }: PaletteProps): ReactElement {
  const { t } = useTranslation('panels');
  const { t: te } = useTranslation('editor');

  const layers = useDocumentStore((state) => state.layers);
  const writePalette = useDocumentStore((state) => state.writePalette);
  const slot = useEditorStore((state) => state.slot);
  const secondarySlot = useEditorStore((state) => state.secondarySlot);
  const setSlot = useEditorStore((state) => state.setSlot);
  const setSecondarySlot = useEditorStore((state) => state.setSecondarySlot);
  const style = useDocumentStyle();

  /** Why the last removal was not sent, or null. */
  const [notice, setNotice] = useState<string | null>(null);

  // The style's ceiling, and never past what the grid alphabet can name. An
  // unread style is not a reason to refuse: Rust checks the real ceiling.
  const ceiling = Math.min(MAX_SLOT, style.value?.rules.maxSlots ?? MAX_SLOT);
  const count = palette.slots.length;
  const last = palette.slots[count - 1] ?? null;
  const full = count >= ceiling;
  const nextIndex = count + 1;

  const presets: Readonly<Record<StylePreset, string>> = {
    hd2d: t('colour.presets.hd2d'),
    snes: t('colour.presets.snes'),
    gameboy: t('colour.presets.gameboy'),
    custom: t('colour.presets.custom'),
  };

  const add = async (): Promise<void> => {
    setNotice(null);
    if (full) {
      return;
    }
    const source = findSlot(palette, slot);
    const added: PaletteSlot = {
      index: nextIndex,
      // A copy of the primary rather than an arbitrary colour, because the
      // usual reason to add a slot is a variation of the one in hand.
      rgba: source === null ? [0, 0, 0, 255] : [...source.rgba],
      name: null,
      ramp: null,
      step: null,
    };
    await writePalette({ ...palette, slots: [...palette.slots, added] });
    const stored = useDocumentStore.getState().palette;
    if (stored !== null && findSlot(stored, nextIndex) !== null) {
      setSlot(nextIndex);
    }
  };

  const remove = async (): Promise<void> => {
    setNotice(null);
    if (last === null || count <= 1) {
      setNotice(t('colour.keepOne'));
      return;
    }
    const used = pixelsUsing(layers, last.index);
    if (used > 0) {
      setNotice(t('colour.inUse', { index: last.index, count: used }));
      return;
    }
    await writePalette(withoutSlot(palette, last.index));
    const stored = useDocumentStore.getState().palette;
    if (stored !== null && findSlot(stored, last.index) === null) {
      // A chip left pointing at a slot that no longer exists would draw
      // nothing and say nothing; the neighbour below is the closest colour
      // the artist was looking at.
      if (slot === last.index) {
        setSlot(last.index - 1);
      }
      if (secondarySlot === last.index) {
        setSecondarySlot(last.index - 1);
      }
    }
  };

  return (
    <>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-neutral-500">{t('colour.style.label')}</span>
        <span className="font-medium text-neutral-200" data-testid="style-preset">
          {style.reading
            ? t('colour.style.reading')
            : style.value === null
              ? t('colour.style.none')
              : presets[style.value.preset]}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="min-w-0 truncate font-semibold text-neutral-300">
            {t('colour.count', { count })}
          </span>
          <span className="flex shrink-0 items-center space-x-1.5 whitespace-nowrap">
            <button
              type="button"
              disabled={full}
              title={
                full
                  ? t('colour.full', { max: ceiling })
                  : t('colour.addHint', { index: nextIndex })
              }
              onClick={() => {
                void add();
              }}
              className="text-pink-400 hover:text-pink-300 disabled:text-neutral-600 disabled:cursor-not-allowed"
            >
              {t('colour.add')}
            </button>
            <span className="text-neutral-600">|</span>
            <button
              type="button"
              disabled={count <= 1}
              title={
                last === null || count <= 1
                  ? t('colour.keepOne')
                  : t('colour.removeHint', { index: last.index })
              }
              onClick={() => {
                void remove();
              }}
              className="text-neutral-400 hover:text-red-400 disabled:text-neutral-600 disabled:cursor-not-allowed"
            >
              {t('colour.remove')}
            </button>
          </span>
        </div>

        {notice !== null && (
          <p role="status" className="text-[11px] text-amber-400">
            {notice}
          </p>
        )}

        <div
          role="group"
          aria-label={t('colour.grid')}
          className="grid grid-cols-7 gap-1.5 p-2 bg-neutral-900/60 rounded border border-neutral-800/80 max-h-48 overflow-y-auto"
        >
          {palette.slots.map((entry) => (
            <Swatch
              key={entry.index}
              slot={entry}
              primary={entry.index === slot}
              secondary={entry.index === secondarySlot}
              label={swatchLabel(entry, palette, (key, options) => te(key, options))}
              onPrimary={setSlot}
              onSecondary={setSecondarySlot}
            />
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * The Ramps tab: every ramp in order, the loose slots, and the primary slot
 * described in the shading tools' terms with its colour editor.
 *
 * @param props - The open palette.
 * @returns The tab body.
 */
function RampsTab({ palette }: PaletteProps): ReactElement {
  const { t } = useTranslation('panels');
  const { t: te } = useTranslation('editor');

  const writePalette = useDocumentStore((state) => state.writePalette);
  const slot = useEditorStore((state) => state.slot);
  const secondarySlot = useEditorStore((state) => state.secondarySlot);
  const setSlot = useEditorStore((state) => state.setSlot);
  const setSecondarySlot = useEditorStore((state) => state.setSecondarySlot);

  const [editing, setEditing] = useState(false);

  const chosen = findSlot(palette, slot);
  const ramped = new Set(palette.ramps.flatMap((ramp) => ramp.slots));
  const loose = palette.slots.filter((entry) => !ramped.has(entry.index));

  /**
   * Replaces one slot's colour, leaving every pixel and every ramp alone.
   *
   * @param index - The slot to recolour.
   * @param rgba - Its new bytes.
   */
  const recolour = (index: number, rgba: [number, number, number, number]): void => {
    void writePalette({
      ...palette,
      slots: palette.slots.map((entry) => (entry.index === index ? { ...entry, rgba } : entry)),
    });
  };

  const swatch = (entry: PaletteSlot, label: string): ReactElement => (
    <Swatch
      key={entry.index}
      slot={entry}
      primary={entry.index === slot}
      secondary={entry.index === secondarySlot}
      label={label}
      onPrimary={setSlot}
      onSecondary={setSecondarySlot}
    />
  );

  return (
    <>
      <div className="rounded border border-neutral-800 bg-neutral-900 p-2">
        <p className="text-[10px] text-neutral-500 uppercase">{t('colour.chosen')}</p>
        <p className="mt-1 text-[11px] text-neutral-300">
          {chosen === null
            ? te('palette.noSlot', { index: slot })
            : describe(chosen, palette, (key, options) => te(key, options))}
        </p>
        {chosen !== null && (
          <div className="mt-2 flex items-center gap-2">
            {editing ? (
              <>
                <label className="flex items-center gap-2 text-[11px] text-neutral-400">
                  {te('palette.colour')}
                  <input
                    type="color"
                    className="h-6 w-10 cursor-pointer rounded border border-neutral-700 bg-transparent"
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
                  {te('palette.done')}
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
                {te('palette.edit')}
              </Button>
            )}
          </div>
        )}
      </div>

      {palette.ramps.length === 0 && (
        <p className="text-[11px] text-neutral-500">{t('colour.noRamps')}</p>
      )}

      {palette.ramps.map((ramp) => (
        <section key={ramp.name} className="space-y-1.5">
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="font-medium text-neutral-300">
              {te('palette.ramp', { name: ramp.name, material: ramp.material })}
            </span>
            <span className="text-[10px] text-neutral-500">
              {t('colour.rampSlots', { count: ramp.slots.length })}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ramp.slots.map((index, position) => {
              const entry = findSlot(palette, index);
              return entry === null
                ? null
                : swatch(
                    entry,
                    te('palette.swatchInRamp', {
                      index: entry.index,
                      ramp: ramp.name,
                      step: position + 1,
                      of: ramp.slots.length,
                    }),
                  );
            })}
          </div>
        </section>
      ))}

      {loose.length > 0 && (
        <section className="space-y-1.5">
          {/* Named rather than left unlabelled, because a slot outside every
              ramp is the one a shading op will skip, and the count of skipped
              pixels it reports afterwards does not say which slot did it. */}
          <p className="text-[11px] font-medium text-neutral-300">{te('palette.unramped')}</p>
          <div className="flex flex-wrap gap-1.5">
            {loose.map((entry) => swatch(entry, te('palette.swatch', { index: entry.index })))}
          </div>
        </section>
      )}
    </>
  );
}

interface SwatchProps {
  slot: PaletteSlot;
  primary: boolean;
  secondary: boolean;
  label: string;
  onPrimary: (index: number) => void;
  onSecondary: (index: number) => void;
}

/**
 * One slot, as a square that can be picked into either chip.
 *
 * Right click picks the secondary, which is the reference studio's gesture and
 * Aseprite's; the context menu it would otherwise open has nothing in it for a
 * swatch.
 *
 * @param props - The slot, which chips hold it, and what to call it.
 * @returns The swatch.
 */
function Swatch({
  slot,
  primary,
  secondary,
  label,
  onPrimary,
  onSecondary,
}: SwatchProps): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={primary}
      aria-label={label}
      title={label}
      onClick={() => {
        onPrimary(slot.index);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onSecondary(slot.index);
      }}
      className={cn(
        'palette-swatch w-6 h-6 rounded-sm hover:scale-110 transition-transform',
        primary ? 'ring-2 ring-white' : secondary ? 'ring-2 ring-sky-400' : '',
      )}
      // Handed over as a custom property, never as `background-color`. A
      // component that writes a colour into its own markup is what the token
      // rule forbids, and a swatch is the one colour on screen that is a pixel
      // of the sprite rather than a piece of the interface.
      style={swatchStyle(slot)}
    />
  );
}

/** The document's style, and whether it is still being read. */
interface DocumentStyle {
  value: Style | null;
  reading: boolean;
}

/**
 * Reads the style the open asset is checked against.
 *
 * The asset's own style wins; without one it inherits its project's. Read
 * here rather than held in a store because nothing else on screen needs it
 * yet, and a read that fails leaves the readout saying there is no style
 * rather than blocking the palette.
 *
 * @returns The style, or null when there is none or it could not be read.
 */
function useDocumentStyle(): DocumentStyle {
  const asset = useDocumentStore((state) => state.asset);
  const projects = useProjectStore((state) => state.projects);
  const project =
    asset === null ? undefined : projects.find((candidate) => candidate.id === asset.projectId);
  const styleId = asset?.styleId ?? project?.styleId ?? null;

  const [read, setRead] = useState<{ id: string; value: Style | null } | null>(null);

  useEffect(() => {
    if (styleId === null) {
      return;
    }
    let live = true;
    void styleRead(styleId).then((result) => {
      if (live) {
        setRead({ id: styleId, value: result.ok ? result.value : null });
      }
    });
    return () => {
      live = false;
    };
  }, [styleId]);

  if (styleId === null) {
    return { value: null, reading: false };
  }
  if (read === null || read.id !== styleId) {
    return { value: null, reading: true };
  }
  return { value: read.value, reading: false };
}

/**
 * Finds a slot by index.
 *
 * @param palette - The palette, or null.
 * @param index - The slot.
 * @returns The slot, or null when the palette has none by that number.
 */
function findSlot(palette: Palette | null, index: number): PaletteSlot | null {
  return palette?.slots.find((entry) => entry.index === index) ?? null;
}

/**
 * The custom property a swatch or a chip is coloured through.
 *
 * @param slot - The slot it shows, or null for an empty chip.
 * @returns The style, with no colour for an empty chip.
 */
function swatchStyle(slot: PaletteSlot | null): Record<string, string> {
  return slot === null ? {} : { '--swatch': toHexa(slot.rgba) };
}

/**
 * How many pixels, across every layer, are painted with a slot.
 *
 * @param layers - The document's layers.
 * @param index - The slot.
 * @returns The count.
 */
function pixelsUsing(layers: readonly Layer[], index: number): number {
  let count = 0;
  for (const layer of layers) {
    for (const value of layer.buffer.data) {
      if (value === index) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * The palette with one slot taken out, and every ramp told.
 *
 * Rust refuses a ramp that names a slot that does not exist, and a slot whose
 * `step` disagrees with its position in its ramp, so both are rewritten here:
 * the slot leaves its ramp, and the slots after it in that ramp move up a step.
 *
 * @param palette - The palette.
 * @param index - The slot to remove, which must be the last.
 * @returns The palette to write.
 */
function withoutSlot(palette: Palette, index: number): Palette {
  const ramps = palette.ramps.map((ramp) => ({
    ...ramp,
    slots: ramp.slots.filter((entry) => entry !== index),
  }));
  const slots = palette.slots
    .filter((entry) => entry.index !== index)
    .map((entry) => {
      const ramp = ramps.find((candidate) => candidate.name === entry.ramp);
      return ramp === undefined ? entry : { ...entry, step: ramp.slots.indexOf(entry.index) };
    });
  return { slots, ramps };
}

/**
 * What a swatch is called: its number, and its place in its ramp if it has one.
 *
 * @param slot - The slot.
 * @param palette - Its palette.
 * @param t - The editor namespace's translator.
 * @returns The label.
 */
function swatchLabel(
  slot: PaletteSlot,
  palette: Palette,
  t: (key: 'palette.swatch' | 'palette.swatchInRamp', options: Record<string, unknown>) => string,
): string {
  const ramp = palette.ramps.find((candidate) => candidate.name === slot.ramp);
  if (ramp === undefined) {
    return t('palette.swatch', { index: slot.index });
  }
  return t('palette.swatchInRamp', {
    index: slot.index,
    ramp: ramp.name,
    step: ramp.slots.indexOf(slot.index) + 1,
    of: ramp.slots.length,
  });
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
