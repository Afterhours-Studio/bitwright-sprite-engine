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
 * What the MCP server is doing, and which clients are configured for it.
 *
 * WHY THE PANEL HAS A STORE AT ALL
 *
 * Three commands feed one screen, and two of them change because of something
 * the shell did rather than something the user asked: a client connects, a tool
 * call arrives. Read straight from the component they would be re-issued on
 * every render and on every language change. Held here, the card renders the
 * last known state immediately and the subscription has one owner that can
 * cancel it.
 *
 * WHY ACTIVITY IS MERGED RATHER THAN RE-READ
 *
 * A session's last tool changes on every tool call, which while an agent is
 * working is several times a second. Re-asking for the whole status to learn
 * one string would put a command on the wire per call, so the event updates the
 * row it belongs to and nothing else. Only the shell's own commands write
 * `lastToolAt`, which keeps every time on screen a time the shell measured; the
 * merged row names the tool and leaves the timestamp alone until the next read.
 *
 * WHY CONFIGURE ALL IS NOT A LOOP IN THE COMPONENT
 *
 * It is a sequence of independent writes to three different files. Held here, a
 * failure in the middle leaves the ones that succeeded applied - which is the
 * truth on disk - and the row that failed can say so. A component doing the
 * same work would re-render between each write and could not be tested without
 * mounting the panel.
 *
 * The bearer token is in `status`, so nothing here is ever persisted on this
 * side: see `lib/persist.ts` for what is stored, and this is not part of it.
 */

import { create } from 'zustand';
import type { UnlistenFn } from '@tauri-apps/api/event';

import {
  mcpClientRegister,
  mcpClientUnregister,
  mcpClients,
  mcpManualConfig,
  mcpRegenerateToken,
  mcpSetTransport,
  mcpStatus,
  onAgentActivity,
  onAgentSession,
} from '@/lib/mcp';
import type {
  AgentActivityEvent,
  McpClient,
  McpClientId,
  McpStatus,
  McpTransport,
} from '@/types/mcp';

/** The panel's state. */
interface McpState {
  /** What the server reported last, or null before the first answer. */
  status: McpStatus | null;
  /** Every client the shell can configure, in the shell's order. */
  clients: McpClient[];
  /** The manual snippet, or null until the disclosure has needed it. */
  manualConfig: string | null;
  /** True while a command is in flight. */
  loading: boolean;
  /** Stable reason code for the last failure, or null. */
  error: string | null;

  /** Re-reads the status and the client list together. */
  refresh: () => Promise<void>;
  /** Switches the transport, and shows what the shell actually did. */
  setTransport: (transport: McpTransport) => Promise<void>;
  /** Replaces the bearer token, and shows the new one. */
  regenerateToken: () => Promise<void>;
  /** Writes Bitwright into one client's configuration. */
  register: (id: McpClientId) => Promise<void>;
  /** Takes Bitwright out of one client's configuration. */
  unregister: (id: McpClientId) => Promise<void>;
  /** Registers every client that was found and is not yet configured. */
  configureAllDetected: () => Promise<void>;
  /** Reads the manual snippet, once; later calls do nothing. */
  loadManualConfig: () => Promise<void>;
  /** Attaches the agent event listeners. Safe to call more than once. */
  subscribe: () => Promise<void>;
  /** Detaches the listeners. */
  dispose: () => void;
  /** Clears the last error. */
  clearError: () => void;
}

/**
 * Swaps one client for the answer about it, in place.
 *
 * The order is the shell's, and the panel has no sorting of its own, so a row
 * must not move when the register button on it is pressed.
 *
 * @param clients - The list to change.
 * @param updated - The client as the shell now describes it.
 * @returns A new list with one row replaced.
 */
function replaceClient(clients: McpClient[], updated: McpClient): McpClient[] {
  return clients.map((client) => (client.id === updated.id ? updated : client));
}

/**
 * Names the clients that configuring all would write to.
 *
 * Exported because the card needs it to decide whether the button can do
 * anything, and because "found, and not yet configured" is the one rule in this
 * file worth pinning down on its own.
 *
 * @param clients - Every client the shell reported.
 * @returns The detected clients with no Bitwright entry yet.
 */
export function pendingClients(clients: McpClient[]): McpClient[] {
  return clients.filter((client) => client.detected && !client.registered);
}

/**
 * The live subscriptions.
 *
 * Module scope rather than store state, the same way `useDocumentStore` keeps
 * them: they are not something a component renders, and `dispose` has to be
 * able to cancel them without a render having observed them first.
 */
let listeners: UnlistenFn[] = [];

/** Whether subscription has been started, so a second call does not double up. */
let subscribing: Promise<void> | null = null;

export const useMcpStore = create<McpState>((set, get) => {
  /**
   * Records a failure under its reason code and stops the loading state.
   *
   * @param code - The stable reason code the command returned.
   */
  const fail = (code: string): void => {
    set({ error: code, loading: false });
  };

  /**
   * Merges one tool call into the session row it belongs to.
   *
   * An event for a session nothing has listed is dropped rather than invented:
   * a row with no connection time would claim a client is attached when the
   * shell has not said so.
   *
   * @param event - The activity the shell reported.
   */
  const applyActivity = (event: AgentActivityEvent): void => {
    const { status } = get();
    if (status === null || !status.sessions.some((session) => session.id === event.sessionId)) {
      return;
    }
    set({
      status: {
        ...status,
        sessions: status.sessions.map((session) =>
          session.id === event.sessionId ? { ...session, lastTool: event.tool } : session,
        ),
      },
    });
  };

  return {
    status: null,
    clients: [],
    manualConfig: null,
    loading: false,
    error: null,

    refresh: async () => {
      set({ loading: true, error: null });
      const [status, clients] = await Promise.all([mcpStatus(), mcpClients()]);
      if (!status.ok) {
        fail(status.error.code);
        return;
      }
      if (!clients.ok) {
        fail(clients.error.code);
        // The status alone is still worth showing: the transport, port and
        // token are all answerable, and a panel that hides them because the
        // client list failed is less useful than one that shows what it knows.
        set({ status: status.value, loading: false });
        return;
      }
      set({ status: status.value, clients: clients.value, loading: false });
    },

    setTransport: async (transport) => {
      set({ loading: true, error: null });
      const result = await mcpSetTransport(transport);
      if (!result.ok) {
        fail(result.error.code);
        return;
      }
      set({ status: result.value, loading: false });
    },

    regenerateToken: async () => {
      set({ loading: true, error: null });
      const result = await mcpRegenerateToken();
      if (!result.ok) {
        fail(result.error.code);
        return;
      }
      // The clients keep the old token, so the panel has to show them as they
      // are rather than as they were when this list was read.
      const clients = await mcpClients();
      set({
        status: result.value,
        clients: clients.ok ? clients.value : get().clients,
        loading: false,
      });
    },

    register: async (id) => {
      set({ loading: true, error: null });
      const result = await mcpClientRegister(id);
      if (!result.ok) {
        fail(result.error.code);
        return;
      }
      set({ clients: replaceClient(get().clients, result.value), loading: false });
    },

    unregister: async (id) => {
      set({ loading: true, error: null });
      const result = await mcpClientUnregister(id);
      if (!result.ok) {
        fail(result.error.code);
        return;
      }
      set({ clients: replaceClient(get().clients, result.value), loading: false });
    },

    configureAllDetected: async () => {
      const pending = pendingClients(get().clients);
      if (pending.length === 0) {
        return;
      }

      set({ loading: true, error: null });
      for (const client of pending) {
        const result = await mcpClientRegister(client.id);
        if (!result.ok) {
          // Everything already written stays shown as written. A client whose
          // file refused the entry is the only one that has to be retried, and
          // starting over would offer to re-add the ones now configured.
          fail(result.error.code);
          return;
        }
        set({ clients: replaceClient(get().clients, result.value) });
      }
      set({ loading: false });
    },

    loadManualConfig: async () => {
      if (get().manualConfig !== null) {
        return;
      }
      set({ loading: true, error: null });
      const result = await mcpManualConfig();
      if (!result.ok) {
        fail(result.error.code);
        return;
      }
      set({ manualConfig: result.value, loading: false });
    },

    subscribe: async () => {
      subscribing ??= (async () => {
        const session = await onAgentSession(() => {
          // A connect changes the session list and the running state, so this
          // is the one event the panel has to re-read for. A tool call does
          // not: it is merged below instead of costing a command.
          void get().refresh();
        });
        const activity = await onAgentActivity((event) => {
          applyActivity(event);
        });
        listeners = [session, activity];
      })();

      await subscribing;
    },

    dispose: () => {
      for (const unlisten of listeners) {
        unlisten();
      }
      listeners = [];
      subscribing = null;
    },

    clearError: () => {
      set({ error: null });
    },
  };
});
