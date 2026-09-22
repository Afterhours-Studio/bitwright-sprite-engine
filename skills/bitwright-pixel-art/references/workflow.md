# The step workflow, in full

Ten steps. Each owns at most one layer role. The gate at the end of each step is
computed from the pixel buffer by the engine; `check_step` runs it without advancing,
`advance_step` runs it and moves on if it passes.

Canvas assumed below: `hd2d-field`, 48 × 64, light from `upper-left`, contact row
`y = 61`. Substitute your asset's numbers from `get_style_rules`.

---

## 1. `reference` — layer: none

Optional. Skip it when you are drawing from a description.

Reference images are imported by the person in the application; there is no import
tool. Once one exists, `read_reference { assetId }` returns it conformed to a grid in
the asset's palette, plus the conform report (detected grid, extracted palette,
warnings). `extract_palette { assetId, referenceId, maxSlots }` proposes ramps from it
without applying them.

**Gate:** none. `advance_step` always passes.

---

## 2. `palette` — layer: none

Write ramps with `set_palette`. Read them back with `describe_palette`, which reports
every slot's hex, name, ramp and position, and every ramp darkest-first — this is how
you learn that slot 7 is `cloth-red` step 2 of 4 and therefore what stepping down from
it means.

**Gate checks and thresholds**

| Check | Threshold |
| --- | --- |
| Ramp length | 3–5 steps per ramp |
| Palette size | ≤ 24 slots on the `hd2d` preset; 14–22 is the working range for 48 × 64; hard ceiling 32 |
| Hue shift present | every ramp rotates hue per step; a ramp that only changes lightness is rejected |
| Darker step, hue | +12° to +20° toward blue/violet per step; ≤ ~45° across a ramp |
| Darker step, chroma | × 0.85 – 1.12 of the base step |
| Darker step, lightness | ΔL −0.08 to −0.13 (OKLCH) per step |
| Lighter step, hue | −12° to −20° toward yellow/orange per step |
| Lighter step, chroma | × 0.70 – 0.85 of the base step |
| Lighter step, lightness | ΔL +0.09 to +0.15 (OKLCH) per step |
| Skin exception | ramps whose material is `skin` rotate toward red/magenta in shadow, not blue |
| Value floor | darkest slot OKLCH L in 0.10 – 0.16 |
| Value ceiling | lightest slot OKLCH L in 0.88 – 0.94 |
| Edge separation | any two slots that will touch differ by ΔL ≥ 0.07 |
| Mud pairs | zero pairs with ΔL < 0.05 **and** ΔH < 20° |

Failure code: `palette.rule_violation`, with the offending ramp named in the hint.

---

## 3. `silhouette` — layer: `silhouette`

Two passes into one layer.

**Pass A — the mask.** One slot, the whole character mass. `paste_grid` is the tool.

**Pass B — the base flats.** Repaint the mask with each material's *base* slot, still
in `silhouette`, before advancing. `draw_runs` is the tool. `shade` later reads this
layer and resolves each pixel's ramp from the slot it finds, so a mask left in one flat
colour produces one ramp of shading for the entire sprite.

**Gate checks and thresholds**

| Check | Threshold |
| --- | --- |
| `single-region` | exactly one 4-connected filled region |
| `reads-at-1x` | the shape survives a 50% downscale |
| Occupancy, height | bbox height ≥ 0.85 × H → ≥ 55 rows on a 64-high canvas |
| Occupancy, width | bbox width 0.45 – 0.75 × W → 22–36 columns on a 48-wide canvas |
| Margin | no filled pixel in row 0, row H−1, column 0, column W−1; 2 rows clear at the top if there is a head extremity |
| Contact row | lowest filled row == the style's contact row (61 on `hd2d-field`) |
| Extremities | 2–4 distinct protrusions |
| Negative space | ≥ 1 enclosed hole or notch of at least 2 × 2 px |
| Tangents | zero pairs of part edges adjacent or 1 px apart for ≥ 3 consecutive pixels; fix by overlapping ≥ 2 px or gapping ≥ 2 px |
| Asymmetry | not bilaterally identical; 1–2 asymmetric elements, not five |
| Perimeter² / area, alpha mask at 50% | 18–28 |
| Solidity (filled ÷ convex hull) | 0.62 – 0.82 |
| Centre of mass | horizontal centroid within ±1 px of the canvas centreline |

Flats-specific checks, measured on the same layer:

| Check | Threshold |
| --- | --- |
| Base slots only | no shading slots present; one base slot per material |
| Adjacent material separation | ΔL ≥ 0.07 between touching bases |
| Area share | no single material other than skin and the main cloth exceeds 40% of filled pixels |
| Signature hue | exactly one high-chroma hue, at 8–15% of filled pixels |
| Greyscale legibility | head, torso, arms, legs, held objects still separable with hue removed |

Landmark rows for a 3.5-head figure on 48 × 64 — use these before drawing, not after:

```
crown        y = 4        head height 17 px, head width 14 px (0.80–0.90 × height)
eye line     y = 14       (58% down the head, not the middle)
chin         y = 21
shoulder     y = 24       shoulder width 1.6 × head width for an adult male,
waist        y = 38                      1.4 slim, 1.9 armoured
hip          y = 41
knee         y = 50
sole         y = 61       the contact row; identical for every sprite in the project
```

Legs are 40–45% of total height. Hands are mitten blocks ≤ 5 px wide; no fingers below
a 96 px canvas. Feet are 3–5 px wide seen from the front.

---

## 4. `outline` — layer: `outline`

One call:

```jsonc
{ "assetId": "…", "from": "silhouette", "mode": "selective", "darken": 2 }
```

`mode: "selective"` is what HD-2D does — the outline is dropped where the key light
strikes, so the sprite reads as lit rather than as a sticker. Each outline pixel's
colour is derived from the fill it borders, never a flat black. Do not attempt to draw
outline pixels by hand; `draw_runs` into `outline` is for repairs only.

**Gate checks and thresholds**

| Check | Threshold |
| --- | --- |
| Containment | no outline pixel outside the silhouette; verify with `diff_layers { a: "silhouette", b: "outline" }` |
| Outline coverage | 60–75% of the perimeter present, 25–40% dropped |
| Thickness | 1 px everywhere; 2 px only at ≥ 96 × 128 and only on the shadow side |
| Bottom band | the bottom 20% of the sprite has a full outline, zero dropped pixels |
| Dropped edges | where dropped, the outermost pixel is at least the material's base value |
| Hue variety | ≥ 3 distinct outline colours on a sprite with ≥ 3 materials |
| Pure black | zero `#000000` pixels |

---

## 5. `shadow` — layers: `shadow-core`, then `shadow-deep`

Two `shade` calls, in this order:

```jsonc
{ "assetId": "…", "target": "shadow-core", "from": "silhouette", "depth": 1 }
{ "assetId": "…", "target": "shadow-deep", "from": "silhouette", "depth": 2,
  "region": { "x": 17, "y": 19, "w": 14, "h": 6 } }
```

`shadow-core` is the whole away-from-key side. `shadow-deep` is ambient occlusion only,
and it takes a `region` per placement: under the chin, under a hat brim, under the
belt, inside a neckline, in an armpit, between limbs, and the contact rows at the feet.
Never use `shadow-deep` as a general darker shadow.

**Gate checks and thresholds**

| Check | Threshold |
| --- | --- |
| Light direction | one consistent direction; per-region light vectors have circular std dev ≤ 35° and the mean is within 30° of the declared key |
| Pillow shading | correlation between lightness and distance-to-transparent, Pearson r ≤ 0.6 |
| Banding | zero pairs of adjacent colour boundaries parallel for > 4 consecutive pixels |
| Band thickness | varies along each band; thickness std dev ≥ 1 px |
| Key-lit arc | the key-lit 25–40% of the perimeter has no inward shadow ring |
| Shadow share | ≈ 35% ± 8 of filled pixels |
| Small forms | forms smaller than 4 × 4 px receive no shadow |
| `shadow-deep` coverage | ≤ 8% of filled pixels; hard fail above 12% |

---

## 6. `light` — layer: `light`

```jsonc
{ "assetId": "…", "target": "light", "from": "silhouette", "depth": 1 }
```

Light comes after shadow because the shadow shape is the form description, and because
placing light first tempts you into shading inward from the edge, which is pillow
shading.

**Gate checks and thresholds**

| Check | Threshold |
| --- | --- |
| Placement | every lit pixel lies on the toward-key side of its form's centroid |
| Light share | ≈ 25% ± 8 of filled pixels, and strictly less than the shadow share |
| Split | roughly 25% light / 40% base / 35% shadow |
| Ceiling | no pixel above L = 0.94 yet; specular is the `accent` step |
| Extremes | no `#FFFFFF`, no `#000000` anywhere |
| Band count | each material shows its budgeted band count: skin 4, cloth 3, leather 3, metal 5, hair 3–4 |
| Minimum bands | any form larger than 6 × 6 px has at least 3 bands |

---

## 7. `rim` — layer: `rim`

```jsonc
{ "assetId": "…", "target": "rim", "from": "silhouette", "direction": "upper-left" }
```

The engine writes only the edge pixels on the side away from the key light. Pass the
same `direction` you used for shadow — `rim` is placed opposite it, so passing the
opposite direction yourself puts the rim on the key side and fails the gate.

**Gate checks and thresholds**

| Check | Threshold |
| --- | --- |
| Side | zero rim pixels on the key-lit side |
| Position | rim sits on the outermost filled pixel; never outside the silhouette, never inside it |
| Thickness | 1 px on `hd2d-field`; 1–2 px at ≥ 64 × 96; never more than 2 |
| Broken | runs of 3–7 px separated by gaps of 1–3 px; zero runs longer than 8 px |
| Coverage | 15–25% of the perimeter; hard fail above 35%, reads as stray pixels below 10% |
| Taper | every run of length ≥ 4 ends in the softer rim step |
| Bottom | zero rim pixels in the bottom 25% of the sprite |
| Contrast | rim exceeds the adjacent fill by ΔL ≥ 0.20 |
| Consistency | the rim slots are identical across every sprite in the project |

---

## 8. `detail` — layer: `detail`

`draw_runs` and `set_pixels` here, plus `draw_shape` for straps and belts. Cast shadows
go in this layer too: 2–4 per sprite, in the core-shadow step of the material, offset
roughly (+1, +2) from their caster.

Interior separators are 1 px of the **occluded** form's shadow step, never the darkest
ink slot, and only where two forms differ by ΔL < 0.10. If they already differ by
ΔL ≥ 0.10 the value difference is the separator and drawing a line there is
over-outlining.

**Gate checks and thresholds**

| Check | Threshold |
| --- | --- |
| Noise | pixels with zero same-slot neighbours ≤ 2% of filled and ≤ 6 absolute |
| Speckle | pixels with ≤ 1 like neighbour ≤ 6% of filled |
| Feature budget | ≤ 5 features below 4 × 4 px on 48 × 64 |
| Components | no non-base slot has more than 8 connected components |
| Tiny components | components of area ≤ 2 px are ≤ 10% of all components |
| Colour-change rate | horizontal adjacent-pixel changes ÷ filled pixels, 0.22–0.38 |
| Detail distribution | ≥ 60% of detail pixels in the top 40% of the sprite |
| Separator length | ≤ 8 px before the run breaks |
| Face | eyes 1–2 px each, 2 slots maximum, on the eye-line row |
| Dither | default zero; if used, field ≥ 6 × 6 px, only between adjacent ramp steps, never on the face, never across the silhouette edge |

---

## 9. `accent` — layer: `accent`

`set_pixels` only. The highest-contrast marks in the sprite: metal speculars, eye
highlights, emissive points.

**Gate checks and thresholds**

| Check | Threshold |
| --- | --- |
| Specular count | ≤ 6 pixels total, only on metal, glass or eyes |
| Specular value | max L 0.97 |
| Palette | accents use existing slots |

Finish the sprite with `antialias { assetId, layer, strength: 1 }` on interior layers.
It refuses the outer silhouette boundary by design: a billboard sprite sits on
backgrounds of unknown colour and an anti-aliased outer edge produces a halo. Alpha
values other than 0 and 255 are forbidden at the edge.

Anti-alias only interior edges, only on curves and shallow diagonals, only at run
corners: 0 AA pixels for runs of 1–2 px, 1 for 3–4 px, 2 for 5–8 px, 3 for 9+ px. Never
on a 45° diagonal, never on a feature ≤ 3 px, never where it would create a value used
only once.

---

## 10. `variation` — layer: none

`create_variation { assetId, name, remap: [{ ramp, to: [hex, …] }] }` forks the asset
with a new palette and identical layers. Not one pixel moves, so the value structure is
preserved by construction.

**Gate checks and thresholds**

| Check | Threshold |
| --- | --- |
| Value structure | every replacement step keeps the source step's OKLCH L within ±0.02 |
| Hue-shift deltas | preserved, not just the base hue |
| Edge separation | every adjacent-slot boundary still ΔL ≥ 0.07 |
| Fixed values | the darkest ink lightness and the rim slots do not move |

---

## Overrides

`advance_step { assetId, force: true }` skips a failing gate and is recorded in the op
log as a forced advance. A person overriding a gate is legitimate; an agent doing it
silently is not. Use it only when the person has asked for it, and say that you did.

`revisit_step { assetId, step }` moves back without erasing anything. Every earlier
step's output is still in its own layer — that is the reason the steps are separate
layers. Revisit, fix, advance forward again.
