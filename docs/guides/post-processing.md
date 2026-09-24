# Reference import

What happens to a picture between the file you chose and the indexed canvas an
agent can work from, why the steps run in the order they do, and when to change
them.

This pipeline is called conform, and it used to run on every image a diffusion
model produced, as a repair step. It is not a repair step any more. Nothing in
Bitwright generates an image that needs conforming; the pixels an agent writes
are palette indices and are correct by construction. Conform survives because
the problem it solves turned out not to be about generated images at all. Any
picture that arrives from outside — a screenshot, a mock-up someone painted, a
sprite scaled up for a store page, a photograph of a sketch — is an image _of_
pixel art rather than pixel art, and conform is what turns it into the second
thing.

See
[decision 0012](../architecture/decisions/0012-pivot-to-an-agent-driven-pixel-editor.md)
for why that distinction ended up mattering so much, and
[the pixel editing plan](../architecture/pixel-editing-plan.md) for the
mathematics of each step.

## What you get back

An imported reference produces two things, and both are for the agent as much
as for you:

- **An indexed image** at the real cell size, with a hard alpha edge and exactly
  the colours the palette contains.
- **The palette itself**, as a list of colours in descending order of how much
  of the image they cover, which becomes the starting point for the asset's
  ramps.

An agent asked to draw in a style works from those two, not from the original
picture. That is the point of importing rather than simply looking.

## The steps

```
the file you chose
   |
   v
[1] separate the subject from the background   -> a soft alpha mask
   |
   v
[2] find the cell size and the phase           -> how big a pixel really is
   |
   v
[3] one colour per cell                        -> an N by M image
   |
   v
[4] build or load the palette                  -> K colours, chosen in Oklab
   |
   v
[5] snap every cell to a palette entry         -> exactly K colours
   |
   v
[6] clean up                                   -> hard alpha, no halo, no specks
   |
   v
a reference you can draw from
```

The order is the substance of the design. The background has to go first,
because a cell that straddles the silhouette must not let background pixels vote
on what colour the subject is there. The grid has to be found before anything is
resampled, because resampling destroys the evidence that says where the grid
was. The palette is built after the downsample and before the snap, so that it
is derived from the colours the image actually resolved to rather than from the
blend along every edge.

## Finding the grid

This is the step that makes the difference between conform and any tool that
asks you for a scale factor.

An image that was drawn at 64 by 64 and is now 512 pixels wide does not have
blocks exactly eight pixels across. It has blocks that are near enough eight to
read as a grid, drifting by a pixel or two as they go, usually starting at a
fractional offset rather than at zero. Dividing by eight lands half the cells on
a boundary.

Conform measures instead. It takes the gradient magnitude along each axis and
reads the periodicity out of its discrete Fourier transform, which gives the
cell size; then it scores every candidate offset against the measured edges to
find the phase. You can tell it the target size if you know it, and it finds
only the phase. If you do not, it finds both.

When the measurement is weak — a photograph, a heavily compressed image, art
that was never on a grid — the result carries `conform.grid_not_found` and
conform falls back to a plain resample. That is reported rather than hidden,
because a reference imported from a grid that was not there is worth knowing
about before an agent starts copying it.

## The palette

Pick a size and conform derives the palette by weighted k-means in Oklab, where
the weight is how many cells hold that colour. Oklab rather than sRGB is not a
detail: in sRGB, two greens a person cannot tell apart sit further from each
other than a mid blue and a mid purple, so a clustering that minimises sRGB
distance spends its colours in the wrong places. Oklab's distances correspond to
what the eye reports, so the same clustering keeps the distinctions that matter.

| Colours    | Reads as                         |
| ---------- | -------------------------------- |
| 4 to 8     | Game Boy or one-bit style        |
| 16         | Classic 8-bit                    |
| 32         | Balanced, and the default        |
| 64 or more | Modern pixel art, softer shading |

You can also load a named palette and snap to that instead, which is what to do
when the reference is a mood board and the palette is already decided elsewhere.
The snap is nearest-neighbour in Oklab, for the same reason the clustering is.

## Dithering

Dithering trades banding for noise, and at sprite sizes noise usually loses,
which is why it is off by default. Turn it on for a reference with a wide smooth
gradient — a sky, a large metal surface — where the alternative is three visible
bands. Ordered Bayer patterns and Floyd-Steinberg are both available; ordered
patterns are the ones that look deliberate at a small size, because the texture
repeats rather than wandering.

## Background removal

The background is cleared by flood filling from the four corners. A pixel is
cleared when it is connected to a corner and within the tolerance of that
corner's colour.

Filling from the corners rather than matching a colour globally is what stops a
subject that contains the background colour from developing holes: an enclosed
region is not connected to a corner, so it stays.

Tolerance defaults to 12 out of 255. Raise it when a faint halo remains around
the subject; lower it when part of the subject is being eaten. When the corners
disagree with each other the result carries `conform.background_uncertain`,
which usually means the picture has a background that is not flat, and the
honest answer there is to cut it out in another tool first.

## Cleaning up

Three things happen after the snap, and each exists because of a specific way
that an imported image looks wrong at its real size.

**Alpha becomes binary.** Every cell is either in the sprite or out of it.
Partial alpha is what a resampled edge leaves behind, and it reads as a blurred
outline the moment the image is scaled back up.

**The halo goes.** A pixel on the silhouette that was averaged with the
background carries the background's colour at full alpha once the alpha is
hardened. Conform either bleeds the nearest subject colour outwards into those
cells or erodes them away; bleeding is the default, because it keeps the
silhouette the artist drew.

**Specks go.** A single isolated cell of a colour nothing around it uses is
almost always an artefact of the vote rather than a decision, and it is replaced
by the majority of its neighbours.

## Turning it all off

Set the palette size to empty, leave the target size unset, and turn background
removal off, and the image comes through with only the grid detection applied.
That is the setting for a reference you want to look at rather than draw from —
or for checking what conform thinks the grid is before deciding what to do about
it.
