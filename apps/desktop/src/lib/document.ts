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
 * The document commands, and the events the document emits.
 *
 * One function per command in `commands/document.rs`, named after it, so that
 * a command can be found from either side by searching for the same word.
 * Every one returns a {@link ShellResult} rather than throwing, like the rest
 * of the bridge in `lib/tauri.ts`: outside a Tauri window they all report
 * `shell.unavailable`, which is what lets the interface render under Vitest.
 *
 * Argument names are camelCase because Tauri 2 renames command arguments for
 * the webview, so Rust's `asset_id` is `assetId` here. Getting one wrong is not
 * a compile error on either side - it arrives as a missing argument at run time
 * - which is why the names are written once, here, and nowhere else.
 *
 * Every write goes through {@link documentWriteOps}. There is no second path,
 * which is what makes an agent's edit and a user's edit indistinguishable to
 * undo.
 */

import { invoke, on } from '@/lib/tauri';
import type {
  Asset,
  AssetKind,
  ChangedEvent,
  Document,
  GateReport,
  IndexedBuffer,
  LayerRole,
  Op,
  OpResult,
  Palette,
  PaletteEvent,
  Project,
  RgbaImage,
  StepEvent,
  StepState,
  StylePreset,
  AgentActivityEvent,
  AgentSessionEvent,
} from '@/types/document';

import type { ShellResult } from '@/lib/tauri';
import type { UnlistenFn } from '@tauri-apps/api/event';

/** The events the document side of the shell emits. */
export const DOCUMENT_EVENTS = {
  changed: 'document://changed',
  palette: 'document://palette',
  step: 'document://step',
  agentActivity: 'agent://activity',
  agentSession: 'agent://session',
} as const;

/** Lists every project, oldest first. */
export function projectList(): Promise<ShellResult<Project[]>> {
  return invoke<Project[]>('project_list');
}

/**
 * Creates a project, and the style it expands the preset into.
 *
 * The preset is chosen once, here, because it decides the palette ceiling and
 * the ramp bounds every asset in the project is then checked against.
 */
export function projectCreate(name: string, preset: StylePreset): Promise<ShellResult<Project>> {
  return invoke<Project>('project_create', { name, preset });
}

/** Renames a project. */
export function projectRename(id: string, name: string): Promise<ShellResult<Project>> {
  return invoke<Project>('project_rename', { id, name });
}

/**
 * Deletes a project.
 *
 * Cascades to every asset in it, and through each asset to its layers, its
 * palette, its references and its whole op log.
 */
export function projectDelete(id: string): Promise<ShellResult<null>> {
  return invoke<null>('project_delete', { id });
}

/** Lists one project's assets, oldest first. */
export function assetList(projectId: string): Promise<ShellResult<Asset[]>> {
  return invoke<Asset[]>('asset_list', { projectId });
}

/**
 * Creates an asset at a fixed size.
 *
 * The size is settled here and not later: every layer is that size, and the op
 * log records coordinates within it, so a resize is a different operation
 * rather than an edit to this one.
 */
export function assetCreate(
  projectId: string,
  name: string,
  kind: AssetKind,
  width: number,
  height: number,
): Promise<ShellResult<Asset>> {
  // The command's own parameters are `w` and `h`, not `width` and `height`.
  return invoke<Asset>('asset_create', { projectId, name, kind, w: width, h: height });
}

/** Renames an asset. */
export function assetRename(id: string, name: string): Promise<ShellResult<Asset>> {
  return invoke<Asset>('asset_rename', { id, name });
}

/** Deletes an asset, its layers, its palette and its op log. */
export function assetDelete(id: string): Promise<ShellResult<null>> {
  return invoke<null>('asset_delete', { id });
}

/** Reads a whole document: the asset, its palette, and every layer it has. */
export function assetOpen(id: string): Promise<ShellResult<Document>> {
  return invoke<Document>('asset_open', { id });
}

/** Composites the document to sRGB, for the canvas to draw. */
export function documentComposite(assetId: string): Promise<ShellResult<RgbaImage>> {
  return invoke<RgbaImage>('document_composite', { assetId });
}

/** Reads one layer's indices. */
export function documentReadLayer(
  assetId: string,
  role: LayerRole,
): Promise<ShellResult<IndexedBuffer>> {
  return invoke<IndexedBuffer>('document_read_layer', { assetId, role });
}

/**
 * The single write path.
 *
 * A batch rather than one op, because a user's brush stroke and an agent's
 * `draw_runs` are the same thing arriving at different granularities, and both
 * want to land as one undo entry.
 */
export function documentWriteOps(assetId: string, ops: Op[]): Promise<ShellResult<OpResult>> {
  return invoke<OpResult>('document_write_ops', { assetId, ops });
}

/** Steps the undo cursor back one entry. */
export function documentUndo(assetId: string): Promise<ShellResult<OpResult>> {
  return invoke<OpResult>('document_undo', { assetId });
}

/** Steps the undo cursor forward one entry. */
export function documentRedo(assetId: string): Promise<ShellResult<OpResult>> {
  return invoke<OpResult>('document_redo', { assetId });
}

/** Reads the document's palette. */
export function paletteRead(assetId: string): Promise<ShellResult<Palette>> {
  return invoke<Palette>('palette_read', { assetId });
}

/**
 * Replaces the document's palette.
 *
 * Not one pixel of any layer moves. That is the point of storing indices: a
 * recolour cannot drift the value structure of what was already drawn.
 */
export function paletteWrite(assetId: string, palette: Palette): Promise<ShellResult<Palette>> {
  return invoke<Palette>('palette_write', { assetId, palette });
}

/** Reads where the asset is in the workflow, and whether it may move on. */
export function stepState(assetId: string): Promise<ShellResult<StepState>> {
  return invoke<StepState>('step_state', { assetId });
}

/** Re-evaluates the current step's gates without advancing. */
export function stepCheck(assetId: string): Promise<ShellResult<GateReport>> {
  return invoke<GateReport>('step_check', { assetId });
}

/** Advances to the next step, which fails unless the current gate passes. */
export function stepAdvance(assetId: string): Promise<ShellResult<StepState>> {
  return invoke<StepState>('step_advance', { assetId });
}

/**
 * Subscribes to writes.
 *
 * The payload names the roles that moved rather than carrying their pixels, so
 * a listener re-reads only what changed and a fast agent cannot flood the
 * channel with buffers. Emission is coalesced on a frame boundary in Rust, so a
 * burst arrives as one event with the roles unioned.
 */
export function onDocumentChanged(handler: (event: ChangedEvent) => void): Promise<UnlistenFn> {
  return on<ChangedEvent>(DOCUMENT_EVENTS.changed, handler);
}

/** Subscribes to palette edits. */
export function onPaletteChanged(handler: (event: PaletteEvent) => void): Promise<UnlistenFn> {
  return on<PaletteEvent>(DOCUMENT_EVENTS.palette, handler);
}

/** Subscribes to step advances and gate re-evaluations. */
export function onStepChanged(handler: (event: StepEvent) => void): Promise<UnlistenFn> {
  return on<StepEvent>(DOCUMENT_EVENTS.step, handler);
}

/** Subscribes to the start of each MCP tool call. */
export function onAgentActivity(handler: (event: AgentActivityEvent) => void): Promise<UnlistenFn> {
  return on<AgentActivityEvent>(DOCUMENT_EVENTS.agentActivity, handler);
}

/** Subscribes to MCP clients connecting and disconnecting. */
export function onAgentSession(handler: (event: AgentSessionEvent) => void): Promise<UnlistenFn> {
  return on<AgentSessionEvent>(DOCUMENT_EVENTS.agentSession, handler);
}
