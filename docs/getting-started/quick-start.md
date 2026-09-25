# Quick start

Your first sprite, from a fresh install to a finished character, drawn by an
agent in a canvas you are watching.

This assumes Bitwright is installed. If it is not, see
[Installation](installation.md).

**Where this stands.** Everything below works today: the document store and
the canvas, the sixteen manual tools, the workflow steps and their gates, the
MCP server with both transports, the client configuration, the live sync,
reference import, tilemap backgrounds and export. The screens are the 1.1
studio layout, described region by region in
[the studio layout](../architecture/studio-layout.md).

## 1. Make a project

Open Bitwright. It opens on home: a sidebar on the left with the agent card,
the create actions and the sections **Recent**, **Projects** and **Settings**,
and your sprites in a grid on the right. On a fresh install the grid is empty.

A project is the unit that carries a style: the palette rules, the default
canvas size, and the preset that decides how an asset is shaded. Choose **New
project** in the sidebar, name it after the game rather than the sprite, and
pick its preset.

Then choose **New sprite**. The dialog asks for the project, a name, the kind
and a canvas size. The sizes are squares from 16 to 512 pixels, each with the
use it suits, plus the project preset's size, marked **Preset**, and a custom
width and height from 16 to 512. **Create sprite** opens the editor on it. The
size cannot be changed afterwards, because every layer and every recorded edit
is measured in it.

The kind says what the sprite is for, and suggests the canvas:

| Asset type | Canvas                     | Drawn as                           |
| ---------- | -------------------------- | ---------------------------------- |
| Character  | 48 to 64                   | full grid                          |
| Prop, item | 16 to 32                   | full grid                          |
| Tile       | 16 or 32                   | full grid, with edge-match checks  |
| Tileset    | N tiles                    | per tile, plus autotile rules      |
| Background | tilemap 20 by 12 or larger | tile placement and parallax layers |

A background is a tilemap rather than one enormous canvas, because a 320 by 180
image is 57,600 characters to read back and a 20 by 12 grid of tile ids is 240.
That is also how the art is actually made.

**PNG to Pixel** in the sidebar is the shortcut for starting from a picture: it
asks for the file, creates a sprite for it in the selected project, and imports
the picture as that sprite's reference. **Projects** lists the sprites grouped
by project, and is where a project is renamed or deleted.

## 2. Connect an agent

Open **Settings** (from the home sidebar, or the round button at the end of
the editor header), then **Agent connection**. The home sidebar's agent card
has a **Connect an agent** button that goes to the same place. The transport picker offers two,
and the difference is about who starts whom:

| Transport  | Use it when                                               |
| ---------- | --------------------------------------------------------- |
| HTTP Local | Bitwright is open and you want to watch the sprite appear |
| Off        | The server is not started; nothing can connect            |

HTTP Local is the one to start with. It binds a loopback port and issues a
token, so the client has to be on this machine. The card shows the status, the
URL with a copy button, and the token masked, with **Reveal**, **Copy** and
**Regenerate**.

Press **Configure all detected clients**. Bitwright looks for Claude Code,
Claude Desktop and Cursor, writes the server entry into each one's
configuration, and lists what it found. Each client has its own row with
**Register** and **Remove**. If your client is not one of the three, **Manual
configuration** on the same card is the JSON snippet to paste in yourself.

A client that spawns the process itself uses stdio instead: run
`bitwright --mcp-stdio`, which carries no token because the spawning process is
the trust boundary. Claude Desktop is configured this way.

Restart the client so it picks up the new server. The connected sessions list on
the card turns over when it connects, and the agent card on home reads "Agent
connected".

## 3. Give it a reference, or do not

An agent can start from nothing. It works better from a reference: a picture of
the character, a screenshot of the art style you are aiming at, or a palette you
already use.

Press **Reference** in the editor header, or start the sprite with **PNG to
Pixel**. The image goes through conform, which finds the
pixel grid it actually has, reduces it to one colour per cell, and extracts a
palette. What comes back is an indexed image and a list of colours that the
agent can read and work from. [Reference import](../guides/post-processing.md)
explains each step and when to change its settings.

## 4. Ask for the sprite

In your client, describe what you want. Something like:

```
Open the "knight" asset in my "Verdance" project in Bitwright and draw it:
a knight in plate armour, side view, idle.
```

The agent works through the ordered steps, and cannot skip one:

```
  reference -> palette -> silhouette -> flats -> shadow -> light
                                                             |
       variation <- cleanup <- accent <- detail <- outline <-+
```

The steps strip along the bottom of the editor shows the same sequence, one
card per step with a thumbnail of what it painted, and the current step
outlined. Its bar summarises the current step's gate report; open the summary
for the detail.

Each painting step writes its own layer, so revising the shading does not destroy the
detail pass, and each step has a gate that is computed from the pixel buffer
rather than asserted by the agent. A silhouette that is two disconnected regions
does not pass, whatever the agent says about it, and shading with two light
directions does not pass either.

Watch the canvas while this happens. A tool call reaches the window as a direct
event, so the sprite appears as it is drawn rather than arriving finished. The
stage shows "Agent drawing · <tool>" while a call is in flight, and an
`open_asset` call switches the window to that asset. The header's **Agent**
button opens a popover with the server's state, the connected sessions and the
last tool each one called.

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

## 6. Draw it yourself

You can also draw yourself, before the agent, after it, or instead of it. A
stroke you make and a tool call the agent makes end in the same buffer and the
same undo history, one entry per stroke.

The editor is laid out in regions:

| Region       | Where  | What it holds                                                                                                                                |
| ------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Header       | Top    | Home, the name and size, undo and redo, clear layer, pixel grid, tile guide, the panel toggles, Agent, New, Reference, Export File, Settings |
| Tools        | Left   | The sixteen tools with their keys, the Fill toggle for a shape tool, mirror symmetry                                                         |
| Stage        | Middle | The sprite; flip, replace colour, outline and anti-alias at the top right; the readout and zoom along the bottom                             |
| Colour panel | Right  | Primary and secondary colours, brush size and footprint, the palette as swatches or ramps                                                    |
| Layers panel | Right  | The workflow's layers, top first, with visibility and pixel counts, and **Draw on…**                                                         |
| Steps strip  | Bottom | The workflow, with **Check**, **Advance**, revisit and forced advance                                                                        |

**Layer** and **Steps** in the header hide and show the layers panel and the
steps strip. Strokes go to the current step's layer unless **Draw on…** in the
layers panel points them at another one.

The tools, each on one key:

| Key | Tool             | Key | Tool           |
| --- | ---------------- | --- | -------------- |
| B   | Pencil           | L   | Line           |
| E   | Eraser           | Q   | Curve          |
| G   | Paint bucket     | U   | Rectangle      |
| I   | Eyedropper       | C   | Circle         |
| M   | Rectangle select | J   | Checker dither |
| W   | Magic wand       | O   | Lighten        |
| V   | Move             | K   | Darken         |
| H   | Pan              | Z   | Zoom           |

A few of them behave in ways worth knowing:

- The eyedropper picks the primary colour; right click picks the secondary.
  In the palette, left click on a swatch sets the primary and right click the
  secondary.
- Lighten and darken move each pixel one step along its colour's ramp in the
  palette. A colour in no ramp is left alone.
- Rectangle select and the magic wand make a selection, and while one exists
  every tool is clipped to it. Shift with the wand selects every pixel of that
  colour, not only the connected ones. The move tool moves the selected pixels,
  or the whole layer when nothing is selected.
- Mirror symmetry, under the tool list, repeats each stroke about the canvas
  centre, horizontally, vertically or both.

Other keys:

| Keys                   | Does                                        |
| ---------------------- | ------------------------------------------- |
| X                      | Swap the primary and secondary colours      |
| Ctrl+Z                 | Undo                                        |
| Ctrl+Y or Ctrl+Shift+Z | Redo                                        |
| Space, held            | Pan with any tool                           |
| `-` and `+`            | Zoom out and in                             |
| Delete or Backspace    | Clear the selected pixels                   |
| Escape                 | Drop the selection, or close the top dialog |
| Ctrl+K                 | Open the command palette                    |

On macOS, Cmd works in place of Ctrl. Single-key shortcuts are ignored while a
text field has focus, so typing a name never changes the tool.

## 7. Export

Saving is implicit and continuous: the document is a row in a SQLite file under
your data root, and there is no save button because there is nothing to save.

Export is the explicit action. Choose **Export File** in the editor header,
pick a folder, and Bitwright
writes PNGs — one per asset, or a packed sheet with every sprite laid out left
to right, wrapping to a new row after `columns`. An agent exports the same way
through `export_png` and `export_sheet`; either one, on success, reports the
path it wrote along with the image's width and height. An agent's export
cannot pick a folder of its own — its files always go under the exports folder
in the data root.

## Next

- [Reference import](../guides/post-processing.md) — what conform does to an
  imported image, and when to change it.
- [Architecture overview](../architecture/overview.md) — what is doing the work.
- [The plan](../PLAN.md) — what is built and what is scheduled.
