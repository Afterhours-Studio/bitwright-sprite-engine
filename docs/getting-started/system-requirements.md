# System requirements

What Bitwright needs to run, split by whether generation happens on your own
GPU or through a remote API.

The application itself is small. The requirements come almost entirely from the
diffusion model, which is why a machine with no usable GPU can still run
Bitwright against a remote endpoint.

## Every platform

| Item | Minimum |
| --- | --- |
| Disk, application | 120 MB |
| Disk, model cache | 5 GB for one base model, more per extra model |
| Memory | 4 GB for the application and the remote backend |
| Display | 960 by 600, which is the minimum window size |

## Local generation on an NVIDIA GPU

| Item | Minimum | Comfortable |
| --- | --- | --- |
| GPU | NVIDIA with 6 GB of VRAM | 12 GB or more |
| Driver | 525 or later, for CUDA 12 | Latest stable |
| Memory | 16 GB | 32 GB |
| Compute capability | 6.1 (Pascal) | 8.6 (Ampere) or later |

Sprites are small, so 6 GB is enough for a 64 by 64 output from a Stable
Diffusion 1.5 base model. SDXL and large batches need more.

Check the driver:

```bash
nvidia-smi
```

If that command is not found, the driver is missing and the NVIDIA engine will
report `No CUDA driver was found` in Settings.

## Local generation on Apple Silicon

| Item | Minimum | Comfortable |
| --- | --- | --- |
| Chip | M1 | M2 Pro or later |
| Memory | 16 GB unified | 24 GB or more |
| macOS | 11.0 Big Sur | 14 Sonoma or later |

Intel Macs cannot generate locally. Metal Performance Shaders needs Apple
Silicon, so an Intel Mac runs the application against a remote API instead.

Apple Silicon supports fewer optional features than CUDA. IP-Adapter is not
available, because it depends on operators the Metal device does not implement
in the pinned version of PyTorch. Settings shows exactly what each engine
supports.

## Remote API only

| Item | Minimum |
| --- | --- |
| GPU | None |
| Memory | 4 GB |
| Network | A connection to the endpoint you configure |

This is the option for a laptop with integrated graphics, an Intel Mac, or a
machine where you would rather not download several gigabytes of weights.
Prompts and parameters are sent to the endpoint you configure, and that
provider's terms apply. See [Using a remote API](../guides/using-remote-api.md).

## Operating system versions

| Platform | Supported |
| --- | --- |
| Windows | 10 version 1809 or later, and Windows 11 |
| macOS | 11.0 Big Sur or later |
| Linux | Anything with glibc 2.31 or later and WebKitGTK 4.1 |

Window blur behaves differently per platform. Windows 11 uses Mica, macOS uses
its own vibrancy, and Windows 10 and Linux use opaque surfaces. The application
detects what is available and adjusts; nothing needs configuring. See
[decision 0006](../architecture/decisions/0006-custom-window-decorations.md).
