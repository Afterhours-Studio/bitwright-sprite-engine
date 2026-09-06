# Engine API reference

Every endpoint the sidecar serves, with request and response shapes.

The engine listens on a loopback port chosen at startup and announced in its
handshake. See [IPC protocol](../architecture/ipc-protocol.md) for how the
shell learns it.

To explore interactively, pin the port and open the generated documentation:

```bash
BITWRIGHT_PORT=8000 bitwright-engine
# http://127.0.0.1:8000/docs
```

## Conventions

- JSON in and out, with camelCase field names. Requests also accept snake_case.
- The server binds loopback only and refuses any other address.
- Every route except `/health` requires the token in `X-Bitwright-Token`.
- A request carrying an `Origin` header is refused with 403, whatever the
  origin. The only legitimate caller is the Rust shell, which is not a browser.
- A failure returns a stable `code`, not a sentence. The frontend translates it
  from the `errors` namespace.

## Authentication

The engine generates a token at startup and prints it in the handshake:

```json
{"event": "ready", "port": 51234, "token": "3Qq7...", "version": "0.0.2"}
```

Send it on every authenticated call:

```bash
curl -H "X-Bitwright-Token: $TOKEN" http://127.0.0.1:8000/v1/backends
```

| Status | Code | Cause |
| --- | --- | --- |
| 401 | `auth.invalid_token` | The token is missing or wrong |
| 403 | `auth.origin_not_allowed` | The request carried an `Origin` header |

Loopback binding keeps the API off the network. It does not keep it away from
other processes on the same machine, which is what the token is for. See
[decision 0008](../architecture/decisions/0008-authenticate-the-sidecar.md).

## GET /health

Liveness, version, and whether the selected backend can generate.

```bash
curl http://127.0.0.1:8000/health
```

```json
{
  "status": "ok",
  "version": "0.0.2",
  "backend": "remote",
  "backendReady": false
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | string | `ok` once the process can serve requests |
| `version` | string | Engine version |
| `backend` | string | The selected backend: `cuda`, `mps`, or `remote` |
| `backendReady` | boolean | Whether that backend can generate now |

`backendReady` being false is not an error. The process is up; the backend it
holds cannot run, and `GET /v1/backends` says why.

## POST /shutdown

Asks the server to finish in-flight requests and exit. The shell calls this
before terminating the process, so a generation midway through is not cut off.
Authenticated, because an unauthorised caller could otherwise stop generation at
will.

```bash
curl -X POST -H "X-Bitwright-Token: $TOKEN" http://127.0.0.1:8000/shutdown
```

Returns `202 Accepted` with an empty body. The process exits shortly after.

## GET /v1/backends

Every backend, its availability, and its capabilities, in preference order.

```bash
curl -H "X-Bitwright-Token: $TOKEN" http://127.0.0.1:8000/v1/backends
```

```json
{
  "backends": [
    {
      "kind": "cuda",
      "available": false,
      "detail": "backend.cuda.driver_missing",
      "device": "",
      "capabilities": ["batch", "controlnet", "ip_adapter", "lora_hotswap"],
      "selected": false
    },
    {
      "kind": "remote",
      "available": true,
      "detail": "",
      "device": "https://api.example.com",
      "capabilities": ["batch"],
      "selected": true
    }
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | string | `cuda`, `mps`, or `remote` |
| `available` | boolean | Can generate right now |
| `detail` | string | Stable reason code when unavailable, empty otherwise |
| `device` | string | Device or endpoint description when available |
| `capabilities` | string[] | Supported optional features |
| `selected` | boolean | Currently serving generation |

Capabilities are reported whether or not the backend is available, so the
Settings screen can show what an engine would offer once its driver is
installed.

## POST /v1/backends/{kind}/select

Switches the active backend.

```bash
curl -X POST -H "X-Bitwright-Token: $TOKEN" \
  http://127.0.0.1:8000/v1/backends/remote/select
```

Returns the refreshed backend list, with the new selection marked.

| Status | Meaning |
| --- | --- |
| 200 | Switched |
| 404 | `backend.unknown_kind` |
| 409 | The backend is unavailable; the reason code is in `detail` |

Selecting an unavailable backend is rejected here rather than at generation
time, so the problem is reported where the user made the choice.

## POST /v1/generate

Generates sprites.

```bash
curl -X POST http://127.0.0.1:8000/v1/generate \
  -H "X-Bitwright-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "a knight in silver armour, side view",
    "width": 64,
    "height": 64,
    "seed": 42
  }'
```

### Request

| Field | Type | Default | Range |
| --- | --- | --- | --- |
| `prompt` | string | required | 1 to 2000 characters |
| `negativePrompt` | string | `""` | up to 2000 characters |
| `width` | integer | 64 | 8 to 2048 |
| `height` | integer | 64 | 8 to 2048 |
| `steps` | integer | 20 | 1 to 150 |
| `guidanceScale` | number | 7.0 | 0 to 30 |
| `seed` | integer or null | null | 0 to 2147483647 |
| `batchSize` | integer | 1 | 1 to 16 |
| `modelId` | string | `sd15-base` | a registry identifier |
| `loraId` | string or null | null | a registry identifier |
| `postprocess` | object | defaults below | |

`postprocess`:

| Field | Type | Default | Range |
| --- | --- | --- | --- |
| `removeBackground` | boolean | true | |
| `backgroundTolerance` | integer | 12 | 0 to 255 |
| `paletteSize` | integer or null | 32 | 2 to 256 |
| `dither` | boolean | false | |
| `pixelGrid` | integer or null | null | 1 to 64 |

### Response

```json
{
  "images": [
    { "data": "iVBORw0KGgoAAAANSUhEUgAA...", "width": 64, "height": 64 }
  ],
  "backend": "remote",
  "durationMs": 42,
  "warnings": []
}
```

`data` is base64 encoded PNG bytes, with no data URL prefix.

### Errors

| Status | Body | Cause |
| --- | --- | --- |
| 422 | FastAPI validation detail | A field is outside its range |
| 503 | `{"code": "...", "message": "..."}` | The backend failed |

Backend codes:

| Code | Meaning |
| --- | --- |
| `backend.unavailable` | The backend cannot run on this machine |
| `backend.unsupported_capability` | The request needs a capability the backend lacks |
| `backend.remote.request_failed` | The remote endpoint rejected the request or was unreachable |
| `backend.error` | Anything else |

A request that needs an undeclared capability is rejected before generation
starts, so `batchSize: 4` against a backend without `batch` fails immediately
rather than after a wait.

## GET /v1/models

Registered models, their licences, and whether they are cached locally.

```bash
curl -H "X-Bitwright-Token: $TOKEN" http://127.0.0.1:8000/v1/models
```

```json
{
  "models": [
    {
      "modelId": "sd15-base",
      "name": "Stable Diffusion 1.5",
      "kind": "base",
      "licenseId": "CreativeML Open RAIL-M",
      "licenseUrl": "https://huggingface.co/spaces/CompVis/stable-diffusion-license",
      "commercialUse": true,
      "sizeMb": 4200,
      "cached": false
    }
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `modelId` | string | Registry identifier |
| `name` | string | Display name |
| `kind` | string | `base`, `lora`, or `segmentation` |
| `licenseId` | string | Licence identifier or name |
| `licenseUrl` | string | Where to read the full text |
| `commercialUse` | boolean | Whether the licence permits commercial use |
| `sizeMb` | integer | Approximate download size |
| `cached` | boolean | Already on this machine |

The licence is part of the response because the user has to see it before
anything is downloaded. Weights are not covered by the application's own
licence; see [MODELS.md](../../MODELS.md).

## Error shape

Every backend failure returns the same body:

```json
{
  "code": "backend.cuda.driver_missing",
  "message": "backend.cuda.driver_missing"
}
```

`code` is stable and is the key the frontend looks up in the `errors`
namespace. `message` is an English fallback for logs and for a code with no
translation.
