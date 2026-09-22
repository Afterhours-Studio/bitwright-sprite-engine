# IPC protocol

How the Tauri process and the Python sidecar find each other, stay in touch,
and shut down cleanly.

Three channels connect the parts of the application: Tauri IPC between the
webview and Rust, a stdout handshake from the sidecar to Rust, and loopback
HTTP from Rust to the sidecar. The webview has no channel to the sidecar.

A fourth channel arrives from outside the application: an MCP client connects
to Rust over streamable HTTP or stdio. It is a different protocol with a
different lifetime and is described in [MCP tools](mcp-tools.md) and
[decision 0013](decisions/0013-rust-mcp-server-in-the-tauri-process.md) rather
than here. Nothing on that channel reaches the sidecar.

## Startup

```
Rust shell                               Python sidecar
    |                                          |
    |  spawn, --parent-pid 12345               |
    |  BITWRIGHT_PORT=0                        |
    |----------------------------------------->|
    |                                          |  bind 127.0.0.1:0
    |                                          |  os picks 51234
    |                                          |  generate a token
    |                                          |
    |  {"event":"ready","port":51234,          |
    |   "token":"3Qq7...","version":"0.0.3"}   |
    |<-----------------------------------------|  stdout, one line
    |                                          |
    |  keep the port and the token             |  serve
    |  emit sidecar://ready (no token)         |
    |                                          |
Frontend                                       |
    |  invoke("engine_conform", ...)           |
    |------------->|                           |
    |              |  POST /v1/conform         |
    |              |  X-Bitwright-Token: ...   |
    |              |-------------------------->|
    |              |  {"image":..., ...}       |
    |              |<--------------------------|
    |  <-----------|                           |
```

## Why the sidecar picks the port

The obvious design has Rust find a free port and pass it in. It has a race:
between the check and the bind, another process can take the port. Two copies
of Bitwright started at once would sometimes collide.

Letting the sidecar bind port zero removes the race. The operating system hands
out a port that is free at the moment of binding, and the process reports which
one it got. There is no window in which the answer can go stale.

The consequence is that the port has to travel back, which is what the
handshake is for.

## The handshake

One JSON object, one line, on standard output, written before the server starts
accepting:

```json
{ "event": "ready", "port": 51234, "token": "3Qq7...", "version": "0.0.3" }
```

The token authenticates every later call. It is generated fresh on each start,
so a token captured from an earlier run is useless, and it is never written to a
log or returned to the webview.

Everything else the sidecar writes goes to standard error. That split is what
makes the handshake unambiguous: the shell parses each stdout line as JSON and
ignores anything that is not a `ready` object with a non-zero port, so a stray
print cannot be mistaken for a handshake.

The same discipline is what the stdio MCP transport demands of Rust, for the
same reason and in the opposite direction: anything written to standard output
that is not protocol corrupts the stream.

The shell allows 30 seconds. Past that it reports `sidecar.startup_timeout`.

## Events

The shell emits these to the frontend:

| Event                | Payload         | When                                                   |
| -------------------- | --------------- | ------------------------------------------------------ |
| `sidecar://ready`    | `SidecarStatus` | The handshake arrived                                  |
| `sidecar://failed`   | `SidecarStatus` | Spawn failed, startup timed out, or the process exited |
| `document://changed` | `DocumentPatch` | A layer, palette or step state changed                 |

The frontend also polls `sidecar_status` when it mounts, because the sidecar can
become ready before the webview finishes loading, and in that case the event has
already fired.

`document://changed` is raised identically whether the mutation came from a
user's cursor or from an agent's tool call. The renderer cannot tell, and does
not need to: the canvas it draws is the buffer Rust holds either way. The shape
of the payload is in [the document model](document-model.md).

The GPU probe and its `startup://gpu` event are gone. Nothing in the application
needs a graphics driver any more; see
[decision 0012](decisions/0012-pivot-to-an-agent-driven-pixel-editor.md).

## Commands

The frontend calls these through `invoke`. The set is deliberately small: a
command is a fixed method and a fixed path, so a compromised page cannot aim a
request at an endpoint that was never meant to be reachable.

| Command                  | Returns         | Purpose                                            |
| ------------------------ | --------------- | -------------------------------------------------- |
| `sidecar_status`         | `SidecarStatus` | Current status, for the initial poll               |
| `engine_conform`         | JSON            | Import a reference image through the conform pipeline |
| `engine_sprites`         | JSON            | List sprites written under the data root           |
| `engine_remove_sprite`   | JSON            | Delete one                                         |
| `engine_save_sprite_edit`| JSON            | Write an edited sprite back                        |
| `storage_info`           | JSON            | Where the data root is, and how much space it has  |
| `storage_validate`       | JSON            | Check a candidate root before committing to it     |
| `storage_set_root`       | JSON            | Move the data root                                 |
| `storage_reset_root`     | JSON            | Return to the platform default                     |
| `storage_pick_directory` | JSON            | Open the system folder picker                      |
| `vibrancy_state`         | `VibrancyState` | Whether a background effect applied                |
| `platform_info`          | `PlatformInfo`  | Operating system, and who draws the window buttons |
| `app_version`            | `string`        | Version, for the about panel                       |
| `window_minimize`        | -               | Minimize                                           |
| `window_toggle_maximize` | `boolean`       | Maximize or restore, returning the new state       |
| `window_is_maximized`    | `boolean`       | Current maximized state                            |
| `window_close`           | -               | Close, which quits                                 |
| `open_directory`         | -               | Reveal a folder in the system file manager         |
| `open_external`          | -               | Open a URL in the system browser                   |

The document commands that Phase 1 adds — create, open, mutate and read back a
document and its layers — are specified in
[the document model](document-model.md) rather than listed here, because their
shape is the contract the Rust and TypeScript sides are written against at the
same time.

Every fallible command returns `Result<T, CommandError>`, where `CommandError`
is `{ code, detail }`. The code is stable and translated by the frontend; the
detail is English, for logs.

## HTTP API

The webview does not call the sidecar. It calls the shell, and the shell makes
the request with the token attached. A token the webview holds is a token any
script in the webview holds, and the engine refuses requests carrying an
`Origin` in any case.

The sidecar binds loopback only, and refuses to bind anything else:

```python
if host not in {"127.0.0.1", "::1", "localhost"}:
    raise ValueError("the sidecar may only bind a loopback address")
```

There is no CORS middleware. A request that arrives with an `Origin` header is
refused with 403 and the code `auth.origin_not_allowed`, whatever that origin
is, because the only legitimate caller is not a browser. That is what closes off
DNS rebinding, where a page on an attacker's domain resolves to 127.0.0.1 and
calls the API from inside the user's machine.

Every route except `/health` requires the token in `X-Bitwright-Token`, compared
with `secrets.compare_digest`. Health is open so that the shell can probe for
readiness before it has parsed the handshake, and it reveals only liveness.

Endpoints are documented in [the API reference](../reference/api.md).

## Failure

| Failure                     | Code                      | What the user sees                         |
| --------------------------- | ------------------------- | ------------------------------------------ |
| Executable missing          | `sidecar.spawn_failed`    | The engine could not be started            |
| Wrong or missing token      | `auth.invalid_token`      | An unexpected error occurred               |
| Request carried an Origin   | `auth.origin_not_allowed` | An unexpected error occurred               |
| No handshake in 30s         | `sidecar.startup_timeout` | The engine did not finish starting in time |
| Process exits while running | `sidecar.exited`          | The engine stopped unexpectedly            |
| Request before ready        | `sidecar.not_ready`       | The engine is still starting               |

Startup failure is never fatal to the shell, and it matters more now than it
did. Nothing in the editor needs the sidecar: a document opens, an agent draws
in it, and the canvas renders, all with the Python process dead. Only reference
import and export ask for it, so a failed sidecar disables two actions rather
than the application.

## Shutdown

```
Rust shell                          Python sidecar
    |                                     |
    |  POST /shutdown                     |
    |------------------------------------>|
    |  202 Accepted                       |  server.should_exit = True
    |<------------------------------------|
    |                                     |  finish in-flight requests
    |  wait up to 5 seconds               |  exit
    |                                     |
    |  kill, if still alive               |
    |------------------------------------>|
```

The flag on the server object is what makes this portable. Signalling a process
group would be the Unix answer, and Windows has no equivalent, so the shutdown
route sets a flag that uvicorn already checks. An in-flight conform finishes
rather than being cut off midway through writing its result.

The kill is the backstop for a process that has stopped responding.

## When the shell dies without shutting down

A crash, a force kill, or a power cut leaves no chance to send `/shutdown`. An
orphaned sidecar is a process the user cannot see, holding a port and a data
root that the next launch expects to have to itself.

The shell therefore passes its own process id when it spawns the engine:

```
bitwright-sidecar --parent-pid 12345
```

The engine polls that id every two seconds with `psutil.pid_exists`, and exits
once it is gone. Polling is the primary mechanism because it behaves the same
way on all three platforms. On Linux the engine additionally asks the kernel for
`PR_SET_PDEATHSIG`, which reacts immediately rather than within one interval;
that call is wrapped and its failure ignored, since it exists nowhere else.
