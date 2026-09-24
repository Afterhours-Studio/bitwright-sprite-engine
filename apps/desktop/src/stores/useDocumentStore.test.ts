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
 * The open document: what a change event costs, and what a refused read leaves
 * on screen.
 *
 * The partial re-read is the behaviour worth pinning down. `document://changed`
 * carries roles rather than pixels precisely so that a write to one layer costs
 * one buffer, and a store that re-read everything would be correct and would
 * quietly undo the reason the event was designed that way.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDocumentStore } from '@/stores/useDocumentStore';
import type {
  Asset,
  Document,
  GateReport,
  IndexedBuffer,
  Layer,
  LayerRole,
  StepState,
} from '@/types/document';

vi.mock('@/lib/document', () => ({
  assetOpen: vi.fn(),
  documentReadLayer: vi.fn(),
  documentWriteOps: vi.fn(),
  documentUndo: vi.fn(),
  documentRedo: vi.fn(),
  paletteRead: vi.fn(),
  paletteWrite: vi.fn(),
  stepState: vi.fn(),
  stepCheck: vi.fn(),
  stepAdvance: vi.fn(),
  stepRevisit: vi.fn(),
  onDocumentChanged: vi.fn(),
  onPaletteChanged: vi.fn(),
  onStepChanged: vi.fn(),
}));

const documents = await import('@/lib/document');

const ASSET: Asset = {
  id: 'asset-1',
  projectId: 'project-1',
  styleId: null,
  name: 'hero',
  kind: 'character',
  width: 2,
  height: 1,
  step: 'flats',
  createdAt: 1,
  updatedAt: 1,
};

/**
 * A buffer holding two pixels, which is enough to tell one read from another.
 *
 * @param first - The left pixel's slot.
 * @param second - The right pixel's slot.
 * @returns The buffer.
 */
function buffer(first: number, second: number): IndexedBuffer {
  return { width: 2, height: 1, data: [first, second] };
}

/**
 * A layer, as the shell would return one.
 *
 * @param role - Which role it fills.
 * @param ordinal - Where it composites.
 * @param pixels - Its contents.
 * @returns The layer.
 */
function layer(role: LayerRole, ordinal: number, pixels: IndexedBuffer): Layer {
  return {
    id: `layer-${role}`,
    role,
    ordinal,
    visible: true,
    locked: false,
    opacity: 1,
    buffer: pixels,
  };
}

const SILHOUETTE = layer('silhouette', 10, buffer(1, 1));
const FLATS = layer('flats', 20, buffer(2, 2));

const DOCUMENT: Document = {
  asset: ASSET,
  palette: { slots: [], ramps: [] },
  layers: [SILHOUETTE, FLATS],
};

const STEP: StepState = {
  assetId: 'asset-1',
  step: 'flats',
  canAdvance: false,
  gate: {
    step: 'flats',
    pass: false,
    checks: [
      {
        name: 'material-coverage',
        pass: false,
        detail: '2 of 4 silhouette pixels carry a material slot',
        hint: 'Fill the remaining pixels on the flats layer.',
      },
    ],
    metrics: {
      filled: 2,
      regionSizes: [2],
      perimeter: 6,
      perimeterSquaredOverArea: 18,
      solidity: 1,
      orphanCount: 0,
      orphanFraction: 0,
      speckleFraction: 0,
      jaggySequences: 0,
      horizontalChangeRate: 0,
      pillowCorrelation: 0,
      lightVectors: [],
      lightMeanDegrees: null,
      lightStdDegrees: null,
      undirectedRegions: [],
    },
  },
};

beforeEach(() => {
  vi.mocked(documents.assetOpen).mockResolvedValue({ ok: true, value: DOCUMENT });
  vi.mocked(documents.stepState).mockResolvedValue({ ok: true, value: STEP });
  vi.mocked(documents.onDocumentChanged).mockResolvedValue(() => undefined);
  vi.mocked(documents.onPaletteChanged).mockResolvedValue(() => undefined);
  vi.mocked(documents.onStepChanged).mockResolvedValue(() => undefined);
  vi.mocked(documents.documentReadLayer).mockReset();
  // `subscribing` is module-scoped state in `useDocumentStore.ts`, so it has to
  // be reset between tests the same way the shell resets it: through dispose.
  useDocumentStore.getState().dispose();
  useDocumentStore.setState({
    assetId: null,
    asset: null,
    layers: [],
    palette: null,
    step: null,
    gate: null,
    seq: 0,
    loading: false,
    error: null,
  });
});

describe('useDocumentStore', () => {
  it('reads the document and its workflow position when one is opened', async () => {
    await useDocumentStore.getState().open('asset-1');

    const state = useDocumentStore.getState();
    expect(state.assetId).toBe('asset-1');
    expect(state.layers).toEqual([SILHOUETTE, FLATS]);
    expect(state.step).toEqual(STEP);
    expect(state.gate).toEqual(STEP.gate);
    expect(state.error).toBeNull();
  });

  it('re-reads only the roles a change event names', async () => {
    await useDocumentStore.getState().open('asset-1');
    vi.mocked(documents.assetOpen).mockClear();
    vi.mocked(documents.documentReadLayer).mockResolvedValue({ ok: true, value: buffer(7, 7) });

    await useDocumentStore.getState().applyChange({
      assetId: 'asset-1',
      roles: ['flats'],
      seq: 12,
    });

    expect(documents.documentReadLayer).toHaveBeenCalledTimes(1);
    expect(documents.documentReadLayer).toHaveBeenCalledWith('asset-1', 'flats');
    // The whole document is not re-read: that is the cost the event exists to
    // avoid, and re-reading it would make the roles in the payload decoration.
    expect(documents.assetOpen).not.toHaveBeenCalled();

    const state = useDocumentStore.getState();
    expect(state.layers[0]).toEqual(SILHOUETTE);
    expect(state.layers[1]?.buffer).toEqual(buffer(7, 7));
    expect(state.seq).toBe(12);
  });

  it('ignores a change to a document this window does not have open', async () => {
    await useDocumentStore.getState().open('asset-1');

    await useDocumentStore.getState().applyChange({
      assetId: 'asset-2',
      roles: ['flats'],
      seq: 99,
    });

    expect(documents.documentReadLayer).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().seq).toBe(0);
  });

  it('re-reads the whole document when a role it has never seen appears', async () => {
    await useDocumentStore.getState().open('asset-1');
    vi.mocked(documents.assetOpen).mockClear();

    await useDocumentStore.getState().applyChange({
      assetId: 'asset-1',
      roles: ['outline'],
      seq: 4,
    });

    // A layer read returns pixels and nothing else, so a layer that has just
    // been created has no ordinal, opacity or identity to be read from it.
    expect(documents.documentReadLayer).not.toHaveBeenCalled();
    expect(documents.assetOpen).toHaveBeenCalledWith('asset-1');
  });

  it('applies none of a re-read when one of its layers fails', async () => {
    await useDocumentStore.getState().open('asset-1');
    vi.mocked(documents.documentReadLayer).mockImplementation((_assetId, role) =>
      Promise.resolve(
        role === 'flats'
          ? { ok: false, error: { code: 'document.layer_not_found', detail: 'flats' } }
          : { ok: true, value: buffer(9, 9) },
      ),
    );

    await useDocumentStore.getState().applyChange({
      assetId: 'asset-1',
      roles: ['silhouette', 'flats'],
      seq: 5,
    });

    const state = useDocumentStore.getState();
    expect(state.error).toBe('document.layer_not_found');
    // Not one layer moved. Half of a re-read is a sprite that never existed.
    expect(state.layers).toEqual([SILHOUETTE, FLATS]);
    expect(state.seq).toBe(0);
  });

  it('keeps the open document when a write is refused', async () => {
    vi.mocked(documents.documentWriteOps).mockResolvedValue({
      ok: false,
      error: { code: 'document.layer_locked', detail: 'flats' },
    });

    await useDocumentStore.getState().open('asset-1');
    await useDocumentStore.getState().write([{ kind: 'clear', layer: 'flats' }]);

    const state = useDocumentStore.getState();
    expect(state.error).toBe('document.layer_locked');
    expect(state.loading).toBe(false);
    expect(state.layers).toEqual([SILHOUETTE, FLATS]);
  });

  it('does not adopt a document that failed to open', async () => {
    vi.mocked(documents.assetOpen).mockResolvedValue({
      ok: false,
      error: { code: 'document.not_found', detail: 'asset-2' },
    });

    await useDocumentStore.getState().open('asset-2');

    const state = useDocumentStore.getState();
    expect(state.error).toBe('document.not_found');
    expect(state.assetId).toBeNull();
    expect(state.layers).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it('records why an advance was refused and leaves the step where it was', async () => {
    vi.mocked(documents.stepAdvance).mockResolvedValue({
      ok: false,
      error: { code: 'step.gate_failed', detail: 'flats' },
    });

    await useDocumentStore.getState().open('asset-1');
    await useDocumentStore.getState().advance();

    const state = useDocumentStore.getState();
    expect(state.error).toBe('step.gate_failed');
    expect(state.step?.step).toBe('flats');
    expect(state.asset?.step).toBe('flats');
  });

  it('advances without forcing when no option is given', async () => {
    vi.mocked(documents.stepAdvance).mockResolvedValue({ ok: true, value: STEP });

    await useDocumentStore.getState().open('asset-1');
    await useDocumentStore.getState().advance();

    expect(documents.stepAdvance).toHaveBeenCalledWith('asset-1', false);
  });

  it('passes a forced advance to the shell', async () => {
    const advanced: StepState = {
      ...STEP,
      step: 'shadow',
      canAdvance: true,
      gate: { ...STEP.gate, step: 'shadow', pass: true },
    };
    vi.mocked(documents.stepAdvance).mockResolvedValue({ ok: true, value: advanced });

    await useDocumentStore.getState().open('asset-1');
    await useDocumentStore.getState().advance({ force: true });

    expect(documents.stepAdvance).toHaveBeenCalledWith('asset-1', true);
    const state = useDocumentStore.getState();
    expect(state.step?.step).toBe('shadow');
    expect(state.asset?.step).toBe('shadow');
    expect(state.gate?.step).toBe('shadow');
  });

  it('revisits an earlier step and records why a refusal failed', async () => {
    const revisited: StepState = {
      ...STEP,
      step: 'silhouette',
      gate: { ...STEP.gate, step: 'silhouette' },
    };
    vi.mocked(documents.stepRevisit).mockResolvedValue({ ok: true, value: revisited });

    await useDocumentStore.getState().open('asset-1');
    await useDocumentStore.getState().revisit('silhouette');

    expect(documents.stepRevisit).toHaveBeenCalledWith('asset-1', 'silhouette');
    const state = useDocumentStore.getState();
    expect(state.step?.step).toBe('silhouette');
    expect(state.asset?.step).toBe('silhouette');
    expect(state.gate?.step).toBe('silhouette');
    expect(state.error).toBeNull();
  });

  it('records why a revisit was refused and leaves the step where it was', async () => {
    vi.mocked(documents.stepRevisit).mockResolvedValue({
      ok: false,
      error: { code: 'step.not_found', detail: 'nope' },
    });

    await useDocumentStore.getState().open('asset-1');
    await useDocumentStore.getState().revisit('nope');

    const state = useDocumentStore.getState();
    expect(state.error).toBe('step.not_found');
    expect(state.step?.step).toBe('flats');
    expect(state.asset?.step).toBe('flats');
  });

  it('close resets the whole document to its empty state', async () => {
    await useDocumentStore.getState().open('asset-1');

    useDocumentStore.getState().close();

    const state = useDocumentStore.getState();
    expect(state.assetId).toBeNull();
    expect(state.asset).toBeNull();
    expect(state.layers).toEqual([]);
    expect(state.palette).toBeNull();
    expect(state.step).toBeNull();
    expect(state.gate).toBeNull();
    expect(state.seq).toBe(0);
    expect(state.error).toBeNull();
  });

  it('undo re-reads the step state on success', async () => {
    vi.mocked(documents.documentUndo).mockResolvedValue({
      ok: true,
      value: { assetId: 'asset-1' } as never,
    });
    const revisited: StepState = {
      ...STEP,
      step: 'silhouette',
      gate: { ...STEP.gate, step: 'silhouette' },
    };
    vi.mocked(documents.stepState).mockResolvedValueOnce({ ok: true, value: STEP });

    await useDocumentStore.getState().open('asset-1');
    vi.mocked(documents.stepState).mockResolvedValue({ ok: true, value: revisited });

    await useDocumentStore.getState().undo();

    expect(documents.documentUndo).toHaveBeenCalledWith('asset-1');
    const state = useDocumentStore.getState();
    expect(state.step?.step).toBe('silhouette');
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('undo records the failure code and does not re-read the step', async () => {
    vi.mocked(documents.documentUndo).mockResolvedValue({
      ok: false,
      error: { code: 'document.nothing_to_undo', detail: '' },
    });

    await useDocumentStore.getState().open('asset-1');
    vi.mocked(documents.stepState).mockClear();
    await useDocumentStore.getState().undo();

    expect(documents.stepState).not.toHaveBeenCalled();
    const state = useDocumentStore.getState();
    expect(state.error).toBe('document.nothing_to_undo');
    expect(state.loading).toBe(false);
  });

  it('redo re-reads the step state on success', async () => {
    vi.mocked(documents.documentRedo).mockResolvedValue({
      ok: true,
      value: { assetId: 'asset-1' } as never,
    });
    const revisited: StepState = {
      ...STEP,
      step: 'shadow',
      gate: { ...STEP.gate, step: 'shadow' },
    };

    await useDocumentStore.getState().open('asset-1');
    vi.mocked(documents.stepState).mockResolvedValue({ ok: true, value: revisited });

    await useDocumentStore.getState().redo();

    expect(documents.documentRedo).toHaveBeenCalledWith('asset-1');
    const state = useDocumentStore.getState();
    expect(state.step?.step).toBe('shadow');
  });

  it('redo records the failure code', async () => {
    vi.mocked(documents.documentRedo).mockResolvedValue({
      ok: false,
      error: { code: 'document.nothing_to_redo', detail: '' },
    });

    await useDocumentStore.getState().open('asset-1');
    await useDocumentStore.getState().redo();

    const state = useDocumentStore.getState();
    expect(state.error).toBe('document.nothing_to_redo');
    expect(state.loading).toBe(false);
  });

  it('writePalette replaces the palette with what the shell returned', async () => {
    const written = { slots: [{ index: 1, ramp: 'skin', position: 0 }], ramps: [] } as never;
    vi.mocked(documents.paletteWrite).mockResolvedValue({ ok: true, value: written });

    await useDocumentStore.getState().open('asset-1');
    await useDocumentStore.getState().writePalette({ slots: [], ramps: [] });

    expect(documents.paletteWrite).toHaveBeenCalledWith('asset-1', { slots: [], ramps: [] });
    const state = useDocumentStore.getState();
    expect(state.palette).toEqual(written);
    expect(state.loading).toBe(false);
  });

  it('writePalette records the failure code', async () => {
    vi.mocked(documents.paletteWrite).mockResolvedValue({
      ok: false,
      error: { code: 'document.invalid_buffer', detail: 'slot' },
    });

    await useDocumentStore.getState().open('asset-1');
    await useDocumentStore.getState().writePalette({ slots: [], ramps: [] });

    expect(useDocumentStore.getState().error).toBe('document.invalid_buffer');
  });

  it('check re-evaluates the current gate without advancing the step', async () => {
    const report: GateReport = { ...STEP.gate, pass: true };
    vi.mocked(documents.stepCheck).mockResolvedValue({ ok: true, value: report });

    await useDocumentStore.getState().open('asset-1');
    await useDocumentStore.getState().check();

    expect(documents.stepCheck).toHaveBeenCalledWith('asset-1');
    const state = useDocumentStore.getState();
    expect(state.gate).toEqual(report);
    expect(state.step?.step).toBe('flats');
  });

  it('check records the failure code', async () => {
    vi.mocked(documents.stepCheck).mockResolvedValue({
      ok: false,
      error: { code: 'document.not_found', detail: '' },
    });

    await useDocumentStore.getState().open('asset-1');
    await useDocumentStore.getState().check();

    expect(useDocumentStore.getState().error).toBe('document.not_found');
  });

  it('dispose unlistens every subscription and closes the document', async () => {
    const unlistenChanged = vi.fn();
    const unlistenPalette = vi.fn();
    const unlistenStep = vi.fn();
    vi.mocked(documents.onDocumentChanged).mockResolvedValue(unlistenChanged);
    vi.mocked(documents.onPaletteChanged).mockResolvedValue(unlistenPalette);
    vi.mocked(documents.onStepChanged).mockResolvedValue(unlistenStep);

    await useDocumentStore.getState().open('asset-1');
    useDocumentStore.getState().dispose();

    expect(unlistenChanged).toHaveBeenCalled();
    expect(unlistenPalette).toHaveBeenCalled();
    expect(unlistenStep).toHaveBeenCalled();
    expect(useDocumentStore.getState().assetId).toBeNull();
  });

  it('clearError clears the last error', async () => {
    vi.mocked(documents.assetOpen).mockResolvedValue({
      ok: false,
      error: { code: 'document.not_found', detail: 'asset-2' },
    });
    await useDocumentStore.getState().open('asset-2');
    expect(useDocumentStore.getState().error).toBe('document.not_found');

    useDocumentStore.getState().clearError();

    expect(useDocumentStore.getState().error).toBeNull();
  });
});
