# bitwright-engine

The Python sidecar for [Bitwright - Sprite Engine](https://github.com/Afterhours-Studio/bitwright-sprite-engine).
It owns model loading, generation, and post-processing, and exposes them over a
loopback HTTP API that the desktop application calls.

## Layout

| Path | Contents |
| --- | --- |
| `bitwright_engine/api/` | FastAPI application, routes, and schemas |
| `bitwright_engine/backends/` | The backend interface and its implementations |
| `bitwright_engine/pipeline/` | Generation pipeline and post-processing |
| `bitwright_engine/models/` | Model registry and download cache |
| `bitwright_engine/config/` | Settings, read from the environment |
| `bitwright_engine/utils/` | Logging and image helpers |

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

Torch and diffusers are optional extras, so that a contributor working on the
API does not have to download several gigabytes. Install one when you need
local generation:

```bash
pip install -e ".[dev,cuda]"   # NVIDIA
pip install -e ".[dev,mps]"    # Apple Silicon
```

## Run

```bash
bitwright-engine
```

The process binds a free loopback port, prints a handshake line on standard
output, and then serves:

```json
{"event": "ready", "port": 51234, "token": "3Qq7...", "version": "0.0.3"}
```

The token authenticates every route except `/health`, and goes in the
`X-Bitwright-Token` header. It is new on every start.

Logs go to standard error, so that they never mix with the handshake, and the
token is never logged. Override any setting with a `BITWRIGHT_` prefixed
environment variable:

```bash
BITWRIGHT_PORT=8000 BITWRIGHT_BACKEND=remote BITWRIGHT_LOG_LEVEL=DEBUG bitwright-engine
```

With a fixed port, the interactive API documentation is at
`http://127.0.0.1:8000/docs`.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness, version, and backend readiness. No token |
| GET | `/v1/backends` | Every backend, its availability, and its capabilities |
| POST | `/v1/backends/{kind}/select` | Switch the active backend |
| POST | `/v1/generate` | Generate sprites |
| GET | `/v1/models` | Registered models, their licences, and cache state |

Full reference: [docs/reference/api.md](../../docs/reference/api.md).

## Checks

```bash
ruff check .
ruff format --check .
mypy .
pytest
```

## Licence

AGPL-3.0-only, copyright (C) 2026 Afterhours Studio. Model weights are not
covered by that licence; see [MODELS.md](../../MODELS.md).
