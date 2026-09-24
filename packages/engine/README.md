# bitwright-engine

The Python sidecar for [Bitwright - Sprite Engine](https://github.com/Afterhours-Studio/bitwright-sprite-engine).
It owns the batch image work — conforming a reference image into real pixel
art, reducing a palette, post-processing a finished sprite — and exposes it over
a loopback HTTP API that the desktop application calls.

Nothing interactive lives here. The document, the canvas and the agent-facing
tools belong to the Rust shell, which keeps a draw call a direct event rather
than a round trip through this process.

## Layout

| Path                                     | Contents                                                         |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `bitwright_engine/api/`                  | FastAPI application, routes, and schemas                         |
| `bitwright_engine/pipeline/conform/`     | Grid detection, palette reduction, modal downsampling, dithering |
| `bitwright_engine/pipeline/postprocess/` | Background removal, quantization, grid snapping                  |
| `bitwright_engine/config/`               | Settings, read from the environment                              |
| `bitwright_engine/utils/`                | Logging, colour maths, and image helpers                         |

## Install

```bash
cd packages/engine
python -m venv .venv

# Linux and macOS
source .venv/bin/activate
# Windows (PowerShell)
.venv\Scripts\Activate.ps1

pip install -e ".[dev]"
```

There is one install. Everything this package needs is a base dependency, so a
contributor working on the API installs the same thing as one working on
conform.

## Run

```bash
bitwright-engine
```

The process binds a free loopback port, prints a handshake line on standard
output, and then serves:

```json
{ "event": "ready", "port": 51234, "token": "3Qq7...", "version": "1.0.0" }
```

The token authenticates every route except `/health`, and goes in the
`X-Bitwright-Token` header. It is new on every start.

Logs go to standard error, so that they never mix with the handshake, and the
token is never logged. Override any setting with a `BITWRIGHT_` prefixed
environment variable:

```bash
BITWRIGHT_PORT=8000 BITWRIGHT_LOG_LEVEL=DEBUG bitwright-engine
```

With a fixed port, the interactive API documentation is at
`http://127.0.0.1:8000/docs`.

## Endpoints

| Method | Path                   | Purpose                                             |
| ------ | ---------------------- | --------------------------------------------------- |
| GET    | `/health`              | Liveness and version. No token                      |
| POST   | `/shutdown`            | Finish in-flight requests, then exit                |
| POST   | `/v1/conform`          | Conform an image into real pixel art                |
| GET    | `/v1/storage`          | The data root in use, and its free space            |
| POST   | `/v1/storage/validate` | Check a candidate directory before committing to it |
| POST   | `/v1/storage`          | Adopt a new data root                               |
| POST   | `/v1/storage/default`  | Return to the per-user default                      |

Full reference: [docs/reference/api.md](../../docs/reference/api.md).

## Checks

```bash
ruff check .
ruff format --check .
mypy .
pytest
```

## Licence

AGPL-3.0-only, copyright (C) 2026 Afterhours Studio.
