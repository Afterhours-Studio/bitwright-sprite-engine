---
name: bitwright-pixel-art
description: Draw HD-2D pixel art sprites through the Bitwright MCP server. Use whenever a Bitwright tool is available and the task is to create, shade, outline, recolour, review or repair a sprite, tile, prop or background — it is the operating manual for the tool catalogue, the step workflow and its computed gates.
---

# Drawing in Bitwright

You are drawing on a real indexed canvas. Pixels are palette **slot numbers**, not
colours. Slot `0` is transparent. Reading the canvas is cheap — about 1.3k tokens for a
whole 64×64 layer — and it is the only thing standing between you and drawing blind.

## 1. The loop

Every unit of work is the same six moves:

**read → decide → write → read back → verify → correct.**

1. `read_canvas` the layer you are about to touch.
2. Decide the exact runs, pixels or grid from what you just read.
3. Write with one tool call.
4. `read_canvas` or `read_region` the area you wrote.
5. `check_step` when the step is finished.
6. Fix what the readback or the gate shows, then read again.

Rules that are not negotiable:

- **Never write twice without reading in between.** The primary failure of an agent on
  this API is drawing from memory of what it intended rather than from the canvas.
- **Every write returns `{ changed, bounds, seq }`, not pixels.** If `changed` is `0`
  the write did nothing — wrong layer, wrong coordinates, or the slot was already
  there. Investigate before writing again.
- **Read back after every meaningful write.** A `draw_runs` of 40 runs, a `shade`, a
  `mirror`, a `fill_region` — all of these can land somewhere you did not mean.
- `read_region` exists so you can read the 20 rows you touched instead of all 64. Use
  it for corrections; use `read_canvas` when you need to judge the whole shape.
- `diff_layers` answers "did my outline stay inside the silhouette" in one call. Use it
  instead of reading two layers and comparing by eye.
- `undo` takes `{ assetId, count }` and walks the same op log the person's undo walks.
  A bad `shade` or `mirror` is one `undo` away. Prefer it over patching by hand.

## 2. The step workflow

An asset moves `reference → palette → silhouette → flats → shadow → light → outline →
detail → accent → cleanup → variation`. You cannot skip a step and you cannot advance
until the gate passes.

`check_step` evaluates the gate without advancing. `advance_step` moves on, or fails
with `step.gate_failed` and hands you the same report. Every check in that report is
**computed from the pixel buffer**. There is nothing to argue with and nothing to
assert — a failing check is a statement about pixels, so change pixels. The `hint`
field names coordinates wherever it can; act on those coordinates directly.

| Step | Layer role | Ord | You place | Tools | Gate measures |
| --- | --- | --- | --- | --- | --- |
| `reference` | — | — | optional imported art | `read_reference` | nothing |
| `palette` | — | — | ramps per material | `set_palette`, `extract_palette`, `describe_palette` | ≥ 3 steps per ramp, hue shift present, slot ceiling |
| `silhouette` | `silhouette` | 10 | the mask, one slot | `paste_grid`, `draw_runs`, `mirror` | single connected region, reads at 1× |
| `flats` | `flats` | 20 | each material's base slot | `paste_grid`, `draw_runs`, `fill_region` | no pixel of the mask left unassigned |
| `shadow` | `shadow-core`, `shadow-deep` | 30, 31 | core shadow, then AO | `shade` | one consistent light direction |
| `light` | `light` | 40 | lit planes | `shade` | no pillow shading, no banding |
| `outline` | `outline` | 50 | the selective outline | `outline` | no outline pixel outside the silhouette |
| `detail` | `detail` | 60 | interior features, folds, face | `draw_runs`, `set_pixels`, `draw_shape` | isolated-pixel noise within budget |
| `accent` | `rim`, `accent` | 70, 71 | the backlight edge, then speculars | `shade`, `set_pixels` | rim coverage and accent count within budget |
| `cleanup` | — | — | polish, in place | `antialias`, `set_pixels` | noise below budget, outer edge untouched |
| `variation` | — | — | recolours | `create_variation` | value structure unchanged |

Four things about this order that catch agents out:

- **Silhouette and flats are different layers because they answer different
  questions.** The silhouette is one opaque slot answering *what shape*; the flats
  assign each material's base slot, answering *made of what*. They get revised for
  different reasons, and the flats gate is simply that the flats cover the mask
  completely.
- **`shade` and `outline` both read `from: "flats"`**, never from the silhouette. They
  resolve each pixel's ramp from the material slot they find there. Point either at
  `silhouette` and every pixel resolves to the one mask slot, so the whole sprite
  shades off a single ramp.
- **The outline goes late, after light.** An outline pixel's colour is derived from the
  fill beside it, so outlining before the fills exist means guessing, and the guess is
  always flat black. This is the position most likely to surprise you; do not reorder it.
- **`cleanup` owns no layer.** It polishes the layers already drawn, in place, so its
  calls name whichever finished layer they are touching.

Full step table with the numeric thresholds: `references/workflow.md`.

Writing to a layer that does not belong to the current step fails with `step.wrong`.
Passing `force: true` is allowed and is sometimes right, but prefer `revisit_step` — it
is recorded, and nothing is erased when you go back.

## 3. Choosing a write tool

| Situation | Tool |
| --- | --- |
| A silhouette, a flats map, a whole tile — any region you can state as a rectangle of characters | `paste_grid` |
| A shape you are describing scanline by scanline | `draw_runs` |
| Fewer than about a dozen corrections | `set_pixels` |
| A straight edge, a box, an ellipse, a curve | `draw_shape` |
| The second half of a front-facing form | `mirror` |
| A closed area of one slot that should become another | `fill_region` |

The decision rule: **pick the tool whose arguments state what you actually know.**

- You know a shape as a picture → `paste_grid`. Its rows must all be the same length
  and must match the target region, or you get `grid.size_mismatch`.
- You know a shape as "row 31 from column 12 to column 30" → `draw_runs`. Prefer it
  over `paste_grid` for anything that is not a full rectangle, because each run states
  its own endpoints and cannot drift from a miscounted character in a long string.
- You know exact pixels and there are few → `set_pixels`. It is capped at 512; if you
  are near that cap you wanted `draw_runs`.
- You know geometry → `draw_shape`. Leave `pixelPerfect` at its default `true`; the
  doubled corner pixel on a diagonal is the clearest tell of machine-drawn pixel art.
- The form is bilaterally symmetric → draw one half and `mirror` with
  `{ axis: "x", about: 23 }` on a 48-wide canvas. Drawing both halves by hand is where
  drift enters. Mirror the silhouette and the flats; never mirror after shading,
  because the lighting is not symmetric.

## 4. You never choose a colour for shading

`shade` and `outline` resolve ramp steps themselves. You say *where* and *which
direction the light comes from*; the engine looks up the ramp the source slot belongs
to and steps along it.

```jsonc
{ "assetId": "…", "target": "shadow-core", "from": "flats",
  "direction": "upper-left", "depth": 1 }
```

- `target` is one of `shadow-core`, `shadow-deep`, `light`, `rim`.
- `from` is `"flats"`. That is where the material slots are.
- Omit `direction` and the style rules supply it. Do not vary it between calls on one
  sprite; one inconsistent call is exactly what the shadow gate detects.
- `depth` is how many ramp steps to move. `depth: 1` for core shadow and for light;
  `depth: 2` for `shadow-deep`.
- If `shade` reports skipped pixels, those source slots belong to no ramp. That means
  the flats carry a slot that is not in any ramp. Fix the flats, not the shade call.

**The only hex values you ever type are in `set_palette`.** Those are checked against
the style rules — slot ceiling, ramp length, hue-shift bounds, value floor and ceiling
— and a ramp that only changes lightness is rejected with `palette.rule_violation`. If
you catch yourself wanting a specific colour anywhere else, you want a different slot,
and `describe_palette` will tell you which one it is. Ramp construction, the numbers,
and a complete ready-to-send call: `references/palette.md`.

## 5. Reading the ruler grid

`read_canvas` and `read_region` return a legend, a column ruler, then one line per row
prefixed by its row number. Example, `read_region` with
`{ layer: "silhouette", x: 10, y: 24, w: 28, h: 12 }`:

```
legend: R=18 ink.mid  .=transparent

        10   15   20   25   30   35
   24 | ...RRRRRRRRRRRRRRRRRRRRRR...
   25 | ...RRRRRRRRRRRRRRRRRRRRRR...
   26 | ...RRRRRRRRRRRRRRRRRRRRRR...
   27 | ..RRRRRRRRRRRRRRRRRRRRRRR...
   28 | ..RRRRRRRRRRRRRRRRRRRRRRRR..
   29 | ..RRRRRRRRRRRRRRRRRRRRRRRR..
   30 | ..RRRRRRRRRRRRRRRRRRR..RRR..
   31 | ..RRRRRRRRRRRRRRRRRRR..RRR..
   32 | ..RRRRRRRRRRRRRRRRRRR..RRR..
   33 | ..RRRRRRRRRRRRRRRRRRRRRRRR..
   34 | ..RRRRRRRRRRRRRRRRRRRRRRRR..
   35 | .RRRRRRRRRRRRRRRRRRRRRRRR...
```

Read it like this, every time:

1. **The ruler is in canvas coordinates, not string offsets.** The first character of
   each row is canvas column `10`, because that is what you passed as `x`. A label sits
   over the column it names: the `1` of `10` is column 10, the `1` of `15` is column 15.
2. **To locate a coordinate, subtract the region origin.** Canvas column 31 on row 30
   is string index `31 − 10 = 21`. Count to the ruler mark nearest below it — `30` — and
   step one to the right.
3. **Verify against the ruler before you trust the count.** On row 30 the gap runs from
   the character under the `0` of `30` to the one after it. Columns 31 and 32 are
   transparent; columns 30 and 33 are filled. That hole is the gap between the forearm
   and the torso.
4. **State the answer as a run, then write it as a run.** "Row 30, columns 31 to 32,
   transparent" becomes `{ "y": 30, "x0": 31, "x1": 32, "slot": 0 }`. Never convert a
   grid reading into a bare column number you then reuse from memory.

The mask slot here is `R`, slot 18. Which slot the silhouette uses does not matter:
nothing downstream reads it, because `shade` and `outline` read the `flats` layer. What
matters is that it is one slot and that the shape is right.

Miscounting one column is the mistake that ruins a shading pass, because the error is
invisible in the diff summary and only shows up as a one-pixel-wide misalignment three
steps later. When a region matters, re-read it with a tighter `read_region` so the
ruler starts near the coordinate you care about.

## 6. Recovery

| Code | What actually happened | Do this |
| --- | --- | --- |
| `step.gate_failed` | `advance_step` measured the pixels and one or more checks failed | Read the `checks` array. Each failing entry has a `detail` with numbers and a `hint` with coordinates. Fix the pixels named, `check_step` again, then advance. Never re-send `advance_step` unchanged, and do not reach for `force` to make a report go away. |
| `palette.rule_violation` | `set_palette` rejected a ramp: it is too short, too long, over the slot ceiling, or it changes lightness without shifting hue | The hint names the ramp. Rebuild that ramp with per-step hue rotation and chroma change, not lightness alone — see `references/palette.md`. Re-send the whole `set_palette` call; it replaces the palette. |
| `grid.size_mismatch` | Your `paste_grid` rows are ragged, or the block does not fit at `x, y` | Check that every string in `rows` has identical length, and that `x + width ≤ canvas width` and `y + len(rows) ≤ canvas height`. For a non-rectangular shape use `draw_runs` instead. |
| `grid.bad_character` | A character in `rows` maps to no slot | Only `.`, `A`–`Z`, `a`–`z`, `0`–`9` are legal, in that order from slot 0. Call `describe_palette` and rebuild the rows from the letters it reports. |
| `slot.out_of_range` | A slot number is above the palette size | `describe_palette`, then use a real slot. Do not guess that the ramp has one more step than it does. |
| `bounds.outside` | Coordinates fall off the canvas | Re-read the asset size from `open_asset` or `get_step`. Remember `x1` in a run is inclusive. |
| `step.wrong` | The layer does not belong to the current step | Use the layer the current step owns, or `revisit_step` to go back. Nothing is erased by revisiting. `force: true` is a last resort and is logged as a forced write. |
| `layer.locked` | The person locked that layer in the application | Say so and ask. Do not work around it. |
| `layer.unknown_role` | The role string is not a workflow role | The roles are `silhouette`, `flats`, `shadow-core`, `shadow-deep`, `light`, `outline`, `detail`, `rim`, `accent`. |
| `asset.not_open` / `asset.not_found` | No current asset, or a bad id | `list_assets`, then `open_asset`. |

## 7. Starting from nothing

```
list_projects → create_project → create_asset → open_asset → get_style_rules
```

`create_asset` returns the style rules with the asset, so you usually do not need the
separate call. Read them before drawing: they carry the slot ceiling, the light
direction, the ramp bounds and the canvas defaults you are about to be gated against.

## References

- `references/workflow.md` — every step, its layer, what to draw, which tools, and the
  numeric gate thresholds.
- `references/palette.md` — how to build ramps that pass validation, plus a complete
  worked 22-slot character palette as a ready-to-send `set_palette` call.
- `references/recipes.md` — three full worked sequences: a 48×64 character from
  nothing, deriving a palette and silhouette from an imported reference, and producing
  a colour variation.
- `references/troubleshooting.md` — the failure modes, the heuristic that detects each,
  and the tool calls that fix it.
