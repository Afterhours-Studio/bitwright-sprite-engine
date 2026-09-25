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
 * The tilemap editor: pick a tile, click cells to place it, manage layers and
 * their parallax, for one background asset.
 *
 * SELF-CONTAINED, BECAUSE IT IS MOUNTED BY SOMETHING THAT DOES NOT EXIST YET.
 * Unlike `StepRail` and `PalettePanel`, which read a shared document store,
 * this component owns every byte of state it shows: the map, the tile
 * palette, the preview and the active layer and tile. Nothing outside it has
 * to know a tilemap is being edited, so nothing outside it has to change when
 * a later task decides where the editor lives on screen.
 *
 * EVERY WRITE ANSWERS WITH THE WHOLE MAP, SO THAT IS WHAT IS KEPT. `tilemap_*`
 * commands hand back the map as written rather than a delta, which is what
 * lets this component skip a second read after every click: the response
 * itself is the next state. Only the preview is a separate call, because the
 * composite is not part of the map's own shape.
 *
 * IT FILLS THE STAGE. A background asset shows this editor where a sprite
 * shows its canvas, so the map is drawn on the workspace checker and its
 * controls float over it in the same panels the sprite stage uses. The top
 * left corner is left free for the agent chip the stage puts there.
 *
 * `tilemap.none` IS NOT AN ERROR, IT IS A STATE. A background asset with no
 * map yet is the ordinary starting point, not a failure to show in the alert
 * region, so that one reason code switches the screen to the create form
 * instead of being translated and surfaced like every other one.
 *
 * ONE TOKEN GUARDS EVERY ASYNC ANSWER, NOT JUST `load`'s. A write sent for
 * one asset can still be in flight when the panel is pointed at another one -
 * a click lands, then the artist switches assets before it answers - and its
 * response is a map for an asset that is no longer on screen. `loadTokenRef`
 * is bumped the moment the asset shown changes, every write and every load
 * captures it before it starts, and every place a response is about to become
 * state checks it is still current first. `mountedRef` is the same idea for
 * the one case a token cannot cover: the panel being gone entirely.
 */

import { Eraser, Layers, Map as MapIcon, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { cn } from '@/lib/cn';
import type { ShellResult } from '@/lib/tauri';
import {
  onTilemapChanged,
  tilemapAddLayer,
  tilemapCreate,
  tilemapPlace,
  tilemapPreview,
  tilemapRead,
  tilemapRemoveLayer,
  tilemapSetLayer,
  tilemapTiles,
} from '@/lib/tilemap';
import type { TileAsset, Tilemap, TilemapLayer } from '@/types/tilemap';

import type { UnlistenFn } from '@tauri-apps/api/event';

/** The reason code `tilemap_read` answers with for an asset that has no map yet. */
const NONE_CODE = 'tilemap.none';

/** The tile sizes the create form offers. */
const TILE_SIZES = [8, 16, 32, 48, 64];

const DEFAULT_TILE_SIZE = 16;
const DEFAULT_COLUMNS = 20;
const DEFAULT_ROWS = 12;

/** How much larger than the tile itself a grid cell is drawn on screen. */
const ZOOM = 2;

/** The stage's floating panel, as the sprite stage draws its zoom box and actions. */
const FLOAT = 'bg-surface-float border border-line-subtle rounded-lg shadow-md';

/** A compact field on a floating panel. */
const SMALL_INPUT =
  'rounded-sm border border-line-input bg-surface-input px-1.5 py-0.5 text-[11px] text-fg-primary focus:border-line-focus focus:outline-none';

/** A label with its control at the trailing end. */
const FIELD_ROW = 'flex items-center justify-between gap-2 text-[11px] text-fg-secondary';

/** Parallax is refused outside this range, by the create form and by a layer's own field. */
const MIN_PARALLAX = 0;
const MAX_PARALLAX = 4;

export interface TilemapEditorProps {
  /** The background asset being edited. */
  assetId: string;
}

/**
 * The tilemap editor.
 *
 * @param props - The asset being edited.
 * @returns The create form, or the picker, grid, layers and preview.
 */
export function TilemapEditor({ assetId }: TilemapEditorProps): ReactElement {
  const { t } = useTranslation('tilemap');
  const translateError = useErrorMessage();

  const [tilemap, setTilemap] = useState<Tilemap | null>(null);
  const [tiles, setTiles] = useState<TileAsset[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [activeLayer, setActiveLayer] = useState<string | null>(null);
  // `null` is the eraser, never an unselected state: it is always one of the
  // choices, and it is the default one, so a first click cannot place a tile
  // nobody chose.
  const [activeTile, setActiveTile] = useState<string | null>(null);
  const [needsCreate, setNeedsCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tileSize, setTileSize] = useState(DEFAULT_TILE_SIZE);
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [rows, setRows] = useState(DEFAULT_ROWS);

  const [newLayerName, setNewLayerName] = useState('');
  const [newLayerParallax, setNewLayerParallax] = useState(1);

  // What a layer's parallax field shows while it is being typed into, keyed
  // by layer name. Absent (or cleared back out) means "show the layer's own
  // committed value" - which is why a rejected or refused edit is undone by
  // deleting the draft rather than by writing the old number back into it.
  const [parallaxDrafts, setParallaxDrafts] = useState<Record<string, string>>({});

  // Bumped whenever the asset shown changes, and once more at the start of
  // every `load`. Every write and read captures this before it starts an
  // await, and checks it again after: a response whose token no longer
  // matches is for an asset (or an older request for this one) this panel has
  // since moved on from, and is dropped rather than applied.
  const loadTokenRef = useRef(0);

  // True for as long as the component is actually mounted, regardless of
  // which asset it is showing. A token catches an answer that arrives after
  // the asset changed; this catches one that arrives after the panel is gone.
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Advances the token, invalidating every write and read already in flight.
   *
   * @returns The new, current token.
   */
  const bumpToken = useCallback((): number => {
    loadTokenRef.current += 1;
    return loadTokenRef.current;
  }, []);

  /**
   * Whether a response captured under `token` is still worth applying: the
   * component is still mounted, and nothing has bumped the token since.
   *
   * @param token - The token captured before the request that answered.
   * @returns Whether the response may still become state.
   */
  const isCurrent = useCallback(
    (token: number): boolean => mountedRef.current && loadTokenRef.current === token,
    [],
  );

  /**
   * Replaces the map, keeping the active layer selected if it still exists
   * and otherwise falling back to the back-most one.
   *
   * @param map - The map as the shell just answered with.
   */
  const applyMap = useCallback((map: Tilemap): void => {
    setTilemap(map);
    setActiveLayer((current) =>
      current !== null && map.layers.some((layer) => layer.name === current)
        ? current
        : (map.layers[0]?.name ?? null),
    );
  }, []);

  /**
   * Applies the outcome of a write command, guarded by the token captured
   * when that write was sent: the new map and a fresh preview on success, the
   * reason code as an alert on failure - but only while the response is
   * still current. Dropped otherwise, success or failure alike, because a
   * refusal for an asset no longer on screen is not this screen's alert to
   * show either.
   *
   * @param token - `loadTokenRef.current` as it stood when the write started.
   * @param result - What the command answered with.
   */
  const afterWrite = useCallback(
    async (token: number, result: ShellResult<Tilemap>): Promise<void> => {
      if (!isCurrent(token)) {
        return;
      }

      if (!result.ok) {
        setError(result.error.code);
        return;
      }
      setError(null);
      applyMap(result.value);

      const previewResult = await tilemapPreview(assetId);
      if (!isCurrent(token)) {
        return;
      }
      if (previewResult.ok) {
        setPreview(previewResult.value);
      }
    },
    [applyMap, assetId, isCurrent],
  );

  /**
   * Reads the map fresh, for the initial mount and for every change event.
   *
   * Stamped with a token that every await point checks against the latest
   * one issued: a result that comes back after a newer `load` has started -
   * for a different asset, or a second `tilemap://changed` for this one - is
   * dropped rather than applied over whatever the newer request found.
   */
  const load = useCallback(async (): Promise<void> => {
    const token = bumpToken();

    const result = await tilemapRead(assetId);
    if (!isCurrent(token)) {
      return;
    }

    if (!result.ok) {
      if (result.error.code === NONE_CODE) {
        setNeedsCreate(true);
        setTilemap(null);
        setError(null);
      } else {
        setNeedsCreate(false);
        setError(result.error.code);
      }
      return;
    }

    setNeedsCreate(false);
    setError(null);
    applyMap(result.value);

    const tilesResult = await tilemapTiles(assetId);
    if (!isCurrent(token)) {
      return;
    }
    if (tilesResult.ok) {
      setTiles(tilesResult.value);
    }

    const previewResult = await tilemapPreview(assetId);
    if (!isCurrent(token)) {
      return;
    }
    if (previewResult.ok) {
      setPreview(previewResult.value);
    }
  }, [assetId, applyMap, bumpToken, isCurrent]);

  useEffect(() => {
    let activeEffect = true;
    let unlisten: UnlistenFn | undefined;

    // Advance the token before anything else: any write or load still in
    // flight for the asset shown before this effect is now stale, and the
    // state reset below makes that visible immediately rather than only once
    // the new asset's own `load` answers.
    bumpToken();

    setTilemap(null);
    setTiles([]);
    setPreview(null);
    setActiveLayer(null);
    setActiveTile(null);
    setError(null);
    setNeedsCreate(false);
    setParallaxDrafts({});

    void load();

    void onTilemapChanged((event) => {
      if (event.assetId === assetId) {
        void load();
      }
    }).then((detach) => {
      if (activeEffect) {
        unlisten = detach;
        return;
      }
      // Unmounted, or moved on to another asset, while the subscription was
      // still being made: the listener exists, so it has to be taken back off
      // here or it outlives this effect.
      detach();
    });

    return () => {
      activeEffect = false;
      unlisten?.();
    };
  }, [assetId, load, bumpToken]);

  /** Gives the asset an empty map at the sizes chosen in the create form. */
  const handleCreate = async (): Promise<void> => {
    const token = loadTokenRef.current;
    const result = await tilemapCreate(assetId, tileSize, tileSize, columns, rows);
    if (!isCurrent(token)) {
      return;
    }
    await afterWrite(token, result);
    if (result.ok) {
      setNeedsCreate(false);
      const tilesResult = await tilemapTiles(assetId);
      if (!isCurrent(token)) {
        return;
      }
      if (tilesResult.ok) {
        setTiles(tilesResult.value);
      }
    }
  };

  /**
   * Places the active tile, or clears the cell with the eraser, on the
   * active layer.
   *
   * @param x - The cell's column.
   * @param y - The cell's row.
   */
  const handlePlace = async (x: number, y: number): Promise<void> => {
    if (activeLayer === null) {
      return;
    }
    const token = loadTokenRef.current;
    const result = await tilemapPlace(assetId, activeLayer, [{ x, y, tile: activeTile }]);
    if (!isCurrent(token)) {
      return;
    }
    await afterWrite(token, result);
  };

  /** Adds the layer named in the add-layer form, in front of the others. */
  const handleAddLayer = async (): Promise<void> => {
    const name = newLayerName.trim();
    if (name === '') {
      return;
    }
    const token = loadTokenRef.current;
    const result = await tilemapAddLayer(assetId, name, newLayerParallax);
    if (!isCurrent(token)) {
      return;
    }
    await afterWrite(token, result);
    if (result.ok) {
      setNewLayerName('');
      setNewLayerParallax(1);
    }
  };

  /**
   * Removes a layer.
   *
   * @param name - The layer to remove.
   */
  const handleRemoveLayer = async (name: string): Promise<void> => {
    const token = loadTokenRef.current;
    const result = await tilemapRemoveLayer(assetId, name);
    if (!isCurrent(token)) {
      return;
    }
    await afterWrite(token, result);
  };

  /**
   * Commits a typed parallax value, or rejects it.
   *
   * Reads the field's raw text rather than trusting `valueAsNumber`: an empty
   * or half-typed field (a bare "-", a trailing ".") reads back as `NaN` from
   * that, but `Number('')` is `0`, a legitimate parallax that would otherwise
   * commit silently while the artist is still typing over it.
   *
   * Either way the field's draft is cleared afterwards, so it falls back to
   * showing the layer's own committed value: the one it had all along, if the
   * text was rejected before anything was sent, or the one the response just
   * applied, if the shell refused the write outright. What is never left on
   * screen is the typed text once it is known not to have taken effect.
   *
   * @param layer - The layer being edited.
   * @param raw - The input's text at the moment it was committed.
   */
  const handleSetParallax = async (layer: TilemapLayer, raw: string): Promise<void> => {
    const clearDraft = (): void => {
      setParallaxDrafts((current) => {
        if (!(layer.name in current)) {
          return current;
        }
        return Object.fromEntries(Object.entries(current).filter(([key]) => key !== layer.name));
      });
    };

    const trimmed = raw.trim();
    const parallax = Number(trimmed);
    const rejected =
      trimmed === '' ||
      !Number.isFinite(parallax) ||
      parallax < MIN_PARALLAX ||
      parallax > MAX_PARALLAX;

    if (rejected) {
      clearDraft();
      return;
    }

    const token = loadTokenRef.current;
    const result = await tilemapSetLayer(assetId, layer.name, parallax, undefined);
    if (!isCurrent(token)) {
      return;
    }
    await afterWrite(token, result);
    clearDraft();
  };

  /**
   * Toggles a layer's visibility.
   *
   * @param name - The layer being toggled.
   * @param visible - The new state.
   */
  const handleToggleVisible = async (name: string, visible: boolean): Promise<void> => {
    const token = loadTokenRef.current;
    const result = await tilemapSetLayer(assetId, name, undefined, visible);
    if (!isCurrent(token)) {
      return;
    }
    await afterWrite(token, result);
  };

  const refusal = error !== null ? translateError(error) : null;

  return (
    <div className="sprite-checkerboard relative h-full w-full overflow-hidden bg-surface-well text-fg-primary">
      {/* Named for assistive technology from the first render, before the map
          has answered and any panel is on screen; the panels show it too. */}
      <h3 className="sr-only">{t('title')}</h3>
      {/* The grid sits where the sprite would, and scrolls under the floating
          panels rather than being pushed aside by them: the panels are the
          stage's chrome, and the map is the stage. The padding is what lets
          any cell be scrolled out from under a panel. */}
      <div className="absolute inset-0 overflow-auto">
        <div className="flex min-h-full min-w-full w-max items-center justify-center p-24">
          {tilemap !== null && activeLayer !== null && (
            <div
              className="grid gap-px bg-line shadow-lg ring-1 ring-line"
              style={{
                gridTemplateColumns: `repeat(${tilemap.columns}, ${tilemap.tileWidth * ZOOM}px)`,
              }}
            >
              {Array.from({ length: tilemap.rows }, (_, y) =>
                Array.from({ length: tilemap.columns }, (_, x) => {
                  const layer = tilemap.layers.find((entry) => entry.name === activeLayer);
                  const tileId = layer?.tiles[y * tilemap.columns + x] ?? null;
                  const tile =
                    tileId === null ? null : (tiles.find((entry) => entry.id === tileId) ?? null);
                  return (
                    <button
                      key={`${x}-${y}`}
                      type="button"
                      aria-label={t('cell', { x, y })}
                      onClick={() => {
                        void handlePlace(x, y);
                      }}
                      style={{
                        width: tilemap.tileWidth * ZOOM,
                        height: tilemap.tileHeight * ZOOM,
                      }}
                      className="flex items-center justify-center bg-surface-well p-0 hover:bg-surface-content-alt focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-line-focus"
                    >
                      {tile !== null && (
                        <img
                          src={tile.preview}
                          alt=""
                          className="pixelated h-full w-full object-contain"
                        />
                      )}
                    </button>
                  );
                }),
              )}
            </div>
          )}
        </div>
      </div>

      {needsCreate && (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className={cn(FLOAT, 'flex w-full max-w-xs flex-col gap-3 p-4')}>
            <div className="flex items-center gap-2">
              <MapIcon
                aria-hidden="true"
                className="w-4 h-4 text-fg-secondary"
                strokeWidth={1.75}
              />
              <p className="text-xs font-semibold text-fg-primary">{t('title')}</p>
            </div>
            <p className="text-xs font-semibold text-fg-primary">{t('create.heading')}</p>
            <p className="text-[11px] leading-relaxed text-fg-secondary">{t('create.body')}</p>

            <label className={FIELD_ROW}>
              {t('create.tileSize')}
              <select
                value={tileSize}
                onChange={(event) => {
                  setTileSize(Number(event.target.value));
                }}
                className={SMALL_INPUT}
              >
                {TILE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>

            <label className={FIELD_ROW}>
              {t('create.columns')}
              <input
                type="number"
                min={1}
                max={256}
                value={columns}
                onChange={(event) => {
                  setColumns(Number(event.target.value));
                }}
                className={cn(SMALL_INPUT, 'w-16')}
              />
            </label>

            <label className={FIELD_ROW}>
              {t('create.rows')}
              <input
                type="number"
                min={1}
                max={256}
                value={rows}
                onChange={(event) => {
                  setRows(Number(event.target.value));
                }}
                className={cn(SMALL_INPUT, 'w-16')}
              />
            </label>

            <Button
              variant="primary"
              className="w-full py-2"
              onClick={() => {
                void handleCreate();
              }}
            >
              {t('create.submit')}
            </Button>
          </div>
        </div>
      )}

      {tilemap !== null && (
        <>
          {/* Tiles: the brush box, bottom left, where the readout sits on a
              sprite's stage. The top left is left to the agent chip. */}
          <section
            className={cn(FLOAT, 'absolute bottom-3 left-3 flex max-w-[18rem] flex-col gap-2 p-2')}
          >
            <div className="flex items-center justify-between gap-2 px-0.5">
              <p className="text-xs font-semibold text-fg-primary">{t('title')}</p>
              <p className="text-[11px] font-medium uppercase tracking-wider text-fg-secondary">
                {t('tiles.title')}
              </p>
            </div>
            <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
              {tiles.map((tile) => (
                <button
                  key={tile.id}
                  type="button"
                  aria-pressed={activeTile === tile.id}
                  aria-label={tile.name}
                  title={tile.name}
                  onClick={() => {
                    setActiveTile(tile.id);
                  }}
                  className={cn(
                    'checkerboard-pattern flex h-8 w-8 items-center justify-center rounded-sm border p-0.5',
                    activeTile === tile.id
                      ? 'border-accent ring-1 ring-accent'
                      : 'border-line-subtle hover:border-line-strong',
                  )}
                >
                  <img
                    src={tile.preview}
                    alt=""
                    className="pixelated h-full w-full object-contain"
                  />
                </button>
              ))}
              <Button
                variant={activeTile === null ? 'primary' : 'secondary'}
                aria-pressed={activeTile === null}
                className="h-8 px-2 text-[11px]"
                onClick={() => {
                  setActiveTile(null);
                }}
              >
                <Eraser aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={1.75} />
                {t('tiles.eraser')}
              </Button>
            </div>
            {tiles.length === 0 && (
              <p className="px-0.5 text-[11px] text-fg-secondary">{t('tiles.empty')}</p>
            )}
          </section>

          {/* Layers: styled as the editor's layers panel, top right where the
              sprite stage keeps its canvas actions. */}
          <section
            className={cn(
              FLOAT,
              'absolute right-4 top-4 flex max-h-[calc(100%-2rem)] w-72 flex-col p-0',
            )}
          >
            <div className="flex items-center gap-2 rounded-t-lg border-b border-line-subtle p-3">
              <Layers aria-hidden="true" className="w-4 h-4 text-fg-secondary" strokeWidth={1.75} />
              <p className="text-xs font-semibold text-fg-primary">{t('layers.title')}</p>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
              {tilemap.layers.map((layer) => (
                <div
                  key={layer.name}
                  className={cn(
                    'rounded-md border p-2 text-[11px]',
                    layer.name === activeLayer
                      ? 'bg-surface-content-alt border-accent'
                      : 'bg-surface-content border-line-subtle',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-pressed={layer.name === activeLayer}
                      onClick={() => {
                        setActiveLayer(layer.name);
                      }}
                      className={cn(
                        'min-w-0 flex-1 truncate text-start text-xs font-medium',
                        layer.name === activeLayer ? 'text-fg-primary' : 'text-fg-secondary',
                      )}
                    >
                      {layer.name}
                    </button>

                    <label className="flex items-center gap-1 text-fg-secondary">
                      <input
                        type="checkbox"
                        checked={layer.visible}
                        aria-label={t('layers.visibleFor', { name: layer.name })}
                        onChange={(event) => {
                          void handleToggleVisible(layer.name, event.target.checked);
                        }}
                        className="h-3 w-3 accent-accent"
                      />
                      {t('layers.visible')}
                    </label>

                    <Button
                      variant="ghost"
                      className="px-1.5 py-0.5 text-[11px] hover:text-severity-error"
                      disabled={tilemap.layers.length === 1}
                      onClick={() => {
                        void handleRemoveLayer(layer.name);
                      }}
                    >
                      {t('layers.remove')}
                    </Button>
                  </div>

                  <label className="mt-2 flex items-center justify-between gap-2 border-t border-line-subtle pt-1.5 text-fg-secondary">
                    {t('layers.parallax')}
                    <input
                      type="number"
                      min={MIN_PARALLAX}
                      max={MAX_PARALLAX}
                      step={0.1}
                      value={parallaxDrafts[layer.name] ?? String(layer.parallax)}
                      aria-label={t('layers.parallaxFor', { name: layer.name })}
                      onChange={(event) => {
                        const value = event.target.value;
                        setParallaxDrafts((current) => ({ ...current, [layer.name]: value }));
                      }}
                      onBlur={(event) => {
                        void handleSetParallax(layer, event.target.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          void handleSetParallax(layer, event.currentTarget.value);
                        }
                      }}
                      className={cn(SMALL_INPUT, 'w-16 font-medium')}
                    />
                  </label>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2 border-t border-line-subtle p-2 text-[11px]">
              <label className="flex flex-col gap-1 text-fg-secondary">
                {t('layers.name')}
                <input
                  type="text"
                  value={newLayerName}
                  onChange={(event) => {
                    setNewLayerName(event.target.value);
                  }}
                  className={cn(SMALL_INPUT, 'w-full')}
                />
              </label>
              <div className="flex items-end gap-2">
                <label className="flex flex-1 items-center justify-between gap-2 text-fg-secondary">
                  {t('layers.parallax')}
                  <input
                    type="number"
                    min={MIN_PARALLAX}
                    max={MAX_PARALLAX}
                    step={0.1}
                    value={newLayerParallax}
                    onChange={(event) => {
                      setNewLayerParallax(Number(event.target.value));
                    }}
                    className={cn(SMALL_INPUT, 'w-16')}
                  />
                </label>
                <Button
                  variant="secondary"
                  className="px-2.5 py-1 text-[11px]"
                  onClick={() => {
                    void handleAddLayer();
                  }}
                >
                  <Plus aria-hidden="true" className="w-3 h-3" strokeWidth={1.75} />
                  {t('layers.add')}
                </Button>
              </div>
            </div>
          </section>

          {preview !== null && (
            <section
              className={cn(
                FLOAT,
                'absolute bottom-3 right-3 flex max-w-[16rem] flex-col gap-1.5 p-2',
              )}
            >
              <p className="px-0.5 text-[11px] font-medium uppercase tracking-wider text-fg-secondary">
                {t('preview.title')}
              </p>
              <img
                src={preview}
                alt={t('preview.title')}
                className="pixelated checkerboard-pattern max-h-40 max-w-full rounded-sm border border-line-subtle object-contain"
              />
            </section>
          )}
        </>
      )}

      {refusal !== null && (
        <p
          role="alert"
          className="absolute left-1/2 top-4 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-lg border border-line-subtle bg-surface-float px-3 py-1.5 text-xs text-severity-error shadow-md"
        >
          {refusal}
        </p>
      )}
    </div>
  );
}
