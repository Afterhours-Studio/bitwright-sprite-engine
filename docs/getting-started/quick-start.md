# Quick start

Your first sprite, from a fresh install to a finished character, drawn by an
agent in a canvas you are watching.

This assumes Bitwright is installed. If it is not, see
[Installation](installation.md).

**Where this stands.** Bitwright is being rebuilt from a sprite generator into
an agent-driven editor, and the phases are listed in
[the plan](../plan/PLAN.md). The document store and the canvas are
Phase 1; the MCP server, the client configuration and the live sync described
below are Phase 2; the workflow gates and reference import are Phase 3. This
page describes the flow those phases are being built to produce, so that the
shape of the finished thing is written down rather than discovered. Where a step
is not yet available in a release, the plan says which phase it belongs to.

## 1. Make a project

Open Bitwright. The left sidebar is a tree of projects, and a project is the
unit that carries a style: the palette rules, the default canvas size, and the
preset that decides how an asset is shaded.

Create one, name it after the game rather than the sprite, and add an asset
inside it. An asset has a type, and the type picks the canvas:

| Asset type | Canvas          | Drawn as                        |
| ---------- | --------------- | ------------------------------- |
| Character  | 48 to 64        | full grid                       |
| Prop, item | 16 to 32        | full grid                       |
| Tile       | 16 or 32        | full grid, with edge-match checks |
| Tileset    | N tiles         | per tile, plus autotile rules   |
| Background | tilemap 20 by 12 or larger | tile placement and parallax layers |

A background is a tilemap rather than one enormous canvas, because a 320 by 180
image is 57,600 characters to read back and a 20 by 12 grid of tile ids is 240.
That is also how the art is actually made.

## 2. Connect an agent

Open **Settings**, then **MCP**. The transport picker offers two, and the
difference is about who starts whom:

| Transport       | Use it when                                                        |
| --------------- | ------------------------------------------------------------------ |
| HTTP Local      | Bitwright is open and you want to watch the sprite appear          |
| Stdio           | A client spawns the application itself, for headless or CI use     |

HTTP Local is the one to start with. It binds a loopback port and issues a
token, so the client has to be on this machine.

Press **Configure All Detected Clients**. Bitwright looks for Claude Code,
Claude Desktop and Cursor, writes the server entry into each one's
configuration, and lists what it found. If your client is not one of the three,
the manual configuration block on the same screen is the same entry to paste in
yourself.

Restart the client so it picks up the new server. The session status on the MCP
screen turns over when it connects.

## 3. Give it a reference, or do not

An agent can start from nothing. It works better from a reference: a picture of
the character, a screenshot of the art style you are aiming at, or a palette you
already use.

Import one under **Reference**. The image goes through conform, which finds the
pixel grid it actually has, reduces it to one colour per cell, and extracts a
palette. What comes back is an indexed image and a list of colours that the
agent can read and work from. [Reference import](../guides/post-processing.md)
explains each step and when to change its settings.

## 4. Ask for the sprite

In your client, describe what you want. Something like:

```
Open the "knight" asset in my "Verdance" project in Bitwright and draw it:
a knight in plate armour, side view, idle. Use the reference palette.
```

The agent works through the ordered steps, and cannot skip one:

```
  reference -> palette -> silhouette -> outline -> shadow -> light
                                                              |
                     variation <- accent <- detail <- rim <----+
```

Each step writes its own layer, so revising the shading does not destroy the
detail pass, and each step has a gate that is computed from the pixel buffer
rather than asserted by the agent. A silhouette that is two disconnected regions
does not pass, whatever the agent says about it, and shading with two light
directions does not pass either.

Watch the canvas while this happens. A tool call reaches the window as a direct
event, so the sprite appears as it is drawn rather than arriving finished.

## 5. Correct it

This is the part a generator could not do. Ask the agent to read the layer back
and fix what is wrong:

```
The outline on the left pauldron is two pixels thick around row 20. Make it one.
```

A 64 by 64 layer reads back as 64 lines of 64 characters, with column and row
rulers, which is about four kilobytes:

```
      0    5    10   15   20   25   30
 40 | ..........AAAAAAAAAA...........
 41 | ........AABBBBBBBBBBAA.........
 42 | ......AABBBCCCCCCBBBBBAA.......
```

`.` is transparent, and `A` onwards are palette slots in order. The agent can
see what it drew, count to the pixel it means, and change three pixels without
touching anything else.

You can also draw yourself. The tool panel on the right has the usual pencil,
fill, line and shape tools, and a stroke you make and a tool call the agent
makes end in the same buffer and the same undo history.

## 6. Export

Saving is implicit and continuous: the document is a row in a SQLite file under
your data root, and there is no save button because there is nothing to save.

Export is the explicit action. Choose **Export**, pick a folder, and Bitwright
writes PNGs — one per asset, or a packed sheet with the rectangle of every frame
reported alongside it, so an importer knows exactly where each one landed.

## Next

- [Reference import](../guides/post-processing.md) — what conform does to an
  imported image, and when to change it.
- [Architecture overview](../architecture/overview.md) — what is doing the work.
- [The plan](../plan/PLAN.md) — what is built and what is scheduled.
