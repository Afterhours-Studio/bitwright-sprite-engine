# Architecture overview

How the three processes that make up Bitwright fit together, and what each one
is responsible for.

Bitwright is one application built from three parts in different languages,
each doing the thing its language is good at: React for the interface, Rust for
the window and the process lifetime, Python for the machine learning.

## The flow

```
+---------------------------------------------------------------------------+
|  Bitwright window                                                         |
|                                                                           |
|  +---------------------------------------------------------------------+  |
|  |  React 18 + TypeScript  (webview)                                   |  |
|  |                                                                     |  |
|  |   Screens          Stores (Zustand)        Design tokens            |  |
|  |   Generate         useShellStore           tokens.css               |  |
|  |   Gallery          useEngineStore          light and dark           |  |
|  |   Settings         useGenerationStore      opaque and translucent   |  |
|  |                    useGalleryStore                                  |  |
|  +---------------------------------------------------------------------+  |
|                         |                                                 |
|                         | invoke("engine_generate", ...)                   |
|                         | Tauri IPC. No engine URL, no token, no fetch.    |
|                         v                                                 |
|  +---------------------------------------------------------------------+  |
|  |  Rust  (Tauri 2 shell)                                              |  |
|  |                                                                     |  |
|  |   commands.rs   window controls, platform, GPU probe,               |  |
|  |                 the four engine_* proxy commands                    |  |
|  |   engine.rs     HTTP client. Adds X-Bitwright-Token                 |  |
|  |   sidecar.rs    spawn, handshake, watch, graceful stop              |  |
|  |   main.rs       window, vibrancy                                    |  |
|  +---------------------------------------------------------------------+  |
|            |                   ^                        |                  |
+------------|-------------------|------------------------|------------------+
             | spawn             | stdout handshake       | loopback HTTP
             | --parent-pid PID  | {"event":"ready",      | + token header
             v                   |  "port":51234,         v
             |                   |  "token":"3Qq7..."}
   +--------------------------------------------------------------+
   |  Python 3.11  (sidecar process)                              |
   |                                                              |
   |   Origin present -> 403        no token -> 401               |
   |   watches --parent-pid, exits when the shell is gone         |
   |      |                                                       |
   |      v                                                       |
   |   FastAPI  /health  /v1/backends  /v1/generate  /v1/models   |
   |      |                                                       |
   |      v                                                       |
   |   SpriteGenerator                                            |
   |      |                                                       |
   |      +--> Backend (Protocol)                                 |
   |      |      available()  capabilities()  generate()          |
   |      |         |               |               |             |
   |      |    CudaBackend     MpsBackend     RemoteBackend       |
   |      |         |               |               |             |
   |      |         v               v               v             |
   |      |    NVIDIA GPU     Apple GPU      HTTPS endpoint       |
   |      |     (CUDA)         (Metal)       (user configured)    |
   |      |                                                       |
   |      +--> post-processing                                    |
   |             snap to grid -> quantize -> remove background    |
   +--------------------------------------------------------------+
```

## The three processes

### React, in the webview

Renders the interface and holds no logic of its own. Components are
presentational; state lives in Zustand stores and side effects in hooks, which
is what lets every screen be rendered in a test with an arbitrary store state.

Everything it does goes through the Rust shell, including generation. It holds
no engine URL and no engine token, because the engine authenticates its callers
and refuses any request that carries an `Origin`, which a webview always sends.
See [decision 0008](decisions/0008-authenticate-the-sidecar.md).

Every user-visible string comes from i18next. Every colour comes from
`tokens.css`.

### Rust, the Tauri shell

Owns the window, the custom decorations, the platform background effect, and
the lifetime of the sidecar. It contains no generation logic, and it is not a
proxy for the engine API.

Its jobs:

- Create the window with system decorations off, and apply Mica, macOS
  vibrancy, or nothing, then report which.
- Spawn the sidecar, read its handshake, and watch it. The handshake carries
  the port and the token; the token stays in Rust and is never logged.
- Pass its own process id to the sidecar, so that a crash here does not leave
  Python holding the GPU.
- Make every engine call on the frontend's behalf, adding the token.
- Tell the frontend, through an event, when the sidecar becomes ready or dies.
- Probe for a GPU driver at startup, so a missing one is a specific message.
- Serve window controls, since the title bar is ours to draw.
- Stop the sidecar cleanly when the application exits.

### Python, the sidecar

Owns model loading, generation, and post-processing, and exposes them over a
loopback HTTP API. It is a separate process because the machine learning
ecosystem is Python and embedding an interpreter in the shell would make the
build far harder for no gain. See
[decision 0003](decisions/0003-python-sidecar-architecture.md).

## How they connect

**Frontend to shell**: Tauri IPC, through `invoke`. Every command returns a
result carrying a stable reason code rather than an English string, so the
frontend translates the message.

**Shell to sidecar**: the shell spawns the process, and the sidecar binds a
free loopback port and prints a handshake line naming it. The shell reads that
rather than guessing, which is what keeps two running copies of the application
from colliding. See [IPC protocol](ipc-protocol.md).

**Frontend to sidecar**: there is no such channel. The frontend calls
`engine_backends`, `engine_select_backend`, `engine_generate`, and
`engine_models` on the shell, and Rust makes the HTTP call with the token
attached. Each command is a fixed method and path, so a compromised page cannot
aim a request at an endpoint that was never meant to be reachable.

## Design principles

**Capabilities are declared, not discovered by failing.** Every backend states
what it supports, and the interface disables what is unsupported. Being told
after a two minute wait that an option was never available is worse than not
being offered it.

**Errors are codes, not sentences.** Rust and Python return keys such as
`backend.cuda.driver_missing`. The frontend looks them up in the `errors`
namespace, so the user reads a message in their own language.

**The shell never guesses about the platform.** Whether a background effect
applied, and whether the system draws the window buttons, are both answered by
Rust and read by the frontend. Guessing would put unreadable text over a
wallpaper on any machine where the effect silently failed.

**Colour is checked, not eyeballed.** The token system makes numeric promises
about lightness steps and contrast ratios, and `scripts/check-contrast.ts`
enforces them in CI.

## Further reading

- [Backend abstraction](backend-abstraction.md)
- [IPC protocol](ipc-protocol.md)
- [Decision records](decisions/0001-record-architecture-decisions.md)
