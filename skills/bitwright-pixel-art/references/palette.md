# Building a palette that passes validation

`set_palette` is the only tool that takes hex values, and it is the only place you ever
type one. Everything downstream addresses colour by slot number, and `shade` and
`outline` resolve ramp steps themselves.

```jsonc
{ "assetId": "…",
  "ramps": [ { "name": "skin", "material": "skin",
               "slots": ["#885659", "#AC7361", "#C19470", "#D0B692"] } ] }
```

Slots are listed **darkest first**. Slot numbers are assigned in the order the ramps
and their steps appear: the first ramp's first step is slot 1. Slot 0 is transparent
and is not a palette entry. Read the assignment back with `describe_palette` rather
than assuming it.

---

## 1. The rules the call is checked against

Failure is `palette.rule_violation` with the offending ramp named in the hint.

**Per step, going darker from the base:**

- Hue rotates **+12° to +20°** toward blue/violet, and no more than ~45° across a ramp.
- Chroma is **× 0.85 – 1.12** of the base's chroma. Shadows gain a little chroma before
  losing it at the deepest step; they are not desaturated grey.
- OKLCH lightness drops **0.08 – 0.13** per step.

**Per step, going lighter from the base:**

- Hue rotates **−12° to −20°** toward yellow/orange.
- Chroma is **× 0.70 – 0.85** of the base's chroma. Bright light washes colour out.
- OKLCH lightness rises **0.09 – 0.15** per step.

**The skin exception.** Ramps whose `material` is `skin` — and anything translucent:
ears, fingers, thin fabric — rotate toward **red/magenta** in shadow rather than toward
blue. Subsurface scattering. It is the one exception; cloth, metal, leather, stone and
hair all take the blue rule.

**Ramp length** is 3–5 steps. Budget per material:

| Material | Steps | Note |
| --- | --- | --- |
| Skin | 4 | deep shadow, shadow, base, light |
| Cloth, fabric | 3 | low contrast; fabric absorbs light |
| Leather | 3 | one narrow specular run allowed |
| Metal | 5 | the widest ramp in the sprite; needs a near-white specular and a very dark occlusion |
| Hair | 3–4 | 4 only when hair is a major silhouette element |

**Value spread**, darkest to lightest step, in OKLCH L:

| Material | ΔL |
| --- | --- |
| Cloth (matte) | 0.18 – 0.26 |
| Skin | 0.22 – 0.30 |
| Leather | 0.26 – 0.34 |
| Hair | 0.24 – 0.34 |
| Metal | 0.45 – 0.60 |

Metal is metal because of that spread, not because of its hue.

**Floor and ceiling.** The darkest slot in the whole palette sits at OKLCH L
**0.10 – 0.16**; the lightest at **0.88 – 0.94**. A single 1 px metal specular may reach
0.97, and it belongs in the `accent` step, not the palette floor. Never `#000000`:
it carries no hue, so it flattens every material it shades and it leaves you no room
for a deeper occlusion. Never `#FFFFFF`: it clips the top the same way.

**Separation.** Any two slots that will touch differ by **ΔL ≥ 0.07**, or they merge at
sprite scale. Zero pairs anywhere in the palette may have ΔL < 0.05 *and* ΔH < 20° —
each such pair is a wasted slot and a source of mud.

**Size.** 14–22 slots for 48 × 64, 20–32 for 64 × 96, hard ceiling 32 and a preset
ceiling of 24 on `hd2d`. Share aggressively: the darkest leather step and the darkest
hair step are usually the same colour, and every slot you free goes to a material that
needs contrast.

---

## 2. The two shared global ramps

Every character in a project shares them, and they are ramps rather than lone slots so
that they satisfy the 3-step minimum honestly:

- **`ink`** — the outline and interior-separator family. Its darkest step is the
  deepest value in the sprite and the starting point the `outline` tool mixes toward.
- **`rim`** — the backlight. One family per project so every sprite appears lit by the
  same key. Its middle step is the taper colour used at the ends of each rim run.

Do not vary either between characters in a cast.

---

## 3. A complete worked character palette

22 slots. A traveller in a blue coat with green trim, leather belt and boots, dark
plum hair. The green is the single high-chroma signature hue, at 8% of filled pixels.

Send this verbatim, changing only the hexes you have a reason to change:

```jsonc
{
  "assetId": "…",
  "ramps": [
    { "name": "skin",        "material": "skin",
      "slots": ["#885659", "#AC7361", "#C19470", "#D0B692"] },
    { "name": "cloth-blue",  "material": "cloth",
      "slots": ["#3F4595", "#406EB3", "#5697C3"] },
    { "name": "cloth-green", "material": "cloth",
      "slots": ["#2B7750", "#69945F", "#A0AF7E"] },
    { "name": "leather",     "material": "leather",
      "slots": ["#322C00", "#604914", "#896B4D"] },
    { "name": "hair",        "material": "hair",
      "slots": ["#2E0C20", "#492C46", "#64546E"] },
    { "name": "ink",         "material": "ink",
      "slots": ["#0E0418", "#211E36", "#363C50"] },
    { "name": "rim",         "material": "rim",
      "slots": ["#B3AC82", "#DDC8A2", "#FBE3CE"] }
  ]
}
```

The slots it produces, with the character `read_canvas` prints for each:

| Slot | Char | Ramp / step | Hex | OKLCH L | C | H |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `A` | skin deep shadow | `#885659` | 0.510 | 0.067 | 16° |
| 2 | `B` | skin shadow | `#AC7361` | 0.610 | 0.078 | 38° |
| 3 | `C` | skin **base** | `#C19470` | 0.700 | 0.074 | 60° |
| 4 | `D` | skin light | `#D0B692` | 0.790 | 0.057 | 76° |
| 5 | `E` | cloth-blue shadow | `#3F4595` | 0.430 | 0.129 | 276° |
| 6 | `F` | cloth-blue **base** | `#406EB3` | 0.539 | 0.120 | 258° |
| 7 | `G` | cloth-blue light | `#5697C3` | 0.651 | 0.094 | 240° |
| 8 | `H` | cloth-green shadow | `#2B7750` | 0.511 | 0.098 | 158° |
| 9 | `I` | cloth-green **base** | `#69945F` | 0.621 | 0.091 | 140° |
| 10 | `J` | cloth-green light | `#A0AF7E` | 0.730 | 0.070 | 122° |
| 11 | `K` | leather shadow | `#322C00` | 0.291 | 0.061 | 101° |
| 12 | `L` | leather **base** | `#604914` | 0.419 | 0.075 | 84° |
| 13 | `M` | leather light | `#896B4D` | 0.550 | 0.058 | 66° |
| 14 | `N` | hair shadow | `#2E0C20` | 0.220 | 0.062 | 347° |
| 15 | `O` | hair **base** | `#492C46` | 0.339 | 0.059 | 330° |
| 16 | `P` | hair light | `#64546E` | 0.471 | 0.046 | 312° |
| 17 | `Q` | ink dark — `OUTLINE_DARK` | `#0E0418` | 0.140 | 0.046 | 306° |
| 18 | `R` | ink **mid** | `#211E36` | 0.251 | 0.045 | 288° |
| 19 | `S` | ink light | `#363C50` | 0.359 | 0.036 | 270° |
| 20 | `T` | rim deep | `#B3AC82` | 0.740 | 0.058 | 100° |
| 21 | `U` | rim **soft** — run tapers | `#DDC8A2` | 0.841 | 0.056 | 82° |
| 22 | `V` | rim | `#FBE3CE` | 0.930 | 0.038 | 64° |

Why it passes:

- Every ramp is 3 steps except skin, which is 4. All within 3–5.
- Every step moves 0.089–0.150 in L from its neighbour, inside the darker and lighter
  bounds.
- Spreads: skin 0.280, cloth-blue 0.221, cloth-green 0.218, leather 0.258, hair 0.252 —
  each inside its material's band.
- Skin rotates 76° → 60° → 38° → 16° going darker: toward red, the documented
  exception. Every other ramp rotates the other way going darker.
- Chroma factors against each base: 0.90 and 1.05 darker, 0.78 lighter for skin; 1.08
  darker and 0.78 lighter for both cloths; 0.83 / 0.77 for leather; 1.05 / 0.78 for
  hair; 1.04 / 0.80 for ink; 1.05 / 0.76 for rim.
- Floor `#0E0418` at L 0.140, ceiling `#FBE3CE` at L 0.930. Total L range 0.790.
- Base lightnesses are 0.700, 0.539, 0.621, 0.419, 0.339, 0.251, 0.841 — the closest
  pair differs by 0.08, above the 0.07 edge minimum.
- Zero pairs with ΔL < 0.05 and ΔH < 20°.

---

## 4. Deriving a palette from a reference

`extract_palette { assetId, referenceId, maxSlots: 22 }` runs the reference through the
conform pipeline's weighted k-means in Oklab and proposes ramps grouped by material. It
returns the proposal; it does not apply it.

Treat the proposal as a starting point, not an answer:

1. Check each proposed ramp's length against the material budget above. k-means returns
   clusters by frequency, so a material that covers few pixels often comes back with 2
   steps. Add the missing step yourself.
2. Check the hue rotation per step. Photographic and AI-generated references usually
   have shadows that only lose lightness. Those ramps will be rejected. Rotate the
   darker steps +12° to +20° and the lighter steps −12° to −20° before sending.
3. Check the floor and ceiling. A reference with crushed blacks gives you a darkest
   slot below L 0.10; lift it.
4. Merge any pair with ΔL < 0.05 and ΔH < 20° into one slot and spend the freed slot on
   the material with the widest value spread.
5. Send the corrected ramps with `set_palette`, then `describe_palette` to learn the
   slot numbers you will actually be drawing with.

---

## 5. Recolouring

Value carries form; hue carries identity. A recolour changes hue and chroma and holds
every OKLCH L within ±0.02 — see `create_variation` in `recipes.md`.

May move freely: main and secondary cloth hue, hair hue, accent hue, leather hue within
±40° of brown. May move within limits: skin hue ±25°, and its lightness only if the
whole ramp moves together; metal hue may swap steel → gold → bronze but its value
spread stays ≥ 0.45. Must not move: the darkest ink lightness, the rim slots, and every
L value in every ramp.
