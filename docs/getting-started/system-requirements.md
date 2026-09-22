# System requirements

What Bitwright needs to run, which is very little.

Bitwright used to generate sprites with a diffusion model, and almost every
requirement on this page came from that model rather than from the application.
[Decision 0012](../architecture/decisions/0012-pivot-to-an-agent-driven-pixel-editor.md)
removed it. What is left is a window, an editor, a SQLite file, and a small
Python process that does image arithmetic on an imported picture. None of that
needs a graphics card, and nothing is downloaded after installation.

## Every platform

| Item                | Minimum                                          |
| ------------------- | ------------------------------------------------ |
| Disk, application   | 120 MB                                           |
| Disk, your projects | Megabytes. A 64 by 64 indexed document is tiny   |
| Memory              | 4 GB                                             |
| GPU                 | None. The canvas renders on the processor        |
| Display             | 960 by 600, which is the minimum window size     |
| Network             | None, unless an MCP client you use needs one     |

The disk figure for projects deserves the emphasis it gets. A document's pixels
are palette indices, one byte each, so a 64 by 64 layer is four kilobytes and a
character with eight layers is a rounding error. What grows is the op log, which
records every mutation so that undo, redo and replay work, and even a heavily
revised asset stays in the low megabytes.

## Driving the canvas with an agent

The application is an editor on its own. What makes it worth using is an MCP
client connected to it, and that client is a separate program with its own
requirements: Claude Code, Claude Desktop, and Cursor are the three the
application detects and configures. Whatever model that client talks to runs
somewhere else, so it costs this machine nothing beyond the connection.

The streamable HTTP transport binds a loopback port, so the client has to be on
the same machine. A client that spawns the process itself uses the stdio
transport instead, and needs nothing bound at all. See
[decision 0013](../architecture/decisions/0013-rust-mcp-server-in-the-tauri-process.md).

## Operating system versions

| Platform | Supported                                           |
| -------- | --------------------------------------------------- |
| Windows  | 10 version 1809 or later, and Windows 11            |
| macOS    | 11.0 Big Sur or later                               |
| Linux    | Anything with glibc 2.31 or later and WebKitGTK 4.1 |

Intel Macs are supported, and have been since generation was removed. There is
no longer anything that needs Apple Silicon.

Window blur behaves differently per platform. Windows 11 uses Mica, macOS uses
its own vibrancy, and Windows 10 and Linux use opaque surfaces. The application
detects what is available and adjusts; nothing needs configuring. See
[decision 0006](../architecture/decisions/0006-custom-window-decorations.md).
