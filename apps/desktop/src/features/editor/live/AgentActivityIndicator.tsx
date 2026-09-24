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
 * The chip that says an agent is attached to this window, and what it is doing.
 *
 * A CHIP THAT IS ABSENT WHEN THERE IS NOTHING TO SAY. The open document can be
 * written by a client over MCP, and no amount of looking at the pixels tells a
 * person whether the thing editing their sprite is still there. The chip
 * answers that at a glance, and it renders nothing at all while no session is
 * attached, so a window nobody else can draw in does not carry a permanent
 * badge. A chip that is always on screen is a chip nobody reads.
 *
 * ACTIVITY IS A TWO SECOND WINDOW. `agent://activity` is emitted as a tool call
 * starts, which while an agent works is several times a second. Keeping the
 * last tool name forever would leave the chip naming a call that finished
 * minutes ago, which reads as an agent still working when it has stopped, so
 * the name is dropped two seconds after the last call and the chip falls back
 * to saying the session is connected.
 *
 * SESSIONS ARE COUNTED BY ID. Two clients can be attached at once, and one of
 * them saying good bye must not take the chip away while the other is still
 * drawing. The ids are what `agent://session` carries, so the count is the set
 * of sessions that announced themselves and have not announced a disconnect.
 *
 * THE TOOL NAME IS NEVER TRANSLATED. It is the name the call answers to in the
 * MCP catalogue, the same string the settings card shows, and a translated one
 * could not be matched against a log or a client's own transcript.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import { onAgentActivity, onAgentSession } from '@/lib/mcp';

import type { UnlistenFn } from '@tauri-apps/api/event';

/**
 * How long a tool call keeps the chip saying the agent is drawing.
 *
 * Short enough that a call which has finished stops being announced, long
 * enough to cover the gap between two calls of one tool the agent is thinking
 * its way through.
 */
const ACTIVITY_WINDOW_MS = 2_000;

/** What the chip is showing. */
interface LiveState {
  /** The sessions attached right now, by the id they announced. */
  sessions: ReadonlySet<string>;
  /** The tool of the last call inside the window, or null when none was. */
  tool: string | null;
}

/** Nothing attached and nothing called. */
function empty(): LiveState {
  return { sessions: new Set<string>(), tool: null };
}

/**
 * The live agent indicator.
 *
 * The integration is what mounts it; nothing here reaches for the document
 * store or for any other part of the editor.
 *
 * @returns The chip while an agent is attached, or nothing at all when none is.
 */
export default function AgentActivityIndicator(): ReactElement | null {
  const { t } = useTranslation('editor');
  const [state, setState] = useState<LiveState>(empty);

  /**
   * The timer that ends the activity window.
   *
   * A ref rather than state: it is not something a render reads, and a render
   * caused by it would only be a render that shows the same thing again.
   */
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    /** Stops the activity window, if one is open. */
    const stopTimer = (): void => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };

    /**
     * Keeps a listener that arrived after the effect was torn down from
     * outliving the mount.
     *
     * @param unlisten - The shell's detach function.
     */
    const keep = (unlisten: UnlistenFn): void => {
      if (cancelled) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    };

    void onAgentSession((event) => {
      if (cancelled) {
        return;
      }
      setState((current) => {
        const sessions = new Set(current.sessions);
        if (event.state === 'connected') {
          sessions.add(event.sessionId);
        } else {
          sessions.delete(event.sessionId);
        }
        // The last session leaving ends the window too, so a client that
        // connects afterwards starts from "connected" rather than inheriting
        // the tool the previous one was calling.
        return { sessions, tool: sessions.size === 0 ? null : current.tool };
      });
    }).then(keep);

    void onAgentActivity((event) => {
      if (cancelled) {
        return;
      }
      stopTimer();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setState((current) => (current.tool === null ? current : { ...current, tool: null }));
      }, ACTIVITY_WINDOW_MS);
      setState((current) => ({ ...current, tool: event.tool }));
    }).then(keep);

    return () => {
      cancelled = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
      unlisteners.length = 0;
      stopTimer();
    };
  }, []);

  if (state.sessions.size === 0) {
    return null;
  }

  const drawing = state.tool !== null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'inline-flex items-center gap-2 rounded-md border border-line-subtle px-2 py-1 text-xs',
        drawing
          ? 'border-line-default bg-surface-content-alt text-fg-primary'
          : 'bg-surface-content text-fg-secondary',
      )}
    >
      {state.tool === null ? t('live.connected') : t('live.drawing', { tool: state.tool })}
    </div>
  );
}
