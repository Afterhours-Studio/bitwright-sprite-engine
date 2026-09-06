# Pixel editing plan

How a diffusion image is turned into real pixel art, and where the controls for
doing that and for touching up the result belong in the interface.

This is a plan, not a decision record. It is written to be split into separable
pieces of work and handed out. Anything in it that changes a rule the project
has already written down is called out as such and belongs in an ADR of its own
before it is built.

## The problem

A diffusion model does not produce pixel art. It produces an image of pixel
art. At a glance the two look the same; measured, they are not:

- **The grid drifts.** A model asked for a 64 by 64 sprite at 512 pixels lays
  down blocks that are near enough 8 pixels wide to read as a grid and not
  exactly 8 pixels wide anywhere. Block boundaries wander by a pixel or two
  across the image, and the whole grid usually starts at a fractional offset
  rather than at zero.
- **The edges are soft.** Every block boundary carries one or two pixels of
  blend, because the model was trained on images that had been resampled. The
  same softness sits on the silhouette, where a background remover then leaves
  a ring of half-subject, half-background pixels at full alpha.
- **There are far too many colours, and they are close to right rather than
  right.** A 512 pixel render of a 16 colour sprite typically contains tens of
  thousands of distinct colours, most of them within a couple of units of one
  of the sixteen.

None of this shows at a glance and all of it shows the moment the image is
imported into a game engine at its real size. Fixing it is the core of this
plan; the editing tools exist so that what the fix cannot decide, a person can.

## What already exists

A large part of this feature is surfacing and extending machinery that is
already in the repository. It is worth being precise about which part.

| Capability                   | Where it is                                             | State                                              |
| ---------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| Background removal           | `pipeline/postprocess/background.py`                    | Corner flood fill, per-channel tolerance           |
| Palette reduction            | `pipeline/postprocess/quantize.py`, `quantize()`        | Pillow `Image.quantize`, sRGB, alpha restored      |
| Dithering                    | same, a flag on `quantize()`                            | Floyd-Steinberg only, applied during quantization  |
| Grid snapping                | same, `snap_to_grid()`                                  | Box downscale then nearest upscale, integer factor |
| Sheet packing                | `pipeline/postprocess/grid.py`                          | Uniform grid, frame rectangles reported            |
| The options on the wire      | `api/schemas/generation.py`, `PostProcessBody`          | Four fields, sent with every generate call         |
| The options in the interface | `ParameterPanel.tsx` and the post-processing dock entry | Both places expose the same four                   |
| Tool and shape selection     | `stores/useEditorStore.ts`, the dock's lead cluster     | Selection only; nothing consumes it yet            |
| Canvas                       | `features/generation/SpriteCanvas.tsx`                  | Checkerboard well, nearest-neighbour scaling       |
| Undo and redo menu items     | `TitleBar.tsx`, the Edit group                          | Present and disabled                               |

So the engine already does a weak version of three of the six steps below. The
work is not a parallel system; it is replacing `snap_to_grid` with something
that finds the grid rather than being told a factor, replacing `quantize` with
something that works in a perceptual space, and adding the steps between them.

Two things about the existing pipeline are wrong for this purpose and are
changed by this plan:

**The order is wrong.** `apply()` runs snap, then quantize, then background
removal. Background removal has to run first, because a cell that straddles the
silhouette must not let background pixels vote on the subject's colour. The
current order is correct for the existing box filter, which averages everything
in the cell regardless; it is wrong for a modal vote. The docstring's reasoning
(background removal last so it sees final colours) stops applying once the
background decision is a hard alpha threshold rather than a colour match.

**`snap_to_grid` takes a factor, not a target.** The user thinks in "I want
64 by 64", not "divide by 8". A factor also cannot express a fractional cell
size, which is what a drifting grid actually has. The new entry point takes the
target dimensions and finds the factor itself.

---

# Part 1: Conform

One operation, `conform`, that takes the image the model produced and returns
an image that is genuinely `N` by `M` pixels, on a real palette, with a hard
alpha edge. Six steps, in this order.

```
model output
   |
   v
[1] separate subject from background      -> a soft alpha mask
   |
   v
[2] find the cell size and the phase      -> sx, sy, phix, phiy, confidence
   |
   v
[3] one colour per cell                   -> an N x M image
   |
   v
[4] build or load the palette             -> K colours, in Oklab
   |
   v
[5] snap every cell to a palette entry    -> N x M, exactly K colours
   |
   v
[6] clean up                              -> hard alpha, no halo, no specks
   |
   v
a sprite
```

Every step runs in the Python sidecar. None of it runs in the frontend. The
reasoning is in "Where the work runs" below.

## Step 1: Separate the subject from the background

The existing corner flood fill stays, and runs first rather than last. Two
changes:

- It records the background colour it filled from, and returns it alongside the
  image. Step 6 needs it to recognise halo pixels, and there is no way to
  recover it once the pixels are transparent.
- It returns a soft mask rather than a binary one. A pixel within tolerance is
  fully transparent, a pixel outside it keeps its alpha, and the flood fill
  additionally records, per pixel, how close it came to the tolerance. The
  cheap version of this is to run the fill twice, at `tolerance` and at
  `tolerance * 2`, and treat the difference as the uncertain band.

The soft mask is not shown to the user. It exists so that step 3 can weight
votes by it and step 6 can threshold it once, at the target resolution, where a
single pixel is a decision rather than a fraction of one.

For a photographic background the flood fill is not enough and a segmentation
model is needed. `MODELS.md` already carries `rembg-u2net` for that. It is out
of scope here; conform should report `conform.background_uncertain` as a
warning when the fill clears less than 5 percent or more than 95 percent of the
image, which is the signature of a fill that either found nothing or ate
everything.

## Step 2: Find the cell size and the phase

This is the step the current code does not have at all, and it is what makes
the difference between "looks like pixel art" and "is pixel art".

### The measurement

Convert the image to Oklab (the conversion is in "Colour space" below). For
every column boundary compute the edge energy

```
e[x] = sum over y of  || I[x, y] - I[x-1, y] ||     for x = 1 .. W-1
e[0] = 0
```

where the norm is Euclidean distance in Oklab and pixels the mask calls
background contribute zero. If the image really is a scaled-up grid, `e` is a
comb: large at every cell boundary, near zero inside a cell.

### Finding the phase, given a cell count

For a target of `N` cells across a `W` pixel image the nominal cell size is
`s = W / N`, a float, not an integer. The boundaries sit at `phi + k*s`. Rather
than searching for `phi`, read it off a single DFT bin:

```
Z = sum over x of  e[x] * exp(-2*pi*i * x * N / W)

strength = |Z| / sum(e)
phi      = (arg(Z) / (2*pi)) * s,  reduced into [0, s)
```

`strength` is the fraction of the edge energy that lines up with a comb of
period `s`. It is a confidence number in 0 to 1 and it is the value to show the
user. On a genuine upscaled sprite it lands above 0.4; on a photograph it sits
below 0.1. Below a threshold (0.15 is a reasonable starting point) conform
should still run but warn `conform.grid_not_found`, because the phase it
computed is noise and the user is better served by nearest-neighbour sampling
at an assumed phase of zero.

The sign convention on `arg(Z)` is easy to get backwards. Fix it with a test
that scales a known 8 by 8 image by a known factor with a known offset and
asserts the recovered phase, rather than by reasoning about it.

### Finding the cell count, when it is not given

Sweep `N` over the plausible range (8 to `min(W, H) / 2`), compute `strength(N)`
for each, and take the peak. One trap: a comb of period `s` also has energy at
every harmonic, so `strength(2N)` and `strength(3N)` are high as well. The rule
is therefore **the smallest `N` whose strength is within 10 percent of the
best**, not the argmax. Reporting 128 for an image whose real grid is 64 is the
common failure of every naive version of this.

Do rows and columns independently. Do not assume square. Report both, and warn
`conform.grid_anisotropic` when the two cell sizes differ by more than 3
percent, because that usually means the image was resized non-uniformly at some
point and the user should know.

### Why this rather than the published alternatives

Two other approaches are in circulation and both cost a dependency this project
does not have:

- **Canny plus a probabilistic Hough transform**, clustering near-vertical and
  near-horizontal lines and taking the median spacing. This is what
  `KennethJAllen/proper-pixel-art` does. It works and it needs OpenCV.
- **`scipy.signal.find_peaks` on the summed adjacent-pixel differences**, then
  the median of `np.diff(peaks)`. This is what `Astropulse/pixeldetector` does.
  It works, it needs SciPy, and taking a median of peak spacings throws away the
  phase, which then has to be recovered separately.

The DFT bin gives the spacing and the phase from one number, gives a confidence
measure for free, and needs nothing but NumPy. That is the whole argument.

## Step 3: One colour per cell

Cell `(i, j)` covers `x` in `[phix + i*sx, phix + (i+1)*sx)` and `y` likewise.
The output pixel is the **modal colour of the cell's interior**, not the mean
and not a sample.

### Pre-quantise, or the mode is meaningless

In a smooth image no two pixels share an exact colour, so the mode over raw
8-bit RGB triples is an arbitrary singleton. Reduce the whole image to
`K_pre = 128` colours first. This palette is thrown away; it exists only to make
"most common colour in this cell" a question with an answer. `Astropulse` does
the same thing and it is the step that is easiest to leave out and hardest to
debug the absence of.

Pillow's `Image.quantize(colors=128, method=Quantize.FASTOCTREE)` is adequate
here and is the one place sRGB quantization is acceptable, because the result
is discarded.

### Inset the sampling region

Sample only the central portion of each cell. With `margin = 0.25 * s` on each
side the vote runs over the middle half of the cell.

The anti-aliased transition between two adjacent cells occupies the outermost
pixel or so of each. Insetting removes those pixels from the vote, which does
two things: it stops a blend colour from ever winning, and it makes the result
insensitive to a phase error of up to a quarter of a cell. Given that step 2's
phase is a estimate, that tolerance is the difference between a correct result
and a result that is correct on most of the image.

Guard: when `s < 4` the inset leaves fewer than two pixels per axis. Use the
full cell then and accept the sensitivity. When `s < 1.5` the image is already
at or below the target size and the downsample should be skipped entirely, with
`conform.already_at_size` reported.

### The vote

Build a weighted histogram over the inset pixels. The weight of a pixel is its
mask alpha times its coverage of the inset region (fractional at the boundary,
since `s` is not an integer). Take the argmax.

Two fallbacks:

- **No dominant colour.** If the winner's share of the total weight is below
  `t_mode = 0.4`, the cell has no majority. Take the weight-weighted mean in
  Oklab instead. This is the only place in the pipeline where a colour that was
  not in the source is invented, and step 5 quantises it away immediately.
- **The cell is entirely background.** Weight sums to zero. The output pixel is
  transparent and has no colour.

### The cell's alpha

Separately from the colour, take the coverage-weighted mean of the mask alpha
over the **full** cell, not the inset one. The silhouette is defined at the cell
boundary, so insetting there would shrink the sprite by half a pixel on every
side. Threshold at `a_cut = 0.5`: above it the output pixel is fully opaque,
below it fully transparent. Semi-transparent output is available as an option
and is off by default, because a sprite with soft alpha edges is exactly the
thing this operation exists to remove.

### Why not nearest neighbour, and why not area average

**Nearest neighbour** takes `I[round(phix + (i+0.5)*sx), ...]` — one source
pixel. It is exact if and only if the phase is exact and the cell is flat. A
diffusion image's cells are neither: interiors carry a gentle gradient and
boundaries carry a blend. A half-pixel phase error puts the sample on a
boundary, and the output pixel is then a colour that belongs to neither of the
two cells it sits between. The failure is not graceful. One wrong sample is one
wrong pixel, which is 0.02 percent of a 64 by 64 sprite and 100 percent
visible.

**Area average** — which is what Pillow's `BOX` filter and therefore the
current `snap_to_grid` does — is stable against phase error and invents colours
everywhere. Every cell containing part of an edge returns the blend of the two
sides. A 64 by 64 character sprite is mostly edges, so most cells come back as
blends: the image goes soft, and the distinct colour count goes _up_ rather
than down. The palette reduction that follows then has to choose between the
real colours and the invented in-between ones, and it has no way to tell them
apart. This is the direct mechanical cause of "looks like pixel art but the
colours are wrong".

**The mode** returns a colour that exists in the source and that a majority of
the cell agrees on. It keeps hard edges: a cell that is 70 percent body and 30
percent outline returns body, not a blend. Its weakness is genuine dithering in
the source, where a 50/50 checkerboard has no majority and the answer is
arbitrary; the `t_mode` fallback catches that and returns the mean, which is
what a viewer sees when they look at a dither anyway.

## Step 4: Build or load the palette

Two modes, both operating in Oklab.

### Derived palette of size K

1. Histogram the downsampled image. A 64 by 64 sprite has at most 4096 distinct
   colours, so this is small and everything downstream can be exact rather than
   sampled.
2. Convert each distinct colour to Oklab, carrying its pixel count as a weight.
3. **Weighted median cut.** Take the box with the largest **non-normalised**
   weighted sum of squared error, and cut it along the axis with the largest
   weighted sum of squared error. The representative colour of a box is the
   frequency-weighted mean of its members.

   All three of those are deliberate and all three differ from the textbook
   version, which splits the box with the longest axis at the median along that
   axis. Normalising the error per box makes the result worse, which is
   counterintuitive until stated the right way round: the objective is to
   minimise error over the whole image, so a small partition must not be given
   the same weight as a large one.

4. **K-means refinement.** Run Lloyd's algorithm for 10 to 20 iterations,
   seeded from the median-cut centroids, weighted by pixel counts. At 4096
   distinct colours this is milliseconds and it is what closes most of the gap
   between plain median cut and a good quantiser.
5. Convert the centroids back to sRGB and round to 8 bits.

**Known defect, and the knob for it.** At `K < 16` a perceptual-space
quantiser desaturates, because lightness dominates the Oklab distance and the
clusters spread along L at the expense of hue. Mitigate by scaling the `a` and
`b` axes by a chroma weight `w_c` before clustering: 1.0 by default, 1.5 to 2.0
for small `K`. Do not expose this until the desaturation is observed; it is a
knob nobody can name.

### Fixed named palette

Snap each cell colour to the nearest entry by Euclidean distance in Oklab. That
is the whole algorithm; it is about five lines with NumPy. Optionally restrict
the reachable entries to the `K` nearest to the image's own derived palette, so
that a 64 colour palette does not spend an entry on one stray pixel.

### Why sRGB is the wrong space, concretely

Euclidean distance in sRGB is not perceived distance. Two greens a viewer
cannot separate are far apart in sRGB and get two palette slots; a dark blue and
a dark purple that are obviously different are close and get merged. Reducing a
sprite to 16 colours in sRGB reliably spends three slots on the highlight and
none on the shadow.

Oklab's `L` is perceived lightness and its `a`/`b` are hue-uniform, so a box of
a given size in Oklab is a set of colours a viewer genuinely cannot separate.
This is the same argument `tokens.css` and ADR 0005 already make for the
interface's own colours, applied to image data instead. There is no reason for
the application to reason about colour in two different spaces.

### Colour space conversion

Oklab from linear sRGB is two 3 by 3 matrices with a cube root between them:

```
[l]   [0.4122214708  0.5363325363  0.0514459929] [r]
[m] = [0.2119034982  0.6806995451  0.1073969566] [g]
[s]   [0.0883024619  0.2817188376  0.6299787005] [b]

l' = cbrt(l),  m' = cbrt(m),  s' = cbrt(s)

[L]   [0.2104542553   0.7936177850  -0.0040720468] [l']
[a] = [1.9779984951  -2.4285922050   0.4505937099] [m']
[b]   [0.0259040371   0.7827717662  -0.8086757660] [s']
```

The inverse cubes and applies the inverted matrices in reverse order. Remember
the sRGB transfer function on the way in and out; skipping it is the most
common bug in an Oklab implementation and it looks almost right.

This is about thirty lines of NumPy and does not need a dependency. Do not
reach for a colour library for two matrices.

### Why not Pillow's quantize for the final palette

`Image.quantize(colors, method, kmeans, palette, dither)` is a reasonable
default and is not the right final answer here:

- It works in sRGB.
- On an RGBA image it silently switches to `FASTOCTREE`, because `MEDIANCUT`
  and `MAXCOVERAGE` do not support RGBA. The current code sidesteps that by
  dropping alpha, quantising in RGB, and putting the alpha band back — which is
  correct as far as it goes and means the current default is sRGB median cut
  with the longest-axis heuristic.
- `LIBIMAGEQUANT` is the best method it offers and is not present. libimagequant
  is GPL-3.0, and for that reason Pillow's published wheels on every platform
  are built without it. Enabling it would mean building Pillow from source in
  the sidecar bundle and taking a GPL-3.0 dependency, which
  `scripts/check-licenses.py` denies. See "Dependencies and licences".

`Image.quantize(palette=some_image)` quantises to another image's palette and is
the natural mechanism for named-palette snapping. It is still sRGB. Prefer the
hand-written Oklab nearest-entry snap.

## Step 5: Snap to the palette

Nearest palette entry in Oklab, per pixel, with the same optional chroma
weighting used to build the palette. With `K <= 256` and at most 4096 pixels
this is a single broadcast distance matrix.

The output is guaranteed to contain at most `K` distinct colours plus full
transparency. Assert that in a test; it is the property the whole operation
promises and it is cheap to check.

## Step 6: Clean up

### Alpha

Already hard from step 3. For the path that skips downsampling (source already
at target size), apply the threshold here instead: `alpha >= a_cut` becomes 255,
below becomes 0. Expose `a_cut` from 0.05 to 0.95, default 0.5.

### Halo removal

A background remover leaves pixels whose RGB is a blend of subject and old
background, at full alpha. They read as a light or dark rim one pixel wide.

Two mechanisms, and the recommendation is the second:

- **Erode.** Clear any opaque pixel that has five or more transparent
  neighbours out of eight and whose colour is within tolerance of the recorded
  background colour from step 1. This removes the halo by removing the pixels.
  It can eat a thin feature — an antenna, a sword tip — and there is no way for
  it to know it should not.
- **Bleed.** Keep the pixel and replace its RGB with the modal colour of its
  opaque neighbours, leaving alpha alone. The halo goes and the silhouette does
  not move. This is what a defringe filter does.

Default to bleed, offer erode, and never run both. Bleed cannot make the sprite
worse than it already is, which is the property that decides which one is the
default.

### Despeckle

Find 4-connected components of identical colour. Replace any component of size
`<= n_speck` whose neighbouring pixels are all one other colour with that
colour. Default `n_speck = 1`; expose 0 (off), 1, and 2.

Stop at 1 by default. A two-pixel component in a 64 by 64 sprite is very often
deliberate — an eye highlight, a rivet, a buckle — and removing it is worse
than leaving a stray pixel that the user can erase in two seconds with a tool
that now exists.

### Outline

Not cleanup; a style choice, and it belongs behind its own toggle, off by
default. Take the boundary of the opaque mask and either recolour those cells or
grow one cell outward, using the darkest palette entry or a colour the user
picks.

Growing outward changes the sprite's effective bounds. On a sprite that already
touches the canvas edge the new outline is clipped, which looks like a bug. Warn
`conform.outline_clipped` when that happens rather than silently producing it.

## Dithering

The existing option applies Floyd-Steinberg inside Pillow's quantize, before any
downsampling. In the conform path that is wrong twice over: a dither is by
construction a pattern with no local majority, so the modal vote in step 3
destroys it completely, and what survives is noise.

Dithering belongs **after** the downsample, at the target resolution, as part of
step 5.

| Mode                       | Character                                         | Use                                      |
| -------------------------- | ------------------------------------------------- | ---------------------------------------- |
| None                       | Flat bands                                        | Default. Most sprites.                   |
| Ordered, Bayer 2x2/4x4/8x8 | Fixed threshold matrix, regular repeating texture | Sprites, tiles, anything animated        |
| Floyd-Steinberg            | Error diffusion, organic, no visible grid         | Large single images with a wide gradient |

Recommend ordered Bayer over Floyd-Steinberg for sprite work, and for a reason
that is mechanical rather than aesthetic: error diffusion is content-dependent,
so two frames of a walk cycle that differ by three pixels dither differently
across the whole sprite and the flat areas crawl during playback. An ordered
matrix is keyed to the pixel grid and is identical in every frame.

Keep none as the default. At 64 by 64 a dither costs pixels the silhouette
needs.

## Named palettes and licensing

The palettes pixel artists actually reach for are DawnBringer 16 and 32,
PICO-8's 16, Endesga 32 and 64, and AAP-64, plus the hardware palettes (NES,
Game Boy, MSX1). Lospec is where they are distributed.

**This needs a decision before anything ships.** A palette is a short list of
hex values, which is close to the line where copyright stops applying — but the
project's stated position is that it is careful about licences, and "probably
not copyrightable" is not the same as a grant. What is known:

- Lospec's palette pages carry no licence statement. The DawnBringer 16 page
  states the author and the sixteen hex values and says nothing about terms.
- The site's general position, stated outside the individual pages, is that
  palettes are free to use with optional credit. That is a site policy, not a
  licence from the palette's author.
- PICO-8's palette is part of a commercial product. The hardware palettes are
  measurements of hardware, which is a different question again.

Recommendation, in order of preference:

1. **Ship no third-party palette in the repository.** Ship the mechanism —
   load, save, snap — plus one palette the project authors itself, and import
   `.gpl`, `.hex`, `.pal` and `.ase` from disk. Every named palette the user
   wants is one file drop away and the project distributes none of them.
2. If a palette is to be shipped, get the author's permission in writing and
   record it in `THIRD_PARTY_LICENSES.md` under a new "Bundled data" heading,
   the same way the PyInstaller exemption is recorded.

Option 1 is a smaller piece of work than option 2 and carries no risk. Take it.

The import formats are worth listing because they are all trivial:

| Format | Shape                                                                                        |
| ------ | -------------------------------------------------------------------------------------------- |
| `.hex` | One six-digit hex value per line                                                             |
| `.gpl` | GIMP palette: a header, then `R G B Name` lines                                              |
| `.pal` | JASC-PAL: three header lines, then `R G B`                                                   |
| `.ase` | Aseprite's binary palette; also the Adobe swatch format                                      |
| `.png` | One pixel per colour, which is how Lospec and ComfyUI-PixelArt-Detector both distribute them |

Support `.hex`, `.gpl` and `.png` first. They cover everything and none of them
needs a parser worth the name.

## Where the work runs

**Everything in Part 1 is in the sidecar.** The rules:

- Anything that touches every pixel of the source image is Python. The source is
  512 by 512 or larger; a k-means pass over it in JavaScript would block the
  webview's single thread and there is no reason to write a second
  implementation of median cut.
- Anything that touches only the target image — 64 by 64, 4096 pixels — can be
  either, and should be Python anyway, so that there is exactly one definition
  of what conform does.
- The frontend renders, overlays a grid, tracks a cursor, and edits individual
  pixels in response to a pointer. That is the whole frontend responsibility.

The one place this gets argued is the palette. The colour picker needs to show
the palette, and the editor needs to snap a painted pixel to it. Both are
frontend concerns and both need the palette as data. Answer: conform returns the
palette it used in its response, as a list of hex values, and the frontend
treats it as data it was given rather than something it computes.

## The API

A new route, because conform is not generation and coupling it to
`POST /v1/generate` would mean re-running the model to change a palette.

```
POST /v1/conform
```

Request (`ConformBody`, camelCase on the wire, as every other schema is):

| Field                 | Type                                                             | Default   | Notes                                                       |
| --------------------- | ---------------------------------------------------------------- | --------- | ----------------------------------------------------------- |
| `image`               | `str`                                                            | required  | Base64 PNG, no data URL prefix                              |
| `width`               | `int \| None`                                                    | `None`    | Target cells across. `None` asks conform to detect it       |
| `height`              | `int \| None`                                                    | `None`    | Target cells down                                           |
| `removeBackground`    | `bool`                                                           | `true`    |                                                             |
| `backgroundTolerance` | `int`                                                            | `12`      | 0 to 255                                                    |
| `paletteSize`         | `int \| None`                                                    | `32`      | 2 to 256. `None` keeps every colour the downsample produced |
| `paletteId`           | `str \| None`                                                    | `None`    | A loaded named palette. Overrides `paletteSize`             |
| `dither`              | `"none" \| "bayer2" \| "bayer4" \| "bayer8" \| "floydSteinberg"` | `"none"`  |                                                             |
| `alphaThreshold`      | `float`                                                          | `0.5`     | 0.05 to 0.95                                                |
| `halo`                | `"none" \| "bleed" \| "erode"`                                   | `"bleed"` |                                                             |
| `despeckle`           | `int`                                                            | `1`       | 0 to 2                                                      |
| `outline`             | `str \| None`                                                    | `None`    | Hex colour, or `null` for no outline                        |

Response (`ConformResponse`):

| Field        | Type           | Notes                                                       |
| ------------ | -------------- | ----------------------------------------------------------- |
| `image`      | `SpriteImage`  | The conformed sprite, reusing the existing schema           |
| `palette`    | `list[str]`    | Hex values actually used, in descending frequency order     |
| `detected`   | `DetectedGrid` | `cellWidth`, `cellHeight`, `phaseX`, `phaseY`, `confidence` |
| `durationMs` | `int`          |                                                             |
| `warnings`   | `list[str]`    | Stable reason codes, as `GenerateResponse` already carries  |

The warning codes named above — `conform.grid_not_found`,
`conform.grid_anisotropic`, `conform.background_uncertain`,
`conform.already_at_size`, `conform.outline_clipped` — go into the `errors`
namespace like every other code, per `docs/development/i18n.md`.

Two supporting routes for palettes:

```
GET  /v1/palettes            list loaded palettes
POST /v1/palettes/import     import one from a file the shell read
```

### The shell hop

The webview is not a client of the engine; every call goes through a Rust
command (`apps/desktop/src-tauri/src/commands.rs`) and `engine::call`. Conform
needs `engine_conform`, `engine_palettes`, and `engine_import_palette`, plus
the `lib/tauri.ts` and `lib/api.ts` wrappers and the types in
`types/engine.ts`. That is mechanical and small.

One thing to size before building it: a 512 by 512 PNG base64-encoded is roughly
half a megabyte of JSON, travelling webview to Rust to Python and back. That is
fine for one press. It is not fine for a live preview that re-runs on every
slider drag. Debounce the preview at 300 ms and show the last result until the
next arrives, or make the preview a smaller-scale approximation. Decide this
before the UI is built, because it changes whether the settings live in a panel
(live preview) or behind a button (explicit run).

---

# Part 2: What a pixel editor normally offers

The point of this section is that someone who has used Aseprite should not have
to learn where anything is. Where this application has a reason to differ, the
reason is stated.

## Palette

**Where it lives.** Aseprite puts the palette in a vertical strip down the left
edge by default, with the colour bar directly above it; the strip can be moved
to the right or laid out horizontally. Piskel puts it in the right-hand column
under the colour picker. Pixelorama puts it in a dockable panel, right-hand
side by default. LibreSprite follows Aseprite.

The common factor is not the edge; it is that the palette is **always visible
while drawing** and never behind a tab or a menu. That is the constraint worth
carrying over.

**How entries are picked.** Universally: left click sets the foreground colour,
right click sets the background colour, and `X` swaps the two. The swap key is
unanimous across every editor that has the foreground/background concept at all,
which makes it one of the two bindings safe to treat as non-negotiable (the
other is cursor-anchored zoom, below).

**Palette files.** All of them load and save GIMP `.gpl`; Aseprite and
Pixelorama also handle `.ase`, `.pal`, `.act` and a PNG whose pixels are the
palette. Note that `.gpl` carries a **name per entry**, not just a triple, and
the shipped palettes use it: LibreSprite's `pico-8.gpl` names its sixteen
entries `black`, `dark_blue`, `dark_purple`, and so on. A loader that drops the
names loses information the file was carrying.

**Bundled presets are not universal, and the exception is deliberate.** Aseprite
and LibreSprite ship a browser of several dozen, verified counts including
`db16` at 16, `db32` at 32, `pico-8` at 16, `commodore64` at 16, `nes` at 56 and
`gameboy` at 4. Pixelorama ships a smaller set. **Piskel ships none on
purpose**: two separate requests for a bundled famous-palettes database, issues
693 and 824, were closed as not planned. That is a direct precedent for the
recommendation in open question 4 — an editor can be complete without shipping
anyone else's palette.

## Colour picker

**Modes.** Aseprite's colour bar offers a colour wheel (normal, RYB and
normal-with-shades variants), an RGB tab, an HSV tab, an HSL tab, and a grey
tab, selected by small tabs inside the picker itself. Piskel embeds
`spectrum.js` configured as a saturation/value square plus a hue slider plus a
hex input, with `showButtons: false`; a `beforeShow` callback pins alpha to 1,
so Piskel has no alpha slider at all and transparency is reachable only through
one hardcoded `rgba(0,0,0,0)` swatch. Pixelorama offers a wheel plus RGB/HSV
sliders and a hex field.

The two that every one of them has are **a two-dimensional field plus a hue
slider**, and **a hex input**. Everything else is a preference. A hex field is
non-negotiable: it is how a colour gets copied from anywhere else.

**Recent colours.** Aseprite keeps a recent-colours strip in the colour bar.
**Piskel does not** — its swatch area is the palette and the two active colours,
with the first ten entries carrying number badges bound to `1`-`9` and `0`. So a
recent strip is a nice-to-have rather than a convention; it costs one row and it
is worth having, but its absence is not a gap.

**The eyedropper.** In all of them, the eyedropper sets the foreground colour
from the canvas and does _not_ add to the palette. Holding `Alt` while any
paint tool is active temporarily switches to the eyedropper — this is the
single most-used shortcut in pixel art and is worth implementing before almost
anything else.

## Brush settings

**Where they live.** Aseprite puts them in a **context bar** sitting directly
above the sprite editor: brush type, brush angle, brush size, ink mode,
dynamics, opacity, and the pixel-perfect toggle. Its contents change with the
active tool, so a size control appears only for tools that have a size, and the
paint bucket shows tolerance and contiguous instead. Brush size is also
adjustable by holding `Ctrl+Alt` and dragging on the canvas.
(<https://www.aseprite.org/docs/context-bar/>) Pixelorama uses a left-hand tool
options panel below the toolbox. Piskel has a compact size selector in the tool
row.

The pattern is the same in all three: **brush settings sit adjacent to the tool
selector, not in a general-purpose panel.** They are a property of the tool, and
putting them next to it is what makes that legible.

**Ranges.** Brush size is in image pixels, `[` and `]` step it, and the numbers
people actually use for sprite work are 1, 2, 3 and 4. The caps are lower than
the internet claims: Aseprite and LibreSprite both hold `kMaxBrushSize = 64` in
`src/doc/brush.h`, and Piskel caps at 32 behind a four-button picker that shows
a numeric badge once the size passes 4. (A widely mirrored third-party wiki
states a 1 to 999 range for LibreSprite; the header contradicts it, as does an
open proposal complaining about the 64 cap. Do not cite that wiki for numbers.)
Shapes are circle, square, and a line at a settable angle.

**A third freehand mode exists.** LibreSprite's `FreehandAlgorithm` enum is
`{ DEFAULT (= REGULAR) = 0, PIXEL_PERFECT = 1, DOTS = 2 }`. `DOTS` lays down
isolated points rather than a connected stroke and is not exposed in Aseprite's
context bar. It is cheap to add and worth knowing about; it is not needed for a
first version.

**Pixel-perfect mode.** A stroke drawn freehand at high zoom leaves L-shaped
corner artifacts where a diagonal changes direction: three pixels where the eye
wants two. Pixel-perfect mode removes the middle pixel of any such L as the
stroke is drawn. Aseprite has it as a context-bar toggle and Pixelorama calls it
the same thing.

The condition, verified identically in the Aseprite and LibreSprite trees, is on
the last three points of the stroke: when point `n-2` and point `n` are diagonal
neighbours of point `n-1` and each is orthogonally adjacent to it, the middle
point is redundant and is dropped.

The implementation detail that makes it work **interactively** is the part that
is easy to miss and expensive to retrofit: the newest point has to be drawn
immediately, so the area it covers is saved before it is drawn, and when a
later point reveals that it was an L-corner the saved area is restored to
un-draw it. A version that waits for the third point before drawing anything
feels laggy, and a version that cannot un-draw cannot correct.

**Piskel deliberately does not have it** — issue 624 was closed as not planned.
So it is not universal. It should still be on by default for the pencil here,
because the alternative is a user hand-erasing every diagonal.

**Symmetry and tiled mode.** Aseprite has a symmetry toggle (horizontal,
vertical, both) with draggable axes on the canvas, and a tiled mode reached from
the View menu. Pixelorama has both. Both are second-order and can wait.

## Grid display

**How it is shown.** All of them draw a one-pixel line at every cell boundary,
in a colour the user can set, and all of them **suppress the grid below a zoom
threshold**, because at 200 percent a line per image pixel is a solid field of
lines rather than a grid.

The two approaches, both read out of the source rather than the manuals, since
neither is documented:

- **Aseprite fades rather than switches.** The pixel grid is not drawn at all at
  or below 200 percent, and above that its opacity ramps to full by 1600
  percent: `alpha * (scale - 2) / 14`. The configurable cell grid fades on the
  grid's projected on-screen size instead, `alpha * len / 32`, and is skipped
  entirely once the projected cell is under 2 pixels or the resulting alpha
  falls to 8 or less.
- **Piskel switches, on projected spacing.** The grid is suppressed when
  `zoom * gridSpacing < 6` — that is, when a cell would be under 6 screen pixels
  across. A companion loop also thins the line, `while (zoom < 6 * gridWidth)
gridWidth--`, so the line never eats a meaningful fraction of a cell.

**Take Piskel's rule.** It is one comparison against a number that means
something physical, it needs no per-zoom opacity blending, and it produces the
same outcome. Six screen pixels per image pixel is the threshold used in Part 3.

**Two grids, not one.** Aseprite distinguishes the **pixel grid** — one line per
image pixel, toggled from the View menu — from the **grid**, a configurable tile
grid with its own width, height and origin offset, set from `View > Grid > Grid
Settings` and toggled with `Ctrl+'`, with `View > Grid > Snap to Grid` alongside
it. Pixelorama makes the same split. This matters here: the request that picking
64x64 should divide the cell into 64 is the **pixel** grid, derived from the
sprite's size and not configured. A tile grid is a separate, later feature that
only means something once there are tilesets.
(<https://www.aseprite.org/docs/keyboard-shortcuts/>)

**Colour.** Grid lines are drawn at low opacity in a neutral colour, and
Aseprite lets the user set it because no single colour works over all art. A
common trick is to draw the line as a 50 percent blend rather than a solid
colour so it never hides a pixel entirely.

## Zoom

**Steps.** Integer or reciprocal-integer only, in all of them: 100, 200, 300,
400, 600, 800, 1600 percent and so on down through 50, 33, 25. A non-integer
zoom on pixel art produces unevenly sized pixels, which is exactly the artifact
the whole application exists to remove. Aseprite's `1` key sets 100 percent,
`+` and `-` step, and `Shift+0` or `View > Fit on Screen` fits.

**Cursor-anchored.** Scroll-wheel zoom keeps the point under the cursor fixed.
This is **unanimous** across all five editors surveyed; Aseprite and LibreSprite
even expose the opposite behaviour as an opt-in preference
(`zoom_from_center_with_wheel`, default off, where off is the cursor-anchored
one). Together with `X` for the colour swap it is one of the two bindings to
treat as non-negotiable. `Ctrl` or `Alt` plus wheel, or wheel alone, depending
on preference.

**Panning.** Space plus drag, and middle-mouse drag. Both, in all of them.

**Transparency checkerboard.** Drawn in the background at a fixed screen size
that does _not_ scale with zoom. Scaling it with the zoom makes it read as part
of the art, which is why none of them do it.

What varies is the cell size and, more interestingly, the contrast:

| Editor       | Cell | Colours                                            |
| ------------ | ---- | -------------------------------------------------- |
| Aseprite     | 16px | `#808080` / `#C0C0C0`, both configurable           |
| Pixelorama   | 10px | Configurable                                       |
| Piskel       | 8px  | Four presets; default `#4c4c4c` / `#555555`        |
| Pyxel Edit   | —    | Grey and white                                     |
| GraphicsGale | none | A solid colour-key index instead of a checkerboard |

Piskel's default pair differs by nine values out of 255. That is deliberate: the
checkerboard's job is to say "nothing here", and a high-contrast one competes
with the sprite for attention at exactly the zoom levels where the sprite is
small. Aseprite's 64-value default is at the other end, and it is configurable
for that reason.

The existing `.sprite-checkerboard` is 16 screen pixels of `--border-subtle`
over `--surface-well`, which lands on the low-contrast side and follows the
theme. It is already right, and it should stay a fixed screen size when the
stage gains zoom.

## Onion skin

Aseprite: `View > Show Onion Skin`, with the number of frames before and after,
the opacity of the first and last onion frame, and optional blue/red tinting of
past and future frames, configured from the timeline's own settings popup.
Pixelorama has the same set. Piskel has a simple on/off with a fixed opacity.

Onion skin only means something once there are frames. It is out of scope until
animation is, and it is listed here so that the panel layout leaves room for a
timeline along the bottom later.

## The preview window

Aseprite has a separate **Preview** window (`View > Preview`, `F7`) showing the
sprite at 100 percent while the main view is zoomed in. Pyxel Edit has a preview
panel that does the same job. This is the direct precedent for the rail proposed
in Part 3: while you are editing at 800 percent you cannot see what the sprite
actually looks like, and the whole craft is about what it looks like at 100
percent.

A **minimap** is a different thing and is rarer than it looks. Piskel is the only
one of the five with a real one: a Navigator-style panel that appears only when
the rendered frame is larger than the visible drawing area, with a draggable
gold-bordered rectangle marking the viewport. Aseprite, LibreSprite and
Pixelorama have none.

That splits the rail's job cleanly. The **1:1 cell is the preview** and is worth
building; a minimap is only useful once the sprite is larger than the stage,
which at 64 by 64 and a 664-pixel stage does not happen until roughly 1000
percent zoom. Build the preview, and reach for a minimap only if people
routinely zoom past the point where the sprite stops fitting.

---

# Part 3: The layout

## Taking the split seriously

The stated suggestion is to split the canvas area in two. The geometry supports
it, and it is worth saying why rather than just agreeing.

The content area at the default 1280 by 800 window is about 1248 by 730 after
the title bar. The right panel takes 320. The sprite is square. A square sprite
centred in a 900 by 500 region leaves roughly 200 pixels of dead space on each
side, permanently, at every window size. That space is already there; the
question is only what goes in it.

What goes in it is the thing Aseprite calls the Preview window: **the sprite at
100 percent, while the stage is zoomed in**, plus the pre-conform source to
compare against, plus the rest of the batch. Calling it a rail rather than a
second canvas is deliberate — it displays, it does not edit.

## The layout

At 1200 pixels of content width and above:

```
+---------------------------------------------------------------------------+
| title bar: menu, back/forward, name, [Generate|Gallery|Settings], engine   |
+---------------------------------------------------------------------------+
|                                              |          |                 |
|  STAGE                                       |  RAIL    |  RIGHT PANEL    |
|  flex-1, min 480px                           |  200px   |  320px          |
|                                              |          |                 |
|  +----------------------------------------+  | +------+ | [Params][Colour]|
|  |                                        |  | | 1:1  | | +-------------+ |
|  |   checkerboard well                    |  | +------+ | |             | |
|  |   sprite centred, pixel grid overlay   |  | | src  | | | tab body,   | |
|  |   cursor shows the cell under it       |  | +------+ | | scrolls     | |
|  |                                        |  | | 2 of | | | inside     | |
|  |                       [ - 800% + ][fit]|  | | 4    | | |             | |
|  +----------------------------------------+  | +------+ | |             | |
|                                              |          | |             | |
|  +----------------------------------------+  |          | |             | |
|  |  prompt / negative      [collapse ^]   |  |          | |             | |
|  +----------------------------------------+  |          | +-------------+ |
|                                              |          |                 |
|      [ tool | shape | brush | grid | size | seed | conform | post | GEN ]  |
+---------------------------------------------------------------------------+
```

Proportions at 1248 of content width: stage 664, rail 200, panel 320, four
16-pixel gutters. At 1600: stage 1016, everything else unchanged. The stage
takes all the growth, which is right — it is the only region whose usefulness
scales with size.

## The stage

The existing `SpriteCanvas`, with four additions:

- **A pixel grid overlay**, one line per sprite pixel, drawn only when the zoom
  puts at least **6 screen pixels** on a sprite pixel — Piskel's rule,
  `zoom * spacing < 6`, from Part 2. Below that it is a grey wash and is hidden.
  Thin the line the same way Piskel does rather than letting it eat the cell.
  This is the request that picking 64x64 should divide the cell into 64: the
  grid is derived from the sprite's own dimensions and is not configured.
- **Zoom**, integer steps, cursor-anchored on `Ctrl`+wheel (unanimous across
  every editor surveyed, so not a decision), `+`/`-`/`1`/fit on the keyboard,
  and a small control in the stage's trailing-bottom corner. This
  replaces the fit/actual/tile preview cluster that has just been removed from
  the dock in favour of the tool selector; those three modes become a zoom
  value, a zoom value, and a checkbox respectively.
- **Panning**, space-drag and middle-drag.
- **A pointer readout** of the cell coordinate and its colour, in the stage's
  leading-bottom corner. Two lines of code and it is how anyone verifies the
  grid is aligned.

The stage stays inside a `--surface-content` card with the `--surface-well`
checkerboard nested in it, which is the adjacency `tokens.css` declares. Grid
lines are drawn as a blend rather than a solid, and are not a new token: they
are `--border-subtle` over the art, which already exists and already follows
the theme.

## The rail

Three stacked cells at 200 pixels wide:

1. **1:1.** The sprite at exactly one image pixel per screen pixel. This is the
   only view that tells the truth about what was made, and while the stage is at
   800 percent it is the only place it can be seen.
2. **Source.** The image as the model produced it, before conform. Pressing it
   swaps the stage to show the source instead, so the two can be compared by
   pressing rather than by remembering.
3. **Batch.** The other images from the run, when `batchSize > 1`. Pressing one
   makes it the edited image.

The rail collapses to a 28-pixel tab on the stage's trailing edge below 1200
pixels of content width, and disappears below 1024, where its contents are
reachable from a dock entry instead. The 1:1 view is the one to keep longest;
the batch strip is the first to go.

## The right panel and its sub-tabs

Sub-tabs, not a second column. Three reasons:

- **The window minimum is 960 by 600.** Two 320-pixel columns plus a 200-pixel
  rail leaves 40 pixels of stage. One column leaves 360, which is enough to show
  a 64 by 64 sprite at 5x. The second column is not affordable at the size the
  application declares it supports.
- **The three sets are never wanted at once.** Generation parameters are set
  before a run; colour and brush are used after one. Showing both permanently is
  paying screen for a state nobody is in.
- **The mechanism already exists.** `SegmentedTabs` is built, tested, and is
  what the title bar navigation uses. Reusing it means the sub-tabs read as the
  same kind of control as the screen tabs, one level down.

The tabs:

| Tab            | Contents                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Parameters** | Everything `ParameterPanel` holds today, plus a Conform section (see below)                                                               |
| **Colour**     | Foreground/background swatches with a swap, a saturation-value field with a hue slider, a hex field, a recent strip, and the palette grid |

Two, not the three that were asked for. **Brush size and shape go in the dock,
beside the tool selector**, because that is where every editor puts them and
because they are a property of the tool rather than a panel of their own: a size
control is meaningless without knowing which tool it sizes. A third Brush tab
becomes worth adding the moment brush settings grow past what a popover holds —
ink modes, per-tool opacity, custom brushes — and adding it then costs one
entry in an array. This is an open question, listed below, with that as the
recommendation rather than the decision.

The Colour tab's palette is the palette conform returned, when there is one, and
a derived palette of the current image otherwise. It is not a static list.

## The Conform section

Conform is the feature's centre and it needs a home that says so.

It lives as a section at the top of the **Parameters** tab, above the generation
parameters, containing the target size, the palette choice, the dither mode, the
cleanup toggles, the detected grid readout with its confidence, and one button.

It is _also_ reachable from a **dock entry** that opens a popover with the same
button and the two settings that change most often (target size, palette size).
The dock is where the hand is between runs; making the main action of the
feature take a trip to a panel would be wrong.

**This does not break the dock rule.** The rule is that nothing in the dock
fires a one-press action except Generate. The dock entry opens a popover; the
press inside the popover acts. That is exactly the shape the Reset entry already
has.

**Conform does not need a confirmation, and should not have one.** A destructive
action needs a confirm; an undoable one does not. Conform keeps the pre-conform
image as the rail's Source cell and offers "revert to source", so it is
undoable by construction. Building it that way is cheaper than building a
confirmation dialog and it is better. Note the asymmetry with Reset, which is
behind a confirm because it genuinely destroys the prompt and the parameters.

## The dock

The dock is currently: `[tools | shape] | size | seed | postprocess | reset |
GENERATE`. After this work:

```
[ pencil eraser fill pick select shape ] | brush  grid  conform  size  seed  post  reset | GENERATE
   the tool cluster (a radio group)         popovers, each opening something            the one action
```

Three new entries, all of them popovers or selections:

- **Brush** — size (1 to 16 for sprite work, `[` and `]` on the keyboard), shape
  (circle, square), and the pixel-perfect toggle. A popover of selections.
- **Grid** — show/hide the pixel grid, and later the tile grid settings. A
  popover of toggles. It is also a View menu item, because that is where someone
  coming from Aseprite will look first.
- **Conform** — the popover described above.

Watch the width. The dock is `max-w-[92%]` and centred; at 960 pixels of window
the cluster of six tools plus seven popovers plus the Generate pill is tight.
The tool cluster's chips are 32 pixels collapsed, so six tools is 192 plus gaps.
Measure it at the minimum window size before adding the third entry, and if it
does not fit, the first thing to move out is Reset, which belongs in the File
or Edit menu at least as much as it belongs in a bar.

## Small windows

| Content width | Behaviour                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1200 and up   | Everything as drawn above                                                                                                               |
| 1024 to 1200  | Rail collapses to a 28-pixel tab on the stage's trailing edge and slides over the stage when opened                                     |
| 960 to 1024   | Rail hidden; the 1:1 view and the batch move into a dock popover, and the prompt card collapses to a single line with an expand control |
| Below 960     | Does not occur; `minWidth` is 960                                                                                                       |

The right panel stays at 320 throughout. It is the only fixed thing, and a panel
that changes width as the window changes is a panel whose contents reflow, which
at this size means the parameter grid dropping from two columns to one and back.

## Where each capability lives

| Capability                   | Home                          | Why                                                               |
| ---------------------------- | ----------------------------- | ----------------------------------------------------------------- |
| Tool selection               | Dock, lead cluster            | Already built. Selection, not action                              |
| Shape variant                | Dock popover                  | Already built                                                     |
| Brush size and shape         | Dock popover                  | Property of the tool; sits beside it, as in every editor          |
| Pixel-perfect toggle         | Dock, brush popover           | A brush setting                                                   |
| Foreground/background colour | Right panel, Colour tab       | Needs a two-dimensional field; too large for a popover            |
| Palette grid                 | Right panel, Colour tab       | Must be visible while drawing                                     |
| Eyedropper                   | Dock tool, plus `Alt` held    | The held-`Alt` shortcut is what people actually use               |
| Pixel grid on/off            | Dock popover, and View menu   | A view setting; the menu is where a new user looks                |
| Zoom                         | Stage overlay, plus keyboard  | Belongs to the thing being zoomed                                 |
| Pan                          | Stage, space-drag             | No control needed                                                 |
| 1:1 preview                  | Rail                          | Must be visible _while_ editing, so not a mode                    |
| Compare with source          | Rail                          | Same                                                              |
| Conform settings             | Right panel, Parameters tab   | Ten controls; too many for a popover                              |
| Conform action               | Right panel, and dock popover | Reachable from where the hand is, without a one-press dock action |
| Revert to source             | Rail, on the Source cell      | Next to the thing it reverts to                                   |
| Import a palette             | Right panel, Colour tab       | Rare, and needs a file dialog                                     |
| Generation parameters        | Right panel, Parameters tab   | Unchanged                                                         |
| Size, seed, post-processing  | Dock popovers                 | Unchanged                                                         |
| Undo/redo                    | Edit menu, `Ctrl+Z`/`Ctrl+Y`  | The menu items already exist and are disabled                     |
| Export the sprite            | File menu                     | Not a dock action; it opens a file dialog                         |

Two things push against the dock rule and are called out rather than hidden:

- **Revert to source** on the rail is a one-press action that discards edits.
  It is not in the dock, so the rule does not literally apply, but it has the
  same hazard. Make it undoable through the same undo stack as a brush stroke,
  and it stops being a hazard.
- **Conform** run from its popover replaces the image. Undoable by construction,
  as described. If for any reason the source is not kept, it needs a confirm and
  the design is worse.

---

# Part 4: The work, in order

Eleven pieces. Sizes are relative: small is a day or less for someone who knows
the codebase, medium is a few days, large is a week or more plus a design
conversation.

### 1. Oklab utilities and the palette module (small, no dependencies on other pieces)

`packages/engine/bitwright_engine/utils/color.py`: sRGB to Oklab and back,
vectorised over a NumPy array; weighted median cut with the box and axis
heuristics from Part 1; Lloyd refinement; nearest-entry snap.

Testable in isolation with no image involved, which is why it is first. Round
trip sRGB to Oklab and back and assert equality to within one 8-bit unit. Feed
median cut a known 4-colour image at `K=4` and assert it recovers exactly those
four.

Needs NumPy promoted to a base dependency. See the dependency section.

### 2. Grid detection (small, depends on 1 for the Oklab conversion)

`pipeline/conform/grid.py`: edge energy, the DFT bin, phase, the `N` sweep and
the smallest-N-within-tolerance rule.

Test it by construction: take an 8 by 8 image of known colours, scale it by
nearest neighbour by 7, offset it by 3, blur it slightly, and assert the
detected cell size is 7 and the phase is 3. Then do the same for a non-integer
scale. This is the piece most likely to be subtly wrong and the easiest to test
exactly, so test it exactly.

### 3. The conform pipeline (medium, depends on 1 and 2)

`pipeline/conform/__init__.py` with a `conform()` entry point and
`ConformOptions`, plus `downsample.py` (the modal vote) and `cleanup.py` (alpha,
halo, despeckle, outline). Rework `postprocess/__init__.py`'s `apply()` order,
or leave `apply()` alone for the generate path and have conform be its own
pipeline. Prefer the second: the generate path's existing behaviour is a
reasonable cheap default and changing it changes every existing result.

### 4. The route and the shell hop (small, depends on 3)

`api/schemas/conform.py`, `api/routes/conform.py`, the three Rust commands, the
`tauri.ts` and `api.ts` wrappers, the types, and the warning codes in both
`errors.json` files. Mechanical. It is separate from piece 3 so that piece 3 can
be tested through pytest before any of this exists.

### 5. Stage: grid overlay, zoom, pan, readout (medium, frontend only, no dependency on 1 to 4)

`SpriteCanvas` gains a zoom and pan state, a grid overlay, and the pointer
readout. This is the piece that makes the user's "pick 64x64 and see 64 cells"
true, and it can be built and shipped before conform exists, against the images
generation already produces.

Start it in parallel with piece 1.

### 6. Right panel sub-tabs (small, depends on 5 only for what fills the Colour tab)

Wrap the existing `ParameterPanel` body in a tab, add `SegmentedTabs` at the top
of the panel, add an empty Colour tab. Twenty minutes of work and it unblocks
pieces 7 and 8 for someone else.

### 7. Conform in the interface (small, depends on 4 and 6)

The Conform section in the Parameters tab, the dock entry, the rail's Source
cell, and revert. Wire the returned palette into the store.

### 8. The rail (small, depends on 5)

Three cells, the collapse behaviour, the responsive breakpoints.

### 9. Colour tab: picker and palette (medium, depends on 6, and on 4 for the palette data)

Foreground and background swatches with a swap, a saturation-value field, a hue
slider, a hex field, a recent strip, the palette grid with left-click and
right-click assignment. No dependency worth taking: a saturation-value field is
a canvas and two pointer handlers.

### 10. Palette import and named palettes (small, depends on 4 and 9)

`.hex`, `.gpl` and `.png` parsers in the sidecar, the two palette routes, a
file dialog through Tauri, and the list in the Colour tab.

### 11. The editable pixel buffer and the tools (large, depends on 5, 9, and the tool selector already built)

This is the genuinely large piece and it should not be started until the others
are done, because everything else is useful without it and it is not useful
without them.

It needs, at minimum: an `ImageData` buffer in the store as the single source of
truth for the current sprite; pointer-to-cell mapping through the stage's zoom
and pan; pencil, eraser, fill (scanline flood fill), eyedropper, and the three
shapes as preview-then-commit strokes; pixel-perfect stroke correction; an undo
stack with a stroke as the unit and a bounded depth; the Edit menu items
enabled; and re-encoding to PNG on export.

Two decisions inside it that are worth making before starting, not during:
whether the buffer is the only truth (and the base64 PNG from the engine is
decoded into it on arrival) or whether the PNG stays authoritative and the
buffer is a cache; and whether an edit invalidates the gallery entry or creates
a new one. Recommend: the buffer is the truth, the engine's PNG is decoded on
arrival and never read again, and an edit creates a new gallery entry on export
rather than mutating one.

## Suggested order

```
Python:      1 ---> 2 ---> 3 ---> 4 ------+
                                          |
                                          v
TypeScript:  5 ---> 6 -------------------> 7
              \      \
               -> 8   -> 9 ---> 10
                        |
                        v
                       11   (also needs 5)
```

Two people can work in parallel from the start: one on 1-2-3-4 in Python, one on
5-6-8 in TypeScript. They meet at 7.

If only one person is available and something has to ship early, ship 5 and 6
first. The grid overlay alone answers the loudest part of the complaint — "I
picked 64x64 and I cannot see 64 pixels" — and it needs nothing from the engine.

---

# Open questions

**1. Two sub-tabs or three?** Recommendation: two (Parameters, Colour), with
brush size and shape in a dock popover beside the tool selector, which is where
every editor surveyed puts them. A third Brush tab is one array entry away when
brush settings outgrow a popover. The request was for three; this is a
disagreement worth resolving before piece 6 is built, because it is cheap now
and annoying later.

**2. Does conform run live, or on a button?** Recommendation: on a button, with
the detected-grid readout updating live (it is cheap) and the image updating
only on the press. A half-megabyte round trip per slider drag is not something
to build a debounce around when the alternative is one press.

**3. Does editing stay on the Generate screen, or become a fourth screen?**
Recommendation: stay on Generate for now. The loop is generate, conform, touch
up, generate again, and splitting it across screens breaks that. But say now
that the moment layers, frames, or a timeline appear, it needs its own screen
and the navigation gains a fourth tab — so do not build anything into
`GenerateScreen` that assumes it will always live there. The stage, the rail,
and the panel should all be components that a different screen could mount.

**4. Ship named palettes, or only the mechanism?** Recommendation: only the
mechanism, plus import. See the licensing discussion. There is precedent on both
sides and it is worth stating: Aseprite, LibreSprite and Pixelorama all bundle
presets, and Piskel bundles none as a stated policy, having closed two requests
for a famous-palettes database as not planned. An editor is complete without
them. This is the user's call because it is a product decision, not a technical
one, and the technical answer is that it makes no difference to the work.

**5. Is semi-transparent output ever wanted?** Recommendation: keep the hard
alpha threshold as the default and expose the threshold, but do not build a
soft-alpha mode until someone asks. Sprites with soft alpha edges are the
problem this feature exists to solve.

**6. Should the generate path adopt the new pipeline, or keep the old one?**
Recommendation: keep the old one as the default post-processing on generate, and
make conform an explicit second step. Changing what `POST /v1/generate` returns
changes every result the user has already tuned their prompts against. Revisit
once conform has been used enough to trust.

**7. What happens to an edited sprite when the user presses Generate again?**
Recommendation: the edit is not discarded silently. Either the new result goes
to the rail's batch strip and the stage keeps the edited image until the user
picks the new one, or Generate is blocked behind the same undoable-replacement
rule as conform. The first is less surprising. This needs deciding before piece
11, and it is the kind of thing that is very annoying to retrofit.

---

# Dependencies and licences

The project's policy (`THIRD_PARTY_LICENSES.md`, `scripts/check-licenses.py`)
accepts MIT, BSD, Apache-2.0, ISC, MPL-2.0, Unlicense, Zlib and Python-2.0, and
fails CI on GPL, AGPL, SSPL and BUSL. Against that:

| Dependency       | Licence               | Verdict                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **NumPy**        | BSD-3-Clause          | **Required.** Compatible. Currently only in the `cuda` and `mps` extras; must be promoted to a base dependency, because conform must work on the remote backend too, where neither extra is installed. Adds roughly 20 MB to the PyInstaller bundle.                                                                                                                                      |
| Pillow           | MIT-CMU               | Already present. Unchanged.                                                                                                                                                                                                                                                                                                                                                               |
| SciPy            | BSD-3-Clause          | **Not needed.** Only wanted for `signal.find_peaks`, which the DFT approach replaces. Would add 40 MB or more to the bundle. Do not add it.                                                                                                                                                                                                                                               |
| OpenCV           | Apache-2.0            | **Not needed.** Only wanted for Canny and Hough. Very large. Do not add it.                                                                                                                                                                                                                                                                                                               |
| scikit-learn     | BSD-3-Clause          | **Not needed.** K-means over at most 4096 weighted points is twenty lines of NumPy.                                                                                                                                                                                                                                                                                                       |
| libimagequant    | GPL-3.0 or commercial | **Rejected.** Pillow's published wheels omit it on every platform precisely because of the licence, so using it means building Pillow from source. `check-licenses.py` denies GPL-3.0, and while AGPL-3.0 and GPL-3.0 are combinable in one direction, taking a GPL dependency needs an explicit written exemption of the kind PyInstaller has, and there is no reason to spend one here. |
| A colour library | varies                | **Not needed.** Oklab is two matrices and a cube root.                                                                                                                                                                                                                                                                                                                                    |
| A JS colour lib  | —                     | **Not needed.** `culori` is already a devDependency, used by `check-contrast.ts`. It should not become a runtime dependency; the frontend receives palettes as hex and does not compute in Oklab.                                                                                                                                                                                         |

So: one new base dependency, NumPy, already vendored in two optional extras,
BSD-3-Clause, and compatible.

Bundle size is the real cost. `scripts/build-sidecar.py` freezes the sidecar
with PyInstaller; adding NumPy to the base set adds it to the default bundle for
every user, including remote-backend users who install no extras. That is worth
20 MB, and it should be measured rather than assumed.

---

# Sources

Pipeline and algorithms:

- Astropulse, `pixeldetector` — adjacent-pixel difference sums, `find_peaks`,
  median spacing, per-tile modal colour, and the elbow method for choosing `K`.
  <https://github.com/Astropulse/pixeldetector>
- Kenneth J. Allen, `proper-pixel-art` — Canny plus probabilistic Hough for grid
  detection, line clustering, median spacing, and the "most common colour in the
  cell" rule. <https://github.com/KennethJAllen/proper-pixel-art>
- HappyOnigiri, `PixelRefiner` — grid detection modes (auto, hint, force, off),
  Oklab k-means quantization, Floyd-Steinberg and Bayer 2x2/4x4/8x8, border-based
  background estimation, interior hole filling, and graded noise cleanup.
  <https://github.com/HappyOnigiri/PixelRefiner>
- dimtoneff, `ComfyUI-PixelArt-Detector` — the three downscale strategies, the
  three colour-reduction strategies, and palettes distributed as one-pixel PNGs.
  <https://github.com/dimtoneff/ComfyUI-PixelArt-Detector>
- Clément Bœsch, "Improving color quantization heuristics" — the box selection
  and axis selection heuristics, the finding that per-box normalisation makes
  results worse, weighted mean as the box representative, Oklab as the working
  space, and the desaturation defect below `K=16`.
  <http://blog.pkh.me/p/39-improving-color-quantization-heuristics.html>
- Björn Ottosson, "A perceptual color space for image processing" — the Oklab
  matrices and the argument against CIELAB for blue hues.
  <https://bottosson.github.io/posts/oklab/>
- Leptonica, "Color quantization" — median cut and octree as space-splitting
  methods, and why their outputs differ from the source colours.
  <http://www.leptonica.org/color-quantization.html>
- Pillow, `Image.quantize` and `Image.convert` reference — the method constants,
  the RGBA/`FASTOCTREE` fallback, and `palette=` for quantizing to another
  image's palette.
  <https://pillow.readthedocs.io/en/stable/reference/Image.html>
- Pillow, "Building from source" — the statement that published wheels on every
  platform omit libimagequant because it is GPLv3.
  <https://pillow.readthedocs.io/en/stable/installation/building-from-source.html>
- pngquant, libimagequant licensing.
  <https://pngquant.org/lib/>

Palettes:

- Lospec palette list, DawnBringer 16 — the values, the author, and the absence
  of any licence statement on the page.
  <https://lospec.com/palette-list/dawnbringer-16>
- Lospec palette list, DawnBringer 32, Endesga 32, Endesga 64.
  <https://lospec.com/palette-list/dawnbringer-32>,
  <https://lospec.com/palette-list/endesga-32>,
  <https://lospec.com/palette-list/endesga-64>

Editor conventions:

- Aseprite, "Context bar" — what sits above the sprite editor, and that its
  contents change with the active tool.
  <https://www.aseprite.org/docs/context-bar/>
- Aseprite, "Keyboard shortcuts" — the grid, zoom and colour shortcuts.
  <https://www.aseprite.org/docs/keyboard-shortcuts/>
- Aseprite, "Preferences" and the community threads on grid settings — the
  split between the pixel grid and the configurable grid.
  <https://www.aseprite.org/docs/preferences/>,
  <https://community.aseprite.org/t/grid-settings-explain/8269>
- Aseprite source, read for the values the manuals do not carry: the grid
  opacity ramps (`src/app/ui/editor/editor.cpp`), the zoom ladder
  (`src/render/zoom.cpp`), `kMaxBrushSize` (`src/doc/brush.h`), the
  pixel-perfect condition (`src/app/tools/intertwiners.h`), and the preference
  defaults (`data/pref.xml`, `data/gui.xml`).
  <https://github.com/aseprite/aseprite>
- LibreSprite source — the same files, independently confirming the brush cap,
  the pixel-perfect condition, `FreehandAlgorithm` with its `DOTS` third mode,
  the ten-value `EyedropperChannel` enum, the tiled-mode and symmetry menu
  entries, and the bundled palette files and their entry counts.
  <https://github.com/LibreSprite/LibreSprite>
- Piskel source — the grid threshold `zoom * gridSpacing < 6`
  (`src/js/rendering/frame/FrameRenderer.js`), the minimap
  (`src/js/controller/MinimapController.js`), the `spectrum.js` picker
  configuration, the pen size cap (`src/js/service/PenSizeService.js`), and the
  checkerboard tiles decoded out of `src/css/layout.css`. Issues 693 and 824 (no
  bundled palettes) and 624 (no pixel-perfect mode), both closed as not planned.
  <https://github.com/piskelapp/piskel>
- Pixelorama — the UI scene tree and the user manual, for the tool options panel
  and the palette panel.
  <https://github.com/Orama-Interactive/Pixelorama>,
  <https://www.orama-interactive.com/pixelorama>
- GraphicsGale and Pyxel Edit, for contrast: the colour-key index instead of a
  checkerboard, and the preview panel that doubles as a minimap.
  <https://graphicsgale.com/us/>, <https://pyxeledit.com/>

Internal:

- [ADR 0005](decisions/0005-oklch-color-tokens.md) — why colour is reasoned
  about in a perceptually uniform space here.
- [ADR 0009](decisions/0009-asymmetric-surface-model.md) — the surface roles the
  stage, rail and panel are painted with.
- [ADR 0003](decisions/0003-python-sidecar-architecture.md) — why the pixel work
  belongs in Python.
- [IPC protocol](ipc-protocol.md) — the webview-to-Rust-to-Python path every new
  route has to travel.
- [Post-processing guide](../guides/post-processing.md) — the four options that
  exist today, which this plan extends rather than replaces.
