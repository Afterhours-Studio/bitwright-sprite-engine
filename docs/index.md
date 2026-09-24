# Bitwright - Sprite Engine

Documentation for Bitwright, a pixel art editor whose canvas an AI agent draws
in.

Bitwright is a desktop application for Windows, macOS and Linux. It holds
projects of indexed pixel art documents, and it serves an MCP server that lets
an agent — Claude Code, Claude Desktop, Cursor, or anything else that speaks the
protocol — read the canvas, draw on it, and correct what it drew, while you
watch. You can draw in it yourself with the usual tools, and a reference image
you bring in is turned into a real indexed canvas and a palette an agent can
work from.

It used to generate sprites with a diffusion model. It does not any more, and
[decision 0012](architecture/decisions/0012-pivot-to-an-agent-driven-pixel-editor.md)
explains at length why not. [The plan](plan/PLAN.md) is the authority on what the
project now is, what has been built, and what is scheduled; where a page here
describes something that is decided but not yet shipped, the plan says which
phase it belongs to.

## Where to start

| If you want to                  | Read                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| Know what the project is now    | [The plan](plan/PLAN.md)                                      |
| Install the application         | [Installation](getting-started/installation.md)               |
| Check your machine can run it   | [System requirements](getting-started/system-requirements.md) |
| Draw your first sprite          | [Quick start](getting-started/quick-start.md)                 |
| Bring existing art in           | [Reference import](guides/post-processing.md)                 |
| Understand how it fits together | [Architecture overview](architecture/overview.md)             |
| Know what an agent can call     | [MCP tools](architecture/mcp-tools.md)                        |
| Know what a document is made of | [Document model](architecture/document-model.md)              |
| Build from source               | [Development setup](development/setup.md)                     |
| Translate the interface         | [Internationalization](development/i18n.md)                   |
| Change how it looks             | [Design system](development/design-system.md)                 |
| Configure the engine            | [Configuration](reference/configuration.md)                   |
| Call the engine API             | [API reference](reference/api.md)                             |

## Sections

### Getting started

- [Installation](getting-started/installation.md) - install on each platform.
- [Quick start](getting-started/quick-start.md) - a project, an agent connected,
  and a sprite drawn.
- [System requirements](getting-started/system-requirements.md) - what the
  hardware needs to be, which is not much.

### Guides

- [Reference import](guides/post-processing.md) - what conform does to a picture
  you bring in, and when to change it.

### Architecture

- [Overview](architecture/overview.md) - how the three parts fit together.
- [Document model](architecture/document-model.md) - the schema and the IPC
  contract for projects, assets, documents and layers.
- [MCP tools](architecture/mcp-tools.md) - every tool an agent can call, its
  schema, and its errors.
- [IPC protocol](architecture/ipc-protocol.md) - how the shell and the sidecar
  find each other.
- [Pixel editing plan](architecture/pixel-editing-plan.md) - the mathematics of
  conform, and where the editing controls belong.
- [Decision records](architecture/decisions/0001-record-architecture-decisions.md) -
  why the project is built the way it is, including
  [the pivot](architecture/decisions/0012-pivot-to-an-agent-driven-pixel-editor.md),
  [the MCP server](architecture/decisions/0013-rust-mcp-server-in-the-tauri-process.md),
  [the Python sidecar](architecture/decisions/0003-python-sidecar-architecture.md),
  and [engine authentication](architecture/decisions/0008-authenticate-the-sidecar.md).

### Development

- [Setup](development/setup.md)
- [Coding standards](development/coding-standards.md)
- [Testing](development/testing.md)
- [Internationalization](development/i18n.md)
- [Design system](development/design-system.md)
- [Theming](development/theming.md)

### Reference

- [Engine API](reference/api.md) - the sidecar's HTTP endpoints.
- [Configuration](reference/configuration.md) - every setting and its default.

## Licensing

The application is licensed under AGPL-3.0-only, copyright (C) 2026 Afterhours
Studio. See [decision 0004](architecture/decisions/0004-agpl-license-choice.md)
for why, and `THIRD_PARTY_LICENSES.md` for what it depends on.
