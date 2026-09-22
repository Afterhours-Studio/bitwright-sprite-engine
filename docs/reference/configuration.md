# Configuration

Every setting the engine reads, its default, and how to override it.

Settings are read from the environment at startup, each prefixed `BITWRIGHT_`.
The Tauri shell sets the port, the host and the data root when it spawns the
sidecar; everything else has a default.

There is not much here, and that is the point. The application used to carry a
backend selector, remote endpoint credentials, a model cache and a download
switch, all of which existed to serve diffusion. See
[decision 0012](../architecture/decisions/0012-pivot-to-an-agent-driven-pixel-editor.md).

## Settings

### Server

| Setting     | Environment variable  | Default     | Meaning                                                    |
| ----------- | --------------------- | ----------- | ---------------------------------------------------------- |
| `host`      | `BITWRIGHT_HOST`      | `127.0.0.1` | Address to bind                                            |
| `port`      | `BITWRIGHT_PORT`      | `0`         | Port to bind. `0` asks the operating system for a free one |
| `log_level` | `BITWRIGHT_LOG_LEVEL` | `INFO`      | `DEBUG`, `INFO`, `WARNING`, `ERROR`, or `CRITICAL`         |

`host` must be a loopback address. The engine refuses to bind anything else, so
that it is never reachable from the network:

```python
if host not in {"127.0.0.1", "::1", "localhost"}:
    raise ValueError("the sidecar may only bind a loopback address")
```

`port` defaults to zero on purpose. A caller that picks a port has to check that
it is free and then hope it stays free; binding zero has no such window. The
chosen port is reported in the startup handshake. Pin it only for development,
when you want the interactive documentation at a known address.

### Storage

| Setting       | Environment variable    | Default             | Meaning                               |
| ------------- | ----------------------- | ------------------- | ------------------------------------- |
| `data_root`   | `BITWRIGHT_DATA_ROOT`   | Per platform, below | Where everything the application writes lives |
| `sprites_dir` | `BITWRIGHT_SPRITES_DIR` | `data_root/sprites` | Where exported sprites are written    |

Default data root:

| Platform | Path                                                                  |
| -------- | --------------------------------------------------------------------- |
| Windows  | `%LOCALAPPDATA%\studio.afterhours.bitwright`                          |
| macOS    | `~/Library/Application Support/studio.afterhours.bitwright`           |
| Linux    | `$XDG_DATA_HOME/studio.afterhours.bitwright`, or `~/.local/share/...` |

The database that holds every project, asset, document and op log entry lives
under that root, and so do exported sprites. `sprites_dir` follows `data_root`
unless it is set explicitly, in which case the explicit value wins.

Move the root from Settings, under Storage location, or by setting
`BITWRIGHT_DATA_ROOT`. Changing the location never moves what is already there:
those files stay where they are, and the Settings screen names them.

## Examples

Development, with a pinned port and verbose logs:

```bash
BITWRIGHT_PORT=8000 BITWRIGHT_LOG_LEVEL=DEBUG bitwright-engine
```

Keep the work on another drive:

```powershell
$env:BITWRIGHT_DATA_ROOT = "D:\bitwright"
bitwright-engine
```

## Application settings

Some settings are in the interface rather than the environment, and are stored
per user by the webview:

| Setting                  | Where                | Stored in                            |
| ------------------------ | -------------------- | ------------------------------------ |
| Theme                    | Settings, Appearance | `localStorage`, `bitwright.theme`    |
| Language                 | Settings, Appearance | `localStorage`, `bitwright.language` |
| Window size and position | Automatic            | The window state plugin              |
| Storage location         | Settings, Storage    | `preferences.json`, see below        |

The storage location cannot live in `localStorage`: the shell has to know it
before it spawns the engine, which happens before the webview has loaded, and
Rust cannot read the webview's storage. So the shell writes it to
`preferences.json` in the platform configuration directory and passes it back as
`BITWRIGHT_DATA_ROOT` on every launch. It is a shell preference, not engine
configuration.

The MCP transport, its port, and which clients are configured are shell
preferences for the same reason: the server has to be listening before anything
in the webview runs. They are set in Settings under MCP, and the transports are
described in
[decision 0013](../architecture/decisions/0013-rust-mcp-server-in-the-tauri-process.md).

## Environment variables outside the engine

| Variable             | Read by   | Meaning                                                                                         |
| -------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `BITWRIGHT_VIBRANCY` | The shell | Set to `acrylic` to opt in to acrylic on Windows 10, which stutters while the window is dragged |

## Command line

The engine takes one argument, which the shell always passes:

| Argument             | Meaning                                                                    |
| -------------------- | -------------------------------------------------------------------------- |
| `--parent-pid <pid>` | Exit when this process exits, so that a crash leaves no orphan behind      |

There is no way to set the authentication token. It is generated on each start
and printed in the handshake, so that it cannot be weakened by configuration.

The application binary takes one of its own, `--mcp-stdio`, which runs the MCP
server on standard input and output instead of opening a window. A client that
spawns Bitwright itself passes that.

## Precedence

1. An environment variable.
2. The default in `packages/engine/bitwright_engine/config/settings.py`.

There is no configuration file. The engine is spawned by the shell, which
controls its environment, and a file would be a third place for a setting to
hide.
