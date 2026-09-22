# Worked recipes

Three complete sequences. Tool names, argument names and response shapes are exactly
what the server takes and returns. Ids are elided; everything else is literal.

---

# A. A 48 × 64 HD-2D character from nothing

A traveller in a blue coat with green trim, leather belt and boots, dark plum hair swept
to one side, right forearm bent to the hip.

## A0. Orientation

```
create_project { "name": "Wayfarers", "preset": "hd2d" }
→ { "id": "…", "name": "Wayfarers", "style": "hd2d", "assets": 0 }

create_asset { "projectId": "…", "name": "sofia-idle-south",
               "kind": "character", "width": 48, "height": 64 }
→ { "asset": { "id": "…", "step": "reference", "width": 48, "height": 64 },
    "styleRules": { "maxSlots": 24, "rampSteps": { "min": 3, "max": 5 },
                    "lightDirection": "upper-left",
                    "outline": "selective", "outlineCoverage": [0.60, 0.75],
                    "rimCoverage": [0.15, 0.25], "noiseBudget": 0.02,
                    "valueFloor": [0.10, 0.16], "valueCeiling": [0.88, 0.94],
                    "minEdgeDeltaL": 0.07, "canvas": { "width": 48, "height": 64 } } }

open_asset { "assetId": "…" }
→ { "step": "reference", "gate": { "pass": true, "checks": [] },
    "palette": { "slots": 0, "ramps": [] }, "layers": "all empty" }
```

Write down the landmarks before drawing anything: crown `y=4`, eye line `y=14`,
chin `y=21`, shoulder `y=24`, waist `y=38`, hip `y=41`, knee `y=50`, sole `y=61`.
Centreline falls between columns 23 and 24.

No reference image, so advance straight through.

```
advance_step { "assetId": "…" }   → { "step": "palette" }
```

## A1. Palette

The full call and the reasoning behind each number are in `palette.md`. Send it:

```
set_palette { "assetId": "…", "ramps": [
  { "name": "skin",        "material": "skin",    "slots": ["#885659","#AC7361","#C19470","#D0B692"] },
  { "name": "cloth-blue",  "material": "cloth",   "slots": ["#3F4595","#406EB3","#5697C3"] },
  { "name": "cloth-green", "material": "cloth",   "slots": ["#2B7750","#69945F","#A0AF7E"] },
  { "name": "leather",     "material": "leather", "slots": ["#322C00","#604914","#896B4D"] },
  { "name": "hair",        "material": "hair",    "slots": ["#2E0C20","#492C46","#64546E"] },
  { "name": "ink",         "material": "ink",     "slots": ["#0E0418","#211E36","#363C50"] },
  { "name": "rim",         "material": "rim",     "slots": ["#B3AC82","#DDC8A2","#FBE3CE"] } ] }
→ { "slots": 22, "ramps": 7 }
```

Read the slot numbers back rather than assuming them:

```
describe_palette { "assetId": "…" }
→ legend: A=1 skin.shadow2  B=2 skin.shadow1  C=3 skin.base   D=4 skin.light
          E=5 cloth-blue.shadow  F=6 cloth-blue.base  G=7 cloth-blue.light
          H=8 cloth-green.shadow I=9 cloth-green.base J=10 cloth-green.light
          K=11 leather.shadow    L=12 leather.base    M=13 leather.light
          N=14 hair.shadow       O=15 hair.base       P=16 hair.light
          Q=17 ink.dark          R=18 ink.mid         S=19 ink.light
          T=20 rim.deep          U=21 rim.soft        V=22 rim

check_step  { "assetId": "…" }
→ { "step": "palette", "pass": true,
    "checks": [ { "name": "ramp-length", "pass": true },
                { "name": "hue-shift", "pass": true },
                { "name": "slot-ceiling", "pass": true, "detail": "22 of 24" },
                { "name": "value-range", "pass": true, "detail": "L 0.140–0.930" } ] }

advance_step { "assetId": "…" } → { "step": "silhouette" }
```

## A2. Silhouette, pass A — the mask

One slot, the whole mass. Slot 6 (`F`, cloth-blue base) becomes the coat later, so use
it now and save a repaint.

```
paste_grid {
  "assetId": "…", "layer": "silhouette", "x": 0, "y": 0, "mode": "replace",
  "rows": [
    "................................................",
    "................................................",
    "................................................",
    "................................................",
    "....................FFFFFFFF....................",
    "...................FFFFFFFFFF...................",
    "..................FFFFFFFFFFFF..................",
    ".................FFFFFFFFFFFFFF.................",
    ".................FFFFFFFFFFFFFF.................",
    "..............FFFFFFFFFFFFFFFFF.................",
    "..............FFFFFFFFFFFFFFFFF.................",
    "..............FFFFFFFFFFFFFFFFF.................",
    "..............FFFFFFFFFFFFFFFFF.................",
    "..............FFFFFFFFFFFFFFFFF.................",
    "..............FFFFFFFFFFFFFFFFF.................",
    "..............FFFFFFFFFFFFFFFFF.................",
    "..............FFFFFFFFFFFFFFFFF.................",
    ".................FFFFFFFFFFFFFF.................",
    ".................FFFFFFFFFFFFFF.................",
    "..................FFFFFFFFFFFF..................",
    "...................FFFFFFFFFF...................",
    "....................FFFFFFFF....................",
    ".....................FFFFFF.....................",
    ".....................FFFFFF.....................",
    ".............FFFFFFFFFFFFFFFFFFFFFF.............",
    ".............FFFFFFFFFFFFFFFFFFFFFF.............",
    ".............FFFFFFFFFFFFFFFFFFFFFF.............",
    "............FFFFFFFFFFFFFFFFFFFFFFF.............",
    "............FFFFFFFFFFFFFFFFFFFFFFFF............",
    "............FFFFFFFFFFFFFFFFFFFFFFFF............",
    "............FFFFFFFFFFFFFFFFFFF..FFF............",
    "............FFFFFFFFFFFFFFFFFFF..FFF............",
    "............FFFFFFFFFFFFFFFFFFF..FFF............",
    "............FFFFFFFFFFFFFFFFFFFFFFFF............",
    "............FFFFFFFFFFFFFFFFFFFFFFFF............",
    "...........FFFFFFFFFFFFFFFFFFFFFFFF.............",
    "...........FFFFFFFFFFFFFFFFFFFFFFFF.............",
    "...........FFFFFFFFFFFFFFFFFFFFFFF..............",
    "...........FFFFFFFFFFFFFFFFFFFFFFF..............",
    "...........FFFFFFFFFFFFFFFFFFFFFFF..............",
    "...........FFFFFFFFFFFFFFFFFFFFFFFF.............",
    "..........FFFFFFFFFFFFFFFFFFFFFFFFFFF...........",
    "..........FFFFFFFFFFFFFFFFFFFFFFFFFFFF..........",
    ".................FFFFFF..FFFFFF.................",
    ".................FFFFFF..FFFFFF.................",
    ".................FFFFFF..FFFFFF.................",
    ".................FFFFFF..FFFFFF.................",
    ".................FFFFFF..FFFFFF.................",
    ".................FFFFFF..FFFFFF.................",
    ".................FFFFFF..FFFFFF.................",
    ".................FFFFFF..FFFFFF.................",
    ".................FFFFFF..FFFFFF.................",
    ".................FFFFFF..FFFFFF.................",
    ".................FFFFFF..FFFFFF.................",
    ".................FFFFFF..FFFFFF.................",
    ".................FFFFFF..FFFFFF.................",
    ".................FFFFFF..FFFFFF.................",
    ".................FFFFFF..FFFFFF.................",
    ".................FFFFFF..FFFFFF.................",
    ".................FFFFFF..FFFFFF.................",
    ".................FFFFFF..FFFFFF.................",
    "................................................",
    "................................................",
    "................................................"
  ] }
→ { "changed": 927, "bounds": { "x": 10, "y": 4, "w": 28, "h": 57 }, "seq": 8 }
```

The reported `bounds` already says something: `y` runs 4 to 60, and the contact row is
61. Confirm it before guessing:

```
check_step { "assetId": "…" }
→ { "step": "silhouette", "pass": false,
    "checks": [
      { "name": "single-region", "pass": true, "detail": "1 region, 927px" },
      { "name": "occupancy", "pass": true, "detail": "h 57/64 = 0.891, w 28/48 = 0.583" },
      { "name": "margin", "pass": true },
      { "name": "contact-row", "pass": false,
        "detail": "lowest filled row is 60; the style's contact row is 61",
        "hint": "Extend the soles by one row: y=61, x 17–22 and x 25–30." },
      { "name": "negative-space", "pass": true, "detail": "1 enclosed hole, 2x3 at (31,30)" },
      { "name": "asymmetry", "pass": true } ] }
```

The gate measured the buffer and named the coordinates. Do exactly what it says.

```
draw_runs { "assetId": "…", "layer": "silhouette", "runs": [
  { "y": 61, "x0": 17, "x1": 22, "slot": 6 },
  { "y": 61, "x0": 25, "x1": 30, "slot": 6 } ] }
→ { "changed": 12, "bounds": { "x": 17, "y": 61, "w": 14, "h": 1 }, "seq": 9 }
```

Read back the part you touched — not the whole canvas:

```
read_region { "assetId": "…", "layer": "silhouette", "x": 14, "y": 56, "w": 20, "h": 8 }
→ legend: F=6 cloth-blue.base  .=transparent

         15   20   25   30
    56 | ...FFFFFF..FFFFFF...
    57 | ...FFFFFF..FFFFFF...
    58 | ...FFFFFF..FFFFFF...
    59 | ...FFFFFF..FFFFFF...
    60 | ...FFFFFF..FFFFFF...
    61 | ...FFFFFF..FFFFFF...
    62 | ....................
    63 | ....................

check_step { "assetId": "…" }
→ { "step": "silhouette", "pass": true, "checks": [ … all pass … ] }
```

## A3. Silhouette, pass B — the base flats

Same layer. Repaint each material over the mask. `shade` will read this layer and
resolve each pixel's ramp from the slot it finds here, so every material must carry its
own base slot before you advance.

```
draw_runs { "assetId": "…", "layer": "silhouette", "runs": [
  { "y": 4,  "x0": 20, "x1": 27, "slot": 15 }, { "y": 5,  "x0": 19, "x1": 28, "slot": 15 },
  { "y": 6,  "x0": 18, "x1": 29, "slot": 15 }, { "y": 7,  "x0": 17, "x1": 30, "slot": 15 },
  { "y": 8,  "x0": 17, "x1": 30, "slot": 15 }, { "y": 9,  "x0": 14, "x1": 30, "slot": 15 },
  { "y": 10, "x0": 14, "x1": 30, "slot": 15 }, { "y": 11, "x0": 14, "x1": 30, "slot": 15 },
  { "y": 12, "x0": 14, "x1": 30, "slot": 15 },
  { "y": 13, "x0": 14, "x1": 18, "slot": 15 }, { "y": 13, "x0": 29, "x1": 30, "slot": 15 },
  { "y": 14, "x0": 14, "x1": 18, "slot": 15 }, { "y": 14, "x0": 29, "x1": 30, "slot": 15 },
  { "y": 15, "x0": 14, "x1": 18, "slot": 15 }, { "y": 15, "x0": 29, "x1": 30, "slot": 15 },
  { "y": 16, "x0": 14, "x1": 18, "slot": 15 }, { "y": 16, "x0": 29, "x1": 30, "slot": 15 },
  { "y": 17, "x0": 17, "x1": 18, "slot": 15 }, { "y": 17, "x0": 29, "x1": 30, "slot": 15 },
  { "y": 18, "x0": 17, "x1": 18, "slot": 15 }, { "y": 18, "x0": 29, "x1": 30, "slot": 15 },
  { "y": 19, "x0": 18, "x1": 18, "slot": 15 }, { "y": 19, "x0": 29, "x1": 29, "slot": 15 },
  { "y": 20, "x0": 19, "x1": 19, "slot": 15 }, { "y": 20, "x0": 28, "x1": 28, "slot": 15 },

  { "y": 13, "x0": 19, "x1": 28, "slot": 3 }, { "y": 14, "x0": 19, "x1": 28, "slot": 3 },
  { "y": 15, "x0": 19, "x1": 28, "slot": 3 }, { "y": 16, "x0": 19, "x1": 28, "slot": 3 },
  { "y": 17, "x0": 19, "x1": 28, "slot": 3 }, { "y": 18, "x0": 19, "x1": 28, "slot": 3 },
  { "y": 19, "x0": 19, "x1": 28, "slot": 3 }, { "y": 20, "x0": 20, "x1": 27, "slot": 3 },
  { "y": 21, "x0": 20, "x1": 27, "slot": 3 }, { "y": 22, "x0": 21, "x1": 26, "slot": 3 },
  { "y": 23, "x0": 21, "x1": 26, "slot": 3 },
  { "y": 31, "x0": 33, "x1": 35, "slot": 3 }, { "y": 32, "x0": 33, "x1": 35, "slot": 3 },
  { "y": 33, "x0": 12, "x1": 14, "slot": 3 }, { "y": 34, "x0": 12, "x1": 14, "slot": 3 },

  { "y": 24, "x0": 19, "x1": 28, "slot": 9 }, { "y": 25, "x0": 19, "x1": 28, "slot": 9 },
  { "y": 41, "x0": 10, "x1": 36, "slot": 9 }, { "y": 42, "x0": 10, "x1": 37, "slot": 9 },

  { "y": 37, "x0": 11, "x1": 33, "slot": 12 }, { "y": 38, "x0": 11, "x1": 33, "slot": 12 },
  { "y": 57, "x0": 17, "x1": 22, "slot": 12 }, { "y": 57, "x0": 25, "x1": 30, "slot": 12 },
  { "y": 58, "x0": 17, "x1": 22, "slot": 12 }, { "y": 58, "x0": 25, "x1": 30, "slot": 12 },
  { "y": 59, "x0": 17, "x1": 22, "slot": 12 }, { "y": 59, "x0": 25, "x1": 30, "slot": 12 },
  { "y": 60, "x0": 17, "x1": 22, "slot": 12 }, { "y": 60, "x0": 25, "x1": 30, "slot": 12 },
  { "y": 61, "x0": 17, "x1": 22, "slot": 12 }, { "y": 61, "x0": 25, "x1": 30, "slot": 12 } ] }
→ { "changed": 457, "bounds": { "x": 10, "y": 4, "w": 28, "h": 58 }, "seq": 10 }
```

Runs whose span reaches outside the mask are clipped to it — `{ "y": 37, "x0": 11,
"x1": 33 }` paints the belt across the whole waist and stops at the coat edge. That is
why the belt run can be stated as one span instead of measured.

Read back the head, where the material boundaries are tightest:

```
read_region { "assetId": "…", "layer": "silhouette", "x": 12, "y": 4, "w": 26, "h": 22 }
→ legend: C=3 skin.base  F=6 cloth-blue.base  I=9 cloth-green.base  O=15 hair.base

           15   20   25   30   35
     4 | ........OOOOOOOO..........
     5 | .......OOOOOOOOOO.........
     6 | ......OOOOOOOOOOOO........
     7 | .....OOOOOOOOOOOOOO.......
     8 | .....OOOOOOOOOOOOOO.......
     9 | ..OOOOOOOOOOOOOOOOO.......
    10 | ..OOOOOOOOOOOOOOOOO.......
    11 | ..OOOOOOOOOOOOOOOOO.......
    12 | ..OOOOOOOOOOOOOOOOO.......
    13 | ..OOOOOCCCCCCCCCCOO.......
    14 | ..OOOOOCCCCCCCCCCOO.......
    15 | ..OOOOOCCCCCCCCCCOO.......
    16 | ..OOOOOCCCCCCCCCCOO.......
    17 | .....OOCCCCCCCCCCOO.......
    18 | .....OOCCCCCCCCCCOO.......
    19 | ......OCCCCCCCCCCO........
    20 | .......OCCCCCCCCO.........
    21 | ........CCCCCCCC..........
    22 | .........CCCCCC...........
    23 | .........CCCCCC...........
    24 | .FFFFFFIIIIIIIIIIFFFFFF...
    25 | .FFFFFFIIIIIIIIIIFFFFFF...
```

The face is columns 19–28, rows 13–19; the hair sweep is columns 14–16, rows 9–16; the
green collar is columns 19–28, rows 24–25. Those are the coordinates every later step
refers to.

```
check_step { "assetId": "…" }
→ { "step": "silhouette", "pass": true,
    "checks": [
      { "name": "single-region", "pass": true },
      { "name": "base-slots-only", "pass": true, "detail": "5 materials, 5 slots" },
      { "name": "material-separation", "pass": true, "detail": "min ΔL 0.08" },
      { "name": "area-share", "pass": true,
        "detail": "cloth-blue 51.3% (main cloth, exempt), hair 17.7%, skin 11.7%, leather 11.3%, cloth-green 8.0%" },
      { "name": "signature-hue", "pass": true, "detail": "cloth-green 8.0%, in 8–15%" } ] }

advance_step { "assetId": "…" } → { "step": "outline" }
```

## A4. Outline

One call. Do not draw outline pixels by hand.

```
outline { "assetId": "…", "from": "silhouette", "mode": "selective", "darken": 2 }
→ { "changed": 214, "bounds": { "x": 10, "y": 4, "w": 28, "h": 58 }, "seq": 11 }

diff_layers { "assetId": "…", "a": "silhouette", "b": "outline" }
→ 0 outline pixels outside the silhouette

check_step { "assetId": "…" }
→ { "step": "outline", "pass": true,
    "checks": [ { "name": "containment", "pass": true },
                { "name": "coverage", "pass": true, "detail": "0.68 of perimeter, target 0.60–0.75" },
                { "name": "thickness", "pass": true, "detail": "1px everywhere" },
                { "name": "bottom-band", "pass": true },
                { "name": "hue-variety", "pass": true, "detail": "5 distinct outline colours" } ] }

advance_step { "assetId": "…" } → { "step": "shadow" }
```

If coverage comes back at 0.82 the style rules were not applied; re-send with
`"mode": "selective"` spelled exactly, and check `get_style_rules` says
`"outline": "selective"`.

## A5. Shadow

Core shadow over everything, then deep shadow region by region. You name places, never
colours.

```
shade { "assetId": "…", "target": "shadow-core", "from": "silhouette",
        "direction": "upper-left", "depth": 1 }
→ { "changed": 331, "bounds": { "x": 10, "y": 4, "w": 28, "h": 58 }, "seq": 12,
    "skipped": 0 }
```

`skipped: 0` means every source pixel belonged to a ramp. A non-zero number here means
part of the silhouette is painted with an unramped slot — go back and fix the flats.

Deep shadow is ambient occlusion only, one `region` per placement: under the chin, under
the collar, under the belt, and the contact rows.

```
shade { "assetId": "…", "target": "shadow-deep", "from": "silhouette",
        "region": { "x": 20, "y": 21, "w": 8, "h": 3 }, "depth": 2 }
→ { "changed": 20, "bounds": { "x": 20, "y": 21, "w": 8, "h": 3 }, "seq": 13 }

shade { "assetId": "…", "target": "shadow-deep", "from": "silhouette",
        "region": { "x": 13, "y": 26, "w": 22, "h": 2 }, "depth": 2 }
→ { "changed": 44, "bounds": { "x": 13, "y": 26, "w": 22, "h": 2 }, "seq": 14 }

shade { "assetId": "…", "target": "shadow-deep", "from": "silhouette",
        "region": { "x": 11, "y": 39, "w": 23, "h": 2 }, "depth": 2 }
→ { "changed": 46, "bounds": { "x": 11, "y": 39, "w": 23, "h": 2 }, "seq": 15 }

shade { "assetId": "…", "target": "shadow-deep", "from": "silhouette",
        "region": { "x": 17, "y": 60, "w": 14, "h": 2 }, "depth": 2 }
→ { "changed": 24, "bounds": { "x": 17, "y": 60, "w": 14, "h": 2 }, "seq": 16 }

check_step { "assetId": "…" }
→ { "step": "shadow", "pass": false,
    "checks": [ { "name": "light-direction", "pass": true, "detail": "circular σ 11°, mean 7° from declared" },
                { "name": "pillow-shading", "pass": true, "detail": "r = 0.31, limit 0.6" },
                { "name": "banding", "pass": true, "detail": "0 parallel runs over 4px" },
                { "name": "shadow-share", "pass": true, "detail": "35.2% of filled" },
                { "name": "ao-coverage", "pass": false,
                  "detail": "shadow-deep is 14.3% of filled pixels; the hard limit is 12%",
                  "hint": "Narrow an occlusion band. The widest is y=39-40, x 11-33." } ] }
```

Ambient occlusion is a placement, not a wash. The gate measured 14.3% against a hard
limit of 12%, and it named the widest band. The belt occlusion is two full rows across
the whole waist, which is more than the form justifies. Undo that one call and re-place
it one row deep:

```
undo { "assetId": "…", "count": 1 }
→ { "seq": 15, "undone": "shade shadow-deep" }

shade { "assetId": "…", "target": "shadow-deep", "from": "silhouette",
        "region": { "x": 11, "y": 39, "w": 23, "h": 1 }, "depth": 2 }
→ { "changed": 23, "bounds": { "x": 11, "y": 39, "w": 23, "h": 1 }, "seq": 17 }

check_step { "assetId": "…" }
→ { "name": "ao-coverage", "pass": true, "detail": "shadow-deep 7.9% of filled" }

advance_step { "assetId": "…" } → { "step": "light" }
```

## A6. Light

```
shade { "assetId": "…", "target": "light", "from": "silhouette",
        "direction": "upper-left", "depth": 1 }
→ { "changed": 239, "bounds": { "x": 10, "y": 4, "w": 28, "h": 58 }, "seq": 18,
    "skipped": 0 }

check_step { "assetId": "…" }
→ { "step": "light", "pass": true,
    "checks": [ { "name": "placement", "pass": true },
                { "name": "light-share", "pass": true, "detail": "25.5%, shadow 35.2%" },
                { "name": "ceiling", "pass": true, "detail": "max L 0.841" },
                { "name": "extremes", "pass": true },
                { "name": "band-count", "pass": true, "detail": "skin 4, cloth 3, leather 3, hair 3" } ] }

advance_step { "assetId": "…" } → { "step": "rim" }
```

## A7. Rim

Pass the same `direction` you used for shadow. The engine places the rim opposite it.

```
shade { "assetId": "…", "target": "rim", "from": "silhouette",
        "direction": "upper-left" }
→ { "changed": 41, "bounds": { "x": 17, "y": 4, "w": 20, "h": 34 }, "seq": 19 }

read_region { "assetId": "…", "layer": "rim", "x": 14, "y": 4, "w": 22, "h": 10 }
→ legend: T=20 rim.deep  U=21 rim.soft  V=22 rim  .=transparent

           15   20   25   30   35
     4 | ......UVVVVVU.........
     5 | .............U........
     6 | ..............VVU.....
     7 | ................VV....
     8 | ................TV....
     9 | ......................
    10 | ...................V..
    11 | ...................V..
    12 | ...................V..
    13 | ...................U..

check_step { "assetId": "…" }
→ { "step": "rim", "pass": true,
    "checks": [ { "name": "key-side", "pass": true, "detail": "0 rim pixels on the lit side" },
                { "name": "thickness", "pass": true, "detail": "1px" },
                { "name": "broken", "pass": true, "detail": "runs 5,3,2,2,4; gaps 1,2,1,3" },
                { "name": "coverage", "pass": true, "detail": "0.19 of perimeter, target 0.15–0.25" },
                { "name": "bottom-clear", "pass": true },
                { "name": "contrast", "pass": true, "detail": "min ΔL 0.24" } ] }

advance_step { "assetId": "…" } → { "step": "detail" }
```

## A8. Detail

Face on the eye line, a cast shadow from the collar, the coat seam. Everything here is
placed by hand into the `detail` layer.

```
draw_runs { "assetId": "…", "layer": "detail", "runs": [
  { "y": 14, "x0": 21, "x1": 22, "slot": 17 },
  { "y": 14, "x0": 25, "x1": 26, "slot": 17 },
  { "y": 18, "x0": 23, "x1": 24, "slot": 2  },
  { "y": 26, "x0": 19, "x1": 28, "slot": 8  },
  { "y": 27, "x0": 20, "x1": 27, "slot": 8  } ] }
→ { "changed": 26, "bounds": { "x": 19, "y": 14, "w": 10, "h": 14 }, "seq": 20 }
```

Rows 14 are the two eyes, 2 px each, on the eye line, in ink dark. Row 18 is the mouth
in skin shadow. Rows 26–27 are the collar's cast shadow on the coat, in cloth-green
shadow, offset down from its caster at rows 24–25.

The coat seam, as geometry rather than runs:

```
draw_shape { "assetId": "…", "layer": "detail", "shape": "line",
             "from": { "x": 23, "y": 28 }, "to": { "x": 23, "y": 40 },
             "slot": 5, "fill": false, "pixelPerfect": true }
→ { "changed": 13, "bounds": { "x": 23, "y": 28, "w": 1, "h": 13 }, "seq": 21 }

check_step { "assetId": "…" }
→ { "step": "detail", "pass": false,
    "checks": [
      { "name": "noise", "pass": true, "detail": "2 orphan pixels, budget 6" },
      { "name": "feature-budget", "pass": true, "detail": "4 features below 4x4" },
      { "name": "separator-length", "pass": false,
        "detail": "run of 13px at x=23, y=28–40; maximum is 8",
        "hint": "Break the seam: remove y=34 and y=35 at x=23." },
      { "name": "detail-distribution", "pass": true, "detail": "64% in the top 40%" },
      { "name": "colour-change-rate", "pass": true, "detail": "0.29, target 0.22–0.38" } ] }

set_pixels { "assetId": "…", "layer": "detail", "pixels": [
  { "x": 23, "y": 34, "slot": 0 }, { "x": 23, "y": 35, "slot": 0 } ] }
→ { "changed": 2, "bounds": { "x": 23, "y": 34, "w": 1, "h": 2 }, "seq": 22 }

check_step { "assetId": "…" } → { "step": "detail", "pass": true }
advance_step { "assetId": "…" } → { "step": "accent" }
```

## A9. Accent, cleanup, export

```
set_pixels { "assetId": "…", "layer": "accent", "pixels": [
  { "x": 21, "y": 14, "slot": 22 }, { "x": 25, "y": 14, "slot": 22 } ] }
→ { "changed": 2, "bounds": { "x": 21, "y": 14, "w": 5, "h": 1 }, "seq": 23 }

antialias { "assetId": "…", "layer": "detail", "strength": 1 }
→ { "changed": 9, "bounds": { "x": 17, "y": 13, "w": 14, "h": 15 }, "seq": 24 }

check_step { "assetId": "…" }
→ { "step": "accent", "pass": true,
    "checks": [ { "name": "specular-count", "pass": true, "detail": "2 pixels, budget 6" },
                { "name": "specular-value", "pass": true, "detail": "max L 0.930" },
                { "name": "palette", "pass": true, "detail": "22 slots, unchanged" } ] }

read_canvas { "assetId": "…" }            # the flattened composite, one last look

export_png { "assetId": "…", "scale": 1, "layers": "visible" }
→ { "path": "<project export dir>/sofia-idle-south.png" }
```

---

# B. Deriving a palette and a silhouette from a reference

There is no import tool. The person imports the image in the application; the conform
pipeline detects its grid, reduces its palette in Oklab and stores the result. Your
side begins after that. If `read_reference` returns `asset.not_found`, ask the person
to import the image — do not try to read a file.

```
open_asset { "assetId": "…" }
→ { "step": "reference", "palette": { "slots": 0 }, "layers": "all empty" }

read_reference { "assetId": "…" }
→ { "referenceId": "…", "name": "traveller-concept.png",
    "conform": { "detectedGrid": { "cell": 6, "offsetX": 2, "offsetY": 1 },
                 "size": { "w": 48, "h": 64 },
                 "extractedColours": 31,
                 "warnings": ["soft edges on the right shoulder; alpha hardened",
                              "3 colours below 0.2% coverage were merged"] },
    "grid": "… 64 rows of 48 characters in the reference's own extracted palette …" }
```

Read the warnings. "Alpha hardened" means the importer made a decision about where the
edge is; check that edge against the grid before you trust the silhouette you derive
from it.

## B1. Propose, correct, apply

```
extract_palette { "assetId": "…", "referenceId": "…", "maxSlots": 22 }
→ { "proposal": { "ramps": [
      { "name": "skin",   "material": "skin",  "slots": ["#8C6552","#C19470","#D8BC9E"] },
      { "name": "coat",   "material": "cloth", "slots": ["#2E4770","#406EB3"] },
      { "name": "trim",   "material": "cloth", "slots": ["#4C7A4E","#69945F","#A0AF7E"] },
      { "name": "boots",  "material": "leather","slots": ["#3A3210","#604914","#896B4D"] },
      { "name": "hair",   "material": "hair",  "slots": ["#33172B","#492C46","#64546E"] } ],
    "unassigned": ["#0E0418", "#E8E8E8"] } }
```

Four problems, all typical of extraction, all fixed before sending:

1. `coat` has 2 steps. Cloth wants 3. Add a light step above the base.
2. `skin` rotates 30° → 45° → 52° going lighter — warm, correct — but its shadow step
   only loses lightness. Rotate it toward red: `#885659`, `#AC7361`.
3. There is no rim family. `#E8E8E8` came back unassigned and is a near-grey; discard
   it and add the project's shared `rim` ramp.
4. `#0E0418` unassigned is the reference's darkest value. Make it the base of the
   shared `ink` ramp rather than leaving it loose.

```
set_palette { "assetId": "…", "ramps": [
  { "name": "skin",        "material": "skin",    "slots": ["#885659","#AC7361","#C19470","#D0B692"] },
  { "name": "cloth-blue",  "material": "cloth",   "slots": ["#3F4595","#406EB3","#5697C3"] },
  { "name": "cloth-green", "material": "cloth",   "slots": ["#2B7750","#69945F","#A0AF7E"] },
  { "name": "leather",     "material": "leather", "slots": ["#322C00","#604914","#896B4D"] },
  { "name": "hair",        "material": "hair",    "slots": ["#2E0C20","#492C46","#64546E"] },
  { "name": "ink",         "material": "ink",     "slots": ["#0E0418","#211E36","#363C50"] },
  { "name": "rim",         "material": "rim",     "slots": ["#B3AC82","#DDC8A2","#FBE3CE"] } ] }
→ { "slots": 22, "ramps": 7 }
```

Sending the raw proposal instead gives:

```
→ error { "code": "palette.rule_violation",
          "message": "ramp 'coat' has 2 steps; the minimum is 3",
          "hint": "Add a lighter step: rotate hue −12° to −20°, chroma ×0.70–0.85, ΔL +0.09 to +0.15." }
```

## B2. Silhouette from the reference grid

`read_reference` returned the conformed grid in the asset's palette. Read the
silhouette layer, which is still empty, then paste the reference's opaque mask into it
as a single slot — do not paste the reference's colours, because they are its palette's
clusters and not your ramps.

Take the mask from the reference grid row by row, replacing every non-`.` character
with `F`, then paste. Then read back and compare:

```
paste_grid { "assetId": "…", "layer": "silhouette", "x": 0, "y": 0,
             "mode": "replace",
             "rows": [ 64 rows of 48 characters, one per canvas row, `F` wherever the
                       reference grid was opaque and `.` where it was not — the same
                       shape as the block in A2 ] }
→ { "changed": 941, "bounds": { "x": 9, "y": 3, "w": 30, "h": 58 }, "seq": 4 }

check_step { "assetId": "…" }
→ { "step": "silhouette", "pass": false,
    "checks": [
      { "name": "single-region", "pass": false,
        "detail": "3 disconnected regions; largest is 933px, others 6px and 2px",
        "hint": "Remove the stray pixels at (38,12) and (9,44), or connect them." },
      { "name": "margin", "pass": false,
        "detail": "filled pixels in row 3 at x 20–27",
        "hint": "The style reserves 2 rows at the top for a head extremity; translate the layer down by 1." } ] }
```

Both failures are the conform step's soft edges, and both have mechanical fixes:

```
set_pixels { "assetId": "…", "layer": "silhouette", "pixels": [
  { "x": 37, "y": 12, "slot": 0 }, { "x": 38, "y": 12, "slot": 0 },
  { "x": 37, "y": 13, "slot": 0 }, { "x": 38, "y": 13, "slot": 0 },
  { "x": 37, "y": 14, "slot": 0 }, { "x": 38, "y": 14, "slot": 0 },
  { "x": 9,  "y": 44, "slot": 0 }, { "x": 9,  "y": 45, "slot": 0 } ] }
→ { "changed": 8, "bounds": { "x": 9, "y": 12, "w": 30, "h": 34 }, "seq": 5 }

translate { "assetId": "…", "layer": "silhouette", "dx": 0, "dy": 1 }
→ { "changed": 933, "bounds": { "x": 10, "y": 4, "w": 28, "h": 58 }, "seq": 6, "lost": 0 }
```

`lost: 0` matters — `translate` discards pixels pushed off the canvas. A non-zero count
means you shifted content out of existence and should `undo`.

```
check_step { "assetId": "…" } → { "step": "silhouette", "pass": true }
```

From here the flats, outline, shadow, light, rim, detail and accent steps are identical
to recipe A. Keep reading the reference as you go — `read_reference` costs one call and
tells you where the material boundaries were in the original.

---

# C. A colour variation of a finished sprite

The sprite is finished and its gates all pass. Make the same traveller in rose.

```
get_step { "assetId": "…" }
→ { "step": "accent", "pass": true, "next": "variation" }

advance_step { "assetId": "…" } → { "step": "variation" }

describe_palette { "assetId": "…" }
→ ramp cloth-blue (cloth): slot 5 #3F4595 L 0.430
                            slot 6 #406EB3 L 0.539   ← base
                            slot 7 #5697C3 L 0.651
```

The rule is one line: **hold every OKLCH lightness within ±0.02 and move only hue and
chroma.** Hue carries identity, value carries form; a swap that changes lightness
changes the perceived shape.

Blue base is L 0.539, C 0.120, H 258°. Rose at the same lightness and the same chroma
is H 352°. Then reproduce the ramp's own shifts from the new base: the shadow step
rotates 18° toward violet, which from 352° is 334°, and gains chroma slightly; the light
step rotates 18° the other way, to 10°, and loses chroma.

```
create_variation { "assetId": "…", "name": "sofia-idle-south-rose",
                   "remap": [
                     { "ramp": "cloth-blue",
                       "to": ["#782E6D", "#A14E76", "#C17782"] } ] }
→ { "assetId": "…", "name": "sofia-idle-south-rose",
    "layers": "copied unchanged", "palette": { "slots": 22, "ramps": 7 } }

open_asset { "assetId": "…" }
describe_palette { "assetId": "…" }
→ ramp cloth-blue (cloth): slot 5 #782E6D L 0.430  (was 0.430, Δ 0.000)
                            slot 6 #A14E76 L 0.539  (was 0.539, Δ 0.000)
                            slot 7 #C17782 L 0.651  (was 0.651, Δ 0.000)

check_step { "assetId": "…" }
→ { "step": "variation", "pass": true,
    "checks": [ { "name": "value-structure", "pass": true, "detail": "max ΔL 0.001, limit 0.02" },
                { "name": "hue-shift-preserved", "pass": true, "detail": "+18°/−18° per step, source +18°/−18°" },
                { "name": "edge-separation", "pass": true, "detail": "min ΔL 0.08" },
                { "name": "fixed-values", "pass": true, "detail": "ink and rim unchanged" } ] }
```

What to remap and what to leave alone:

- Remap freely: main cloth, secondary cloth, hair, accents, and leather within ±40° of
  brown.
- Remap within limits: skin hue ±25°, and only if the whole ramp moves together; metal
  may go steel → gold → bronze but must keep a value spread ≥ 0.45.
- Never remap: `ink` — the darkest value in the sprite stays the darkest value — and
  `rim`, which is the scene's light and is shared by every character. Changing the rim
  per character breaks the lighting illusion across the cast.

A failed variation looks like this, and the fix is always the same:

```
→ { "name": "value-structure", "pass": false,
    "detail": "ramp cloth-blue step 2: L 0.612, source 0.539, Δ +0.073",
    "hint": "Hold L and move hue and chroma only. Target L 0.539 ±0.02." }
```

Recompute that one hex at the source lightness and re-send `create_variation`; do not
repaint pixels to compensate.

```
export_png { "assetId": "…", "scale": 1, "layers": "visible" }
→ { "path": "<project export dir>/sofia-idle-south-rose.png" }
```

For a party, `export_sheet { "assetId": "…", "columns": 4, "padding": 1 }` packs the
frames and returns the path plus each frame's rectangle.
