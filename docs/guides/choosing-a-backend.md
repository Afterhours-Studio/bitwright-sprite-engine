# Choosing a backend

Which engine to generate on, what each supports, and how to read the reason an
engine is unavailable.

Bitwright has three backends. The choice is yours and lives in Settings; the
application never silently falls back to a remote service.

## The three

| | Local GPU (NVIDIA) | Local GPU (Apple) | Remote API |
| --- | --- | --- | --- |
| Runs on | NVIDIA GPU with CUDA | Apple Silicon | Someone else's server |
| Cost per image | Electricity | Electricity | Whatever the provider charges |
| Prompts leave the machine | No | No | Yes |
| Works offline | Yes, once the model is cached | Yes, once the model is cached | No |
| Disk needed | Several GB per model | Several GB per model | None |
| Batch | Yes | Yes | Yes |
| Style adapters | Yes | Yes | No |
| Pose control | Yes | Yes | No |
| Reference image | Yes | No | No |

The capability rows are what the interface reads. An option a backend does not
declare is disabled on the Generate screen.

## Which to pick

**A machine with an NVIDIA GPU**: use the NVIDIA engine. It is the fastest
option, supports every feature, and keeps prompts local.

**An Apple Silicon Mac**: use the Apple engine. It is slower than a comparable
NVIDIA card, and it lacks reference image support, but everything else works
and unified memory means a 16 GB Mac handles models that would not fit on a
6 GB card.

**Anything else**: use a remote API. An Intel Mac, a laptop with integrated
graphics, or a machine where several gigabytes of weights are not welcome. See
[Using a remote API](using-remote-api.md).

## Why an engine is unavailable

Settings shows a reason for every engine that cannot be selected.

| Message | Cause | Fix |
| --- | --- | --- |
| PyTorch is not installed | The build has no local generation support | Use a release build, or install the extras from source |
| No CUDA driver was found | The NVIDIA driver is missing or too old | Install driver 525 or later, then restart |
| The CUDA driver reported no usable GPU | The driver is there, the device is not | Check `nvidia-smi` lists a GPU |
| The Apple engine only runs on macOS | Not a Mac | Use another engine |
| The Metal device is not available | Intel Mac, or a virtual machine | Use a remote API |
| Set an endpoint in Settings | The remote endpoint is empty | Fill it in |
| Set an API key in Settings | The remote key is empty | Fill it in |

## How availability is decided

Each backend answers three questions, and nothing else in the application knows
how generation works:

- `available()` - can this run here, right now? It never raises. A missing
  driver is a returned reason code, not an exception.
- `capabilities()` - which optional features are supported?
- `generate()` - produce the images.

Availability is cheap to ask, because the Settings screen asks on every render.
The remote backend therefore checks only that an endpoint and a key are
configured, and does not probe the network. A dead endpoint surfaces at
generation time instead.

The interface never guesses at any of this. See
[Backend abstraction](../architecture/backend-abstraction.md) for the
interface, and [decision 0003](../architecture/decisions/0003-python-sidecar-architecture.md)
for why generation lives in a separate process.

## Switching

Switching engines takes effect immediately and does not restart anything. The
parameters you have entered are kept, but a control the new engine does not
support becomes disabled, and its value is ignored until you switch back.
