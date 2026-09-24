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
 * The MCP card renders the server's state, the token, sessions, clients,
 * and the manual snippet.
 *
 * `@/lib/mcp` is mocked entirely: every command returns a plausible answer,
 * and the store exercises the real logic. The tests check what the card shows
 * for a given store state, not how it got there.
 *
 * Every command gets a default resolved answer in `beforeEach`, because a
 * `vi.fn()` that answers `undefined` makes the store read a property of
 * nothing the moment a click reaches it - and a click whose promise nobody
 * awaits reports that as an unhandled rejection in whichever test happens to
 * be running when the promise settles. Each test that clicks therefore also
 * waits for the effect it caused.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/mcp', () => ({
  mcpStatus: vi.fn(),
  mcpSetTransport: vi.fn(),
  mcpRegenerateToken: vi.fn(),
  mcpClients: vi.fn(),
  mcpClientRegister: vi.fn(),
  mcpClientUnregister: vi.fn(),
  mcpManualConfig: vi.fn(),
  onAgentSession: vi.fn(),
  onAgentActivity: vi.fn(),
}));

vi.mock('@/lib/tauri', () => ({
  inShell: vi.fn(() => true),
}));

const mcp = await import('@/lib/mcp');
const tauri = await import('@/lib/tauri');
import McpCard from '@/features/settings/mcp/McpCard';
import { useMcpStore } from '@/features/settings/mcp/useMcpStore';
import type { McpClient } from '@/types/mcp';

function ok<T>(value: T) {
  return { ok: true, value } as const;
}

const BASE_STATUS = {
  transport: 'off' as const,
  running: false,
  port: null,
  url: null,
  token: 'tok-12345678',
  sessions: [],
};

/** A detected client, unregistered unless the test says otherwise. */
function client(overrides: Partial<McpClient> = {}): McpClient {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    detected: true,
    configPath: '/path',
    registered: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(mcp.mcpStatus).mockReset();
  vi.mocked(mcp.mcpSetTransport).mockReset();
  vi.mocked(mcp.mcpRegenerateToken).mockReset();
  vi.mocked(mcp.mcpClients).mockReset();
  vi.mocked(mcp.mcpClientRegister).mockReset();
  vi.mocked(mcp.mcpClientUnregister).mockReset();
  vi.mocked(mcp.mcpManualConfig).mockReset();
  vi.mocked(mcp.onAgentSession).mockReset();
  vi.mocked(mcp.onAgentActivity).mockReset();

  // Defaults for everything, so no click can ever reach a command that answers
  // nothing and no promise is left without a value to resolve to.
  vi.mocked(mcp.mcpStatus).mockResolvedValue(ok(BASE_STATUS));
  vi.mocked(mcp.mcpSetTransport).mockResolvedValue(ok(BASE_STATUS));
  vi.mocked(mcp.mcpRegenerateToken).mockResolvedValue(ok(BASE_STATUS));
  vi.mocked(mcp.mcpClients).mockResolvedValue(ok([]));
  vi.mocked(mcp.mcpClientRegister).mockResolvedValue(ok(client({ registered: true })));
  vi.mocked(mcp.mcpClientUnregister).mockResolvedValue(ok(client({ registered: false })));
  vi.mocked(mcp.mcpManualConfig).mockResolvedValue(ok(''));
  vi.mocked(mcp.onAgentSession).mockResolvedValue(vi.fn());
  vi.mocked(mcp.onAgentActivity).mockResolvedValue(vi.fn());

  vi.mocked(tauri.inShell).mockReturnValue(true);

  useMcpStore.getState().dispose();
  useMcpStore.setState({
    status: null,
    clients: [],
    manualConfig: null,
    loading: false,
    error: null,
  });
});

describe('McpCard', () => {
  it('shows the transport as stopped when off', async () => {
    render(<McpCard />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Off');
    });
  });

  it('shows the transport as running when http', async () => {
    vi.mocked(mcp.mcpStatus).mockResolvedValue(
      ok({
        ...BASE_STATUS,
        transport: 'http',
        running: true,
        port: 53124,
        url: 'http://127.0.0.1:53124/mcp',
      }),
    );

    render(<McpCard />);

    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument();
      expect(screen.getByText('http://127.0.0.1:53124/mcp')).toBeInTheDocument();
    });
  });

  it('masks the token and reveals it', async () => {
    render(<McpCard />);

    await waitFor(() => {
      expect(screen.getByText(/\u2022\u2022\u2022\u20225678/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /reveal/i }));

    expect(screen.getByText('tok-12345678')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hide/i })).toBeInTheDocument();
  });

  it('regenerates the token', async () => {
    vi.mocked(mcp.mcpStatus).mockResolvedValue(
      ok({
        ...BASE_STATUS,
        running: true,
        transport: 'http',
        port: 53124,
        url: 'http://127.0.0.1:53124/mcp',
      }),
    );

    render(<McpCard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /regenerate/i })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));

    await waitFor(() => {
      expect(mcp.mcpRegenerateToken).toHaveBeenCalledTimes(1);
      expect(useMcpStore.getState().loading).toBe(false);
    });
  });

  it('registers a detected and unregistered client', async () => {
    const detected = client();
    vi.mocked(mcp.mcpClientRegister).mockResolvedValue(ok({ ...detected, registered: true }));
    vi.mocked(mcp.mcpClients).mockResolvedValue(ok([detected]));

    render(<McpCard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /register$/i })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /register$/i }));

    await waitFor(() => {
      expect(mcp.mcpClientRegister).toHaveBeenCalledWith('claude-code');
      expect(useMcpStore.getState().loading).toBe(false);
    });
  });

  it('unregisters a registered client', async () => {
    const registered = client({ registered: true });
    vi.mocked(mcp.mcpClientUnregister).mockResolvedValue(ok({ ...registered, registered: false }));
    vi.mocked(mcp.mcpClients).mockResolvedValue(ok([registered]));

    render(<McpCard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /remove/i })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(() => {
      expect(mcp.mcpClientUnregister).toHaveBeenCalledWith('claude-code');
      expect(useMcpStore.getState().loading).toBe(false);
    });
  });

  it('configures all detected-and-unregistered clients', async () => {
    const clients: McpClient[] = [
      {
        id: 'claude-code',
        name: 'Claude Code',
        detected: true,
        configPath: '/p1',
        registered: false,
      },
      { id: 'cursor', name: 'Cursor', detected: true, configPath: '/p2', registered: false },
      {
        id: 'claude-desktop',
        name: 'Claude Desktop',
        detected: false,
        configPath: '/p3',
        registered: false,
      },
    ];
    vi.mocked(mcp.mcpClientRegister).mockImplementation((id) => {
      return Promise.resolve(
        ok<McpClient>({
          id,
          name: 'Claude Code',
          detected: true,
          configPath: '/path',
          registered: true,
        }),
      );
    });
    vi.mocked(mcp.mcpClients).mockResolvedValue(ok(clients));

    render(<McpCard />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /configure all detected clients/i }),
      ).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /configure all detected clients/i }));

    await waitFor(() => {
      expect(mcp.mcpClientRegister).toHaveBeenCalledWith('claude-code');
      expect(mcp.mcpClientRegister).toHaveBeenCalledWith('cursor');
      expect(mcp.mcpClientRegister).not.toHaveBeenCalledWith('claude-desktop');
      expect(useMcpStore.getState().loading).toBe(false);
    });
  });

  it('opens the manual snippet', async () => {
    const snippet = '{"mcpServers":{"bitwright":{"url":"http://127.0.0.1:53124/mcp"}}}';
    vi.mocked(mcp.mcpManualConfig).mockResolvedValue(ok(snippet));

    render(<McpCard />);

    await waitFor(() => {
      expect(screen.getByText('Manual configuration')).toBeInTheDocument();
    });

    const details = screen
      .getByText('Manual configuration')
      .closest('details') as HTMLDetailsElement;
    Object.defineProperty(details, 'open', { value: true, configurable: true });
    details.dispatchEvent(new Event('toggle', { bubbles: true }));

    await waitFor(() => {
      expect(screen.getByText(snippet)).toBeInTheDocument();
    });
    expect(mcp.mcpManualConfig).toHaveBeenCalledTimes(1);
  });

  it('shows the unavailable line outside Tauri', () => {
    vi.mocked(tauri.inShell).mockReturnValue(false);

    render(<McpCard />);

    expect(screen.getByText(/desktop application/)).toBeInTheDocument();
  });

  it('shows sessions when connected', async () => {
    vi.mocked(mcp.mcpStatus).mockResolvedValue(
      ok({
        ...BASE_STATUS,
        running: true,
        transport: 'http',
        port: 53124,
        url: 'http://127.0.0.1:53124/mcp',
        sessions: [
          {
            id: 'session-abc12345',
            connectedAt: Date.now() - 120_000,
            lastToolAt: Date.now() - 5_000,
            lastTool: 'draw_runs',
          },
        ],
      }),
    );

    render(<McpCard />);

    await waitFor(() => {
      expect(screen.getByText('session-')).toBeInTheDocument();
      expect(screen.getByText(/2 min ago/)).toBeInTheDocument();
      expect(screen.getByText(/draw_runs/)).toBeInTheDocument();
    });
  });
});
