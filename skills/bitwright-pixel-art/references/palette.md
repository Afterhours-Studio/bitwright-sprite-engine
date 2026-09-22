# Building a palette that passes validation

`set_palette` is the only tool that takes hex values, and it is the only place you ever
type one. Everything downstream addresses colour by slot number, and `shade` and
`outline` resolve ramp steps themselves.

```jsonc
{ "assetId": "…",
  "ramps": [ { "name": "skin", "material": "skin",
               "slots": ["#8F595E", "#AB7469", "#C19470", "#CEBB92"] } ] }
```

Slots are listed **darkest first**. Slot numbers are assigned in the order the ramps
and their steps appear: the first ramp's first step is slot 1. Slot 0 is transparent
and is not a palette entry. Read the assignment back with `describe_palette` rather
than assuming it.

---

## 1. The rules the call is checked against

Failure is `palette.rule_violation` with the offending ramp named in the hint.

**Per step, going darker from the base:**

- Hue rotates **+12° to +20°** toward blue/violet. The budget is per step, not per ramp:
  a 3-step ramp turns 24–40° end to end, a 4-step ramp 36–60°, a 5-step metal ramp up to
  80°. Only the per-step figure is checked.
- Chroma is **× 0.85 – 1.12** of the step it was taken from — the next one up the ramp,
  not the base. Shadows gain a little chroma before losing it at the deepest step; they
  are not desaturated grey.
- OKLCH lightness drops **0.08 – 0.13** per step.

**Per step, going lighter from the base:**

- Hue rotates **−12° to −20°** toward yellow/orange.
- Chroma is **× 0.70 – 0.85** of the step it was taken from. Bright light washes colour out.
- OKLCH lightness rises **0.09 – 0.15** per step.

**The skin exception.** Ramps whose `material` is `skin` — and anything translucent:
ears, fingers, thin fabric — rotate toward **red/magenta** in shadow rather than toward
blue. Subsurface scattering. The exception is the *sign* of the rotation, so it inverts
both directions: skin rotates **−12° to −20°** going darker and **+12° to +20°** going
lighter. It is the one exception; cloth, metal, leather, stone and hair all take the
blue rule.

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

Metal is metal because of that spread, not because of its hue. The material also decides
which band is applied, so a ramp that is not one of these five — `ink`, `rim`, an
`accent` family — is measured on the per-step rules only, and takes `material: "custom"`.

The spread band and the per-step brackets are checked together, and at these step counts
they overlap less than either suggests alone. The **base of a ramp is its middle step**,
so a 3-step ramp is one darker plus one lighter step, a 4-step ramp is *two* darker plus
one lighter, and a 5-step metal ramp is two of each. Summing the brackets:

| Material | Steps | Reachable | Band | Build inside |
| --- | --- | --- | --- | --- |
| Cloth | 3 | 0.17 – 0.28 | 0.18 – 0.26 | 0.18 – 0.26 |
| Skin | 4 | 0.25 – 0.41 | 0.22 – 0.30 | 0.25 – 0.30 |
| Leather | 3 | 0.17 – 0.28 | 0.26 – 0.34 | 0.26 – 0.28 |
| Hair | 3 | 0.17 – 0.28 | 0.24 – 0.34 | 0.24 – 0.28 |
| Hair | 4 | 0.25 – 0.41 | 0.24 – 0.34 | 0.25 – 0.34 |
| Metal | 5 | 0.34 – 0.56 | 0.45 – 0.60 | 0.45 – 0.56 |

Leather at 3 steps needs both steps near the top of their brackets (≈ −0.125, +0.145);
skin at 4 steps needs all three near the bottom (≈ −0.087, −0.087, +0.097). Mid-bracket
steps fail both.

**Floor and ceiling.** The darkest slot in the whole palette sits at OKLCH L
**0.10 – 0.16**; the lightest at **0.88 – 0.94**. A single 1 px metal specular may reach
0.97, and it belongs in the `accent` step, not the palette floor. These two are
palette-wide, and **no ramp reaches both**: floor to ceiling is a span of at least 0.72
and the widest ramp allowed is metal at 0.60. The ends belong to the shared `ink` and
`rim` families below — if the floor or the ceiling is reported out of band, those are
what to move, not a material ramp. Never `#000000`: it carries no hue, so it flattens
every material it shades and it leaves you no room for a deeper occlusion. Never
`#FFFFFF`: it clips the top the same way.

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
that they satisfy the 3-step minimum honestly. Both take `material: "custom"` — there is
no `ink` or `rim` material, and `material` is only how a ramp picks up a value-spread
band, which neither of these has:

- **`ink`** — the outline and interior-separator family. Its darkest step is the
  deepest value in the sprite, holds the palette floor, and is the starting point the
  `outline` tool mixes toward.
- **`rim`** — the backlight. One family per project so every sprite appears lit by the
  same key. Its lightest step holds the palette ceiling; its middle step is the taper
  colour used at the ends of each rim run.

They are ordinary ramps otherwise: each one's steps obey the same per-step hue, chroma
and lightness brackets as a material ramp.

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
      "slots": ["#8F595E", "#AB7469", "#C19470", "#CEBB92"] },
    { "name": "cloth-blue",  "material": "cloth",
      "slots": ["#3E4991", "#406EB3", "#509BC1"] },
    { "name": "cloth-green", "material": "cloth",
      "slots": ["#447648", "#69945F", "#9AB485"] },
    { "name": "leather",     "material": "leather",
      "slots": ["#2F3000", "#604914", "#906D52"] },
    { "name": "hair",        "material": "hair",
      "slots": ["#2D0E22", "#492C46", "#69546D"] },
    { "name": "ink",         "material": "custom",
      "slots": ["#0D051A", "#211E36", "#393C50"] },
    { "name": "rim",         "material": "custom",
      "slots": ["#B6A889", "#E3C4AE", "#FFE2DC"] }
  ]
}
```

The slots it produces, with the character `read_canvas` prints for each:

| Slot | Char | Ramp / step | Hex | OKLCH L | C | H |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `A` | skin deep shadow | `#8F595E` | 0.525 | 0.072 | 13.8° |
| 2 | `B` | skin shadow | `#AB7469` | 0.613 | 0.072 | 31.7° |
| 3 | `C` | skin **base** | `#C19470` | 0.700 | 0.074 | 59.9° |
| 4 | `D` | skin light | `#CEBB92` | 0.798 | 0.059 | 86.0° |
| 5 | `E` | cloth-blue shadow | `#3E4991` | 0.435 | 0.118 | 273.9° |
| 6 | `F` | cloth-blue **base** | `#406EB3` | 0.539 | 0.120 | 258.3° |
| 7 | `G` | cloth-blue light | `#509BC1` | 0.657 | 0.094 | 232.7° |
| 8 | `H` | cloth-green shadow | `#447648` | 0.518 | 0.090 | 145.9° |
| 9 | `I` | cloth-green **base** | `#69945F` | 0.621 | 0.091 | 139.8° |
| 10 | `J` | cloth-green light | `#9AB485` | 0.738 | 0.071 | 131.5° |
| 11 | `K` | leather shadow | `#2F3000` | 0.298 | 0.066 | 111.0° |
| 12 | `L` | leather **base** | `#604914` | 0.419 | 0.075 | 84.3° |
| 13 | `M` | leather light | `#906D52` | 0.563 | 0.059 | 58.8° |
| 14 | `N` | hair shadow | `#2D0E22` | 0.222 | 0.059 | 343.4° |
| 15 | `O` | hair **base** | `#492C46` | 0.339 | 0.059 | 330.5° |
| 16 | `P` | hair light | `#69546D` | 0.476 | 0.047 | 320.9° |
| 17 | `Q` | ink dark — `OUTLINE_DARK` | `#0D051A` | 0.144 | 0.046 | 299.4° |
| 18 | `R` | ink **mid** | `#211E36` | 0.251 | 0.045 | 288.5° |
| 19 | `S` | ink light | `#393C50` | 0.362 | 0.035 | 277.9° |
| 20 | `T` | rim deep | `#B6A889` | 0.735 | 0.046 | 86.6° |
| 21 | `U` | rim **soft** — run tapers | `#E3C4AE` | 0.841 | 0.046 | 57.4° |
| 22 | `V` | rim | `#FFE2DC` | 0.935 | 0.033 | 31.6° |

The slots marked **base** are the ones the `flats` layer is painted with: 3, 6, 9, 12,
15. Every other slot in the table is reached by the engine stepping along a ramp from
one of those, so you never write them yourself except as detail and accent marks.

Why it passes — every figure below is measured from the hexes above, not asserted:

- Every ramp is 3 steps except skin, which is 4. All within 3–5.
- Darker steps move ΔL 0.087–0.121, lighter steps 0.094–0.143; both inside the
  0.08–0.13 and 0.09–0.15 brackets.
- Spreads: skin 0.272, cloth-blue 0.222, cloth-green 0.220, leather 0.265, hair 0.254 —
  each inside its material's band. Leather is the tight one: 3 steps can only reach
  0.26–0.28 of its 0.26–0.34 band, so both of its steps run near the top of the per-step
  bracket (−0.121 and +0.143). Move its base and you will have to rebuild it.
- Skin rotates 26.7° → 10.0° → 354.4° in HSL going darker: toward red, the documented
  exception, and +14.3° going lighter. Every other ramp rotates +15.1° to +19.4° going
  darker and −14.4° to −16.1° going lighter.
- Chroma factors against the step they were taken from: 0.874–1.031 darker (bracket
  0.85–1.12), 0.716–0.802 lighter (bracket 0.70–0.85).
- Floor `#0D051A` at L 0.144, ceiling `#FFE2DC` at L 0.935. Total L range 0.791. No
  single ramp spans that; the floor and the ceiling belong to `ink` and `rim`.
- Base lightnesses are 0.700, 0.539, 0.621, 0.419, 0.339, 0.251, 0.841 — the closest
  pair differs by 0.079, above the 0.07 edge minimum.
- Zero pairs with ΔL < 0.05 and ΔH < 20°. The near miss is skin light (L 0.798, H 86°)
  against rim soft (L 0.841, H 57°): 0.043 apart in L, so it is the 29° of hue that
  saves it. Warm skin and a warm rim crowd each other here; if you re-tune either,
  re-check that pair.


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
