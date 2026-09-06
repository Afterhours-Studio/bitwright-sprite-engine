# 3. Run the engine as a Python sidecar process

Date: 2026-01-16

## Status

Accepted. Amended by
[0008](0008-authenticate-the-sidecar.md), which moved engine calls behind the
shell instead of letting the webview make them directly.

## Context

Generation needs PyTorch and diffusers. Both are Python, and the practical
alternatives to Python for diffusion inference are immature by comparison. So
the question is not whether to use Python, but where to put it.

**Embed a Python interpreter in the Rust process**, through PyO3. The two sides
share memory, so passing an image is a pointer rather than a copy, and there is
one process to manage. Against it: the build has to link a specific
interpreter, on three platforms; a segfault in a native extension takes the
whole application down with it; and the GIL sits inside the process that also
has to keep a window responsive.

**Rewrite inference in Rust**, with candle or ort. One binary, no interpreter,
no process management. It also means porting the pipeline, and then porting
every technique that arrives afterward. For a two person project that is the
whole project.

**Run Python as a child process** and talk to it over a local transport. The
build stays separable: PyInstaller freezes the engine, and Rust never links an
interpreter. A crash in a native extension kills one process, and the shell can
report it. The cost is a process to supervise, a transport, and serialisation
of the images.

The transport was a second question. Standard input and output with a custom
frame format is the lightest, and means writing a protocol, a parser, and a
correlation mechanism. HTTP on loopback costs a serialisation and a socket, and
brings request framing, correlation, status codes, streaming, and a testable
interface for free. On loopback the overhead is small next to a generation that
takes seconds.

## Decision

The engine runs as a separate Python process, and exposes a FastAPI application
over loopback HTTP.

- The Rust shell spawns it, reads a handshake from its standard output naming
  the port it bound, watches it, and stops it cleanly on exit.
- The sidecar binds `127.0.0.1` on a port the operating system chooses, and
  refuses to bind anything else.
- The webview calls the sidecar directly, after asking the shell for the base
  URL. Proxying image payloads through the IPC bridge would copy them twice.
  **Amended by 0008**: the engine now authenticates its callers and refuses any
  request carrying an `Origin`, so the webview goes through shell commands. The
  double copy is real and was accepted; a sprite is kilobytes.
- The sidecar is frozen with PyInstaller and bundled as a Tauri `externalBin`.

The protocol is in [IPC protocol](../ipc-protocol.md).

## Consequences

Positive:

- No interpreter linked into the Rust build. The two sides are built and
  tested independently.
- A crash in a native extension is one dead process, reported to the user as
  `The engine stopped unexpectedly` rather than a vanished window.
- The engine can be run and tested on its own: `bitwright-engine`, then curl.
  Contributors working on generation need no Rust at all.
- FastAPI generates an OpenAPI document, so the API is documented by
  construction.
- The GIL is in a process that does not own the window, so a long generation
  cannot make the interface stutter.
- The same engine could later serve a headless or remote deployment, unchanged.

Negative:

- Images cross a process boundary as base64 PNG. For a 64 pixel sprite that is
  a few kilobytes and irrelevant; for a large sheet it is real overhead.
- A frozen Python binary is about 25 MB, which is most of the download.
- Startup is slower: the interpreter has to start and import before the first
  request. The window opens immediately and shows progress, so this is visible
  rather than blocking.
- Two runtimes to install for development, and two dependency files.
- Process supervision is real work: startup timeout, crash detection, graceful
  shutdown, and orphan avoidance are all code that would not exist otherwise.

Neutral:

- The port is chosen by the sidecar rather than the shell, because a shell that
  picks a port has to check it is free and then hope it stays free. Binding
  port zero has no such window.
- Loopback binding is enforced in code, not only by configuration.
