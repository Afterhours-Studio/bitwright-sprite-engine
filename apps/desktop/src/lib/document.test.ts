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
 * The document bridge says the names the shell expects.
 *
 * As with `lib/mcp.test.ts`, there is no implementation here to exercise:
 * every function is one call that names a command and its argument keys. A
 * command name, an argument key, or an event channel that does not match the
 * Rust side is not a compile error on either side, so these tests assert the
 * literal strings on the wire.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assetCreate,
  assetDelete,
  assetList,
  assetOpen,
  assetRename,
  documentComposite,
  documentReadLayer,
  documentRedo,
  documentUndo,
  documentWriteOps,
  DOCUMENT_EVENTS,
  onAgentActivity,
  onAgentSession,
  onDocumentChanged,
  onPaletteChanged,
  onStepChanged,
  paletteRead,
  paletteWrite,
  projectCreate,
  projectDelete,
  projectList,
  projectRename,
  stepAdvance,
  stepCheck,
  stepRevisit,
  stepState,
  styleRead,
} from '@/lib/document';
import type {
  AgentActivityEvent,
  AgentSessionEvent,
  ChangedEvent,
  PaletteEvent,
  StepEvent,
} from '@/types/document';

vi.mock('@/lib/tauri', () => ({ invoke: vi.fn(), on: vi.fn() }));

const tauri = await import('@/lib/tauri');

/**
 * Makes the next command answer with a value.
 *
 * @param value - What the command returns.
 */
function answersWith(value: unknown): void {
  vi.mocked(tauri.invoke).mockResolvedValue({ ok: true, value } as never);
}

beforeEach(() => {
  vi.mocked(tauri.invoke).mockReset();
  vi.mocked(tauri.on).mockReset();
});

describe('projectList', () => {
  it('calls project_list with no arguments', async () => {
    answersWith([]);
    await projectList();
    expect(tauri.invoke).toHaveBeenCalledWith('project_list');
  });
});

describe('projectCreate', () => {
  it('sends the name and preset', async () => {
    answersWith({});
    await projectCreate('forest', 'hd2d');
    expect(tauri.invoke).toHaveBeenCalledWith('project_create', { name: 'forest', preset: 'hd2d' });
  });
});

describe('projectRename', () => {
  it('sends the id and the new name', async () => {
    answersWith({});
    await projectRename('project-1', 'renamed');
    expect(tauri.invoke).toHaveBeenCalledWith('project_rename', {
      id: 'project-1',
      name: 'renamed',
    });
  });
});

describe('projectDelete', () => {
  it('sends the id under the id key', async () => {
    answersWith(null);
    await projectDelete('project-1');
    expect(tauri.invoke).toHaveBeenCalledWith('project_delete', { id: 'project-1' });
  });
});

describe('assetList', () => {
  it('sends the project id', async () => {
    answersWith([]);
    await assetList('project-1');
    expect(tauri.invoke).toHaveBeenCalledWith('asset_list', { projectId: 'project-1' });
  });
});

describe('assetCreate', () => {
  it('sends width and height under w and h, not width and height', async () => {
    answersWith({});
    await assetCreate('project-1', 'hero', 'character', 48, 64);
    expect(tauri.invoke).toHaveBeenCalledWith('asset_create', {
      projectId: 'project-1',
      name: 'hero',
      kind: 'character',
      w: 48,
      h: 64,
    });
  });
});

describe('assetRename', () => {
  it('sends the id and the new name', async () => {
    answersWith({});
    await assetRename('asset-1', 'villager');
    expect(tauri.invoke).toHaveBeenCalledWith('asset_rename', { id: 'asset-1', name: 'villager' });
  });
});

describe('assetDelete', () => {
  it('sends the id under the id key', async () => {
    answersWith(null);
    await assetDelete('asset-1');
    expect(tauri.invoke).toHaveBeenCalledWith('asset_delete', { id: 'asset-1' });
  });
});

describe('assetOpen', () => {
  it('sends the id under the id key', async () => {
    answersWith({});
    await assetOpen('asset-1');
    expect(tauri.invoke).toHaveBeenCalledWith('asset_open', { id: 'asset-1' });
  });
});

describe('styleRead', () => {
  it('sends the style id under the id key', async () => {
    answersWith({});
    await styleRead('style-1');
    expect(tauri.invoke).toHaveBeenCalledWith('style_read', { id: 'style-1' });
  });
});

describe('documentComposite', () => {
  it('sends the asset id', async () => {
    answersWith({});
    await documentComposite('asset-1');
    expect(tauri.invoke).toHaveBeenCalledWith('document_composite', { assetId: 'asset-1' });
  });
});

describe('documentReadLayer', () => {
  it('sends the asset id and the role', async () => {
    answersWith({});
    await documentReadLayer('asset-1', 'flats');
    expect(tauri.invoke).toHaveBeenCalledWith('document_read_layer', {
      assetId: 'asset-1',
      role: 'flats',
    });
  });
});

describe('documentWriteOps', () => {
  it('sends the asset id and the ops batch', async () => {
    answersWith({});
    const ops = [{ kind: 'clear', layer: 'flats' }] as never;
    await documentWriteOps('asset-1', ops);
    expect(tauri.invoke).toHaveBeenCalledWith('document_write_ops', {
      assetId: 'asset-1',
      ops,
    });
  });
});

describe('documentUndo', () => {
  it('sends the asset id', async () => {
    answersWith({});
    await documentUndo('asset-1');
    expect(tauri.invoke).toHaveBeenCalledWith('document_undo', { assetId: 'asset-1' });
  });
});

describe('documentRedo', () => {
  it('sends the asset id', async () => {
    answersWith({});
    await documentRedo('asset-1');
    expect(tauri.invoke).toHaveBeenCalledWith('document_redo', { assetId: 'asset-1' });
  });
});

describe('paletteRead', () => {
  it('sends the asset id', async () => {
    answersWith({});
    await paletteRead('asset-1');
    expect(tauri.invoke).toHaveBeenCalledWith('palette_read', { assetId: 'asset-1' });
  });
});

describe('paletteWrite', () => {
  it('sends the asset id and the palette', async () => {
    answersWith({});
    const palette = { slots: [], ramps: [] } as never;
    await paletteWrite('asset-1', palette);
    expect(tauri.invoke).toHaveBeenCalledWith('palette_write', {
      assetId: 'asset-1',
      palette,
    });
  });
});

describe('stepState', () => {
  it('sends the asset id', async () => {
    answersWith({});
    await stepState('asset-1');
    expect(tauri.invoke).toHaveBeenCalledWith('step_state', { assetId: 'asset-1' });
  });
});

describe('stepCheck', () => {
  it('sends the asset id', async () => {
    answersWith({});
    await stepCheck('asset-1');
    expect(tauri.invoke).toHaveBeenCalledWith('step_check', { assetId: 'asset-1' });
  });
});

describe('stepAdvance', () => {
  it('defaults force to false when none is given', async () => {
    answersWith({});
    await stepAdvance('asset-1');
    expect(tauri.invoke).toHaveBeenCalledWith('step_advance', { assetId: 'asset-1', force: false });
  });

  it('sends force through when it is given', async () => {
    answersWith({});
    await stepAdvance('asset-1', true);
    expect(tauri.invoke).toHaveBeenCalledWith('step_advance', { assetId: 'asset-1', force: true });
  });
});

describe('stepRevisit', () => {
  it('sends the asset id and the step to return to', async () => {
    answersWith({});
    await stepRevisit('asset-1', 'silhouette');
    expect(tauri.invoke).toHaveBeenCalledWith('step_revisit', {
      assetId: 'asset-1',
      step: 'silhouette',
    });
  });
});

describe('DOCUMENT_EVENTS', () => {
  it('names each channel verbatim, as the shell emits it', () => {
    expect(DOCUMENT_EVENTS).toEqual({
      changed: 'document://changed',
      palette: 'document://palette',
      step: 'document://step',
      agentActivity: 'agent://activity',
      agentSession: 'agent://session',
    });
  });
});

describe('onDocumentChanged', () => {
  it('subscribes to the changed channel and forwards the payload', async () => {
    const event: ChangedEvent = { assetId: 'asset-1', roles: ['flats'], seq: 1 };
    vi.mocked(tauri.on).mockImplementation((_name, handler) => {
      handler(event);
      return Promise.resolve(() => undefined);
    });
    const seen = vi.fn<(event: ChangedEvent) => void>();

    await onDocumentChanged(seen);

    expect(tauri.on).toHaveBeenCalledWith('document://changed', expect.any(Function));
    expect(seen).toHaveBeenCalledWith(event);
  });
});

describe('onPaletteChanged', () => {
  it('subscribes to the palette channel and forwards the payload', async () => {
    const event: PaletteEvent = { assetId: 'asset-1' };
    vi.mocked(tauri.on).mockImplementation((_name, handler) => {
      handler(event);
      return Promise.resolve(() => undefined);
    });
    const seen = vi.fn<(event: PaletteEvent) => void>();

    await onPaletteChanged(seen);

    expect(tauri.on).toHaveBeenCalledWith('document://palette', expect.any(Function));
    expect(seen).toHaveBeenCalledWith(event);
  });
});

describe('onStepChanged', () => {
  it('subscribes to the step channel and forwards the payload', async () => {
    const event = { assetId: 'asset-1' } as unknown as StepEvent;
    vi.mocked(tauri.on).mockImplementation((_name, handler) => {
      handler(event);
      return Promise.resolve(() => undefined);
    });
    const seen = vi.fn<(event: StepEvent) => void>();

    await onStepChanged(seen);

    expect(tauri.on).toHaveBeenCalledWith('document://step', expect.any(Function));
    expect(seen).toHaveBeenCalledWith(event);
  });
});

describe('onAgentActivity', () => {
  it('subscribes to the activity channel and forwards the payload', async () => {
    const event: AgentActivityEvent = { sessionId: 'session-1', tool: 'draw_runs', assetId: 'a1' };
    vi.mocked(tauri.on).mockImplementation((_name, handler) => {
      handler(event);
      return Promise.resolve(() => undefined);
    });
    const seen = vi.fn<(event: AgentActivityEvent) => void>();

    await onAgentActivity(seen);

    expect(tauri.on).toHaveBeenCalledWith('agent://activity', expect.any(Function));
    expect(seen).toHaveBeenCalledWith(event);
  });
});

describe('onAgentSession', () => {
  it('subscribes to the session channel and forwards the payload', async () => {
    const event: AgentSessionEvent = { sessionId: 'session-1', state: 'connected' };
    vi.mocked(tauri.on).mockImplementation((_name, handler) => {
      handler(event);
      return Promise.resolve(() => undefined);
    });
    const seen = vi.fn<(event: AgentSessionEvent) => void>();

    await onAgentSession(seen);

    expect(tauri.on).toHaveBeenCalledWith('agent://session', expect.any(Function));
    expect(seen).toHaveBeenCalledWith(event);
  });
});
