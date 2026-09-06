# Backend abstraction

The interface every generation backend implements, and why capabilities are
declared up front rather than discovered by failing.

The abstraction lives in `packages/engine/bitwright_engine/backends/base.py`.
Nothing above it knows whether generation happens on a GPU in the machine or on
a server in another country.

## The interface

```python
class Backend(Protocol):
    kind: BackendKind

    def available(self) -> Availability: ...
    def capabilities(self) -> frozenset[Capability]: ...
    def generate(self, request: GenerationRequest) -> GenerationResult: ...
```

A `Protocol` rather than a base class, so that callers, tests, and fakes are
not tied to an inheritance chain. `BaseBackend` implements the shared request
validation, and the three real backends extend it, but anything structurally
matching the protocol works.

### available()

Answers whether this backend can serve a request on this machine right now.

```python
@dataclass(frozen=True, slots=True)
class Availability:
    ready: bool
    detail: str = ""   # stable reason code when not ready
    device: str = ""   # device or endpoint description when ready
```

Two rules:

**It never raises.** A missing driver, an absent package, an unreachable
endpoint: all of them are a returned value. The Settings screen renders every
backend, and one that threw would take the screen down with it.

**It is cheap.** The Settings screen calls it on every render. The remote
backend therefore checks only that an endpoint and a key are configured, and
does not probe the network; a round trip per render would make the screen
sluggish. A dead endpoint surfaces at generation time as
`backend.remote.request_failed`.

`detail` is a stable reason code, not prose, because the frontend translates it.

### capabilities()

Answers which optional features this backend supports.

```python
class Capability(StrEnum):
    LORA_HOTSWAP = "lora_hotswap"
    CONTROLNET = "controlnet"
    IP_ADAPTER = "ip_adapter"
    BATCH = "batch"
```

| Backend | Capabilities                 |
| ------- | ---------------------------- |
| CUDA    | All four                     |
| MPS     | Everything except IP-Adapter |
| Remote  | Batch only                   |

MPS omits IP-Adapter because it depends on operators the Metal device does not
implement in the pinned version of PyTorch. The remote backend declares only
batching because adapter support varies between providers and cannot be
assumed; a future release will query the provider and declare what it actually
offers.

### generate()

Produces the images. It raises rather than returns on failure, and every error
carries a code:

| Exception                    | Code                    | Raised when                                |
| ---------------------------- | ----------------------- | ------------------------------------------ |
| `BackendUnavailableError`    | the availability detail | The backend cannot run                     |
| `UnsupportedCapabilityError` | the capability name     | The request needs an undeclared capability |
| `BackendError`               | `backend.error`         | Anything else                              |

## Capability negotiation

This is the part that shapes the interface. A request declares what it needs,
and that is compared against the backend before anything runs:

```python
def required_capabilities(request: GenerationRequest) -> frozenset[Capability]:
    required: set[Capability] = set()
    if request.batch_size > 1:
        required.add(Capability.BATCH)
    if request.lora_id is not None:
        required.add(Capability.LORA_HOTSWAP)
    return frozenset(required)
```

The same function exists in TypeScript, in `src/types/engine.ts`, and the
Generate screen uses it to disable controls the selected engine cannot honour.
Two implementations of one rule is a duplication worth having: the check has to
exist in the interface to disable a control, and in the engine to stay correct
when the API is called directly.

The flow:

```
   Settings screen                     Generate screen
        |                                    |
   GET /v1/backends                    read capabilities
        |                                    |
        v                                    v
   [ cuda   unavailable ]            batch size  -> disabled
   [ mps    unavailable ]            adapter     -> disabled
   [ remote SELECTED    ]            steps, size -> enabled
     capabilities: batch
```

The user never presses a button that was always going to fail.

Validation happens once, in `BaseBackend.generate`, so every backend rejects the
same requests for the same reasons. Subclasses implement `_run`, which is only
ever called with a request already known to be supported.

## Adding a backend

1. Subclass `BaseBackend` in `backends/`, and set `kind`.
2. Implement `available()`, returning a reason code for every way it can fail.
   Add each code to both `locales/en/errors.json` and `locales/vi/errors.json`.
3. Implement `capabilities()`. Declare only what is actually supported; an
   optimistic declaration turns into a failure the user cannot predict.
4. Implement `_run()`.
5. Add the kind to `BackendKind`, to `build_backend`, and to `PREFERENCE` in
   `backends/__init__.py`.
6. Mirror the kind in `src/types/engine.ts`, and add a label under
   `settings.engine` in both locales.
7. Add tests. `tests/conftest.py` has a fake backend with configurable
   availability and capabilities to model yours on.

## Selection

`select_backend("auto")` takes the first available backend in preference order,
which is CUDA, then MPS, then remote. Local GPUs come first because they cost
nothing per image and keep prompts on the machine.

A named backend is returned whether or not it is available, and the caller
decides whether that is an error. That is what lets the Settings screen show an
unavailable backend with its reason instead of hiding it.
