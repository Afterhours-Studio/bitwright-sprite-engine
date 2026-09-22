# Engine API reference

Every endpoint the Python sidecar serves, with request and response shapes.

The sidecar's job is batch image mathematics: conform, palette extraction, and
the sprite files on disk. It is not on the path between an agent and the canvas,
and it holds none of the document's state. That belongs to the Rust process, and
its tool surface is in [MCP tools](../architecture/mcp-tools.md) rather than
here.

The engine listens on a loopback port chosen at startup and announced in its
handshake. See [IPC protocol](../architecture/ipc-protocol.md) for how the shell
learns it.

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
{ "event": "ready", "port": 51234, "token": "3Qq7...", "version": "0.0.3" }
```

Send it on every authenticated call:

```bash
curl -H "X-Bitwright-Token: $TOKEN" http://127.0.0.1:8000/v1/storage
```

| Status | Code                      | Cause                                  |
| ------ | ------------------------- | -------------------------------------- |
| 401    | `auth.invalid_token`      | The token is missing or wrong          |
| 403    | `auth.origin_not_allowed` | The request carried an `Origin` header |

Loopback binding keeps the API off the network. It does not keep it away from
other processes on the same machine, which is what the token is for. See
[decision 0008](../architecture/decisions/0008-authenticate-the-sidecar.md).

## GET /health

Liveness and version, and nothing else.

```bash
curl http://127.0.0.1:8000/health
```

```json
{ "status": "ok", "version": "0.0.3" }
```

| Field     | Type   | Meaning                                  |
| --------- | ------ | ---------------------------------------- |
| `status`  | string | `ok` once the process can serve requests |
| `version` | string | Engine version                           |

No engine state is read. The shell polls this while the application is still
starting, and a probe that depended on anything the process builds would answer
500 during exactly the window it exists to cover.

## POST /shutdown

Asks the server to finish in-flight requests and exit. The shell calls this
before terminating the process, so a conform midway through is not cut off.
Authenticated, because an unauthorised caller could otherwise stop the engine at
will.

```bash
curl -X POST -H "X-Bitwright-Token: $TOKEN" http://127.0.0.1:8000/shutdown
```

Returns `202 Accepted` with an empty body. The process exits shortly after.

## POST /v1/conform

Turns an image of pixel art into pixel art: finds the grid it was drawn on,
resolves one colour per cell, reduces to a palette, and hardens the alpha edge.
This is the reference importer. What each step does, and when to change it, is
in [Reference import](../guides/post-processing.md).

```bash
curl -X POST http://127.0.0.1:8000/v1/conform \
  -H "X-Bitwright-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"image": "iVBORw0KGgo...", "width": 64, "height": 64}'
```

### Request

| Field                 | Type            | Default  | Notes                                                   |
| --------------------- | --------------- | -------- | ------------------------------------------------------- |
| `image`               | string          | required | Base64 PNG, no data URL prefix                          |
| `width`               | integer or null | null     | Cells across. `null` detects the count as well as the size |
| `height`              | integer or null | null     | Cells down, on the same terms                           |
| `removeBackground`    | boolean         | true     |                                                         |
| `backgroundTolerance` | integer         | 12       | 0 to 255                                                |
| `paletteSize`         | integer or null | 32       | 2 to 256. `null` keeps every colour the downsample produced |
| `dither`              | string          | `none`   | `none`, `bayer2`, `bayer4`, `bayer8`, or `floydSteinberg` |
| `alphaThreshold`      | number          | 0.5      | 0.05 to 0.95. How much of a cell must be subject for it to come out opaque |

`width` and `height` are capped at 1024 cells, which is well above anything
anyone draws by hand and low enough that a request cannot ask the engine to
allocate a cell grid larger than the image it came from.

### Response

```json
{
  "image": "iVBORw0KGgo...",
  "width": 64,
  "height": 64,
  "palette": ["#2e2a3b", "#7a4b2e", "#c9a227"],
  "detected": {
    "cellWidth": 8.03,
    "cellHeight": 8.01,
    "phaseX": 3.2,
    "phaseY": 0.4,
    "confidence": 0.86
  },
  "durationMs": 412,
  "warnings": []
}
```

| Field        | Type     | Meaning                                                        |
| ------------ | -------- | -------------------------------------------------------------- |
| `image`      | string   | The result, base64 PNG                                         |
| `width`      | integer  | Result width in pixels                                         |
| `height`     | integer  | Result height in pixels                                        |
| `palette`    | string[] | Every colour the result uses, hex, opaque pixels only, most used first |
| `detected`   | object   | The grid the image turned out to be drawn on                   |
| `durationMs` | integer  | How long it took                                               |
| `warnings`   | string[] | Stable reason codes for anything the caller should know        |

`detected` is reported because it is the one number that says whether the result
can be trusted. `cellWidth` and `cellHeight` are source pixels per cell and are
fractional in general; `phaseX` and `phaseY` are where the first boundary sat;
`confidence` is the share of edge energy that lined up with the grid, taken from
whichever axis was weaker. A confidence near zero means the image was not an
upscaled sprite, and what came back is a resize rather than a correction.

`palette` is empty when the result has more colours than a palette could hold,
which happens when `paletteSize` is null.

Warning codes:

| Code                           | Meaning                                                  |
| ------------------------------ | -------------------------------------------------------- |
| `conform.grid_not_found`       | No periodicity was measurable; the image was resized     |
| `conform.grid_anisotropic`     | The two axes disagree about the cell size                |
| `conform.background_uncertain` | The four corners do not agree on what the background is  |
| `conform.already_at_size`      | The image was already at the requested cell size         |

## GET /v1/sprites

Every sprite written under the data root, newest first.

```json
{
  "sprites": [
    {
      "name": "knight-idle.png",
      "path": "C:\\Users\\me\\AppData\\Local\\studio.afterhours.bitwright\\sprites\\knight-idle.png",
      "width": 64,
      "height": 64,
      "data": "iVBORw0KGgo...",
      "modifiedAt": 1758585600.0
    }
  ]
}
```

`data` is base64 encoded PNG bytes, with no data URL prefix. `name` is the file
name and is also the identifier the other two routes take.

## POST /v1/sprites/{name}/remove

Deletes one sprite. Returns `204 No Content`.

## POST /v1/sprites/{name}/edit

Writes an edited sprite back, and returns the `SavedSprite` that resulted.

| Field   | Type   | Notes                                              |
| ------- | ------ | -------------------------------------------------- |
| `image` | string | Base64 PNG, no data URL prefix, at least one byte  |

## Storage

Four routes over the data root, which is the directory that holds everything
the application writes and the one setting a user moves when a drive fills up.

| Route                     | Purpose                                                |
| ------------------------- | ------------------------------------------------------ |
| `GET /v1/storage`         | The root in use, and the free space on its volume      |
| `POST /v1/storage/validate` | Check a candidate directory before committing to it  |
| `POST /v1/storage`        | Move to a directory the user picked                    |
| `POST /v1/storage/default`| Return to the per-user default                         |

`validate` exists so that a bad choice is reported where the user made it rather
than at the next write. The two that change the root return both the new root
and the old one, described as it stands after the change, so the interface can
name what was left behind: nothing is moved on the application's own initiative.

## Error shape

Every engine failure returns the same body:

```json
{
  "code": "conform.grid_not_found",
  "message": "conform.grid_not_found"
}
```

`code` is stable and is the key the frontend looks up in the `errors`
namespace. `message` is an English fallback for logs and for a code with no
translation.
