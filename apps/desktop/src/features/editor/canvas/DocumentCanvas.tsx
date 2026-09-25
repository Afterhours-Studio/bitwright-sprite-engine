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
 * The stage: the open document, as large as the room allows, the pointer that
 * draws on it, and the floating panels around it.
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
 * is written here; the picture that comes back is the one Rust made. What each
 * tool turns a drag into is `stroke.ts`; this file only decides which drag is
 * which, from the tool, the button and the keys held.
 *
 * WHERE THE STROKE GOES. Into the layer the current step owns. Painting into a
 * layer the step does not own needs the override to have been set deliberately
 * in the layer list, which is the same act the MCP tools spell `force`. A
 * pointer press cannot set it, which is the point. The readout in the corner
 * says where the next stroke lands, or why it would land nowhere, before the
 * press rather than after it.
 *
 * THE LAYERS OF THE SPRITE BOX, bottom up: the checker pattern that shows
 * transparency, the composite, the stroke preview, the pixel grid and tile
 * guide, and the marching ants. The floating panels sit over the stage, not
 * the sprite, so zooming never moves them.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Blend,
  FlipHorizontal2,
  FlipVertical2,
  Replace,
  Square,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import { Tooltip } from '@/components/ui/Tooltip';
import { PixelGridOverlay, MIN_GRID_CELL } from '@/features/editor/PixelGridOverlay';
import { paintTarget } from '@/features/editor/activeLayer';
import { useWorkflowLabels } from '@/features/editor/labels';
import { AgentActivityIndicator } from '@/features/editor/live';
import { DocumentSurface, StrokePreview } from '@/features/editor/canvas/DocumentSurface';
import { SelectionOutline } from '@/features/editor/canvas/SelectionOutline';
import { isFreehand, strokeOps, strokePreview, type Stroke } from '@/features/editor/canvas/stroke';
import { useComposite } from '@/features/editor/canvas/useComposite';
import {
  fitView,
  imageRect,
  stepZoom,
  toCanvasPoint,
  toDocumentPoint,
  zoomAbout,
  DEFAULT_VIEW,
  type View,
} from '@/features/editor/canvas/view';
import { useElementSize } from '@/hooks/useElementSize';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { cn } from '@/lib/cn';
import {
  clearSelected,
  rectSelection,
  selectionBounds,
  replaceSlot,
  translateSelection,
  wandSelection,
  type LayerPixels,
} from '@/lib/selection';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { shapeOf, useEditorStore, type Selection } from '@/stores/useEditorStore';
import type { LayerRole, Op, PixelSet, Point } from '@/types/document';

/**
 * The room kept free around a fitted document, in CSS pixels, so the floating
 * panels in the corners do not sit on the sprite at the zoom it opens at.
 */
const FIT_MARGIN = 56;

/** The floating panel look, from the studio layout. */
const PANEL = 'bg-neutral-950/90 backdrop-blur border border-neutral-800 p-1 rounded shadow-md';

/** A floating panel's button. */
const PANEL_BUTTON =
  'p-1.5 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded disabled:cursor-not-allowed disabled:text-neutral-600 disabled:hover:bg-transparent';

/** The drag in progress, whichever kind it is. */
type Drag =
  /** The view moving under the pointer. */
  | { kind: 'pan'; pointerId: number; from: Point; view: View }
  /** The eyedropper held down, picking as it moves. */
  | { kind: 'pick'; pointerId: number; secondary: boolean }
  /** A rectangle select being pulled out. */
  | { kind: 'select'; pointerId: number; from: Point; to: Point }
  /** Anything that writes: a freehand stroke, a fill, a shape, a move. */
  | { kind: 'stroke'; pointerId: number; points: Point[]; stroke: Omit<Stroke, 'points'> };

/** What the Delete key needs, kept current for a listener added once. */
interface ClearTarget {
  selection: Selection | null;
  buffer: LayerPixels | null;
  role: LayerRole | null;
}

/**
 * Reports whether a key press belongs to a field rather than to the stage.
 *
 * @param target - Where the event was dispatched.
 * @returns True for text inputs, text areas, selects and editable content.
 */
function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * Captures the pointer, where the engine can.
 *
 * jsdom has no pointer capture, and a stage that threw on press there would
 * be untestable; a real engine always has it.
 *
 * @param element - The stage.
 * @param pointerId - The pointer.
 */
function capture(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Nothing to capture with; the stage still receives the moves it is over.
  }
}

/**
 * Releases a captured pointer, where the engine can.
 *
 * @param element - The stage.
 * @param pointerId - The pointer.
 */
function release(element: Element, pointerId: number): void {
  try {
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  } catch {
    // As in `capture`.
  }
}

/**
 * The fitted view, leaving {@link FIT_MARGIN} free around the document.
 *
 * @param stageWidth - The stage's width.
 * @param stageHeight - The stage's height.
 * @param width - The document's width.
 * @param height - The document's height.
 * @returns A centred view at the largest whole zoom that fits.
 */
function fitWithMargin(
  stageWidth: number,
  stageHeight: number,
  width: number,
  height: number,
): View {
  return fitView(
    {
      width: Math.max(stageWidth - FIT_MARGIN * 2, 1),
      height: Math.max(stageHeight - FIT_MARGIN * 2, 1),
    },
    { width, height },
  );
}

interface PanelButtonProps {
  /** The accessible name and the tooltip. */
  label: string;
  /** Whether it can be pressed. */
  disabled: boolean;
  /** What pressing it does. */
  onClick: () => void;
  /** The icon. */
  children: ReactNode;
}

/**
 * One button of a floating panel, with its tooltip.
 *
 * A press with the mouse does not move focus onto it. A panel button that
 * kept focus after a click would take the next Space for itself - pressing
 * Flip a second time on key up - where the artist meant the hand; a keyboard
 * user still reaches it with Tab, and then Space is theirs.
 *
 * @param props - The label, whether it is enabled, the action and the icon.
 * @returns The button.
 */
function PanelButton({ label, disabled, onClick, children }: PanelButtonProps): ReactElement {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        className={PANEL_BUTTON}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * Reports whether a focused button was reached from the keyboard, so Space is
 * its own to press rather than the hand's.
 *
 * @param target - Where the key event was dispatched.
 * @returns True for a button showing keyboard focus.
 */
function keyboardFocusedButton(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLButtonElement)) {
    return false;
  }
  try {
    return target.matches(':focus-visible');
  } catch {
    // An engine without the selector. Leaving Space to the button is the
    // safer failure: a hand that does not engage is less surprising than a
    // button that cannot be pressed.
    return true;
  }
}

/**
 * How far the wheel has to travel, in pixels, for one zoom rung.
 *
 * A mouse notch reports about a hundred; a trackpad reports a stream of small
 * deltas, and stepping on each of them would double the zoom several times per
 * flick. Accumulating to one notch's worth makes both move one rung per notch.
 */
const WHEEL_STEP = 100;

/**
 * How long a committed batch may block the next one before the stage gives
 * up waiting for its `document://changed`, in milliseconds.
 *
 * Every write emits one, so this is a guard against a lost event rather than
 * a delay anybody should see.
 */
const PENDING_TIMEOUT = 2000;

/**
 * The stage.
 *
 * Fills whatever region it is mounted in; it reads the document and the
 * editor settings from their stores and takes no props.
 *
 * @returns The workspace, the document, and the panels over it.
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
  const slot = useEditorStore((state) => state.slot);
  const secondarySlot = useEditorStore((state) => state.secondarySlot);
  const setSlot = useEditorStore((state) => state.setSlot);
  const setSecondarySlot = useEditorStore((state) => state.setSecondarySlot);
  const brushSize = useEditorStore((state) => state.brushSize);
  const brushShape = useEditorStore((state) => state.brushShape);
  const shapeFill = useEditorStore((state) => state.shapeFill);
  const symmetry = useEditorStore((state) => state.symmetry);
  const storedSelection = useEditorStore((state) => state.selection);
  const setSelection = useEditorStore((state) => state.setSelection);
  const clearSelection = useEditorStore((state) => state.clearSelection);
  const targetRole = useEditorStore((state) => state.targetRole);
  const showPixelGrid = useEditorStore((state) => state.showPixelGrid);
  const showCheckerboard = useEditorStore((state) => state.showCheckerboard);
  const tileGuide = useEditorStore((state) => state.tileGuide);

  const { ref, width: stageWidth, height: stageHeight } = useElementSize();
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [preview, setPreview] = useState<readonly PixelSet[]>([]);
  /** The rectangle being pulled out, shown before it becomes the selection. */
  const [marquee, setMarquee] = useState<Selection | null>(null);
  /** How far a selection being moved has travelled, for its outline. */
  const [moving, setMoving] = useState<Point | null>(null);
  /** The document pixel under the pointer, or null off the document. */
  const [cursor, setCursor] = useState<Point | null>(null);
  /** Whether Space is held, which turns every tool into the hand. */
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panningNow, setPanningNow] = useState(false);

  // The composite is asked for again whenever the op log moves or the palette
  // is replaced, and those are the only two things that change the picture.
  const { image, error } = useComposite(asset?.id ?? null, `${String(seq)}:${paletteKey(palette)}`);

  const canvas = { width: asset?.width ?? 0, height: asset?.height ?? 0 };
  const viewport = { width: stageWidth, height: stageHeight };
  const assetId = asset?.id ?? null;

  const target = paintTarget(step?.step ?? null, targetRole, layers);
  const layer = layers.find((candidate) => candidate.role === target.role) ?? null;
  const buffer: LayerPixels | null = layer === null ? null : layer.buffer;
  // A selection belongs to the asset it was made on. The store outlives this
  // component - it unmounts for the home screen and the tilemap editor - so a
  // mask is honoured only while its asset is the one open, and never across
  // a resize.
  const selection =
    storedSelection !== null &&
    assetId !== null &&
    storedSelection.assetId === assetId &&
    storedSelection.width === canvas.width &&
    storedSelection.height === canvas.height
      ? storedSelection
      : null;
  const role = target.refusal === 'ready' ? target.role : null;

  // And one that is not honoured is dropped, so no other screen reads it as
  // the selection either.
  useEffect(() => {
    if (storedSelection !== null && assetId !== null && storedSelection.assetId !== assetId) {
      clearSelection();
    }
  }, [storedSelection, assetId, clearSelection]);

  /**
   * The drag in progress. A ref rather than state, because a pointer reports
   * far more often than the stage should render; what the user sees of it is
   * the preview, which is state and is set once per move.
   */
  const drag = useRef<Drag | null>(null);

  /**
   * The write the stage is waiting to see land, as the op log sequence it was
   * made from, or null when nothing is pending.
   *
   * Every edit reads the layer as the store holds it, and the store learns of
   * a write only when `document://changed` arrives. Until then a second move
   * would lift from the pixels as they were before the first one, so nothing
   * new starts until the sequence has moved past the pending write.
   */
  const pending = useRef<{ seq: number; token: number } | null>(null);
  const pendingToken = useRef(0);

  /**
   * Reports whether a write is still on its way back.
   *
   * @returns True while the store's sequence has not moved past it.
   */
  const busy = useCallback((): boolean => {
    const waiting = pending.current;
    if (waiting === null) {
      return false;
    }
    if (useDocumentStore.getState().seq > waiting.seq) {
      pending.current = null;
      return false;
    }
    return true;
  }, []);

  // A pending write belongs to the document it was made on.
  useEffect(() => {
    pending.current = null;
  }, [assetId]);

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
    setView(fitWithMargin(stageWidth, stageHeight, asset.width, asset.height));
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

  /**
   * Commits a batch and reports whether it landed.
   *
   * An empty batch is not sent - it is `document.invalid_batch`, a failure
   * reported for a stroke never made - and counts as landed, because nothing
   * was asked for. A batch made while an earlier one is still on its way back
   * is refused, because it was built from pixels that are about to change.
   *
   * @param ops - The batch.
   * @returns True when the write succeeded or there was nothing to write.
   */
  const commit = useCallback(
    async (ops: Op[]): Promise<boolean> => {
      if (ops.length === 0) {
        return true;
      }
      if (busy()) {
        return false;
      }
      pendingToken.current += 1;
      const token = pendingToken.current;
      pending.current = { seq: useDocumentStore.getState().seq, token };
      // Read through a function, because the compiler narrows the ref to the
      // value just assigned and cannot see the await that may change it.
      const ours = (): boolean => pending.current?.token === token;
      window.setTimeout(() => {
        if (ours()) {
          pending.current = null;
        }
      }, PENDING_TIMEOUT);
      await write(ops);
      if (useDocumentStore.getState().error !== null) {
        // Refused by Rust: nothing will arrive, so nothing is waited for.
        if (ours()) {
          pending.current = null;
        }
        return false;
      }
      return true;
    },
    [write, busy],
  );

  /**
   * Replaces the selection, or drops it when it holds no pixel.
   *
   * An empty mask is not "nothing selected": every tool would be clipped to
   * it and paint nothing, with nothing on screen to say why. A marquee pulled
   * out wholly off the sprite, or a selection moved off it, is therefore no
   * selection at all.
   *
   * @param next - The selection to hold.
   */
  const applySelection = useCallback(
    (next: Selection): void => {
      if (assetId === null || selectionBounds(next) === null) {
        clearSelection();
        return;
      }
      setSelection({ ...next, assetId });
    },
    [assetId, clearSelection, setSelection],
  );

  /**
   * Picks the slot under a document pixel into a colour slot.
   *
   * @param point - The pixel, or null off the document.
   * @param secondary - True for a right-button pick.
   */
  const pick = (point: Point | null, secondary: boolean): void => {
    if (point === null || buffer === null) {
      return;
    }
    const picked = buffer.data[point.y * buffer.width + point.x] ?? 0;
    // Transparent is not a slot, and picking it would set the pencil to a
    // colour that does not exist.
    if (picked === 0) {
      return;
    }
    if (secondary) {
      setSecondarySlot(picked);
    } else {
      setSlot(picked);
    }
  };

  /**
   * Ends the drag in progress.
   *
   * @param keep - True to commit what it did, false to throw it away: a
   *   cancelled pointer or a window that lost focus mid-drag did not finish
   *   the stroke it was making.
   */
  const finish = (keep: boolean): void => {
    const current = drag.current;
    drag.current = null;
    setPanningNow(false);
    setPreview([]);
    setMoving(null);
    setMarquee(null);
    if (current === null) {
      return;
    }
    if (stage.current !== null) {
      release(stage.current, current.pointerId);
    }
    if (!keep) {
      return;
    }
    if (current.kind === 'select') {
      // A click without a drag drops the selection, as it does in every
      // editor; a box of one pixel is made by dragging one pixel.
      if (current.from.x === current.to.x && current.from.y === current.to.y) {
        clearSelection();
        return;
      }
      applySelection(rectSelection(current.from, current.to, canvas));
      return;
    }
    if (current.kind !== 'stroke') {
      return;
    }
    const stroke: Stroke = { ...current.stroke, points: current.points };
    const lifted = stroke.selection ?? null;
    const first = current.points[0];
    const last = current.points[current.points.length - 1];
    // One call with the whole batch. The pixels are not applied here: they
    // come back through `document://changed` by the same route an agent's
    // write reaches this screen, so there is one path and not two.
    void commit(strokeOps(stroke)).then((landed) => {
      if (
        !landed ||
        stroke.tool !== 'move' ||
        lifted === null ||
        first === undefined ||
        last === undefined
      ) {
        return;
      }
      const dx = last.x - first.x;
      const dy = last.y - first.y;
      if (dx !== 0 || dy !== 0) {
        // The selection travels with the pixels it lifted, once they have.
        applySelection(translateSelection(lifted, dx, dy));
      }
    });
  };

  // Read by listeners added once, which would otherwise hold the first render's.
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (asset === null) {
      return;
    }
    const open = drag.current;
    if (open !== null) {
      if (open.pointerId !== event.pointerId) {
        // A second finger or pen while a drag is under way is not a new drag.
        return;
      }
      // The same pointer pressing again means its release never arrived;
      // what it drew is kept rather than overwritten.
      finish(true);
    }
    const point = stagePoint(event);
    const pointerId = event.pointerId;

    // The middle button pans on every tool, and so does Space held with any
    // of them: it is how a zoomed-in artist reaches the rest of the sprite
    // without putting the tool down.
    if (event.button === 1 || (event.button === 0 && (tool === 'pan' || spaceHeld))) {
      event.preventDefault();
      drag.current = { kind: 'pan', pointerId, from: point, view };
      setPanningNow(true);
      capture(event.currentTarget, pointerId);
      return;
    }
    if (event.button !== 0 && event.button !== 2) {
      return;
    }
    const secondary = event.button === 2;
    const onDocument = toCanvasPoint(point, view, viewport, canvas);
    const anywhere = toDocumentPoint(point, view, viewport, canvas);

    switch (tool) {
      case 'zoom': {
        const direction = event.altKey || secondary ? -1 : 1;
        setView((current) =>
          zoomAbout(current, point, stepZoom(current.zoom, direction), viewport, canvas),
        );
        return;
      }
      case 'eyedropper':
        pick(onDocument, secondary);
        drag.current = { kind: 'pick', pointerId, secondary };
        capture(event.currentTarget, pointerId);
        return;
      case 'select':
        if (secondary) {
          return;
        }
        drag.current = { kind: 'select', pointerId, from: anywhere, to: anywhere };
        setMarquee(rectSelection(anywhere, anywhere, canvas));
        capture(event.currentTarget, pointerId);
        return;
      case 'wand': {
        if (secondary || onDocument === null || buffer === null) {
          return;
        }
        const next = wandSelection(buffer, onDocument, !event.shiftKey);
        if (next !== null) {
          applySelection(next);
        }
        return;
      }
      case 'pan':
        return;
      default:
        break;
    }

    if (role === null || busy()) {
      return;
    }
    const isMove = tool === 'move';
    if (isMove && secondary) {
      return;
    }
    const start = isMove ? anywhere : onDocument;
    if (start === null) {
      return;
    }
    // Every setting is read once, here, and held for the stroke's whole length,
    // so changing a tool or a slot mid-drag cannot alter a stroke already made.
    // The right button trades the two slots: the pencil, the bucket and the
    // shapes paint the secondary, and the dither swaps its two cells.
    const stroke: Omit<Stroke, 'points'> = {
      tool,
      layer: role,
      slot: secondary ? secondarySlot : slot,
      secondarySlot: secondary ? slot : secondarySlot,
      brushSize,
      brushShape,
      canvas,
      symmetry,
      selection,
      buffer,
      ramps: palette?.ramps ?? [],
      shapeFill,
    };
    drag.current = { kind: 'stroke', pointerId, points: [start], stroke };
    capture(event.currentTarget, pointerId);
    if (isFreehand(tool) || tool === 'fill' || shapeOf(tool) !== null) {
      setPreview(strokePreview({ ...stroke, points: [start] }));
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const point = stagePoint(event);
    const onDocument = asset === null ? null : toCanvasPoint(point, view, viewport, canvas);
    setCursor((previous) =>
      previous?.x === onDocument?.x && previous?.y === onDocument?.y ? previous : onDocument,
    );

    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) {
      return;
    }
    if (event.buttons === 0) {
      // Every button is up, so the release was lost somewhere - outside the
      // window, or to a capture that was taken away. The drag ends here.
      finish(true);
      return;
    }
    switch (current.kind) {
      case 'pan':
        setView({
          zoom: current.view.zoom,
          panX: current.view.panX + (point.x - current.from.x),
          panY: current.view.panY + (point.y - current.from.y),
        });
        return;
      case 'pick':
        pick(onDocument, current.secondary);
        return;
      case 'select': {
        const to = toDocumentPoint(point, view, viewport, canvas);
        if (to.x === current.to.x && to.y === current.to.y) {
          return;
        }
        current.to = to;
        setMarquee(rectSelection(current.from, to, canvas));
        return;
      }
      case 'stroke':
        break;
    }

    const stroke = current.stroke;
    if (stroke.tool === 'fill') {
      // A bucket is a click; where the hand drifts to afterwards is not a seed.
      return;
    }
    let next: Point | null;
    if (stroke.tool === 'move') {
      next = toDocumentPoint(point, view, viewport, canvas);
    } else if (shapeOf(stroke.tool) !== null) {
      // A shape's far end is held to the document's edge rather than lost off
      // it, so pulling a line out past the border still ends it on the border.
      const loose = toDocumentPoint(point, view, viewport, canvas);
      next = {
        x: Math.min(Math.max(loose.x, 0), canvas.width - 1),
        y: Math.min(Math.max(loose.y, 0), canvas.height - 1),
      };
    } else {
      next = onDocument;
    }
    const last = current.points[current.points.length - 1];
    if (next === null || (last !== undefined && last.x === next.x && last.y === next.y)) {
      // A pointer that moved within one document pixel has not drawn anything
      // new, and appending it would grow the path without changing the marks.
      return;
    }
    current.points.push(next);
    const points = current.points;
    setPreview(strokePreview({ ...stroke, points }));
    const first = points[0];
    if (stroke.tool === 'move' && stroke.selection && first !== undefined) {
      setMoving({ x: next.x - first.x, y: next.y - first.y });
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId !== event.pointerId) {
      return;
    }
    finish(true);
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId !== event.pointerId) {
      return;
    }
    finish(false);
  };

  const onLostPointerCapture = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // After an ordinary release the drag is already over and this is a no-op.
    // Otherwise the capture was taken away mid-drag, and no release will come.
    if (drag.current?.pointerId !== event.pointerId) {
      return;
    }
    finish(true);
  };

  const onPointerLeave = (): void => {
    setCursor(null);
  };

  /** Wheel travel not yet spent on a zoom rung, signed. */
  const wheel = useRef(0);
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    if (asset === null || event.deltaY === 0) {
      // A horizontal scroll carries no vertical delta and is not a zoom.
      return;
    }
    // Line and page deltas are scaled to pixels, so a wheel reporting lines
    // takes the same number of notches per rung as one reporting pixels.
    const scale = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1;
    const delta = event.deltaY * scale;
    // A change of direction starts over rather than paying off travel the
    // other way first.
    wheel.current = Math.sign(wheel.current) === Math.sign(delta) ? wheel.current + delta : delta;
    if (Math.abs(wheel.current) < WHEEL_STEP) {
      return;
    }
    const direction = wheel.current < 0 ? 1 : -1;
    wheel.current = 0;
    const pointer = stagePoint(event);
    setView((current) =>
      zoomAbout(current, pointer, stepZoom(current.zoom, direction), viewport, canvas),
    );
  };

  const assetWidth = asset?.width ?? 0;
  const assetHeight = asset?.height ?? 0;
  /**
   * Zooms one rung about the middle of the stage, for the buttons and keys.
   *
   * @param direction - Positive to zoom in, negative to zoom out.
   */
  const zoomStep = useCallback(
    (direction: number): void => {
      setView((current) =>
        zoomAbout(
          current,
          { x: stageWidth / 2, y: stageHeight / 2 },
          stepZoom(current.zoom, direction),
          { width: stageWidth, height: stageHeight },
          { width: assetWidth, height: assetHeight },
        ),
      );
    },
    [assetWidth, assetHeight, stageWidth, stageHeight],
  );

  // What the Delete key clears, read by a listener that is added once.
  const clearTarget = useRef<ClearTarget>({ selection: null, buffer: null, role: null });
  useEffect(() => {
    clearTarget.current = { selection, buffer, role };
  });

  // The stage's keys. Everything else - tool letters, swap, undo - belongs to
  // the editor frame; these are the ones that act on what is on the stage.
  // Keys typed into a field are the field's, whatever they are.
  useEffect(() => {
    /** Whether the Space now held was taken for the hand. */
    let spaceTaken = false;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (typingInto(event.target)) {
        return;
      }
      if (event.key === ' ') {
        // Space on a button reached from the keyboard presses the button; on
        // anything else it is the hand.
        if (keyboardFocusedButton(event.target)) {
          return;
        }
        event.preventDefault();
        spaceTaken = true;
        setSpaceHeld(true);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      switch (event.key) {
        case '-':
          event.preventDefault();
          zoomStep(-1);
          return;
        case '+':
        case '=':
          event.preventDefault();
          zoomStep(1);
          return;
        case 'Escape':
          if (useEditorStore.getState().selection !== null) {
            clearSelection();
          }
          return;
        case 'Delete':
        case 'Backspace': {
          const { selection: held, buffer: pixels, role: into } = clearTarget.current;
          if (held === null || pixels === null || into === null) {
            return;
          }
          event.preventDefault();
          if (event.repeat) {
            // A held key clears once; the repeats would clear pixels that are
            // already on their way to being transparent.
            return;
          }
          const cleared = clearSelected(pixels, held);
          void commit(
            cleared.length === 0 ? [] : [{ kind: 'set_pixels', layer: into, pixels: cleared }],
          );
          return;
        }
        default:
          return;
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === ' ') {
        if (spaceTaken) {
          // The key up is what presses a button with Space, so a Space the
          // hand took must not reach one on the way back up.
          event.preventDefault();
        }
        spaceTaken = false;
        setSpaceHeld(false);
      }
    };
    // A window that loses focus mid-drag never sees the release, and Space let
    // go in the background never arrives as a key up. Both end here: a stage
    // stuck on the hand, or on a drag, is a stage that will not draw.
    const onBlur = (): void => {
      spaceTaken = false;
      setSpaceHeld(false);
      finishRef.current(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [zoomStep, clearSelection, commit]);

  const rect = imageRect(view, viewport, canvas);
  const cellsVisible = showPixelGrid && view.zoom >= MIN_GRID_CELL;
  // The pattern is two document pixels across and never below four CSS pixels,
  // where it would read as a grey wash rather than as a transparency mark.
  const checkerSize = Math.max(view.zoom * 2, 4);
  const message = translateError(error);

  // Why the next stroke would do nothing, or null when it would land. A canvas
  // that silently refuses a press is the failure this exists to prevent.
  const refusal = ((): string | null => {
    switch (target.refusal) {
      case 'ready':
        return null;
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

  // The outline is derived from the fills into the outline layer, so it is
  // offered where the next stroke would land there: on the outline step, or
  // with that layer chosen deliberately.
  const outlineSource: LayerRole | null = layers.some((entry) => entry.role === 'flats')
    ? 'flats'
    : layers.some((entry) => entry.role === 'silhouette')
      ? 'silhouette'
      : null;

  const cursorClass = panningNow
    ? 'cursor-grabbing'
    : tool === 'pan' || spaceHeld
      ? 'cursor-grab'
      : tool === 'zoom'
        ? 'cursor-zoom-in'
        : tool === 'move'
          ? 'cursor-move'
          : 'cursor-crosshair';

  const outlined = marquee ?? selection;
  const zoomFactor = Number(view.zoom.toFixed(2));

  return (
    <div
      ref={ref}
      className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden canvas-workspace-bg cursor-crosshair"
    >
      <div
        ref={stage}
        role="presentation"
        data-testid="stage"
        className={cn('absolute inset-0 touch-none select-none', cursorClass)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onLostPointerCapture}
        onPointerLeave={onPointerLeave}
        onContextMenu={(event) => {
          event.preventDefault();
        }}
        onWheel={onWheel}
      >
        {asset !== null && (
          <div
            className="absolute shadow-2xl ring-1 ring-white/15"
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
              palette={palette}
              width={rect.width}
              height={rect.height}
            />
            {(cellsVisible || tileGuide > 0) && (
              <PixelGridOverlay
                columns={canvas.width}
                rows={canvas.height}
                width={rect.width}
                height={rect.height}
                cells={cellsVisible}
                tileGuide={tileGuide}
              />
            )}
            {outlined !== null && (
              <SelectionOutline
                selection={outlined}
                offset={marquee === null ? (moving ?? undefined) : undefined}
                width={rect.width}
                height={rect.height}
              />
            )}
          </div>
        )}

        {asset === null && (
          <div className="flex h-full items-center justify-center">
            <div className={cn(PANEL, 'px-4 py-3 text-center')}>
              <p className="text-sm text-neutral-200">{t('canvas.empty')}</p>
              <p className="mt-1 text-xs text-neutral-500">{t('canvas.hint')}</p>
            </div>
          </div>
        )}
      </div>

      <div className="absolute left-4 top-4 z-10">
        <AgentActivityIndicator />
      </div>

      <div
        role="toolbar"
        aria-label={t('canvas.toolbar')}
        className={cn(PANEL, 'absolute right-4 top-4 z-10 flex items-center space-x-0.5')}
      >
        <PanelButton
          label={t('canvas.flipHorizontal')}
          disabled={role === null}
          onClick={() => {
            if (role !== null) {
              void commit([{ kind: 'mirror', layer: role, axis: 'x' }]);
            }
          }}
        >
          <FlipHorizontal2 className="h-4 w-4" />
        </PanelButton>
        <PanelButton
          label={t('canvas.flipVertical')}
          disabled={role === null}
          onClick={() => {
            if (role !== null) {
              void commit([{ kind: 'mirror', layer: role, axis: 'y' }]);
            }
          }}
        >
          <FlipVertical2 className="h-4 w-4" />
        </PanelButton>
        <div className="mx-0.5 h-4 w-px bg-neutral-800" />
        <PanelButton
          label={t('canvas.replaceSecondary')}
          disabled={role === null || buffer === null || slot === secondarySlot}
          onClick={() => {
            if (role !== null && buffer !== null) {
              const pixels = replaceSlot(buffer, secondarySlot, slot);
              void commit(pixels.length === 0 ? [] : [{ kind: 'set_pixels', layer: role, pixels }]);
            }
          }}
        >
          <Replace className="h-4 w-4" />
        </PanelButton>
        <PanelButton
          label={
            role === 'outline' && outlineSource !== null
              ? t('canvas.outline')
              : t('canvas.outlineUnavailable')
          }
          disabled={role !== 'outline' || outlineSource === null}
          onClick={() => {
            if (role === 'outline' && outlineSource !== null) {
              void commit([{ kind: 'outline', from: outlineSource }]);
            }
          }}
        >
          <Square className="h-4 w-4" />
        </PanelButton>
        <PanelButton
          label={t('canvas.antialias')}
          disabled={role === null}
          onClick={() => {
            if (role !== null) {
              void commit([{ kind: 'antialias', layer: role }]);
            }
          }}
        >
          <Blend className="h-4 w-4" />
        </PanelButton>
      </div>

      <div
        data-testid="canvas-readout"
        className={cn(
          PANEL,
          'pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[60%] space-x-3 px-3 py-1.5 text-xs text-neutral-300',
        )}
      >
        <span className="shrink-0 tabular-nums">
          {cursor === null
            ? t('canvas.cursorNone')
            : t('canvas.cursor', { x: cursor.x, y: cursor.y })}
        </span>
        <span className="text-neutral-600">|</span>
        <span className="shrink-0 font-semibold text-pink-400">
          {t('canvas.size', { width: canvas.width, height: canvas.height })}
        </span>
        <span className="text-neutral-600">|</span>
        <span className="shrink-0 font-semibold text-sky-400">
          {t('canvas.zoomFactor', { zoom: zoomFactor })}
        </span>
        <span className="text-neutral-600">|</span>
        <span
          aria-live="polite"
          className={cn(
            'min-w-0 truncate',
            role !== null && message === null ? 'text-purple-400' : 'text-amber-400',
          )}
        >
          {message ?? (role !== null ? labels.layer[role] : refusal)}
        </span>
      </div>

      <div className={cn(PANEL, 'absolute bottom-3 right-3 z-10 flex items-center')}>
        <PanelButton
          label={t('canvas.zoomOut')}
          disabled={asset === null}
          onClick={() => {
            zoomStep(-1);
          }}
        >
          <ZoomOut className="h-4 w-4" />
        </PanelButton>
        <Tooltip label={t('canvas.zoomFitHint')}>
          <button
            type="button"
            aria-label={t('canvas.zoomFitHint')}
            disabled={asset === null}
            className="rounded px-2 py-1 text-xs font-medium tabular-nums text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-600"
            onClick={() => {
              if (asset !== null) {
                setView(fitWithMargin(stageWidth, stageHeight, asset.width, asset.height));
              }
            }}
          >
            {t('canvas.zoomPercent', { percent: Math.round(view.zoom * 100) })}
          </button>
        </Tooltip>
        <PanelButton
          label={t('canvas.zoomIn')}
          disabled={asset === null}
          onClick={() => {
            zoomStep(1);
          }}
        >
          <ZoomIn className="h-4 w-4" />
        </PanelButton>
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
