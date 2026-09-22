# Failure modes, detection, and the calls that fix them

Every heuristic here is computed from the pixel buffer, which means `check_step` will
find it before you do. Run this list yourself at the `detail` and `accent` steps, and
whenever a sprite "looks wrong" and you cannot say why.

---

## 1. Noise — orphan pixels

**Symptom.** Isolated single pixels of one slot surrounded by another. Speckle.

**Detect.** For every pixel, count the 8-neighbours carrying the same slot.

- 0 same-slot neighbours is an orphan. Fail above **2% of filled pixels**, or above
  **6 pixels** on `hd2d-field`.
- More than **6% of filled pixels** with ≤ 1 like neighbour means the sprite is
  speckled.
- Whitelisted: eye highlights, the single metal specular, and deliberate AA corner
  pixels, which by definition sit in a run.

**Fix.** The minimum meaningful mark is 2 px. Either merge the orphan into its most
common neighbour, or grow it into a 2×1 or 2×2 cluster if it was carrying information.

```
read_region { "assetId": "…", "layer": "detail", "x": 18, "y": 12, "w": 14, "h": 10 }
set_pixels  { "assetId": "…", "layer": "detail",
              "pixels": [ { "x": 27, "y": 16, "slot": 0 },
                          { "x": 20, "y": 33, "slot": 0 } ] }
```

Orphans created by a whole pass — a `shade` that speckled a narrow form — are not worth
patching pixel by pixel:

```
undo { "assetId": "…", "count": 1 }
shade { "assetId": "…", "target": "shadow-core", "from": "silhouette",
        "region": { "x": 11, "y": 24, "w": 25, "h": 18 }, "depth": 1 }
```

Restricting `region` to the forms large enough to take shading is the fix; forms smaller
than 4 × 4 px get 2 slots at most and no shading at all.

---

## 2. Jaggies — broken lines and curves

**Symptom.** A curve whose run lengths do not change monotonically — `4,2,3,1` instead
of `4,3,2,1`. The line looks chewed.

**Detect.** Trace each contiguous edge into a run-length sequence and flag when:

- the sequence is non-monotonic across 4 or more runs (up-down-up), or
- a run of length 1 sits between two runs of length ≥ 3, or
- the same run length repeats more than 5 times and then jumps by more than 2.

**Fix.** Rewrite the whole run sequence, not the offending pixel. Legal sequences at
these scales: `1,1,1,…` (45°), `2,2,2,…`, `3,3,3,…`, and monotone runs like
`5,4,3,2,1,1` or `1,1,2,3,4,6`.

```
read_region { "assetId": "…", "layer": "silhouette", "x": 28, "y": 24, "w": 10, "h": 12 }
draw_runs   { "assetId": "…", "layer": "silhouette", "runs": [
  { "y": 27, "x0": 12, "x1": 34, "slot": 6 },
  { "y": 28, "x0": 12, "x1": 35, "slot": 6 },
  { "y": 29, "x0": 12, "x1": 35, "slot": 6 } ] }
```

Never anti-alias a jaggy. `antialias` over a bad line produces a blurry bad line.

---

## 3. Muddy mid-tones

**Symptom.** The sprite reads grey or brown and flat; forms do not separate.

**Detect.**

- More than **55%** of filled pixels inside any 0.15-wide OKLCH L window → value
  compressed.
- Total L range below **0.55** → contrast too low. Aim for ≥ 0.60.
- Any palette pair with **ΔL < 0.05 and ΔH < 20°** → each such pair is a wasted slot and
  a mud source. The target is zero.
- The sprite passes the 1× read in colour but fails it in greyscale → colour is doing
  work the values should be doing.

**Fix.** This is a palette problem, not a pixel problem. Merge the redundant pairs, then
push the extremes.

```
describe_palette { "assetId": "…" }
revisit_step { "assetId": "…", "step": "palette" }
set_palette  { "assetId": "…", "ramps": [ every ramp, corrected — set_palette replaces
                                          the palette, it does not merge into it ] }
```

Darken the deepest step and brighten the lightest until the L range is ≥ 0.6, and raise
chroma in the shadows rather than lightness. Nothing in any layer moves — pixels are
slot numbers — so this costs you no drawing.

---

## 4. Inconsistent light direction

**Symptom.** One form lit from the left, another from the right. The sprite reads as a
collage.

**Detect.** Segment into connected regions per material; for each, take the vector from
the centroid of its darkest band to the centroid of its lightest band. Flag any region
deviating **> 45°** from the circular mean, flag the sprite if the mean is **> 30°**
from the declared key, and flag if the circular standard deviation exceeds **35°**.

**Cause, almost always.** Two `shade` calls with different `direction` values, or one
call that omitted `direction` after another that passed it.

**Fix.** Re-shade the offending regions only. Do not rotate the whole sprite's lighting
to match a mistake.

```
get_style_rules { "assetId": "…" }      # confirm the declared direction
clear_layer { "assetId": "…", "layer": "shadow-core" }
shade { "assetId": "…", "target": "shadow-core", "from": "silhouette",
        "direction": "upper-left", "depth": 1 }
```

If only one form is wrong, scope it rather than clearing the layer:

```
shade { "assetId": "…", "target": "shadow-core", "from": "silhouette",
        "region": { "x": 33, "y": 30, "w": 3, "h": 3 },
        "direction": "upper-left", "depth": 1 }
```

---

## 5. Pillow shading

**Symptom.** Shading applied concentrically inward from the silhouette — dark at the
edges, light in the middle, no light direction. Every form is an inflated cushion.

**Detect.** Distance transform to the nearest transparent pixel, then correlate that
distance with lightness. Pearson **r > 0.6** is pillow shading.

**Its disguise:** a ring of core shadow one pixel inside the outline all the way around.
The shadow ring must be **absent on the key-lit 25–40%** of the perimeter.

**Fix.** Pillow shading cannot be patched; it is redone. Keep the flats and rebuild the
shading with one explicit light vector.

```
clear_layer { "assetId": "…", "layer": "light" }
clear_layer { "assetId": "…", "layer": "shadow-core" }
clear_layer { "assetId": "…", "layer": "shadow-deep" }
revisit_step { "assetId": "…", "step": "shadow" }
shade { "assetId": "…", "target": "shadow-core", "from": "silhouette",
        "direction": "upper-left", "depth": 1 }
```

Shadow before light, always. Placing light first is what tempts you into shading inward
from the edge.

---

## 6. Banding

**Symptom.** Two or more colour boundaries running parallel to each other and to the
outline, at uniform thickness, so the eye locks onto the lines between colours instead
of the form.

**Detect.** Zero pairs of adjacent boundaries may be parallel for more than **4
consecutive pixels**. Band thickness standard deviation must be **≥ 1 px** along each
band.

**Fix.** Break the parallel run. Vary thickness — thin where the form turns fast, thick
where it turns slowly — and let ramp steps skip: `base → deep shadow` directly in a hard
crease is correct and breaks the band.

```
read_region { "assetId": "…", "layer": "shadow-core", "x": 11, "y": 28, "w": 25, "h": 12 }
draw_runs   { "assetId": "…", "layer": "shadow-core", "runs": [
  { "y": 30, "x0": 27, "x1": 30, "slot": 5 },
  { "y": 31, "x0": 26, "x1": 30, "slot": 5 },
  { "y": 32, "x0": 26, "x1": 30, "slot": 5 },
  { "y": 33, "x0": 28, "x1": 31, "slot": 5 },
  { "y": 34, "x0": 27, "x1": 31, "slot": 5 } ] }
```

Never place a shadow band that mirrors the outline at a constant 1–2 px offset. That is
banding and pillow shading at once.

---

## 7. Over-detailing at small sizes

**Symptom.** Buttons, buckles, fingers, embroidery — all illegible, all noisy.

**Detect.**

- Any non-base slot with more than **8 connected components** on a 48 × 64 sprite.
- Components of area ≤ 2 px making up more than **10%** of all components.
- Horizontal colour-change rate — adjacent differing pairs ÷ filled pixels — above
  **0.45**. HD-2D field sprites sit at **0.22–0.38**.

**Fix.** Apply the detail budget: at most **5 features below 4 × 4 px** on a 48 × 64
canvas. Eyes are one feature, a belt buckle is one. Delete the rest and let the larger
shapes imply them. Spend what remains where the viewer looks: **60% of detail pixels in
the top 40% of the sprite**.

```
read_canvas { "assetId": "…", "layer": "detail" }
clear_layer { "assetId": "…", "layer": "detail" }
draw_runs   { "assetId": "…", "layer": "detail", "runs": [
  { "y": 14, "x0": 21, "x1": 22, "slot": 17 },
  { "y": 14, "x0": 25, "x1": 26, "slot": 17 },
  { "y": 18, "x0": 23, "x1": 24, "slot": 2 },
  { "y": 26, "x0": 19, "x1": 28, "slot": 8 },
  { "y": 27, "x0": 20, "x1": 27, "slot": 8 } ] }
```

Clearing and re-placing is one op and one undo. Deleting 40 stray pixels with
`set_pixels` is 40 chances to miscount a column.

---

## 8. Losing the silhouette

**Symptom.** The sprite reads as a blob, or sinks into the background.

**Detect.**

- Perimeter² / area on the 50% alpha mask outside **18–28**. Below 18 the shape is too
  blobby; above 28 single-pixel spikes are eating the outline.
- Solidity — filled ÷ convex hull — outside **0.62–0.82**. Below 0.55 the shape is
  spindly; above 0.88 it has no negative space.
- Fewer than **1** interior hole or notch of at least 2 × 2 px.
- Edge contrast against mid-grey below ΔL 0.25 on more than 30% of the perimeter.

**Fix.** Widen or exaggerate the defining extremity, carve a notch between arm and
torso, and raise rim coverage on the top and upper-back edges.

```
revisit_step { "assetId": "…", "step": "silhouette" }
draw_runs { "assetId": "…", "layer": "silhouette", "runs": [
  { "y": 30, "x0": 31, "x1": 32, "slot": 0 },
  { "y": 31, "x0": 31, "x1": 32, "slot": 0 },
  { "y": 32, "x0": 31, "x1": 32, "slot": 0 } ] }
check_step { "assetId": "…" }
```

That is the arm-to-torso gap: three runs, one enclosed 2 × 3 hole, and it moves both
solidity and the negative-space check at once.

---

## 9. Tangents

**Symptom.** Two edges just touch, or run 1 px apart, fusing two forms into one
ambiguous shape.

**Detect.** Scan for edges of two different parts adjacent or 1 px apart for **≥ 3
consecutive pixels**.

**Fix.** Never leave a 0–1 px kiss. Either overlap by ≥ 2 px, so the occlusion is
unambiguous, or separate by ≥ 2 px, so the gap is.

```
draw_runs { "assetId": "…", "layer": "silhouette", "runs": [
  { "y": 30, "x0": 31, "x1": 32, "slot": 0 },
  { "y": 31, "x0": 31, "x1": 32, "slot": 0 },
  { "y": 32, "x0": 31, "x1": 32, "slot": 0 } ] }
```

---

## 10. Sticker outline

**Symptom.** A uniform dark line all the way around. The sprite sits on top of the scene
instead of in it.

**Detect.** Outline coverage above **75%** of the perimeter, fewer than 3 distinct
outline colours on a sprite with 3 or more materials, or any `#000000` pixel.

**Cause.** `mode: "full"`, or outline pixels drawn by hand.

**Fix.** Never draw outline pixels by hand. Let the tool derive each one from the fill
it borders.

```
clear_layer { "assetId": "…", "layer": "outline" }
outline { "assetId": "…", "from": "silhouette", "mode": "selective", "darken": 2 }
diff_layers { "assetId": "…", "a": "silhouette", "b": "outline" }
```

Where the outline is dropped, the outermost pixel must be at least the material's base
value. Never drop it along the bottom 20% of the sprite — the contact region needs the
darkest possible edge to anchor the character to the ground.

---

## 11. Rim reading as a glow sticker

**Symptom.** A bright halo all the way around, or a rim on the key-lit side.

**Detect.** Coverage above **35%** of the perimeter is a hard fail; 15–25% is the
target. Any run longer than **8 px**. Any rim pixel in the bottom 25% of the sprite. Any
rim pixel on the key side. Rim-to-neighbour contrast below **ΔL 0.20**.

**Fix.** Redo the pass with the same `direction` as the shadow pass — the engine places
the rim opposite it — then break the runs by hand if the result is still continuous.

```
clear_layer { "assetId": "…", "layer": "rim" }
shade { "assetId": "…", "target": "rim", "from": "silhouette",
        "direction": "upper-left" }
read_region { "assetId": "…", "layer": "rim", "x": 14, "y": 4, "w": 22, "h": 14 }
set_pixels  { "assetId": "…", "layer": "rim", "pixels": [
  { "x": 29, "y": 9,  "slot": 0 },
  { "x": 30, "y": 10, "slot": 0 } ] }
```

Runs of 3–7 px separated by gaps of 1–3 px, broken at every concave point of the
silhouette. Every run of length ≥ 4 ends in the softer rim step so it tapers.

---

## 12. Halo on the outer edge

**Symptom.** A dirty fringe around the sprite over some backgrounds and not others.

**Detect.** Any alpha value other than 0 and 255 in the edge ring. Any anti-aliased
pixel on the perimeter.

**Cause.** `antialias` was pointed at the outer boundary — which it refuses — or AA
pixels were placed by hand along the silhouette.

**Fix.** Anti-alias interior edges only. `antialias` will not touch the outer boundary
by design, because a billboard sprite sits on backgrounds of unknown colour.

```
read_region { "assetId": "…", "layer": "detail", "x": 10, "y": 24, "w": 28, "h": 14 }
set_pixels  { "assetId": "…", "layer": "detail",
              "pixels": [ { "x": 11, "y": 29, "slot": 0 },
                          { "x": 35, "y": 29, "slot": 0 } ] }
antialias   { "assetId": "…", "layer": "detail", "strength": 1 }
```

AA belongs only on curves and shallow diagonals, only at run corners, only on canvases
≥ 48 × 64, never on a 45° diagonal, never on a feature ≤ 3 px, and never where it would
create a value used only once in the sprite.

---

## 13. Dither reading as dirt

**Symptom.** Speckled texture that fights the cel banding.

**Detect.** Default is **zero dither pixels** on a character sprite. If any exist, the
field must be ≥ 6 × 6 px, between adjacent ramp steps only (ΔL ≤ 0.13), never on the
face, never across the outer silhouette edge.

**Fix.** Delete it. At 48 × 64 with a 22-slot palette, dither reads as dirt.

```
read_region { "assetId": "…", "layer": "detail", "x": 12, "y": 42, "w": 24, "h": 10 }
clear_layer { "assetId": "…", "layer": "detail" }
```

Dither earns its place only as texture where the noise *is* the material — stone, dirt,
fur, rust — as a transparency effect, or to extend a ramp on a large flat area of a
`hd2d-large` canvas.

---

## 14. Quick numeric index

| Metric | Target |
| --- | --- |
| Palette size, 48 × 64 | 14–22, hard max 32 |
| Orphan pixels | ≤ 2% of filled, ≤ 6 absolute |
| Pixels with ≤ 1 like neighbour | ≤ 6% |
| OKLCH L range | ≥ 0.55, ideally ≥ 0.60 |
| Pixels inside any 0.15 L window | ≤ 55% |
| Palette pairs with ΔL < 0.05 and ΔH < 20° | 0 |
| Deep-shadow (AO) coverage | ≤ 8% of filled, hard fail > 12% |
| Light / base / shadow split | ≈ 25 / 40 / 35 |
| Rim coverage of perimeter | 15–25%, hard fail > 35% |
| Outline coverage of perimeter | 60–75% |
| Horizontal colour-change rate | 0.22–0.38 |
| Perimeter² / area, alpha mask | 18–28 |
| Solidity | 0.62–0.82 |
| Light-vector circular std dev | ≤ 35° |
| Lightness ↔ edge-distance correlation | r ≤ 0.6 |
| Alpha values used | only 0 and 255 |
| Specular pixels | ≤ 6, max L 0.97 |
| Features below 4 × 4 px | ≤ 5 |
| Cast shadows | 2–4 |

---

## 15. When the tool, not the sprite, is the problem

| What you see | What it means |
| --- | --- |
| A write returns `"changed": 0` | Wrong layer, wrong coordinates, or that slot was already there. `read_region` the target before writing again. |
| `shade` returns a non-zero skipped count | Those source slots belong to no ramp. The silhouette flats are painted with an unramped slot. Fix the flats. |
| `translate` returns a non-zero `lost` | Pixels were pushed off the canvas and are gone. `undo` and translate by less. |
| `outline` covers 100% of the perimeter | `mode` was not `selective`. Check `get_style_rules`. |
| `paste_grid` returns `grid.size_mismatch` | Ragged `rows`, or the block does not fit at `x, y`. Every string must be the same length. |
| `paste_grid` returns `grid.bad_character` | Only `.`, `A`–`Z`, `a`–`z`, `0`–`9` are legal. Rebuild the rows from `describe_palette`. |
| A write returns `step.wrong` | The layer belongs to another step. `revisit_step` rather than `force`. |
| A write returns `layer.locked` | The person locked it in the application. Say so and ask; do not work around it. |
| `read_history` shows ops you did not make | The person is drawing in the same document at the same time. Re-read before writing. |
