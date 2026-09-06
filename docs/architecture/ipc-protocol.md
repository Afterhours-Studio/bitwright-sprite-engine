# IPC protocol

How the Tauri shell and the Python sidecar find each other, stay in touch, and
shut down cleanly.

Three channels connect the parts of the application: Tauri IPC between the
webview and Rust, a stdout handshake from the sidecar to Rust, and loopback
HTTP from Rust to the sidecar. The webview has no channel to the sidecar.

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
    |  invoke("engine_backends")               |
    |------------->|                           |
    |              |  GET /v1/backends         |
    |              |  X-Bitwright-Token: ...   |
    |              |-------------------------->|
    |              |  {"backends":[...]}       |
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
{"event": "ready", "port": 51234, "token": "3Qq7...", "version": "0.0.3"}
```

The token authenticates every later call. It is generated fresh on each start,
so a token captured from an earlier run is useless, and it is never written to a
log or returned to the webview.

Everything else the sidecar writes goes to standard error. That split is what
makes the handshake unambiguous: the shell parses each stdout line as JSON and
ignores anything that is not a `ready` object with a non-zero port, so a stray
print cannot be mistaken for a handshake.

The shell allows 30 seconds. Past that it reports `sidecar.startup_timeout`.

## Events

The shell emits these to the frontend:

| Event | Payload | When |
| --- | --- | --- |
| `sidecar://ready` | `SidecarStatus` | The handshake arrived |
| `sidecar://failed` | `SidecarStatus` | Spawn failed, startup timed out, or the process exited |
| `startup://gpu` | `GpuReport` | The GPU probe finished |

The frontend also polls `sidecar_status` when it mounts, because the sidecar can
become ready before the webview finishes loading, and in that case the event has
already fired.

## Commands

| Command | Returns | Purpose |
| --- | --- | --- |
| `sidecar_status` | `SidecarStatus` | Current status, for the initial poll |
| `engine_backends` | JSON | Every backend and its capabilities |
| `engine_select_backend` | JSON | Switch the active backend |
| `engine_generate` | JSON | Generate sprites |
| `engine_models` | JSON | Registered models and their licences |
| `vibrancy_state` | `VibrancyState` | Whether a background effect applied |
| `platform_info` | `PlatformInfo` | Operating system, and who draws the window buttons |
| `check_gpu` | `GpuReport` | Probe for a usable GPU driver |
| `window_minimize` | - | Minimize |
| `window_toggle_maximize` | `boolean` | Maximize or restore, returning the new state |
| `window_is_maximized` | `boolean` | Current maximized state |
| `window_close` | - | Close, which quits |

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

| Failure | Code | What the user sees |
| --- | --- | --- |
| Executable missing | `sidecar.spawn_failed` | The engine could not be started |
| Wrong or missing token | `auth.invalid_token` | An unexpected error occurred |
| Request carried an Origin | `auth.origin_not_allowed` | An unexpected error occurred |
| No handshake in 30s | `sidecar.startup_timeout` | The engine did not finish starting in time |
| Process exits while running | `sidecar.exited` | The engine stopped unexpectedly |
| Request before ready | `sidecar.not_ready` | The engine is still starting |

Startup failure is never fatal to the shell. The window opens, the frontend is
told, and the user sees a message rather than an application that silently does
nothing.

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
route sets a flag that uvicorn already checks. In-flight generation finishes
rather than being cut off midway through writing its result.

The kill is the backstop for a process that has stopped responding.

## When the shell dies without shutting down

A crash, a force kill, or a power cut leaves no chance to send `/shutdown`. An
orphaned sidecar keeps whatever GPU memory it had loaded, and the next launch
fails to allocate for a reason the user cannot see, because the orphan is
invisible to them.

The shell therefore passes its own process id when it spawns the engine:

```
bitwright-sidecar --parent-pid 12345
```

The engine polls that id every two seconds with `psutil.pid_exists`, and exits
once it is gone. Polling is the primary mechanism because it behaves the same
way on all three platforms. On Linux the engine additionally asks the kernel for
`PR_SET_PDEATHSIG`, which reacts immediately rather than within one interval;
that call is wrapped and its failure ignored, since it exists nowhere else.
