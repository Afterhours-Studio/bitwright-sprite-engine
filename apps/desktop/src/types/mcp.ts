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
 * The MCP server, as it crosses the IPC boundary.
 *
 * These mirror the command and event contract in
 * `docs/plan/PHASE-2.md`, which is the same contract the Rust side of
 * `mcp/server.rs`, `mcp/config.rs` and `mcp/clients.rs` is written against.
 * Field names are camelCase because Tauri 2 renames struct fields for the
 * webview; getting one wrong is not a compile error on either side, which is
 * why they are written down once, here.
 *
 * A token is a bearer credential: whoever holds it can draw in the open
 * document while the server is on. It is shown here because the user has to be
 * able to paste it into their own client's configuration, and nowhere else -
 * no other part of the interface reads it, and nothing writes it to disk on the
 * TypeScript side.
 *
 * `AgentSessionEvent`, `AgentActivityEvent` and `DocumentChangedEvent` are the
 * payloads `commands/document.rs` emits. `types/document.ts` names the same
 * events for the document side; the copies here are the narrow ones, because
 * the agent panels are the only consumers that care which state a session
 * changed to.
 */

import type { LayerRole } from '@/types/document';

/**
 * How the server is reachable.
 *
 * `http` is the loopback streamable-HTTP server with a bearer token. `off`
 * stops it, which is the only way a user has of being sure nothing is drawing
 * in their document. Stdio is not a transport the panel chooses: it is the same
 * binary started with `--mcp-stdio`, whose trust boundary is the process that
 * spawned it, so there is no port and no token to show.
 */
export type McpTransport = 'http' | 'off';

/** Every transport, in the order the panel offers them. */
export const MCP_TRANSPORTS: readonly McpTransport[] = ['http', 'off'];

/**
 * A client the shell knows how to configure.
 *
 * A closed union, so a typo here is a compile error rather than a command that
 * answers `client.unknown`. Names are the wire values Rust matches on.
 */
export type McpClientId = 'claude-code' | 'claude-desktop' | 'cursor';

/** One MCP session currently attached to the server. */
export interface McpSession {
  /** The session id, which is also the actor recorded in the op log. */
  id: string;
  /** When the client connected, in epoch milliseconds. */
  connectedAt: number;
  /** When the last tool call arrived, or null before there was one. */
  lastToolAt: number | null;
  /** The last tool called, by its catalogue name. Never translated. */
  lastTool: string | null;
}

/** What the server is doing right now, and what a client needs to join it. */
export interface McpStatus {
  /** Whether the server is reachable over loopback HTTP, or stopped. */
  transport: McpTransport;
  /** Whether a socket is actually listening. False while transport is `off`. */
  running: boolean;
  /** The port it bound, or null when nothing is listening. */
  port: number | null;
  /** The full endpoint, such as `http://127.0.0.1:53124/mcp`, or null. */
  url: string | null;
  /** The bearer token every client has to send. */
  token: string;
  /** The sessions attached right now, oldest first. */
  sessions: McpSession[];
}

/** One client the shell can detect and write a configuration for. */
export interface McpClient {
  /** Which client this is, on the wire. */
  id: McpClientId;
  /** Its product name, such as `Claude Code`. Never translated. */
  name: string;
  /** Whether its configuration file was found on this machine. */
  detected: boolean;
  /** Where its configuration lives, whether or not it exists yet. */
  configPath: string;
  /** Whether Bitwright has already been written into it. */
  registered: boolean;
}

/** Emitted when an MCP client connects or disconnects. */
export interface AgentSessionEvent {
  sessionId: string;
  state: 'connected' | 'disconnected';
}

/** Emitted when an MCP tool call starts. */
export interface AgentActivityEvent {
  sessionId: string;
  /** The tool's catalogue name, such as `draw_runs`. */
  tool: string;
  assetId: string;
}

/**
 * Emitted after any write, from either actor.
 *
 * Names the roles that moved and carries no pixels, which is what lets a burst
 * of agent edits cost one re-read per role per frame instead of one per op.
 */
export interface DocumentChangedEvent {
  assetId: string;
  roles: LayerRole[];
  seq: number;
}
