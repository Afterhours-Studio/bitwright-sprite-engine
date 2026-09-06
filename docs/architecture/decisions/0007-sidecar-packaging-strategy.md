# 7. Package the sidecar as a directory, not a single file

Date: 2026-02-10

## Status

Accepted

## Context

The Python engine is frozen with PyInstaller and shipped inside the application
bundle. PyInstaller offers two modes, and the choice looked unimportant while
the backends were stubs.

**Onefile** produces one executable. Everything is compressed inside it, and at
every launch the process unpacks the whole payload into a temporary directory,
runs from there, and deletes it on exit.

**Onedir** produces a directory: the executable plus an `_internal` folder of
libraries. Nothing is unpacked at run time.

The stub engine froze to 24 MB, and onefile unpacked it in well under a second.
That number is misleading. The engine's real dependencies are PyTorch,
diffusers, and transformers, and a frozen build of those is two to four
gigabytes. Onefile would then unpack two to four gigabytes on **every single
launch**, before the first line of Python runs. On a fast SSD that is thirty
seconds; on a slower disk, or with an antivirus scanner watching the temporary
directory, it is a minute or more. Every time.

There is no way to cache the unpacked payload between runs. Onefile deletes it
on exit by design.

Against onedir: it is not a single file, so it cannot be shipped through Tauri's
`externalBin` mechanism, which copies exactly one file per target and places it
next to the application binary. PyInstaller's onedir executable resolves
`_internal` relative to its own directory, so splitting the two breaks it.

Two ways out were considered. Ship the executable through `externalBin` and
`_internal` through resources: rejected, because the two land in different
directories inside a bundle and the executable would not find its libraries.
Ship a small launcher through `externalBin` that re-executes the real binary
from resources: rejected as a moving part that exists only to satisfy a
mechanism we do not need.

## Decision

The sidecar is built with PyInstaller in **onedir** mode, and the whole
directory ships through `bundle.resources` rather than `externalBin`.

```
apps/desktop/src-tauri/binaries/
    bitwright-sidecar-x86_64-pc-windows-msvc/
        bitwright-sidecar-x86_64-pc-windows-msvc.exe
        _internal/...
```

The directory and the executable both carry the Rust target triple. Tauri no
longer enforces that naming for us, since `externalBin` is not in play, but the
reason for it stands on its own: artefacts for several targets can sit in one
tree without colliding, and a bundle cannot pick up a binary frozen for another
platform. The triple comes from `rustc -vV`, never from a guess about the
interpreter, because it is Rust's view of the target that has to match.

The shell locates the executable at startup with
`app.path().resolve(..., BaseDirectory::Resource)`, using the triple that
`tauri-build` compiled in, and falls back to the in-tree build directory during
development. It is spawned with `Command::new` rather than `sidecar()`.

## Consequences

Positive:

- Startup does not depend on the size of the bundle. Adding PyTorch adds
  install size, not launch time.
- The unpacked layout is inspectable. A missing native library is visible in
  the directory rather than hidden inside an archive.
- No temporary directory is written on each launch, which avoids a common
  source of antivirus interference and of failures on a machine with a small or
  read-only temporary volume.
- The target triple is explicit in the path, so a wrong-platform artefact fails
  loudly at startup rather than subtly at run time.

Negative:

- The installed application is a tree rather than a file, so an installer is
  effectively required. That was already true for every target Tauri bundles.
- `externalBin` is not used, so its per-target validation and its automatic
  placement are given up, and the resolution logic is ours to maintain.
- The development fallback path is a second code path that only runs in
  development, and it can rot without anyone noticing. It is one function, and
  it fails with a message naming the script to run.

Neutral:

- The bundle grew from 24 MB (onefile) to 47 MB (onedir) for the stub, because
  nothing is compressed. That is the trade being made deliberately: disk space
  is cheap and repeated at install time, launch time is expensive and repeated
  every single day.

## The fallback, if the bundle is still too large

A two to four gigabyte installer is a poor download, even once. If it proves
unacceptable, the next step is already clear and is recorded here so that it is
not rediscovered from scratch:

**Split PyTorch out of the installer and fetch it on first run**, through the
same mechanism as model weights.

- The installer carries the engine, FastAPI, Pillow, and the backend code:
  roughly 50 MB.
- On first launch, if a local GPU backend is selected, the application
  downloads a PyTorch wheel matching the platform and the CUDA version into the
  same per-user cache directory the models use, and installs it into a private
  virtual environment beside them.
- The remote backend needs none of this, so a user who only ever calls a remote
  API downloads 50 MB and nothing more.
- The download is shown with its size and its licence before it starts, exactly
  as a model download is.

The cost is a more complicated first run and a new failure mode when the
download fails part way. The existing model download flow has to handle resume
and verification anyway, so the work is shared rather than new.

This is not being done now. The backends are stubs, the bundle is 47 MB, and
building the split before there is anything to split would be guessing at the
shape of a problem that does not exist yet.
