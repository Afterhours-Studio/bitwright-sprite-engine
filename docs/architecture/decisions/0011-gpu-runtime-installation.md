# 11. Install the GPU runtime from a pinned wheel manifest

Date: 2026-09-06

## Status

Superseded in full by
[0012](0012-pivot-to-an-agent-driven-pixel-editor.md).

Local diffusion is deleted, so there is nothing for a GPU runtime to run. The
manifest, the installer, the activation hook, the settings card and the
`--report-runtime` build check are all removed with it, and the whole standard
library is no longer collected into the frozen sidecar because nothing arrives
after the build that would need it.

The record is kept in full, and not only for the history. It is the most
detailed account this repository has of what it costs to put a multi-gigabyte
machine learning runtime on a user's machine, and that cost is part of why
[0012](0012-pivot-to-an-agent-driven-pixel-editor.md) was worth making. The
findings below about PyInstaller's hidden imports, about resolving wheels for a
platform other than the host, and about per-target wheel tags remain true of
PyInstaller and of pip; they simply no longer apply to anything this project
ships.

## Context

A user with an RTX 3060 opens Settings and finds every engine unusable:

```
cuda   available=False  detail=backend.cuda.torch_missing
mps    available=False  detail=backend.mps.not_macos
remote available=False  detail=backend.remote.endpoint_missing
auto -> BackendUnavailableError: backend.none_available
```

PyTorch is not installed. It sits in the `cuda` and `mps` extras of
`packages/engine/pyproject.toml`, deliberately out of the base install, because
the Windows CUDA build alone is 2.5 GB compressed and 3.9 GB unpacked. So there
is working hardware, an application that wants it, and no way to connect the two
that does not involve a terminal.

ADR 0007 already anticipated this and wrote down the answer in outline: split
PyTorch out of the installer and fetch it on first run, into the same per-user
directory the model weights use, showing its size and its licence beforehand.
This record is that outline made concrete, and it corrects one detail of it.

### What makes it hard

**The shipped sidecar is a PyInstaller bundle.** It has no `pip`, no
`python.exe`, and no `venv` module. An installer written as
`subprocess.run([sys.executable, "-m", "pip", "install", ...])` works perfectly
in development, where the engine runs out of `packages/engine/.venv`, and does
nothing at all in a release, where `sys.executable` is the frozen sidecar and
`-m pip` is not a thing it can do. Shipping that and calling it done would be
shipping a button that only works on the developer's machine.

ADR 0007's phrasing, "installs it into a private virtual environment beside
them", is the part that does not survive contact with the frozen bundle: there
is no interpreter to build a virtual environment around.

### The options

**Collect `pip` into the frozen bundle and drive it in process.** `pip` is
importable, and `pip._internal.main()` can be called directly. It is not
designed for it. It computes wheel tags and installation schemes from
`sysconfig`, resolves several paths relative to `sys.executable`, and reaches
for a subprocess for anything that is not a plain wheel install. Some of that
can be worked around with `--target --only-binary :all: --no-input`; the
remainder is undocumented behaviour that changes between pip releases and that
we would be discovering at a user's first launch rather than in CI. It also
means shipping pip's vendored dependency tree inside the bundle and keeping it
current.

**Ship `uv` as a vendored binary.** A single static executable, Apache-2.0 or
MIT, and genuinely able to resolve for a target it is not running on
(`--python-version`, `--python-platform`). It is the strongest of the
alternatives. What it costs: a third-party binary of roughly 35 MB per platform
committed into the repository and into every installer, a new entry in the
licence records, a new thing to keep up to date, and a subprocess launch on a
machine where antivirus software has opinions about newly written executables.
It is a package manager brought in to do one job that has exactly one correct
answer.

**Resolve and download wheels directly.** The honest objection is that this
means implementing dependency resolution, which is a genuinely hard problem and
not one to solve in a settings screen.

Except that we do not have to solve it. There is one dependency set that
matters, it is small, and it does not change between users:

```
torch, fsspec, networkx, setuptools, sympy, mpmath,
typing_extensions, filelock, jinja2, markupsafe
```

Ten wheels. Resolution is a build-time question with a build-time answer, and
the repository already works this way: `models/registry.py` pins a model
revision rather than resolving one at download time, "so that two machines
fetching the same entry get the same bytes".

## Decision

**The runtime is a manifest of pinned wheels, fetched and unzipped by the
engine, into `<data_root>/runtime`.**

`bitwright_engine/runtime/manifest.py` holds, per target, the exact URL,
version, sha256, download size and unpacked size of every wheel. The pins are
produced by pip, once, ahead of time:

```
python -m pip install --dry-run --ignore-installed --only-binary :all: \
    --python-version 3.14 --abi cp314 --platform win_amd64 \
    --target /tmp/unused --report report.json \
    --index-url https://download.pytorch.org/whl/cu126 \
    --extra-index-url https://pypi.org/simple "torch==2.14.0+cu126"
```

pip does the resolution; this repository stores the answer. Nothing at run time
resolves anything, guesses a version, or trusts a file because it arrived over
TLS: every wheel is checked against its recorded digest before it is unpacked.

`bitwright_engine/runtime/installer.py` does the rest, and it does only two
things a frozen bundle is definitely capable of: stream a file, and read a zip.
Wheels land in `runtime/.partial`, are extracted into `runtime/.staging`, and
each wheel is deleted the moment it is unpacked, so peak disk usage is the tree
plus one wheel rather than the tree plus all of them. The record file
`runtime/runtime.json` is written last and is what "installed" means, so a
process killed at any point leaves a directory that reads as absent rather than
one that reads as present and then fails to import. Archive members are checked
before extraction: a name that is absolute, that walks upwards, or that carries
a drive letter is refused as `runtime.unsafe_archive`.

**It goes under the data root the user chose.** Beside `models`, on the volume
they picked in Settings, because it is gigabytes and that is the entire purpose
of that setting. `RuntimeInstaller.root` reads `settings.data_root` afresh on
every access rather than capturing it, so moving the root moves where the
runtime is looked for.

**It reaches `sys.path` by being appended at startup.**
`bitwright_engine/runtime/activation.py` is called from `server.main()` before
anything can select a backend and therefore before anything can import torch.
It is **appended**, not prepended: the runtime carries its own copies of
packages the sidecar already ships (`typing_extensions`, `setuptools`), and
letting a downloaded tree shadow what the engine is already running on would
turn a generation feature into a process that no longer starts. torch pins its
dependencies with lower bounds, which the shipped versions satisfy.

**A restart is required, and the interface says so.** Activation happens at
startup and nowhere else. Importing torch into a process that has already been
answering requests without it means that if the import fails half way, Python
has no way to unimport the partly initialised module. `GET /v1/runtime` reports
`installed` and `torchImportable` as two separate facts, and `restartRequired`
when the first is true and the second is not. The card says "Installed. Restart
Bitwright to start using it." rather than claiming the GPU works.

**CUDA 12.6, and the variant follows the shell's existing probe.** CUDA's minor
version compatibility means a 12.6 build runs on any 525 or newer driver, which
is the widest reach of the 12.x line, and it covers Turing through Blackwell,
the RTX 3060 included. The shell's `check_gpu` already runs `nvidia-smi` without
loading any machine learning framework; its answer is passed to the engine as a
query parameter rather than probed a second time in Python. A machine with no
NVIDIA GPU is offered the CPU build, with the card saying plainly that it
generates on the processor and is much slower.

**The standard library is taken whole into the frozen bundle.** PyInstaller
ships what it can see being imported, and it cannot see PyTorch, which is
downloaded after the build. PyTorch imports a wide slice of the standard library
this engine never touches, and each of those would be missing from the frozen
interpreter. `scripts/build-sidecar.py` therefore passes every public name in
`sys.stdlib_module_names` as a hidden import, minus Tk, the test suites and the
demos. There is no shorter list that can be checked, because it changes with
every PyTorch release.

## Consequences

Positive:

- No pip, no `uv`, no vendored third-party binary, no subprocess. The install
  path is a download and a zip extraction, both of which a frozen bundle can
  certainly do.
- Every byte is pinned and hashed. Two machines installing the same variant get
  the same bytes, and a proxy or mirror that alters a wheel is caught rather
  than installed.
- The failure modes are the ones the model downloader already has, and they get
  the same treatment: stable reason codes, cooperative cancellation, nothing
  half written left behind.
- Removal is a single `rmtree` of a directory this code owns entirely, which is
  what makes reclaiming four gigabytes safe to offer.
- The licence position can be stated exactly, because the exact package set is
  known before the download starts.

Negative:

- **The manifest is maintained by hand.** Moving to a newer PyTorch, or
  supporting a new Python version, means re-running the pip command above and
  pasting in the result. There is no automation for it yet. A stale manifest is
  not dangerous, it just means the application installs an older PyTorch than
  the one available.
- **The manifest is keyed by interpreter ABI.** The frozen sidecar embeds one
  CPython version, and wheels with compiled extensions are built for one ABI. If
  the build machine's Python changes, the pins have to be regenerated, and until
  they are, the target reports `runtime.unsupported_platform`. A runtime
  installed for a different target is refused at activation rather than imported.
- **There was no Linux entry.** pip's `--platform` does not change how
  environment markers are evaluated, so a wheel set has to be resolved on the
  operating system it is for. PyTorch's Linux CUDA build pulls a separate tree of
  NVIDIA wheels behind `platform_system == "Linux"` markers, and a set resolved
  for it from Windows silently comes back without them. Rather than ship pins
  that were guessed, Linux reports `runtime.unsupported_platform` until the set
  is generated on Linux. That is a gap, and it is stated in the interface rather
  than hidden.

  Closed on 2026-09-14; see the update below. The premise held exactly: torch's
  Linux metadata declares eighteen CUDA packages and Triton that its Windows
  metadata does not.

- The whole standard library in the bundle costs roughly 10 to 20 MB of install
  size that a sidecar without a runtime does not need.

Neutral:

- Development and release take the same path. There is no `pip install` branch
  that only developers exercise, so there is no second code path to rot.

## What has been verified, and what has not

Verified: the download, digest check, extraction, publication, cancellation,
removal and path activation all run in the test suite against wheels the tests
build themselves, and the pinned URLs, digests, sizes and unpacked sizes for all
three shipped variants were read from the live indexes rather than estimated.

**Not verified: `import torch` inside a frozen bundle.** Confirming that needs a
full PyInstaller build followed by a real 2.5 GB install, which is not something
CI or this change can run. The mechanism is sound — a wheel's compiled
extensions link against the same `python3xx` runtime the bundle already has
loaded, and the whole standard library is now present for them — but it is
reasoning, not evidence. It is called out here rather than glossed over, and the
interface is built so that a failure is visible: if torch is on disk and will
not load, `probe()` reports `runtime.import_failed` and the card shows it,
instead of the runtime silently appearing to be installed and generation
failing later.

That reasoning was wrong, and the paragraph above is left standing as the record
of it. What it got right is that the failure would be visible; what it got wrong
is the claim that "the whole standard library is now present". See the update
below.

## The licence position

PyTorch's own metadata declares
`Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause AND BSL-1.0 AND MIT`.
It is not the plain BSD-3-Clause this project's notes assumed. Every part is
permissive; none is copyleft; none of it reaches this program's own AGPL-3.0
grant.

The CUDA build is the part that needs saying out loud. The Windows `+cu126`
wheel embeds NVIDIA's redistributable CUDA runtime libraries — cuBLAS, cuDNN,
cuFFT and the rest — and those are **not** under PyTorch's licence. They come
under NVIDIA's own end user licence agreement, which is not an open source
licence. That does not affect what this project distributes: the wheels are
fetched by the user, at their instruction, from PyTorch's index, into their own
data folder, and nothing of NVIDIA's is ever in an installer we build. But the
user is taking on those terms, so the confirmation names them and links to the
agreement before any bytes move, the same rule MODELS.md sets for weights.

`scripts/check-licenses.py` reads installed distribution metadata, and the
runtime is installed outside any environment it scans, so CI is unaffected by an
install. `THIRD_PARTY_LICENSES.md` should record the set anyway, because it is
what the application will fetch.

## Update, 2026-09-14: both open gaps closed

### Linux is supported, and the resolver was the answer

`linux_x86_64-cp314` is in the manifest, with a CUDA variant and a CPU variant,
the same shape the other targets have.

The original objection stands entirely: resolving the Linux set from Windows
does come back wrong. torch's own metadata for
`torch-2.14.0+cu126-cp314-cp314-manylinux_2_28_x86_64.whl` declares
`cuda-toolkit[...]==12.6.3`, `nvidia-cudnn-cu12==9.10.2.21`, `nvidia-nccl-cu12`,
`nvidia-cusparselt-cu12`, `nvidia-nvshmem-cu12`, `nvidia-nvjitlink-cu12` and
`triton~=3.8.0`, every one of them behind `platform_system == "Linux"`, and pip
on Windows evaluates that marker to false and drops all of them.

What the record got wrong is the conclusion that the set therefore has to be
generated _on_ Linux. It has to be generated by something that evaluates markers
against the target rather than against the host, and pip is not the only such
thing. This ADR already noted, while rejecting `uv` as a shipped dependency,
that it is "genuinely able to resolve for a target it is not running on
(`--python-version`, `--python-platform`)". That is a build-time capability, and
using it at build time costs none of what rejecting it avoided: nothing is
vendored, nothing is shipped, no subprocess runs on a user's machine. The pins
came from:

```
uv pip compile --python-platform x86_64-unknown-linux-gnu --python-version 3.14 \
    --index-url https://download.pytorch.org/whl/cu126 \
    --extra-index-url https://pypi.org/simple --index-strategy unsafe-best-match \
    torch==2.14.0+cu126
```

and the resolution it returned carries the eighteen CUDA packages and Triton
that the Windows resolution does not.

Resolving is not pinning. Every URL in the new entries was then confirmed with
an HTTP HEAD against the canonical host, every `size_bytes` is the
`Content-Length` that host reported, every `sha256` is the digest the index
publishes for that file, and every `unpacked_bytes` on a wheel large enough to
matter was read from the wheel's own zip directory over range requests rather
than estimated. A Linux CUDA install is 3.71 GB downloaded and 6.74 GB on disk;
the CPU install is 0.26 GB and 0.93 GB.

Still open on Linux: only 64-bit x86 with glibc is pinned. ARM Linux, 32-bit
Linux and a free-threaded interpreter all report
`runtime.unsupported_platform`, which is the honest answer rather than a near
miss. musl needs no detection: the sidecar is frozen against glibc, so a musl
system cannot run the process that would ask.

### While pinning Linux: the other two targets were already wrong

Splitting the wheel list per target exposed something the single shared list had
been hiding. Eight of the packages in the diffusers set carry compiled
extensions — PyYAML, charset-normalizer, hf-xet, Pillow, psutil, regex,
safetensors, tokenizers — and all eight were pinned to their `win_amd64` wheels
for **every** target. A macOS install was therefore downloading Windows binaries
and unpacking them happily, because a wheel is a zip and a zip does not care;
the failure would have surfaced as `import PIL` finding a `.pyd` it cannot open.
Each is now pinned per target, verified the same way, and
`test_every_pinned_wheel_is_built_for_the_target_it_is_listed_under` fails the
suite if it ever happens again.

### `import torch` inside a frozen bundle: now tested, and it did not work

`scripts/build-sidecar.py` no longer stops at `--help`. It runs the frozen
executable a second time with `--report-runtime`, which takes the real path the
application takes — activate, then import — and prints what happened as JSON,
including the directory the `torch` module was actually loaded from. The build
fails when a runtime is installed and torch will not import from it, when the
torch that imported did not come from the directory activation added, or when it
imports and cannot compute. The check needs no torch on the build machine, and
would not use one if it were there: the frozen executable carries only its own
archive on `sys.path`, and the report says where the module came from so that
the answer can be read rather than assumed.

Run against a real 0.19 GB CPU install on Windows, the first thing it did was
fail:

```
ModuleNotFoundError: No module named 'unittest.mock'
  torch/_guards.py line 12, in <module>
    import unittest.mock
```

`--hidden-import unittest` collects `unittest` and nothing underneath it.
PyInstaller still works by following imports from the name it is given, and
`unittest/__init__.py` does not import `unittest.mock`. The same was true of
every other standard library package: the build was passing 205 top-level names
and getting 205 modules, not the standard library. "The standard library is
taken whole into the frozen bundle" was not true of the code that claimed it.

`stdlib_modules()` now walks each package on disk and names every public
submodule at every depth, which takes the list from 205 to 481. It reads the
file system rather than importing, so nothing runs module level code to be
enumerated and `curses` on Windows is listed rather than crashed on.

A second, smaller bug turned up in the same run. `probe()` treated every
`ImportError` as "torch is not installed", and a module missing from the bundle,
or a DLL that will not load on Windows, is an `ImportError` too. A user whose
runtime was broken was being told to install the runtime they already had. The
reason codes are unchanged; what changed is which one is reported, and a failed
import now logs its traceback instead of being swallowed.

### What is proven now, and what is not

Proven, by running it: a PyInstaller onedir bundle built from this repository
imports torch 2.14.0+cpu out of a runtime installed by `RuntimeInstaller` into a
data root of the user's choosing, from the directory activation put on
`sys.path`, and computes a tensor on it. On Windows, for the CPU variant.

Not proven, and each needs hardware or an operating system this change could not
reach:

- The CUDA variant. Nothing here has touched an NVIDIA GPU, so
  `torch.cuda.is_available()` returning true inside a frozen bundle is still
  reasoning. The `--report-runtime` check answers it on the first machine that
  has one, without any further code.
- Any Linux install, end to end. The pins were verified as bytes on a server;
  nothing has unpacked them on Linux and imported the result.
- macOS, both the corrected wheels and the frozen import.

The check reports which of these it could and could not answer on the machine it
ran on, rather than printing a single line that reads the same either way.
