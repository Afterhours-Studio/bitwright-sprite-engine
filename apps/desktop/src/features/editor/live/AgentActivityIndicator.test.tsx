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
 * The live agent chip, against a mocked event bridge.
 *
 * `@/lib/mcp` is replaced whole: the tests capture the handlers the component
 * hands to the two subscriptions and call them directly, which is the only way
 * to exercise an unconnected event channel without a shell to emit on. What is
 * being pinned down is the reading of the events - who is attached, what tool
 * was called, and when the call stops being news - rather than the transport.
 */

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/mcp', () => ({
  onAgentSession: vi.fn(),
  onAgentActivity: vi.fn(),
}));

const mcp = await import('@/lib/mcp');
import AgentActivityIndicator from '@/features/editor/live/AgentActivityIndicator';
import type { AgentActivityEvent, AgentSessionEvent } from '@/types/mcp';

/** Handlers captured from the component's subscriptions. */
let sessionHandlers: ((event: AgentSessionEvent) => void)[] = [];
let activityHandlers: ((event: AgentActivityEvent) => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  sessionHandlers = [];
  activityHandlers = [];
  vi.mocked(mcp.onAgentSession).mockReset();
  vi.mocked(mcp.onAgentActivity).mockReset();
  vi.mocked(mcp.onAgentSession).mockImplementation((handler) => {
    sessionHandlers.push(handler);
    return Promise.resolve(vi.fn());
  });
  vi.mocked(mcp.onAgentActivity).mockImplementation((handler) => {
    activityHandlers.push(handler);
    return Promise.resolve(vi.fn());
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Runs something that changes the component's state, and lets the microtask
 * queue empty so a subscription that resolved during it is attached.
 *
 * @param change - The event to deliver, or the timers to advance.
 */
async function settle(change: () => void): Promise<void> {
  await act(async () => {
    change();
    await Promise.resolve();
  });
}

/**
 * Reports a session connecting or disconnecting.
 *
 * @param event - What the shell would have emitted.
 */
async function session(event: AgentSessionEvent): Promise<void> {
  await settle(() => {
    for (const handler of sessionHandlers) {
      handler(event);
    }
  });
}

/**
 * Reports a tool call starting.
 *
 * @param event - What the shell would have emitted.
 */
async function activity(event: AgentActivityEvent): Promise<void> {
  await settle(() => {
    for (const handler of activityHandlers) {
      handler(event);
    }
  });
}

/** The event a session announces itself with. */
function connected(sessionId: string): AgentSessionEvent {
  return { sessionId, state: 'connected' };
}

/** The event a session leaves with. */
function disconnected(sessionId: string): AgentSessionEvent {
  return { sessionId, state: 'disconnected' };
}

describe('AgentActivityIndicator', () => {
  it('renders nothing at all while no session is attached', async () => {
    render(<AgentActivityIndicator />);

    await settle(() => undefined);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says an agent is connected once one attaches', async () => {
    render(<AgentActivityIndicator />);

    await session(connected('s1'));

    const chip = screen.getByRole('status');
    expect(chip).toHaveTextContent('Agent connected');
    expect(chip).toHaveAttribute('aria-live', 'polite');
  });

  it('names the tool of a call in the last two seconds', async () => {
    render(<AgentActivityIndicator />);

    await session(connected('s1'));
    await activity({ sessionId: 's1', tool: 'draw_runs', assetId: 'asset-1' });

    expect(screen.getByRole('status')).toHaveTextContent('Agent drawing \u00b7 draw_runs');
  });

  it('drops the tool name two seconds after the last call', async () => {
    render(<AgentActivityIndicator />);

    await session(connected('s1'));
    await activity({ sessionId: 's1', tool: 'draw_runs', assetId: 'asset-1' });
    expect(screen.getByRole('status')).toHaveTextContent('draw_runs');

    await settle(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(screen.getByRole('status')).toHaveTextContent('Agent connected');
    expect(screen.getByRole('status')).not.toHaveTextContent('draw_runs');
  });

  it('keeps the tool name while calls keep arriving', async () => {
    render(<AgentActivityIndicator />);

    await session(connected('s1'));
    await activity({ sessionId: 's1', tool: 'draw_runs', assetId: 'asset-1' });

    await settle(() => {
      vi.advanceTimersByTime(1_500);
    });
    await activity({ sessionId: 's1', tool: 'shade_ramp', assetId: 'asset-1' });

    await settle(() => {
      vi.advanceTimersByTime(1_500);
    });

    // The second call restarted the window, so the first one's timer firing
    // would have been an agent reported idle a second after it moved.
    expect(screen.getByRole('status')).toHaveTextContent('shade_ramp');
  });

  it('stays connected when one of two sessions disconnects', async () => {
    render(<AgentActivityIndicator />);

    await session(connected('s1'));
    await session(connected('s2'));
    await session(disconnected('s1'));

    expect(screen.getByRole('status')).toHaveTextContent('Agent connected');
  });

  it('renders nothing once the last session disconnects', async () => {
    render(<AgentActivityIndicator />);

    await session(connected('s1'));
    await session(connected('s2'));
    await session(disconnected('s1'));
    await session(disconnected('s2'));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('detaches both listeners on unmount', async () => {
    const stopSession = vi.fn();
    const stopActivity = vi.fn();
    vi.mocked(mcp.onAgentSession).mockResolvedValue(stopSession);
    vi.mocked(mcp.onAgentActivity).mockResolvedValue(stopActivity);

    const { unmount } = render(<AgentActivityIndicator />);

    await settle(() => undefined);

    unmount();

    expect(stopSession).toHaveBeenCalledTimes(1);
    expect(stopActivity).toHaveBeenCalledTimes(1);
  });
});
