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
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold text-fg-primary">{t('title')}</h3>

      {needsCreate && (
        <div className="flex flex-col gap-2 rounded-sm border border-line-subtle bg-surface-content-alt p-2">
          <p className="text-[11px] font-medium text-fg-primary">{t('create.heading')}</p>
          <p className="text-[11px] text-fg-secondary">{t('create.body')}</p>

          <label className="flex items-center justify-between gap-2 text-[11px] text-fg-secondary">
            {t('create.tileSize')}
            <select
              value={tileSize}
              onChange={(event) => {
                setTileSize(Number(event.target.value));
              }}
              className="rounded-sm border border-line-subtle bg-surface-content px-1 py-0.5 text-fg-primary"
            >
              {TILE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center justify-between gap-2 text-[11px] text-fg-secondary">
            {t('create.columns')}
            <input
              type="number"
              min={1}
              max={256}
              value={columns}
              onChange={(event) => {
                setColumns(Number(event.target.value));
              }}
              className="w-16 rounded-sm border border-line-subtle bg-surface-content px-1 py-0.5 text-fg-primary"
            />
          </label>

          <label className="flex items-center justify-between gap-2 text-[11px] text-fg-secondary">
            {t('create.rows')}
            <input
              type="number"
              min={1}
              max={256}
              value={rows}
              onChange={(event) => {
                setRows(Number(event.target.value));
              }}
              className="w-16 rounded-sm border border-line-subtle bg-surface-content px-1 py-0.5 text-fg-primary"
            />
          </label>

          <Button
            variant="primary"
            className="px-2 py-1 text-[11px]"
            onClick={() => {
              void handleCreate();
            }}
          >
            {t('create.submit')}
          </Button>
        </div>
      )}

      {tilemap !== null && (
        <>
          <section className="flex flex-col gap-1">
            <p className="text-[11px] font-medium text-fg-secondary">{t('tiles.title')}</p>
            <div className="flex flex-wrap gap-1">
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
                    'flex h-8 w-8 items-center justify-center rounded-sm border p-0.5',
                    activeTile === tile.id
                      ? 'border-accent shadow-sm ring-1 ring-accent'
                      : 'border-line-subtle',
                  )}
                >
                  <img
                    src={tile.preview}
                    alt=""
                    style={{ imageRendering: 'pixelated' }}
                    className="h-full w-full object-contain"
                  />
                </button>
              ))}
              <Button
                variant={activeTile === null ? 'primary' : 'ghost'}
                aria-pressed={activeTile === null}
                className="px-2 py-1 text-[11px]"
                onClick={() => {
                  setActiveTile(null);
                }}
              >
                {t('tiles.eraser')}
              </Button>
            </div>
            {tiles.length === 0 && (
              <p className="text-[11px] text-fg-secondary">{t('tiles.empty')}</p>
            )}
          </section>

          {activeLayer !== null && (
            <div
              className="grid gap-px"
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
                      className="flex items-center justify-center border border-line-subtle bg-surface-content-alt p-0"
                    >
                      {tile !== null && (
                        <img
                          src={tile.preview}
                          alt=""
                          style={{ imageRendering: 'pixelated' }}
                          className="h-full w-full object-contain"
                        />
                      )}
                    </button>
                  );
                }),
              )}
            </div>
          )}

          <section className="flex flex-col gap-1">
            <p className="text-[11px] font-medium text-fg-secondary">{t('layers.title')}</p>
            <div className="flex flex-col gap-1">
              {tilemap.layers.map((layer) => (
                <div
                  key={layer.name}
                  className={cn(
                    'flex items-center gap-2 rounded-sm border p-1 text-[11px]',
                    layer.name === activeLayer
                      ? 'border-accent bg-surface-content-alt'
                      : 'border-line-subtle',
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={layer.name === activeLayer}
                    onClick={() => {
                      setActiveLayer(layer.name);
                    }}
                    className="flex-1 text-start font-medium text-fg-primary"
                  >
                    {layer.name}
                  </button>

                  <label className="flex items-center gap-1 text-fg-secondary">
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
                      className="w-14 rounded-sm border border-line-subtle bg-surface-content px-1 py-0.5 text-fg-primary"
                    />
                  </label>

                  <label className="flex items-center gap-1 text-fg-secondary">
                    <input
                      type="checkbox"
                      checked={layer.visible}
                      aria-label={t('layers.visibleFor', { name: layer.name })}
                      onChange={(event) => {
                        void handleToggleVisible(layer.name, event.target.checked);
                      }}
                    />
                    {t('layers.visible')}
                  </label>

                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-[11px]"
                    disabled={tilemap.layers.length === 1}
                    onClick={() => {
                      void handleRemoveLayer(layer.name);
                    }}
                  >
                    {t('layers.remove')}
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 rounded-sm border border-line-subtle p-1 text-[11px]">
              <label className="flex flex-1 items-center gap-1 text-fg-secondary">
                {t('layers.name')}
                <input
                  type="text"
                  value={newLayerName}
                  onChange={(event) => {
                    setNewLayerName(event.target.value);
                  }}
                  className="w-full rounded-sm border border-line-subtle bg-surface-content px-1 py-0.5 text-fg-primary"
                />
              </label>
              <label className="flex items-center gap-1 text-fg-secondary">
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
                  className="w-14 rounded-sm border border-line-subtle bg-surface-content px-1 py-0.5 text-fg-primary"
                />
              </label>
              <Button
                variant="secondary"
                className="px-2 py-1 text-[11px]"
                onClick={() => {
                  void handleAddLayer();
                }}
              >
                {t('layers.add')}
              </Button>
            </div>
          </section>

          {preview !== null && (
            <section className="flex flex-col gap-1">
              <p className="text-[11px] font-medium text-fg-secondary">{t('preview.title')}</p>
              <img
                src={preview}
                alt={t('preview.title')}
                style={{ imageRendering: 'pixelated' }}
                className="max-w-full rounded-sm border border-line-subtle"
              />
            </section>
          )}
        </>
      )}

      {refusal !== null && (
        <p role="alert" className="text-[11px] text-[color:var(--severity-error)]">
          {refusal}
        </p>
      )}
    </div>
  );
}
