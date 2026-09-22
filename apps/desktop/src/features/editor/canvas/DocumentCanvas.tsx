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
 * The stage: the open document, as large as the room allows, and the pointer
 * that draws on it.
 *
 * WHAT IS ON IT. The composite of every visible layer in ordinal order, made
 * by `document_composite` and re-made whenever the op log moves. That is how
 * an agent's drawing appears while a person watches: the agent's write raises
 * `document://changed`, the document store advances its sequence, and this
 * asks for a new picture. Nothing about that path knows which actor wrote.
 *
 * WHAT A STROKE DOES. It accumulates document pixels while the button is
 * down, previews them, and on release commits one batch through
 * `document_write_ops` - one batch, so one undo. Not one pixel of the result
 * is written here; the picture that comes back is the one Rust made.
 *
 * WHERE THE STROKE GOES. Into the layer the current step owns. Painting into a
 * layer the step does not own needs the override to have been set deliberately
 * in the layer list, which is the same act the MCP tools spell `force`. A
 * pointer press cannot set it, which is the point.
 *
 * THE WELL, THE CHECKERBOARD AND THE GRID are the same three the old stage
 * had, in the same order: a well surface behind, the checker pattern under the
 * sprite to show where it is transparent, the sprite, and the pixel grid over
 * it. The grid is `PixelGridOverlay`, which suppresses itself below six screen
 * pixels per document pixel and draws its lines on whole device pixels.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { PixelGridOverlay, MIN_GRID_CELL } from '@/features/editor/PixelGridOverlay';
import { paintTarget } from '@/features/editor/activeLayer';
import { useWorkflowLabels } from '@/features/editor/labels';
import { DocumentSurface, StrokePreview } from '@/features/editor/canvas/DocumentSurface';
import { strokeOps, strokePixels, type Stroke } from '@/features/editor/canvas/stroke';
import { useComposite } from '@/features/editor/canvas/useComposite';
import {
  fitView,
  imageRect,
  stepZoom,
  toCanvasPoint,
  zoomAbout,
  DEFAULT_VIEW,
  type View,
} from '@/features/editor/canvas/view';
import { useElementSize } from '@/hooks/useElementSize';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { cn } from '@/lib/cn';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { useEditorStore } from '@/stores/useEditorStore';
import type { PixelSet, Point } from '@/types/document';

/** The gap between the well's edge and the document, in CSS pixels. */
const WELL_INSET = 12;

/** The colour a slot with no palette entry previews as: mid grey, opaque. */
const UNKNOWN_SLOT: readonly [number, number, number, number] = [128, 128, 128, 255];

/**
 * The stage.
 *
 * @returns The well, the document, and the overlays over it.
 */
export function DocumentCanvas(): ReactElement {
  const { t } = useTranslation('editor');
  const translateError = useErrorMessage();
  const labels = useWorkflowLabels();

  const asset = useDocumentStore((state) => state.asset);
  const layers = useDocumentStore((state) => state.layers);
  const palette = useDocumentStore((state) => state.palette);
  const step = useDocumentStore((state) => state.step);
  const seq = useDocumentStore((state) => state.seq);
  const write = useDocumentStore((state) => state.write);

  const tool = useEditorStore((state) => state.tool);
  const shape = useEditorStore((state) => state.shape);
  const slot = useEditorStore((state) => state.slot);
  const brushSize = useEditorStore((state) => state.brushSize);
  const brushShape = useEditorStore((state) => state.brushShape);
  const targetRole = useEditorStore((state) => state.targetRole);
  const showPixelGrid = useEditorStore((state) => state.showPixelGrid);
  const showCheckerboard = useEditorStore((state) => state.showCheckerboard);

  const { ref, width, height } = useElementSize();
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [preview, setPreview] = useState<readonly PixelSet[]>([]);

  // The composite is asked for again whenever the op log moves or the palette
  // is replaced, and those are the only two things that change the picture.
  const { image, error } = useComposite(asset?.id ?? null, `${String(seq)}:${paletteKey(palette)}`);

  const canvas = { width: asset?.width ?? 0, height: asset?.height ?? 0 };
  // Held as two numbers rather than one object, because an object rebuilt on
  // every render is a new dependency on every render, and the fit effect below
  // would then run forever.
  const stageWidth = Math.max(width - WELL_INSET * 2, 0);
  const stageHeight = Math.max(height - WELL_INSET * 2, 0);
  const viewport = { width: stageWidth, height: stageHeight };

  const target = paintTarget(step?.step ?? null, targetRole, layers);

  /**
   * The drag in progress.
   *
   * A ref rather than state, because a pointer reports a position per frame
   * and rendering the whole stage on each of them would drop the frames the
   * preview is there to fill. What the user sees of it is the preview, which
   * is state and is set once per move.
   */
  const drag = useRef<{ points: Point[]; stroke: Omit<Stroke, 'points'> } | null>(null);
  /** The pan in progress: where the pointer was, and the view it started from. */
  const panning = useRef<{ from: Point; view: View } | null>(null);

  // Fitted when the document changes or the stage is first measured. Refitting
  // on every size change instead would undo a zoom the user set whenever the
  // window moved, which is the editor overriding a decision that was made.
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (asset === null || stageWidth <= 0 || stageHeight <= 0) {
      return;
    }
    if (fitted.current === asset.id) {
      return;
    }
    fitted.current = asset.id;
    setView(
      fitView(
        { width: stageWidth, height: stageHeight },
        { width: asset.width, height: asset.height },
      ),
    );
  }, [asset, stageWidth, stageHeight]);

  /** The box a pointer's position is measured against. */
  const stage = useRef<HTMLDivElement>(null);

  /**
   * Turns a pointer event into a point in the stage's own coordinates.
   *
   * @param event - The pointer event, from the stage.
   * @returns The point, measured from the stage's top left corner.
   */
  const stagePoint = useCallback((event: { clientX: number; clientY: number }): Point => {
    const box = stage.current?.getBoundingClientRect();
    return {
      x: event.clientX - (box?.left ?? 0),
      y: event.clientY - (box?.top ?? 0),
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (asset === null) {
      return;
    }
    const point = stagePoint(event);

    // The middle button pans, on every tool and at every zoom. It is the one
    // gesture that must not depend on what is selected, because it is how a
    // zoomed-in artist reaches the rest of the sprite.
    if (event.button === 1) {
      event.preventDefault();
      panning.current = { from: point, view };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0 || target.refusal !== 'ready' || target.role === null) {
      return;
    }

    const start = toCanvasPoint(point, view, viewport, canvas);
    if (start === null) {
      return;
    }
    // Every setting is read once, here, and held for the stroke's whole length,
    // so changing a tool or a slot mid-drag cannot alter a stroke already made.
    drag.current = {
      points: [start],
      stroke: {
        tool,
        shape,
        layer: target.role,
        slot,
        brushSize,
        brushShape,
        canvas,
      },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPreview(strokePixels({ ...drag.current.stroke, points: [start] }));
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const point = stagePoint(event);

    const pan = panning.current;
    if (pan !== null) {
      setView({
        zoom: pan.view.zoom,
        panX: pan.view.panX + (point.x - pan.from.x),
        panY: pan.view.panY + (point.y - pan.from.y),
      });
      return;
    }

    const current = drag.current;
    if (current === null) {
      return;
    }
    const next = toCanvasPoint(point, view, viewport, canvas);
    const last = current.points[current.points.length - 1];
    if (next === null || (last !== undefined && last.x === next.x && last.y === next.y)) {
      // A pointer that moved within one document pixel has not drawn anything
      // new, and appending it would grow the path without changing the marks.
      return;
    }
    current.points.push(next);
    setPreview(strokePixels({ ...current.stroke, points: current.points }));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panning.current = null;

    const current = drag.current;
    drag.current = null;
    setPreview([]);
    if (current === null) {
      return;
    }
    const ops = strokeOps({ ...current.stroke, points: current.points });
    if (ops.length > 0) {
      // One call with the whole batch. The pixels are not applied here: they
      // come back through `document://changed` by the same route an agent's
      // write reaches this screen, so there is one path and not two.
      void write(ops);
    }
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    if (asset === null) {
      return;
    }
    setView((current) =>
      zoomAbout(
        current,
        stagePoint(event),
        stepZoom(current.zoom, event.deltaY < 0 ? 1 : -1),
        viewport,
        canvas,
      ),
    );
  };

  const rect = imageRect(view, viewport, canvas);
  const gridVisible = showPixelGrid && view.zoom >= MIN_GRID_CELL;
  // The pattern is two document pixels across and never below four CSS pixels,
  // where it would read as a grey wash rather than as a transparency mark.
  const checkerSize = Math.max(view.zoom * 2, 4);
  const slotRgba = palette?.slots.find((entry) => entry.index === slot)?.rgba ?? UNKNOWN_SLOT;
  const message = translateError(error);

  // What the next stroke would do, or why it would do nothing. A canvas that
  // silently refuses a press is the failure this line exists to prevent: the
  // reason is on screen before the press rather than after it.
  const status = ((): string => {
    switch (target.refusal) {
      case 'ready':
        return t('canvas.writingTo', {
          layer: target.role === null ? '' : labels.layer[target.role],
        });
      case 'no-document':
        return t('canvas.noDocument');
      case 'step-paints-nothing':
        return t('canvas.stepPaintsNothing');
      case 'no-layer':
        return t('canvas.noLayer');
      case 'locked':
        return t('canvas.layerLocked');
    }
  })();

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <div
        ref={ref}
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-md bg-surface-well"
        style={{ padding: WELL_INSET }}
      >
        <div
          ref={stage}
          role="presentation"
          className={cn(
            'relative min-h-0 min-w-0 flex-1 touch-none select-none',
            target.refusal === 'ready' ? 'cursor-crosshair' : 'cursor-default',
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {asset !== null && (
            <div
              className="absolute"
              style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
            >
              {showCheckerboard && (
                <div
                  className="sprite-checkerboard absolute inset-0"
                  style={{ ['--sprite-checker-size' as string]: `${String(checkerSize)}px` }}
                />
              )}
              {image !== null && (
                <DocumentSurface
                  image={image}
                  width={rect.width}
                  height={rect.height}
                  label={t('canvas.surface')}
                />
              )}
              <StrokePreview
                pixels={preview}
                canvas={canvas}
                rgba={slotRgba}
                erasing={tool === 'eraser'}
                width={rect.width}
                height={rect.height}
              />
              {gridVisible && (
                <PixelGridOverlay
                  columns={canvas.width}
                  rows={canvas.height}
                  width={rect.width}
                  height={rect.height}
                />
              )}
            </div>
          )}

          {asset === null && (
            <div className="flex h-full items-center justify-center">
              <div className="rounded-md border border-line-subtle bg-surface-content px-4 py-3 text-center shadow-sm">
                <p className="text-sm text-fg-primary">{t('canvas.empty')}</p>
                <p className="mt-1 text-xs text-fg-secondary">{t('canvas.hint')}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* The status line under the well. On the left, what the next stroke
          would do: a canvas that silently refuses a press is the failure this
          exists to prevent, so the reason is on screen before the press rather
          than after it. On the right, the zoom, because the wheel and the
          middle button are not discoverable and a magnification that cannot be
          read off the screen is one the artist has to guess at. */}
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="min-w-0 truncate text-xs text-fg-secondary" aria-live="polite">
          {message ?? status}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            className="px-2 py-0.5 text-[11px]"
            aria-label={t('canvas.zoomOut')}
            disabled={asset === null}
            onClick={() => {
              setView((current) => ({ ...current, zoom: stepZoom(current.zoom, -1) }));
            }}
          >
            -
          </Button>
          <span className="min-w-12 text-center text-[11px] tabular-nums text-fg-secondary">
            {t('canvas.zoomLevel', { percent: Math.round(view.zoom * 100) })}
          </span>
          <Button
            variant="ghost"
            className="px-2 py-0.5 text-[11px]"
            aria-label={t('canvas.zoomIn')}
            disabled={asset === null}
            onClick={() => {
              setView((current) => ({ ...current, zoom: stepZoom(current.zoom, 1) }));
            }}
          >
            +
          </Button>
          <Button
            variant="ghost"
            className="px-2 py-0.5 text-[11px]"
            disabled={asset === null}
            onClick={() => {
              setView(fitView(viewport, canvas));
            }}
          >
            {t('canvas.zoomFit')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * A value that changes whenever the palette does.
 *
 * The composite depends on the palette as well as on the pixels, and the
 * store replaces the palette object wholesale, so its slot count and its
 * bytes are enough to tell one from another without a deep comparison on
 * every render.
 *
 * @param palette - The document's palette, or null when none is open.
 * @returns A short key.
 */
function paletteKey(palette: { slots: { index: number; rgba: number[] }[] } | null): string {
  if (palette === null) {
    return 'none';
  }
  return palette.slots.map((entry) => `${String(entry.index)}.${entry.rgba.join('')}`).join('-');
}
