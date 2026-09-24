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
 * The MCP bridge says the names the shell expects.
 *
 * There is no implementation here to exercise: every function is one call that
 * names a command and its argument keys. That indirection is the whole risk,
 * because a command name, an argument key, or an event channel that does not
 * match the Rust side is not a compile error on either side. It answers
 * `invalid args` at run time, or a panel quietly shows nothing. So these tests
 * assert the literal strings on the wire rather than behaviour, which is the
 * only cheap way to catch a rename made on one side of the boundary.
 *
 * The bridge is mocked rather than a Tauri window stood up, which also fixes
 * what is under test: unwrapping and error translation belong to
 * `lib/tauri.ts` and are exercised there.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MCP_EVENTS,
  mcpClientRegister,
  mcpClientUnregister,
  mcpClients,
  mcpManualConfig,
  mcpRegenerateToken,
  mcpSetTransport,
  mcpStatus,
  onAgentActivity,
  onAgentSession,
  onDocumentChanged,
} from '@/lib/mcp';
import type {
  AgentActivityEvent,
  AgentSessionEvent,
  DocumentChangedEvent,
  McpClient,
  McpStatus,
} from '@/types/mcp';

vi.mock('@/lib/tauri', () => ({ invoke: vi.fn(), on: vi.fn() }));

const tauri = await import('@/lib/tauri');

/**
 * Status as the shell would report it, with a live server on a port.
 *
 * @returns A status.
 */
function status(): McpStatus {
  return {
    transport: 'http',
    running: true,
    port: 53124,
    url: 'http://127.0.0.1:53124/mcp',
    token: 'tok-1',
    sessions: [{ id: 'session-1', connectedAt: 10, lastToolAt: 20, lastTool: 'draw_runs' }],
  };
}

/**
 * A client row, as the shell would return one.
 *
 * @returns The row.
 */
function client(): McpClient {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    detected: true,
    configPath: 'C:/Users/dev/.claude.json',
    registered: false,
  };
}

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

describe('mcpStatus', () => {
  it('calls mcp_status with no arguments at all', async () => {
    answersWith(status());

    await expect(mcpStatus()).resolves.toEqual({ ok: true, value: status() });
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    expect(tauri.invoke).toHaveBeenCalledWith('mcp_status');
  });
});

describe('mcpSetTransport', () => {
  it('sends off under the transport key the command declares', async () => {
    answersWith({ ...status(), transport: 'off', running: false, port: null, url: null });

    await mcpSetTransport('off');
    expect(tauri.invoke).toHaveBeenCalledWith('mcp_set_transport', { transport: 'off' });
  });

  it('sends http through unchanged, rather than a shell side spelling', async () => {
    answersWith(status());

    await mcpSetTransport('http');
    expect(tauri.invoke).toHaveBeenCalledWith('mcp_set_transport', { transport: 'http' });
  });
});

describe('mcpRegenerateToken', () => {
  it('calls mcp_regenerate_token and hands back the status with the new token', async () => {
    const renewed = { ...status(), token: 'tok-2' };
    answersWith(renewed);

    await expect(mcpRegenerateToken()).resolves.toEqual({ ok: true, value: renewed });
    expect(tauri.invoke).toHaveBeenCalledWith('mcp_regenerate_token');
  });
});

describe('mcpClients', () => {
  it('calls mcp_clients with no arguments', async () => {
    answersWith([client()]);

    await expect(mcpClients()).resolves.toEqual({ ok: true, value: [client()] });
    expect(tauri.invoke).toHaveBeenCalledWith('mcp_clients');
  });
});

describe('mcpClientRegister', () => {
  it('sends the id under the id key, never a path', async () => {
    const registered = { ...client(), registered: true };
    answersWith(registered);

    await expect(mcpClientRegister('cursor')).resolves.toEqual({ ok: true, value: registered });
    expect(tauri.invoke).toHaveBeenCalledWith('mcp_client_register', { id: 'cursor' });
  });
});

describe('mcpClientUnregister', () => {
  it('sends the id under the same key as its counterpart', async () => {
    answersWith(client());

    await mcpClientUnregister('claude-desktop');
    expect(tauri.invoke).toHaveBeenCalledWith('mcp_client_unregister', { id: 'claude-desktop' });
  });
});

describe('mcpManualConfig', () => {
  it('calls mcp_manual_config and hands back the text the shell returned', async () => {
    const snippet = '{mcpServers:{bitwright:{url:http://127.0.0.1:53124/mcp}}}';
    answersWith(snippet);

    await expect(mcpManualConfig()).resolves.toEqual({ ok: true, value: snippet });
    expect(tauri.invoke).toHaveBeenCalledWith('mcp_manual_config');
  });
});

describe('MCP_EVENTS', () => {
  it('names each channel verbatim, as the shell emits it', () => {
    expect(MCP_EVENTS).toEqual({
      session: 'agent://session',
      activity: 'agent://activity',
      changed: 'document://changed',
      opened: 'document://opened',
    });
  });

  it('is the same channel list the listeners subscribe to', async () => {
    vi.mocked(tauri.on).mockResolvedValue(() => undefined);

    await onAgentSession(vi.fn());
    await onAgentActivity(vi.fn());
    await onDocumentChanged(vi.fn());

    expect(tauri.on).toHaveBeenNthCalledWith(1, MCP_EVENTS.session, expect.any(Function));
    expect(tauri.on).toHaveBeenNthCalledWith(2, MCP_EVENTS.activity, expect.any(Function));
    expect(tauri.on).toHaveBeenNthCalledWith(3, MCP_EVENTS.changed, expect.any(Function));
  });
});

describe('onAgentSession', () => {
  it('subscribes to the session channel and forwards each payload', async () => {
    const event: AgentSessionEvent = { sessionId: 'session-1', state: 'connected' };
    vi.mocked(tauri.on).mockImplementation((_name, handler) => {
      handler(event);
      return Promise.resolve(() => undefined);
    });
    const seen = vi.fn<(event: AgentSessionEvent) => void>();

    const unlisten = await onAgentSession(seen);
    expect(unlisten).toBeTypeOf('function');

    expect(tauri.on).toHaveBeenCalledWith('agent://session', expect.any(Function));
    expect(seen).toHaveBeenCalledWith(event);
  });
});

describe('onAgentActivity', () => {
  it('subscribes to the activity channel and forwards the tool that started', async () => {
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

describe('onDocumentChanged', () => {
  it('subscribes to the changed channel and forwards the roles that moved', async () => {
    const event: DocumentChangedEvent = {
      assetId: 'a1',
      roles: ['flats', 'shadow-core'],
      seq: 42,
    };
    vi.mocked(tauri.on).mockImplementation((_name, handler) => {
      handler(event);
      return Promise.resolve(() => undefined);
    });
    const seen = vi.fn<(event: DocumentChangedEvent) => void>();

    await onDocumentChanged(seen);

    expect(tauri.on).toHaveBeenCalledWith('document://changed', expect.any(Function));
    expect(seen).toHaveBeenCalledWith(event);
  });
});
