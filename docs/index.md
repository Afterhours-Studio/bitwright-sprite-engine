# Bitwright - Sprite Engine

Documentation for Bitwright, a cross-platform sprite generation engine for
pixel art games.

Bitwright is a desktop application that generates pixel art character sprites
with a diffusion model. It runs on Windows, macOS, and Linux, and generates
either on a local GPU or through a remote inference API, whichever you choose
in Settings.

## Where to start

| If you want to                    | Read                                                          |
| --------------------------------- | ------------------------------------------------------------- |
| Install the application           | [Installation](getting-started/installation.md)               |
| Check your machine can run it     | [System requirements](getting-started/system-requirements.md) |
| Generate your first sprite        | [Quick start](getting-started/quick-start.md)                 |
| Understand the generation options | [Generating sprites](guides/generating-sprites.md)            |
| Decide where generation runs      | [Choosing a backend](guides/choosing-a-backend.md)            |
| Clean up the output               | [Post-processing](guides/post-processing.md)                  |
| Use a hosted model                | [Using a remote API](guides/using-remote-api.md)              |
| Understand how it fits together   | [Architecture overview](architecture/overview.md)             |
| Build from source                 | [Development setup](development/setup.md)                     |
| Translate the interface           | [Internationalization](development/i18n.md)                   |
| Change how it looks               | [Design system](development/design-system.md)                 |
| Configure the engine              | [Configuration](reference/configuration.md)                   |
| Call the engine API               | [API reference](reference/api.md)                             |

## Sections

### Getting started

- [Installation](getting-started/installation.md) - install on each platform.
- [Quick start](getting-started/quick-start.md) - first sprite in a few minutes.
- [System requirements](getting-started/system-requirements.md) - what the
  hardware needs to be.

### Guides

- [Generating sprites](guides/generating-sprites.md)
- [Choosing a backend](guides/choosing-a-backend.md)
- [Post-processing](guides/post-processing.md)
- [Using a remote API](guides/using-remote-api.md)

### Architecture

- [Overview](architecture/overview.md) - how the three processes fit together.
- [Backend abstraction](architecture/backend-abstraction.md) - the interface
  every engine implements.
- [IPC protocol](architecture/ipc-protocol.md) - how the shell and the sidecar
  talk.
- [Pixel editing plan](architecture/pixel-editing-plan.md) - turning diffusion
  output into real pixel art, and where the editing controls go.
- [Decision records](architecture/decisions/0001-record-architecture-decisions.md) -
  why the project is built the way it is, including
  [sidecar packaging](architecture/decisions/0007-sidecar-packaging-strategy.md),
  [engine authentication](architecture/decisions/0008-authenticate-the-sidecar.md),
  and [custom overlay controls](architecture/decisions/0010-custom-overlay-controls.md).

### Development

- [Setup](development/setup.md)
- [Coding standards](development/coding-standards.md)
- [Testing](development/testing.md)
- [Internationalization](development/i18n.md)
- [Design system](development/design-system.md)
- [Theming](development/theming.md)

### Reference

- [Engine API](reference/api.md)
- [Configuration](reference/configuration.md)

## Licensing

The application is licensed under AGPL-3.0-only, copyright (C) 2026 Afterhours
Studio. Model weights are not part of the application and are not covered by
that licence; each is downloaded at first use under its own terms. See
[MODELS.md](../MODELS.md).
