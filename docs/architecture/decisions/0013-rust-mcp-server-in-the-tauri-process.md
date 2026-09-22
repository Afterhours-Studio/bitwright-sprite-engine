# 13. Serve MCP from Rust, inside the Tauri process

Date: 2026-09-23

## Status

Accepted. Follows from [0012](0012-pivot-to-an-agent-driven-pixel-editor.md),
which put an agent in the drawing seat and therefore created the question of
where the agent connects.

## Context

[0012](0012-pivot-to-an-agent-driven-pixel-editor.md) decided that an MCP
client drives the canvas. That leaves an implementation question with a real
answer either way: the application already contains a Python process that
speaks HTTP and is supervised, authenticated and packaged, and Python has the
better known MCP tooling. Putting the server there would be the path of least
new machinery.

The reason not to is what an MCP call actually is in this application.

**The draw loop is state mutation, not computation.** `draw_pixels`,
`draw_run`, `paste_grid`, `fill`, `set_layer` — each of these takes a few
hundred bytes of argument, changes some palette indices in a buffer, appends an
entry to the op log, and has to show up in the window. There is nothing to
compute. The entire cost of the operation is getting it to the place where the
document lives and then getting the change to the renderer.

The document lives in Rust, because the window does. If the MCP server were in
the sidecar, every one of those calls would travel from the client to Python,
and then from Python back across loopback HTTP into Rust, which would apply it
to the real buffer and emit the change to the webview. The sidecar would be a
relay that owns none of the state it is being asked to mutate, and every draw
call would pay two process boundaries and a serialisation of arguments that
were never large enough to justify one. An agent correcting a silhouette sends
dozens of these in a row.

The alternative shape — move the document into Python and let Rust render what
Python owns — is worse. It puts the authoritative state of an interactive
window in another process, so undo, redo, the op log, the gate computations and
the canvas would all be asking across a socket for something the user is
dragging a cursor over.

**Conform is the opposite kind of work, and it is already written.** Grid
detection is a discrete Fourier transform over every pixel of a 512 by 512
source; the palette is a weighted k-means in Oklab. It is numpy, it is tested,
and it is correct. It runs once per imported reference image, on a user action,
never inside a draw loop, so the process boundary it pays for is irrelevant
against the work it does. Porting it to Rust would buy nothing measurable and
would risk the one part of the old pipeline that was always worth keeping.

So the two kinds of work want different homes, and the split falls out: the
thing that is called sixty times in a row and must reach the window immediately
goes where the window is, and the thing that is called once and takes half a
second stays where it is already correct.

The remaining question was the Rust SDK. `rmcp` is the official Rust
implementation of the protocol, it is maintained alongside the specification
rather than tracking it, and it carries both of the transports this
application needs. Writing the protocol by hand against the specification was
considered only long enough to reject: MCP's session lifecycle, capability
negotiation and error taxonomy are exactly the sort of thing that is cheap to
half-implement and expensive to have half-implemented.

## Decision

**The MCP server is written in Rust, in the Tauri process, on the `rmcp`
crate.**

A tool call arrives at the server, mutates the document in the same process
that owns the window, appends to the op log, and reaches the renderer as a
Tauri event emit. There is no network hop in the hot path, and there is no
second copy of the document to keep in step.

**Both transports are served, and they are the same server.**

- **Streamable HTTP** is the primary transport, bound to loopback on a port the
  operating system chooses, authenticated by a token, with a session lifecycle.
  It is the one the pivot is for: the application is open, the agent connects
  to the running window, and the user watches the sprite appear as it is drawn.
- **Stdio** runs the same binary with `--mcp-stdio`, for headless and
  continuous integration use, where there is no window to watch and a client
  wants to spawn the process itself.

Neither transport is a reduced version of the other. The tool implementations
sit behind both, over the same store and the same raster core.

**The sidecar keeps conform, palette extraction from a reference image, and
sheet export**, and keeps the handshake, loopback binding, token authentication
and packaging that ADRs 0003, 0007 and 0008 gave it. It is never on the path of
a draw call.

## Consequences

Positive:

- A draw call costs a function call and an event emit. The agent's feedback loop
  — draw, read back, correct — runs at the speed of the process, which is what
  makes correction practical rather than theoretical.
- There is one authoritative document, in the process that owns the window.
  Undo, redo, the op log and the gate computations all read the same buffer the
  canvas renders.
- The stdio transport makes the application testable without a user. A
  continuous integration job can drive a whole asset through its workflow steps
  and assert on the pixels.
- The sidecar's job becomes small enough to state in a sentence, which makes it
  obvious when something is being put in the wrong process.
- `rmcp` tracks the specification, so protocol changes arrive as a dependency
  bump rather than as a reading exercise.

Negative:

- MCP is now implemented in the language with the smaller ecosystem for it. Most
  published examples, and most of the community's accumulated advice, are for
  the Python and TypeScript SDKs, and translating them is work.
- The Tauri process gains a network listener, a session lifecycle and an
  authentication surface it did not have. A bug there is a bug in the process
  that owns the window.
- Two transports is two lifecycles to get right, and stdio in particular shares
  standard output with everything else the process might print. Anything that
  writes to stdout outside the protocol corrupts the stream, which is the same
  discipline the sidecar handshake already demands and now has to be kept in
  Rust as well.
- The split is a rule someone has to keep. The temptation to put "just this one
  image operation" in the sidecar because it is easier to write there, or "just
  this one pixel loop" in Rust because it is already open, will recur.

Neutral:

- The webview remains a renderer of state it does not own, which is what it
  already was. A change made by an agent and a change made by a user's cursor
  arrive at the canvas through the same event.
- Nothing about this decision requires the sidecar to exist. If conform were
  ever ported, the Python process could be removed without touching the MCP
  server, which is a reasonable position for a dependency to be in.
