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
 * The MCP commands, and the events an agent's presence is announced on.
 *
 * One function per command in `commands/mcp.rs`, named after it, so that a
 * command can be found from either side by searching for the same word. Every
 * one returns a {@link ShellResult} rather than throwing, like the rest of the
 * bridge in `lib/tauri.ts`: outside a Tauri window they all report
 * `shell.unavailable`, which is what lets the settings screen render under
 * Vitest.
 *
 * The names in here are the whole contract, which is why they are written once
 * and nowhere else. A command name, an argument key, or an event channel that
 * does not match the Rust side is not a compile error on either side: it
 * arrives as `invalid args` at run time, or as a panel that silently shows no
 * sessions. Argument keys are camelCase for the same reason, because Tauri 2
 * renames them on the way to the webview.
 *
 * Nothing here holds a token between calls. `McpStatus.token` travels back to
 * the panel that shows it, so the user can paste it into their own client's
 * configuration, and the server that checks it stays on the Rust side.
 */

import { invoke, on } from '@/lib/tauri';
import type {
  AgentActivityEvent,
  AgentSessionEvent,
  DocumentChangedEvent,
  McpClient,
  McpClientId,
  McpStatus,
  McpTransport,
} from '@/types/mcp';

import type { ShellResult } from '@/lib/tauri';
import type { UnlistenFn } from '@tauri-apps/api/event';

/**
 * The channels the agent panels subscribe to.
 *
 * `lib/document.ts` names the same three for the document side. This is the
 * copy for the MCP panel, so that a settings screen does not have to import
 * the document bridge to find out where sessions are announced.
 */
export const MCP_EVENTS = {
  session: 'agent://session',
  activity: 'agent://activity',
  changed: 'document://changed',
} as const;

/**
 * Reports what the server is doing, and what a client needs to join it.
 *
 * The only way the panel can tell the difference between a server that is
 * configured and one that is actually listening is the `running` flag, which
 * the shell knows and the webview cannot guess.
 */
export function mcpStatus(): Promise<ShellResult<McpStatus>> {
  return invoke<McpStatus>('mcp_status');
}

/**
 * Starts the loopback HTTP server, or stops it.
 *
 * `off` is the only stop a user has: once the transport is off the server
 * answers no client on any port, whatever configuration was written for it.
 */
export function mcpSetTransport(transport: McpTransport): Promise<ShellResult<McpStatus>> {
  return invoke<McpStatus>('mcp_set_transport', { transport });
}

/**
 * Replaces the bearer token and returns the status that carries the new one.
 *
 * The old token stops working at once rather than at its next call, so every
 * client has to be reconfigured afterwards, which is why this is a deliberate
 * button and not something that happens on a timer.
 */
export function mcpRegenerateToken(): Promise<ShellResult<McpStatus>> {
  return invoke<McpStatus>('mcp_regenerate_token');
}

/** Lists the clients the shell can detect, and whether it already wrote to each. */
export function mcpClients(): Promise<ShellResult<McpClient[]>> {
  return invoke<McpClient[]>('mcp_clients');
}

/**
 * Adds Bitwright to one client's own configuration file.
 *
 * The command takes a client id rather than a path, so nothing the webview
 * sends can name a file for the shell to write into.
 */
export function mcpClientRegister(id: McpClientId): Promise<ShellResult<McpClient>> {
  return invoke<McpClient>('mcp_client_register', { id });
}

/** Takes Bitwright back out of one client's configuration, leaving the rest of it alone. */
export function mcpClientUnregister(id: McpClientId): Promise<ShellResult<McpClient>> {
  return invoke<McpClient>('mcp_client_unregister', { id });
}

/**
 * Returns the JSON a client needs, formatted for pasting.
 *
 * For a client whose configuration the shell cannot write. It is the same text
 * the automatic route writes, so the manual route cannot drift from it.
 */
export function mcpManualConfig(): Promise<ShellResult<string>> {
  return invoke<string>('mcp_manual_config');
}

/**
 * Subscribes to MCP clients connecting and disconnecting.
 *
 * The panel counts these rather than trusting the list in one status call, so
 * that a client which drops without a good bye cannot hold a session open
 * forever.
 */
export function onAgentSession(handler: (event: AgentSessionEvent) => void): Promise<UnlistenFn> {
  return on<AgentSessionEvent>(MCP_EVENTS.session, handler);
}

/** Subscribes to the start of each MCP tool call, which is how activity is dated. */
export function onAgentActivity(handler: (event: AgentActivityEvent) => void): Promise<UnlistenFn> {
  return on<AgentActivityEvent>(MCP_EVENTS.activity, handler);
}

/**
 * Subscribes to writes, from either actor.
 *
 * An agent's edit and the user's edit arrive on the same channel and are
 * indistinguishable on it, which is the point: the canvas refreshes because a
 * role changed, not because of who changed it.
 */
export function onDocumentChanged(
  handler: (event: DocumentChangedEvent) => void,
): Promise<UnlistenFn> {
  return on<DocumentChangedEvent>(MCP_EVENTS.changed, handler);
}
