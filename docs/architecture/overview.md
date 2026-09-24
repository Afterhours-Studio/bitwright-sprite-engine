# Architecture overview

How the three parts of Bitwright fit together, what each one owns, and why the
boundary between them falls where it does.

Bitwright is a pixel art editor whose canvas an AI agent drives over the Model
Context Protocol. It is one application built from three parts in different
languages: Rust owns the window, the document and the MCP server; React renders
the interface; Python does the batch image mathematics that neither of the
other two should be doing.

The split is not a matter of taste. It follows from one observation, argued in
[decision 0013](decisions/0013-rust-mcp-server-in-the-tauri-process.md): an
agent's draw call is state mutation that has to reach the window immediately,
and conform is half a second of numpy that runs once per imported image. Those
two kinds of work want different homes.

## The flow

```
   MCP client (Claude Code, Claude Desktop, Cursor)
        |                                  |
        | stdio                            | streamable HTTP, 127.0.0.1
        | (--mcp-stdio)                    | + token
        v                                  v
+---------------------------------------------------------------------------+
|  Bitwright window                                                         |
|                                                                           |
|  +---------------------------------------------------------------------+  |
|  |  Rust  (Tauri 2)                                                    |  |
|  |                                                                     |  |
|  |   mcp/        rmcp server, both transports, session lifecycle,      |  |
|  |               tool implementations, client detection                |  |
|  |   store/      SQLite: project, style, asset, document, op log       |  |
|  |   raster/     indexed buffers, layers, composite, the op set,       |  |
|  |               gate computations                                     |  |
|  |   workflow/   step state machine, gate evaluation                   |  |
|  |   commands.rs window controls, platform, preferences, engine hop    |  |
|  |   sidecar.rs  spawn, handshake, watch, graceful stop                |  |
|  +---------------------------------------------------------------------+  |
|          |  invoke(...)              ^  document://changed                 |
|          v                           |  (also raised by an MCP call)       |
|  +---------------------------------------------------------------------+  |
|  |  React 18 + TypeScript  (webview)                                   |  |
|  |                                                                     |  |
|  |   Canvas, layers, palette editor, tool panel, project tree,         |  |
|  |   workflow rail, Settings. Zustand stores, tokens.css.              |  |
|  +---------------------------------------------------------------------+  |
|                                                                           |
+------------------------------------|--------------------------------------+
                                     | loopback HTTP + token
                                     v
              +--------------------------------------------+
              |  Python  (sidecar process)                 |
              |                                            |
              |   Origin present -> 403   no token -> 401  |
              |   watches --parent-pid                     |
              |                                            |
              |   FastAPI  /health  /v1/conform            |
              |            /v1/storage                     |
              |                                            |
              |   conform: grid detection (DFT),           |
              |   modal downsample, weighted k-means in    |
              |   Oklab, alpha hardening, dithering        |
              +--------------------------------------------+
```

The MCP server, the SQLite store, the raster core and the workflow gates are
scheduled work rather than shipped work; [the plan](../plan/PLAN.md) says which
phase each belongs to. The shell, the sidecar, the conform pipeline and the
design system exist today. This document describes the architecture as decided,
because that is what the parts being built now are being built against.

## The three parts

### Rust, the Tauri process

Owns everything that is interactive state, and that is a deliberately long
list: the window and its custom decorations, the platform background effect,
the lifetime of the sidecar, the SQLite database, the indexed pixel buffers,
the op log, the workflow step machine, and the MCP server.

It owns them together rather than separately because they are the same thing
seen from two directions. A tool call that paints a run of pixels and a user
dragging a brush both end in the same buffer, both append to the same op log,
and both reach the canvas as the same event. Undo does not care which of them
made the entry.

Its jobs:

- Create the window with system decorations off, apply Mica, macOS vibrancy, or
  nothing, and report which.
- Serve MCP on both transports, authenticate HTTP callers, and manage session
  lifetime. See
  [decision 0013](decisions/0013-rust-mcp-server-in-the-tauri-process.md).
- Hold the document: migrations, CRUD over project, style, asset and document,
  and the append-only op log that gives undo, redo, replay, and a record of
  which agent drew what.
- Apply the op set to indexed layer buffers, composite them, and compute the
  workflow gates from the pixels rather than from what the agent claimed.
- Emit a change event to the renderer on every mutation, whoever made it.
- Spawn the sidecar, read its handshake, watch it, and stop it cleanly. The
  handshake carries the port and the token; the token stays in Rust and is never
  logged.
- Pass its own process id to the sidecar, so a crash here does not leave an
  orphan behind.
- Make the sidecar's calls on the renderer's behalf, adding the token.
- Serve window controls, since the title bar is ours to draw.

### React, in the webview

Renders the interface and holds no logic of its own. Components are
presentational; state lives in Zustand stores and side effects in hooks, which
is what lets every screen be rendered in a test with an arbitrary store state.

It renders the document; it does not own it. That was already true of the old
interface, and the pivot makes it load-bearing: a change made by an agent
halfway through a sentence and a change made by the user's cursor arrive at the
canvas through the same event, so there is no path by which the two can
disagree.

Everything it does goes through the Rust process. It holds no engine URL and no
engine token, because the sidecar authenticates its callers and refuses any
request carrying an `Origin`, which a webview always sends. See
[decision 0008](decisions/0008-authenticate-the-sidecar.md).

Every user-visible string comes from i18next. Every colour comes from
`tokens.css`.

### Python, the sidecar

Owns batch image mathematics and nothing else: conform, palette extraction from
a reference image, and sheet export. It is called once per user action, never
per draw call, and it is never on the path between an agent and the canvas.

Conform is the importer for reference art. It takes a picture a person found or
drew, recovers the pixel grid with a discrete Fourier transform, votes one
colour per cell, builds a palette by weighted k-means in Oklab, hardens the
alpha edge and cleans up the result, and hands back an indexed image and the
palette it used. See [Reference import](../guides/post-processing.md) for what
each step does and [the pixel editing plan](pixel-editing-plan.md) for why each
is done the way it is.

It remains a separate process for the reasons in
[decision 0003](decisions/0003-python-sidecar-architecture.md), with the
amendment that record now carries: the original premise was PyTorch, and the
surviving one is that this is tested numpy work with no reason to be rewritten.

## How they connect

**Renderer to Rust**: Tauri IPC, through `invoke`. Every command returns a
result carrying a stable reason code rather than an English string, so the
renderer translates the message.

**Rust to renderer**: events. `document://changed` carries what changed, and it
is raised identically whether the mutation came from a tool call or from the
user, which is what keeps the canvas honest while an agent is drawing.

**MCP client to Rust**: streamable HTTP on a loopback port, with a token, or
stdio when the client spawns the process itself with `--mcp-stdio`. Both reach
the same tool implementations over the same store.

**Rust to sidecar**: the shell spawns the process, and the sidecar binds a free
loopback port and prints a handshake line naming it. The shell reads that rather
than guessing, which is what keeps two running copies of the application from
colliding. See [IPC protocol](ipc-protocol.md).

**Renderer to sidecar**: there is no such channel, and there never was. The
renderer calls a fixed set of shell commands, and Rust makes the HTTP call with
the token attached. Each command is a fixed method and path, so a compromised
page cannot aim a request at an endpoint that was never meant to be reachable.

## Design principles

**The pixels are indices, not colours.** A document's buffer holds palette
indices, one byte each. That is what makes readback cheap enough to hand a
model, recolouring free, and palette discipline something the engine enforces
rather than something the agent is asked to respect.

**Gates are computed, not asserted.** Whether a silhouette is one connected
region, or an outline strays outside it, is answered by reading the buffer. An
agent saying it finished a step is not evidence that it did.

**Errors are codes, not sentences.** Rust and Python return keys such as
`conform.grid_not_found`. The renderer looks them up in the `errors` namespace,
so the user reads a message in their own language.

**The shell never guesses about the platform.** Whether a background effect
applied, and whether the system draws the window buttons, are both answered by
Rust and read by the frontend. Guessing would put unreadable text over a
wallpaper on any machine where the effect silently failed.

**Colour is checked, not eyeballed.** The token system makes numeric promises
about lightness steps and contrast ratios, and `scripts/check-contrast.ts`
enforces them in CI.

## Further reading

- [The plan](../plan/PLAN.md) — what is built, what is scheduled, and in what order.
- [Document model](document-model.md) — the schema and the IPC contract.
- [MCP tools](mcp-tools.md) — every tool an agent can call.
- [IPC protocol](ipc-protocol.md) — how the parts find each other.
- [Pixel editing plan](pixel-editing-plan.md) — how reference art is imported.
- [Decision records](decisions/0001-record-architecture-decisions.md) — why the
  project is shaped as it is.
