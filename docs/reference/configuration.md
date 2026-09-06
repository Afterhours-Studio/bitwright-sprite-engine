# Configuration

Every setting the engine reads, its default, and how to override it.

Settings are read from the environment at startup, each prefixed `BITWRIGHT_`.
The Tauri shell sets the port and the host when it spawns the sidecar;
everything else has a default.

## Settings

### Server

| Setting | Environment variable | Default | Meaning |
| --- | --- | --- | --- |
| `host` | `BITWRIGHT_HOST` | `127.0.0.1` | Address to bind |
| `port` | `BITWRIGHT_PORT` | `0` | Port to bind. `0` asks the operating system for a free one |
| `log_level` | `BITWRIGHT_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR`, or `CRITICAL` |

`host` must be a loopback address. The engine refuses to bind anything else, so
that generation is never exposed to the network:

```python
if host not in {"127.0.0.1", "::1", "localhost"}:
    raise ValueError("the sidecar may only bind a loopback address")
```

`port` defaults to zero on purpose. A caller that picks a port has to check that
it is free and then hope it stays free; binding zero has no such window. The
chosen port is reported in the startup handshake. Pin it only for development,
when you want the interactive documentation at a known address.

### Backend

| Setting | Environment variable | Default | Meaning |
| --- | --- | --- | --- |
| `backend` | `BITWRIGHT_BACKEND` | `auto` | `auto`, `cuda`, `mps`, or `remote` |

`auto` takes the first available backend in preference order: CUDA, then MPS,
then remote. Local GPUs come first because they cost nothing per image and keep
prompts on the machine.

A named backend is selected whether or not it is available, so that the Settings
screen can show it with its reason rather than hiding it.

### Remote API

| Setting | Environment variable | Default | Meaning |
| --- | --- | --- | --- |
| `remote_endpoint` | `BITWRIGHT_REMOTE_ENDPOINT` | `""` | Base URL of the service |
| `remote_api_key` | `BITWRIGHT_REMOTE_API_KEY` | `""` | Bearer token |
| `remote_timeout_s` | `BITWRIGHT_REMOTE_TIMEOUT_S` | `120.0` | Request timeout in seconds |

The remote backend is unavailable while either the endpoint or the key is empty.
Requests go directly from the machine to that endpoint, and are not proxied
through Afterhours Studio. See
[Using a remote API](../guides/using-remote-api.md).

### Models

| Setting | Environment variable | Default | Meaning |
| --- | --- | --- | --- |
| `cache_dir` | `BITWRIGHT_CACHE_DIR` | Per platform, below | Where weights are stored |
| `allow_downloads` | `BITWRIGHT_ALLOW_DOWNLOADS` | `true` | When false, a missing model is an error |

Default cache directory:

| Platform | Path |
| --- | --- |
| Windows | `%LOCALAPPDATA%\studio.afterhours.bitwright\models` |
| macOS | `~/Library/Application Support/studio.afterhours.bitwright/models` |
| Linux | `$XDG_DATA_HOME/studio.afterhours.bitwright/models`, or `~/.local/share/...` |

Move the cache to another drive by setting `BITWRIGHT_CACHE_DIR`. Models are
several gigabytes each.

Set `allow_downloads` to false on a machine that must not fetch weights. A model
that is not already cached then fails with `models.downloads_disabled` instead
of starting a download.

## Examples

Development, with a pinned port and verbose logs:

```bash
BITWRIGHT_PORT=8000 BITWRIGHT_LOG_LEVEL=DEBUG bitwright-engine
```

Force the remote backend:

```bash
export BITWRIGHT_BACKEND=remote
export BITWRIGHT_REMOTE_ENDPOINT="https://api.example.com"
export BITWRIGHT_REMOTE_API_KEY="your-key"
bitwright-engine
```

Cache on another drive, with downloads off:

```powershell
$env:BITWRIGHT_CACHE_DIR = "D:\models\bitwright"
$env:BITWRIGHT_ALLOW_DOWNLOADS = "false"
bitwright-engine
```

## Application settings

Some settings are in the interface rather than the environment, and are stored
per user by the webview:

| Setting | Where | Stored in |
| --- | --- | --- |
| Theme | Settings, Appearance | `localStorage`, `bitwright.theme` |
| Language | Settings, Appearance | `localStorage`, `bitwright.language` |
| Window size and position | Automatic | The window state plugin |

## Environment variables outside the engine

| Variable | Read by | Meaning |
| --- | --- | --- |
| `BITWRIGHT_VIBRANCY` | The shell | Set to `acrylic` to opt in to acrylic on Windows 10, which stutters while the window is dragged |

## Command line

The engine takes one argument, which the shell always passes:

| Argument | Meaning |
| --- | --- |
| `--parent-pid <pid>` | Exit when this process exits, so that no orphan keeps holding GPU memory |

There is no way to set the authentication token. It is generated on each start
and printed in the handshake, so that it cannot be weakened by configuration.

## Precedence

1. An environment variable.
2. The default in `packages/engine/bitwright_engine/config/settings.py`.

There is no configuration file. The engine is spawned by the shell, which
controls its environment, and a file would be a third place for a setting to
hide.
