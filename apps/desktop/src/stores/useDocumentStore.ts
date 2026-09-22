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
 * The open document: its layers, its palette, and where it is in the workflow.
 *
 * RUST HOLDS THE DOCUMENT, THIS HOLDS A VIEW OF IT
 *
 * Nothing here is authoritative. The database is the document, and every byte
 * in this store arrived from a command. That is what makes an agent editing the
 * same sprite through MCP safe: there is no in-memory copy for the two writers
 * to disagree about, and no save step that could lose one of them.
 *
 * WRITES GO ONE WAY
 *
 * Every mutation is a `document_write_ops` call. This store never edits a
 * buffer it is holding, because a locally applied edit would be a second write
 * path, and the moment there are two of them undo is a lie about one of them.
 *
 * READS COME BACK THROUGH THE EVENT
 *
 * `document://changed` names the layer roles that moved and carries no pixels,
 * so a write is followed by a re-read of exactly those roles. That is the whole
 * reason the event carries roles: a fast agent making a thousand small edits
 * costs one buffer per role per frame instead of a buffer per op. A role the
 * store has never seen means a layer was created, which nothing but a full
 * `asset_open` can supply, so that one case re-reads the document.
 *
 * A failed read leaves what is on screen alone and records the reason code. A
 * half-applied re-read would show a sprite that never existed: some layers from
 * before the write and some from after.
 */

import { create } from 'zustand';

import {
  assetOpen,
  documentReadLayer,
  documentRedo,
  documentUndo,
  documentWriteOps,
  onDocumentChanged,
  onPaletteChanged,
  onStepChanged,
  paletteRead,
  paletteWrite,
  stepAdvance,
  stepCheck,
  stepState,
} from '@/lib/document';
import type {
  Asset,
  ChangedEvent,
  GateReport,
  Layer,
  LayerRole,
  Op,
  Palette,
  PaletteEvent,
  StepEvent,
  StepState,
} from '@/types/document';

import type { ShellResult } from '@/lib/tauri';
import type { UnlistenFn } from '@tauri-apps/api/event';

interface DocumentState {
  /** The asset the document belongs to, or null when none is open. */
  assetId: string | null;
  /** The open asset's row, or null when none is open. */
  asset: Asset | null;
  /** Every layer the document has, sorted by ordinal. */
  layers: Layer[];
  /** The document's palette, or null when none is open. */
  palette: Palette | null;
  /** Where the asset is in the workflow, or null before it has been read. */
  step: StepState | null;
  /** The most recent gate evaluation, from whichever command or event produced it. */
  gate: GateReport | null;
  /** The op log sequence this view was built from. */
  seq: number;
  /** True while a command is in flight. */
  loading: boolean;
  /** Stable reason code for the last failure, or null. */
  error: string | null;

  /** Opens a document, replacing whatever was open. */
  open: (assetId: string) => Promise<void>;
  /** Closes the document without touching what is stored. */
  close: () => void;
  /** Commits a batch of ops as one undo entry. */
  write: (ops: Op[]) => Promise<void>;
  /** Steps the undo cursor back. */
  undo: () => Promise<void>;
  /** Steps the undo cursor forward. */
  redo: () => Promise<void>;
  /** Replaces the palette, leaving every pixel where it is. */
  writePalette: (palette: Palette) => Promise<void>;
  /** Re-evaluates the current step's gates without advancing. */
  check: () => Promise<void>;
  /** Advances to the next step, which fails unless the gate passes. */
  advance: () => Promise<void>;
  /**
   * Applies one change event: re-reads the roles it names, and nothing else.
   *
   * Public because it is what the subscription calls, and because it is the
   * behaviour worth testing without a shell to emit events from.
   */
  applyChange: (event: ChangedEvent) => Promise<void>;
  /** Attaches the document event listeners. Safe to call more than once. */
  subscribe: () => Promise<void>;
  /** Detaches the listeners and closes the document. */
  dispose: () => void;
  /** Clears the last error. */
  clearError: () => void;
}

/**
 * The live subscriptions.
 *
 * Module scope rather than store state, because they are not something a
 * component renders and because `dispose` has to be able to cancel them without
 * a render having observed them first.
 */
let listeners: UnlistenFn[] = [];

/** Whether subscription has been started, so a second call does not double up. */
let subscribing: Promise<void> | null = null;

export const useDocumentStore = create<DocumentState>((set, get) => {
  /**
   * Records a failure under its reason code and stops the loading state.
   *
   * @param code - The stable reason code the command returned.
   */
  const fail = (code: string): void => {
    set({ error: code, loading: false });
  };

  /**
   * Reads the workflow position, which every command that could move it needs.
   *
   * Failure is recorded but does not discard the document: a step that cannot
   * be read is a missing rail, not a missing sprite.
   *
   * @param assetId - The open asset.
   */
  const refreshStep = async (assetId: string): Promise<void> => {
    const state = await stepState(assetId);
    if (state.ok) {
      set({ step: state.value, gate: state.value.gate });
      return;
    }
    set({ error: state.error.code });
  };

  /**
   * Guards a command that only makes sense with a document open.
   *
   * @returns The open asset's id, or null when none is open.
   */
  const openAsset = (): string | null => get().assetId;

  return {
    assetId: null,
    asset: null,
    layers: [],
    palette: null,
    step: null,
    gate: null,
    seq: 0,
    loading: false,
    error: null,

    open: async (assetId) => {
      // Attached here rather than by whichever component happens to be mounted,
      // because the events belong to the document and not to a view of it: an
      // agent can write to the open sprite while no canvas is on screen at all.
      await get().subscribe();

      set({ loading: true, error: null });
      const document = await assetOpen(assetId);
      if (!document.ok) {
        // The document that failed to open is not adopted, and whatever was
        // open before is left alone rather than being replaced by nothing.
        fail(document.error.code);
        return;
      }

      set({
        assetId,
        asset: document.value.asset,
        layers: document.value.layers,
        palette: document.value.palette,
        seq: 0,
        loading: false,
      });
      await refreshStep(assetId);
    },

    close: () => {
      set({
        assetId: null,
        asset: null,
        layers: [],
        palette: null,
        step: null,
        gate: null,
        seq: 0,
        error: null,
      });
    },

    write: async (ops) => {
      const assetId = openAsset();
      if (assetId === null || ops.length === 0) {
        return;
      }

      set({ loading: true, error: null });
      const result = await documentWriteOps(assetId, ops);
      if (!result.ok) {
        fail(result.error.code);
        return;
      }
      // The pixels are not taken from the result, which carries none. They
      // arrive through `document://changed`, by the same route an agent's
      // write reaches this store, so there is one path and not two.
      set({ loading: false });
    },

    undo: async () => {
      const assetId = openAsset();
      if (assetId === null) {
        return;
      }
      set({ loading: true, error: null });
      const result = await documentUndo(assetId);
      if (!result.ok) {
        fail(result.error.code);
        return;
      }
      set({ loading: false });
      await refreshStep(assetId);
    },

    redo: async () => {
      const assetId = openAsset();
      if (assetId === null) {
        return;
      }
      set({ loading: true, error: null });
      const result = await documentRedo(assetId);
      if (!result.ok) {
        fail(result.error.code);
        return;
      }
      set({ loading: false });
      await refreshStep(assetId);
    },

    writePalette: async (palette) => {
      const assetId = openAsset();
      if (assetId === null) {
        return;
      }
      set({ loading: true, error: null });
      const written = await paletteWrite(assetId, palette);
      if (!written.ok) {
        fail(written.error.code);
        return;
      }
      // What comes back, not what was sent: Rust normalises slot order and
      // ramp membership, and showing the palette that was asked for would hide
      // the one that was stored.
      set({ palette: written.value, loading: false });
    },

    check: async () => {
      const assetId = openAsset();
      if (assetId === null) {
        return;
      }
      set({ loading: true, error: null });
      const report = await stepCheck(assetId);
      if (!report.ok) {
        fail(report.error.code);
        return;
      }
      set({ gate: report.value, loading: false });
    },

    advance: async () => {
      const assetId = openAsset();
      if (assetId === null) {
        return;
      }
      set({ loading: true, error: null });
      const advanced = await stepAdvance(assetId);
      if (!advanced.ok) {
        // A refused advance is the ordinary outcome of a gate that did not
        // pass, so the reason code is recorded and the step is left where it
        // was rather than the document being closed.
        fail(advanced.error.code);
        return;
      }
      set({
        step: advanced.value,
        gate: advanced.value.gate,
        asset: withStep(get().asset, advanced.value),
        loading: false,
      });
    },

    applyChange: async (event) => {
      const { assetId, layers } = get();
      if (assetId === null || event.assetId !== assetId) {
        // An event for a document this window does not have open. Another
        // asset can be written by an agent at any time.
        return;
      }

      if (event.roles.some((role) => !layers.some((layer) => layer.role === role))) {
        // A role nothing is holding means a layer was created by that write,
        // and a layer read returns only pixels - no ordinal, no opacity, no
        // identity. The whole document is the only thing that carries those.
        const document = await assetOpen(assetId);
        if (!document.ok) {
          set({ error: document.error.code });
          return;
        }
        set({
          asset: document.value.asset,
          layers: document.value.layers,
          palette: document.value.palette,
          seq: event.seq,
        });
        return;
      }

      const reads = await Promise.all(
        event.roles.map(async (role) => ({
          role,
          result: await documentReadLayer(assetId, role),
        })),
      );

      const failed = reads.find((read) => !read.result.ok);
      if (failed !== undefined && !failed.result.ok) {
        // Nothing is applied. A document showing some layers from before the
        // write and some from after is a sprite that never existed.
        set({ error: failed.result.error.code });
        return;
      }

      set({ layers: merge(get().layers, reads), seq: event.seq });
    },

    subscribe: async () => {
      subscribing ??= (async () => {
        const changed = await onDocumentChanged((event) => {
          void get().applyChange(event);
        });
        const palette = await onPaletteChanged((event: PaletteEvent) => {
          void (async () => {
            if (event.assetId !== get().assetId) {
              return;
            }
            const read = await paletteRead(event.assetId);
            if (read.ok) {
              set({ palette: read.value });
              return;
            }
            set({ error: read.error.code });
          })();
        });
        const step = await onStepChanged((event: StepEvent) => {
          if (event.assetId !== get().assetId) {
            return;
          }
          // The payload carries the report in full, so a step event costs no
          // command at all. That matters while an agent is advancing steps.
          set({ gate: event.gate, step: withGate(get().step, event) });
        });
        listeners = [changed, palette, step];
      })();

      await subscribing;
    },

    dispose: () => {
      for (const unlisten of listeners) {
        unlisten();
      }
      listeners = [];
      subscribing = null;
      get().close();
    },

    clearError: () => {
      set({ error: null });
    },
  };
});

/**
 * Replaces the buffers of the roles that were re-read, leaving the rest alone.
 *
 * @param layers - The layers as they stand.
 * @param reads - The re-read roles, every one of which succeeded.
 * @returns The layers, with the named roles carrying their new pixels.
 */
function merge(
  layers: Layer[],
  reads: { role: LayerRole; result: ShellResult<Layer['buffer']> }[],
): Layer[] {
  return layers.map((layer) => {
    const read = reads.find((candidate) => candidate.role === layer.role);
    if (read === undefined || !read.result.ok) {
      return layer;
    }
    return { ...layer, buffer: read.result.value };
  });
}

/**
 * Moves the cached asset row to the step an advance reported.
 *
 * The asset row carries its own step, and leaving it behind would make the
 * sidebar disagree with the step rail about the same sprite.
 *
 * @param asset - The asset row as it stands, or null when none is open.
 * @param state - What the advance reported.
 * @returns The asset row at its new step.
 */
function withStep(asset: Asset | null, state: StepState): Asset | null {
  return asset === null ? null : { ...asset, step: state.step };
}

/**
 * Folds a step event into the step state the store already holds.
 *
 * A gate re-evaluation names the step and the report but not whether the asset
 * may advance, which only `step_state` answers, so `canAdvance` is carried
 * across rather than guessed at from `passed`.
 *
 * @param state - The step state as it stands, or null before one was read.
 * @param event - What the shell reported.
 * @returns The updated step state, or null when there was nothing to update.
 */
function withGate(state: StepState | null, event: StepEvent): StepState | null {
  return state === null ? null : { ...state, step: event.step, gate: event.gate };
}
