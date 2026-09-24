# HD-2D Pixel Art Style Guide (Agent Reference)

A technical specification for drawing HD-2D style character sprites pixel-by-pixel through a
drawing API. Every rule below is stated as a number, a procedure, or a testable condition.
Where a value is a recommendation rather than a documented shipped value, it is marked
**[convention]**. Where it is sourced, see **Sources** at the end.

Reading order for an agent: read §1–§2 before allocating a canvas, read §9 for the drawing
order, then execute the **Checklist per step** at the end. §11 is the self-review pass.

---

## 0. What "HD-2D" means mechanically

HD-2D (term coined and trademarked by Square Enix for _Octopath Traveler_) is SNES-era sprite
work composited into a 3D scene with modern real-time lighting, depth of field, bloom and
tilt-shift. For a _sprite artist_ this has three concrete consequences:

1. **The sprite is a billboard in a lit 3D world.** It will sit on top of backgrounds whose
   color you do not control and cannot predict. Therefore: no anti-aliasing on the outer
   silhouette, and no transparency-dependent edge tricks (§6).
2. **Light in the scene is warm and directional; ambient fill is cool.** Sprites are painted
   with baked lighting that must _agree_ with the scene light, so light direction is a hard
   global constant per project (§5).
3. **Rim light / backlight is the signature.** The engine's rim-light pass finds the outermost
   lit pixels of the sprite and brightens them. You bake an equivalent rim into the art so the
   sprite reads as separated from the background even when the shader is off (§5.5).

Everything else is SNES JRPG sprite technique (FFVI, Chrono Trigger, Secret of Mana) executed
at roughly 2–4× the linear resolution.

---

## 1. Canvas and proportions

### 1.1 Reference sprite sizes

| Source                                             | Sprite                 | Size (px)                                                 |
| -------------------------------------------------- | ---------------------- | --------------------------------------------------------- |
| Final Fantasy VI (SNES)                            | field/battle character | **16 × 24**                                               |
| Chrono Trigger (SNES)                              | field character        | ~**16 × 24** (taller frames up to ~16 × 32 for tall cast) |
| Secret of Mana (SNES)                              | field character        | ~**24 × 32**                                              |
| Radiant Historia (DS)                              | field character        | **22 × 33** (~2× the area of FFVI)                        |
| HD-2D (Octopath / Triangle Strategy / DQIII HD-2D) | field character        | roughly **2–4× SNES linear**                              |

Square Enix has not published exact shipped sprite dimensions for the HD-2D games. What is
documented and reliable is the _relationship_: HD-2D characters are drawn at notably higher
resolution than the SNES sprites they homage, with far more palette entries, then rendered
with sub-pixel-free nearest-neighbour scaling into a high-res 3D scene.

### 1.2 Canvas targets to use **[convention]**

Pick one tier and stay on it for the whole cast. Mixing tiers across a party is the single most
visible consistency failure.

| Tier          | Canvas      | Character occupies | Use for                                       |
| ------------- | ----------- | ------------------ | --------------------------------------------- |
| `snes`        | 32 × 48     | 28 × 44            | retro-faithful field sprite                   |
| `hd2d-field`  | **48 × 64** | 42 × 60            | default HD-2D overworld character             |
| `hd2d-battle` | **64 × 96** | 56 × 90            | battle-side / hero sprite, more detail budget |
| `hd2d-large`  | 96 × 128    | 84 × 120           | boss, mount, key NPC                          |

Always use **even** canvas dimensions so the vertical centerline falls on a pixel _boundary_,
not a pixel. A sprite facing the viewer is then symmetric about columns `W/2 - 1` and `W/2`.

### 1.3 Occupancy and margin rules

- The character's bounding box must occupy **≥ 85% of canvas height** and **45–75% of canvas
  width** for a standing front/back pose.
- Reserve **1 px transparent margin on every side** — minimum. This prevents bleeding when the
  renderer samples with any filtering and gives the engine's rim-light pass a pixel to write
  into.
- Reserve **2 px at the top** if the character has a hat, antenna, or hair spike: silhouette
  extremities should not touch the canvas edge.
- The **feet contact row** is fixed: `y = H - 3` for `hd2d-field`, i.e. 2 px of margin below the
  soles. Every sprite in the project uses the same contact row so they sit on the same ground
  plane when composited. Do not vary this per character.
- Horizontal center of mass must land within **±1 px** of the canvas centerline for idle poses,
  or the character will appear to drift when the sprite flips for left/right facing.

### 1.4 Head-to-body ratio

Measure in **heads**: total body height ÷ head height (crown to chin, excluding hair volume).

| Style                               | Heads         | Head height on 48×64 | Notes                                                           |
| ----------------------------------- | ------------- | -------------------- | --------------------------------------------------------------- |
| Super-deformed / classic SNES chibi | **2.0 – 2.5** | 24 – 30 px           | FFVI field style; head reads as 1/3 to 1/2 of the sprite        |
| **HD-2D standard**                  | **3.0 – 4.0** | **15 – 20 px**       | Octopath/Triangle Strategy range; still stylized, readable face |
| Semi-realistic                      | 5.0 – 6.0     | 10 – 12 px           | loses face readability below 12 px head at these canvases       |
| Realistic                           | 7.0 – 8.0     | n/a                  | do not use below 96 px sprite height                            |

Derived rules for the **3.5-head HD-2D default** on a 48 × 64 canvas (60 px of character):

```
head crown        y = 4            head height  17 px
chin              y = 21
shoulder line     y = 24           shoulder width  = 1.6 × head width
waist             y = 38           waist width     = 1.1 × head width
hip / crotch      y = 41           (≈ 62% of body height from crown)
knee              y = 50
sole / contact    y = 61
eye line          y = 14           (≈ 58% down the head, NOT the middle)
```

- Head **width** is 0.80–0.90 × head height. A head wider than tall reads as a different
  species, not a stylization.
- Shoulder width for an adult male ≈ 1.6 head widths; female/slim ≈ 1.4; heavy/armored ≈ 1.9.
- The **legs are 40–45% of total height** at 3.5 heads (vs 50% realistic). Shortening legs and
  keeping the torso is what makes a sprite read as "JRPG" rather than "small realistic person."
- Hands are drawn as **mitten blocks** at ≤ 5 px wide; do not attempt fingers below a 96 px
  canvas. A hand block is 0.35–0.4 × head width.
- Feet are **3–5 px wide** each seen from front, 5–7 px long seen from the side.

---

## 2. Palette discipline

### 2.1 Total colors

| Canvas tier             | Total unique colors (excl. transparent) |
| ----------------------- | --------------------------------------- |
| 32 × 48                 | **8 – 12**                              |
| 48 × 64 (`hd2d-field`)  | **14 – 22**                             |
| 64 × 96 (`hd2d-battle`) | **20 – 32**                             |
| 96 × 128                | 28 – 40                                 |

Hard ceiling: **32** for any single character at or below 64 × 96 — though a tool enforcing this
guide may set a tighter ceiling per preset (the `hd2d` preset allows **24** slots, `snes` 16).
Derek Yu notes 32 and 16 as
the popular working palette sizes; going above 32 on a character buys nothing and guarantees
muddy mid-tones (§11.3).

### 2.2 Ramp steps per material

A "ramp" is an ordered list of colors from darkest to lightest for one material. Budget:

| Material       | Ramp steps | Notes                                                                                      |
| -------------- | ---------- | ------------------------------------------------------------------------------------------ |
| Skin           | **4**      | shadow, base, light, (rim reuses the global rim color)                                     |
| Cloth / fabric | **3**      | low contrast; fabric absorbs light                                                         |
| Leather        | **3**      | one narrow specular pixel run allowed                                                      |
| Metal          | **5**      | highest contrast ramp in the sprite; needs a near-white specular and a very dark occlusion |
| Hair           | **3 – 4**  | 4 only if hair is a major silhouette element                                               |
| Eyes / accent  | **2**      | one dark, one light; never ramp eyes                                                       |

The **base** of a ramp is its middle step, and that is what decides which per-step bracket in
§2.4 a pair answers to. So a 3-step ramp is one darker step and one lighter step; a 4-step
ramp is _two_ darker and one lighter; a 5-step metal ramp is two of each.

Eyes are the exception to the ramp form: they are two standalone slots, not a ramp. A ramp
is 3–5 steps, and an eye pair is neither long enough to be one nor meant to be stepped along.

Total for a typical character: 4 (skin) + 3 (main cloth) + 3 (secondary cloth) + 3 (leather) +
3 (hair) + 2 (eyes) + 1 (shared darkest outline) + 1 (shared rim) = **20 colors**. This is the
canonical `hd2d-field` budget.

**Share aggressively.** The darkest step of the leather ramp and the darkest step of the hair
ramp should usually be the _same color_. Every shared color you find is budget freed for a
material that needs contrast (metal).

### 2.3 Contrast per material (value spread)

Express value as OKLCH lightness `L` in 0–1 (or HSL lightness if you must).

| Material      | ΔL from darkest to lightest step |
| ------------- | -------------------------------- |
| Cloth (matte) | 0.18 – 0.26                      |
| Skin          | 0.22 – 0.30                      |
| Leather       | 0.26 – 0.34                      |
| Hair          | 0.24 – 0.34                      |
| Metal         | **0.45 – 0.60**                  |

Metal is metal _because_ it has the widest value spread and the tightest highlight, not because
of its hue.

This table and §2.4's per-step brackets have to hold **at the same time**, and at the step
counts §2.2 budgets they leave less room than either implies alone. Summing the per-step
brackets across a ramp gives the spread it can reach; the overlap with the band above is the
part of the band you can actually build:

| Material | Steps | Reachable spread | Band        | Usable window   |
| -------- | ----- | ---------------- | ----------- | --------------- |
| Cloth    | 3     | 0.17 – 0.28      | 0.18 – 0.26 | 0.18 – 0.26     |
| Skin     | 4     | 0.25 – 0.41      | 0.22 – 0.30 | **0.25 – 0.30** |
| Leather  | 3     | 0.17 – 0.28      | 0.26 – 0.34 | **0.26 – 0.28** |
| Hair     | 3     | 0.17 – 0.28      | 0.24 – 0.34 | 0.24 – 0.28     |
| Hair     | 4     | 0.25 – 0.41      | 0.24 – 0.34 | 0.25 – 0.34     |
| Metal    | 5     | 0.34 – 0.56      | 0.45 – 0.60 | 0.45 – 0.56     |

Read this before choosing a base. Leather at 3 steps only reaches the bottom 0.02 of its band,
so both of its steps have to run near the top of the per-step bracket (about −0.125 into shadow
and +0.145 into light); a leather ramp built from mid-bracket steps lands near 0.22 and fails
§2.3. Skin at 4 steps is the mirror case — mid-bracket steps overshoot 0.30, so its steps run
near the _bottom_ of the bracket (about −0.087 twice and +0.097). Hair is easier at 4 steps
than at 3.

### 2.4 Hue shifting — the actual rule

When you step **darker**, do all three:

- **Hue → cool.** Rotate hue **+12° to +20° toward blue/violet** per step (in HSL degrees). The
  rotation is budgeted per _step_, not per ramp: a 3-step ramp turns 24–40° end to end, a 4-step
  ramp 36–60°, a 5-step metal ramp up to 80°. The old "~45° total" figure is the 3-step case and
  does not survive a longer ramp.
- **Saturation → up slightly** for the first shadow step (**+5 to +12 S%**), then back down for a
  deep occlusion step (OKLCH chroma: **×0.85 – ×1.12**, and that whole range is available on
  every darker step). Shadows in ambient sky light are _not_ desaturated grey; they are
  low-lightness, moderately saturated blue-violet.
- **Lightness → down 10–18 L%** per step (OKLCH: **ΔL ≈ −0.08 to −0.13**).

When you step **lighter**, do all three:

- **Hue → warm.** Rotate hue **−12° to −20° toward yellow/orange** per step.
- **Saturation → down 10–18 S%** (OKLCH chroma: ×0.7 – ×0.85). Bright light washes color out.
- **Lightness → up 12–20 L%** (OKLCH: **ΔL ≈ +0.09 to +0.15**).

Worked example, blue cloth base `hsl(220, 55%, 48%)`. Cloth is a **3-step** ramp (§2.2), so it is
one darker step and one lighter step. The OKLCH `L` column is the one the gates read; check the
examples against it rather than against the HSL, which is only where the hue rotation is stated:

```
          hex       hsl                  OKLCH L   step measured
shadow1   #373E9A   hsl(236, 47%, 41%)   0.415     hue +15.8, chroma x0.99, dL -0.105
BASE      #3764BE   hsl(220, 55%, 48%)   0.520
light1    #4093CA   hsl(204, 57%, 52%)   0.636     hue -16.1, chroma x0.77, dL +0.116
(rim)     shared global rim color, see 2.6

total spread dL 0.222, inside cloth's 0.18-0.26 band
```

Cloth has no `shadow2` of its own — three steps is the whole ramp. The occlusion under a fold is
drawn with the shared dark family (§2.6), not with a fourth cloth colour.

Worked example, skin base `hsl(26, 52%, 68%)`. Skin is a **4-step** ramp: two darker steps and
one lighter:

```
          hex       hsl                  OKLCH L   step measured
shadow2   #A56B74   hsl(351, 24%, 53%)   0.592     hue -18.7, chroma x1.00, dL -0.087
shadow1   #C2877C   hsl(  9, 36%, 62%)   0.679     hue -16.7, chroma x0.99, dL -0.087
BASE      #D8A883   hsl( 26, 52%, 68%)   0.767
light1    #E1D1AA   hsl( 43, 48%, 77%)   0.864     hue +16.4, chroma x0.72, dL +0.097

total spread dL 0.272, inside skin's 0.22-0.30 band
```

Note skin shadows rotate toward **red/magenta**, not blue — the hue runs 26° → 9° → 351° going
darker, the opposite sign to the cloth ramp above — because of subsurface scattering. This is the
one documented exception to "shadows go blue," and it inverts the sign of the rotation in both
directions: skin's _lighter_ step rotates **+12° to +20°** where cloth's rotates −12° to −20°.
Apply the blue rule to cloth, metal, leather, stone; apply the red/magenta rule to skin and
anything translucent (ears, fingers, thin fabric).

**Why pure black shadow and pure white highlight are wrong:**

- `#000000` has zero hue information, so it kills the material identity of whatever it shades —
  black shadow on leather and black shadow on cloth are the same pixel, and the sprite flattens.
- Real shadows are lit by _bounced ambient light_ (sky, ground, nearby surfaces). They always
  carry that ambient's hue. A shadow with no hue reads as a hole, not a surface.
- `#000000` also destroys your remaining value range: once you are at 0 you cannot place a
  deeper occlusion, so the deepest crevices and the ordinary shadows collapse into one value.
- `#FFFFFF` clips the same way at the top and makes every material look like the same
  mirror-finish plastic. Reserve values above `L = 0.94` for a single 1–3 px specular on metal,
  or for nothing at all.
- Practical floor and ceiling: **darkest color L ≈ 0.10–0.16, lightest L ≈ 0.88–0.94** in OKLCH.
  Exception: a 1-px metal specular may reach 0.97.
- These are properties of the **whole palette**, not of any one ramp, and no single ramp reaches
  both. Floor to ceiling is a span of at least 0.72; the widest ramp the style allows is metal at
  0.60 (§2.3), and cloth at 0.26 is nowhere near. The two ends belong to the shared
  `OUTLINE_DARK` and `RIM` slots of §2.6: `OUTLINE_DARK` holds the floor, `RIM` holds the ceiling,
  and every material ramp lives between them. A ramp that tries to span the full range will fail
  the per-step brackets above long before it arrives.

### 2.5 Value separation is non-negotiable

Any two colors that touch on an edge you want to _read_ must differ by **ΔL ≥ 0.07** (OKLCH).
Two colors that differ only in hue at the same lightness will visually merge at sprite scale —
this is the main cause of "muddy" sprites (§11.3). Convert the finished sprite to greyscale: if
the silhouette and the major forms are still legible, the value structure is correct.

### 2.6 The two shared global colors

Every character in an HD-2D project shares:

1. **`OUTLINE_DARK`** — the deepest value in the whole palette, used only as a _starting point_
   for tinted outlines (§4). Typical: `#0A0316` = `hsl(262, 76%, 5%)`, **OKLCH L 0.128** — inside
   the 0.10–0.16 floor of §2.4. Never `#000000`.
2. **`RIM`** — the backlight color, one single warm-or-cool color used on every character so all
   sprites appear lit by the same key, and the lightest value in the palette. Typical warm rim:
   `#F1DFBC` = `hsl(40, 65%, 84%)`, **OKLCH L 0.909**; typical cool moonlight rim: `#CBE5F9` =
   `hsl(206, 79%, 89%)`, **OKLCH L 0.909**. Both sit inside the 0.88–0.94 ceiling. Pick one per
   scene mood and never vary it per character.

These two slots are what put the palette's darkest and lightest values where §2.4 asks for them.
No material ramp reaches either end, so if a tool reports the palette's floor or ceiling out of
band, it is these slots that are wrong, not the material ramps. Both are usually stored as short
3-step families rather than lone colours — a dark family for tinted outlines and interior
separators, a rim family so each run can taper through `RIM_SOFT` (§5.5 rule 6) — and each of
those families obeys the same per-step brackets as any other ramp.

---

## 3. Silhouette first

### 3.1 Why first

The sprite will be displayed at 1–3 inches on screen, in motion, often at low contrast against
a lit 3D background, frequently blurred by depth-of-field. Under those conditions the viewer
resolves **shape before color and color before detail**. If the silhouette fails, no amount of
shading recovers it, and every shading pixel you place before the silhouette is settled is work
you will throw away. Draw the silhouette as a solid single-color mass and fix it completely
before placing a second color.

### 3.2 What makes a readable silhouette

- **One dominant read.** A viewer should be able to name the character class from the black
  shape alone: sword profile, staff, cloak flare, hat brim, ponytail.
- **Asymmetry.** Perfect bilateral symmetry reads as inert. Break it with exactly **one or two**
  elements: cape over one shoulder, sword on one hip, hair swept to one side. Do not break it in
  five places — that becomes noise.
- **Size variety.** The silhouette should contain large, medium, and small shapes in roughly a
  **3:2:1 area ratio**. All-medium shapes read as a blob.
- **Negative space.** Deliberately carve at least **one hole or notch ≥ 2×2 px** into the
  silhouette (gap between arm and torso, under a raised elbow, between legs in a walk pose).
  A silhouette with zero negative space is a potato.
- **Extremity budget.** 2–4 distinct protrusions (head, weapon, cape tip, hair). More than 5 and
  the outline turns to fringe at display scale.

### 3.3 Tangent avoidance

A **tangent** is where two edges just touch or run parallel for several pixels, fusing two forms
into one ambiguous shape. Detection: scan for edges of two different parts that are adjacent or
1 px apart for **≥ 3 consecutive pixels**. Fix by either **overlapping them by ≥ 2 px** (clear
occlusion) or **separating them by ≥ 2 px** (clear gap). Never leave a 0–1 px kiss.

```
TANGENT (bad)            OVERLAP (good)           GAP (good)
  ####                    ####                     ####
  ####@@@@                ###@@@@@                 ####  @@@@
  ####@@@@                ###@@@@@                 ####  @@@@
  ####                    ####                     ####
   arm | sword           sword crosses arm        clear air between
```

### 3.4 The squint / thumbnail test

Run this at the end of §9 step 1 and again at the end of the whole sprite:

1. Render the alpha channel as solid black on white. Downscale to **50%** with nearest-neighbour.
2. If the character class is still identifiable, pass. If the shape becomes a lump, fail.
3. Programmatic proxy: downscale the alpha mask to 50% (majority filter), then compute the
   ratio of **perimeter² / area**. Below ~14 the shape is too blobby (no features survive);
   above ~34 it is too fringed (single-pixel spikes are eating the outline). Target **18–28**.

---

## 4. Outlining

### 4.1 HD-2D does not use a uniform black outline

This is the most common mistake when imitating the style. HD-2D sprites use **selective
outlining ("selout")**: the outline exists, varies in color around the perimeter, and disappears
entirely where the form catches the key light. A flat `#000000` 1-px outline all the way around
produces a sticker, not a lit billboard, and fights the scene's lighting.

### 4.2 The tinted-outline rule

For each outline pixel, the color is derived from the fill color it borders:

```
outline = mix( adjacent_fill_shadow_step , OUTLINE_DARK , t )
  t = 0.75  on the side away from the light (bottom / shadow side)
  t = 0.45  on the sides perpendicular to the light
  t = 0.00  on the lit side  -> see 4.3, often no outline at all
```

Concretely: the outline next to red cloth is a very dark desaturating **red-violet**, the
outline next to skin is a very dark **red-brown**, the outline next to blue armor is near-black
**blue**. These may all sit within ΔL 0.04 of each other — the hue difference is what preserves
material identity at the edge.

Outline is **1 px** everywhere. A 2-px outline is only permissible on `hd2d-large` (96×128+)
and only on the shadow side.

### 4.3 When to drop the outline entirely

Drop the outline (let the light fill color be the outermost pixel) where **the surface normal
faces the key light**, i.e. the top-left arc of every rounded form when the light is top-left.

- Typical coverage: outline present on **60–75%** of the perimeter, absent on **25–40%**.
- Where the outline is dropped, the outermost pixel must be at least the material's **base**
  value, usually its **light1** value.
- Never drop the outline along the **bottom 20%** of the sprite (feet, hem, lower cloak) — the
  contact shadow region needs the darkest possible edge to anchor the character to the ground.
- Never drop the outline where the sprite would otherwise touch a same-value background. If in
  doubt on a billboard sprite, keep it.

```
Light from top-left.  '.' = transparent  'o' = tinted outline  '=' = dropped (light fill)
'#' = base  's' = shadow

  ..====....        top-left arc: no outline, light1 pixels are the edge
  .==####o..
  ==#####so.
  =######sso        right side: outline present, t=0.45
  o#####ssoo
  .o###ssoo.
  ..ooooo...        bottom: outline present, t=0.75, darkest
```

### 4.4 Interior outlines and separators

- Use an **interior separator** (1 px of the darker ramp step, not `OUTLINE_DARK`) only where
  two forms of _similar value_ overlap and would otherwise merge: arm over torso, belt over
  tunic, hair over shoulder.
- If the two forms already differ by **ΔL ≥ 0.10**, do **not** draw a separator. The value
  difference is the separator. Adding a line there is "over-outlining" and produces the
  disconnected-body-parts look.
- Interior separators are drawn with the shadow step of the **occluded** (behind) form, not the
  front form, and not with `OUTLINE_DARK`.
- Maximum interior separator length before it must break: **8 px**. Longer runs should thin or
  drop out where they cross into lit areas.

---

## 5. Shading

### 5.1 Light direction convention

**Fix one direction for the entire project.** The HD-2D convention is a **key light from the
top-front, offset to the upper-left**, matching the typical 3D scene's directional light.

Use the vector **L = (−0.55, −0.75, +0.36)** normalized — i.e. from upper-left, above, and
slightly toward the viewer. On the canvas this means:

- Top-left surfaces: **light1**
- Top surfaces and front-facing planes: **base**
- Right side, lower-right: **shadow1**
- Under overhangs and contact areas: **shadow2**
- The upper-left silhouette arc: outline dropped (§4.3)
- The rim appears on the upper-**right** and along the top: see §5.5

If a character faces right rather than front, **do not mirror the lighting** when you mirror the
sprite. Either re-light the flipped frames, or accept the mirror only for gameplay-irrelevant
frames. Mirrored lighting across a party is the most visible consistency error in a finished
sprite set.

### 5.2 Cel banding, not soft gradients

At 48 × 64 you have neither the pixels nor the palette budget for a smooth ramp. Use hard-edged
**cel bands**:

- **3 bands minimum** on any form larger than 6 × 6 px: `shadow1 / base / light1`.
- **4 bands** where the material justifies it: add `shadow2` in occlusion only.
- **5 bands** only for metal.
- Forms **smaller than 4 × 4 px get 2 colors max** (base + one). A 3 × 3 px form with 3 bands is
  noise.
- Band boundaries must follow the **form's cross-section**, not the outline's shape. Parallel
  boundaries are banding (§7).

### 5.3 Ambient occlusion placement

`shadow2` is reserved for ambient occlusion. It goes **only** in these places:

1. Where a form meets another form and is behind it: under the chin (1–2 px band), under the hat
   brim, under the belt, inside the neckline, in the armpit, between fingers/leg gap.
2. The **contact shadow**: the bottom 1–2 rows of the feet and anything touching the ground.
3. Deep folds — at most **two** per garment.

AO must **never** be used as a general "darker shadow" across a large area. Total `shadow2`
pixel count should be **≤ 8% of filled pixels**. If it exceeds 12%, the sprite is going muddy.

### 5.4 Cast shadows on the sprite

Bake the shadow the hat casts on the face, the shadow the arm casts on the torso, and the
shadow the sword casts across the body. These are `shadow1` (not `shadow2`) and they should be
**offset down-right** from the caster by roughly `(+1, +2)` px at the `hd2d-field` scale,
consistent with the key direction. Two to four cast shadows per sprite is right; zero looks
flat, six looks dirty.

### 5.5 Rim light / backlight — the HD-2D signature

The rim (backlight, edge light) is a thin bright band on the edges of the sprite _facing away
from the key light_, produced in-engine by a secondary light behind the subject. It is what
lifts an HD-2D sprite off its background. Bake it.

**Placement rules:**

1. Rim goes on the **side opposite the key**, and along the **top**. With key at top-left, rim
   occupies the **upper-right arc and the crown** of every rounded form.
2. Rim is **1 px thick** on `hd2d-field`, **1–2 px** on `hd2d-battle`, never more than 2.
3. Rim sits **on the outermost filled pixel** — it replaces the outline in that region, it does
   not sit inside it and it does not sit outside the silhouette.
4. Rim is **broken, not continuous**. Draw it in runs of **3–7 px separated by gaps of 1–3 px**.
   A continuous rim around the whole sprite reads as a glow-outline sticker. Break at every
   concave point of the silhouette and wherever the surface turns away from the back light.
5. Total rim coverage: **15–25% of the perimeter**. Above 35% it becomes an outline. Below 10%
   it reads as stray pixels.
6. Rim color is the **shared global `RIM`** (§2.6), at most 2 values: `RIM` and a half-strength
   `RIM_SOFT = mix(RIM, local_light1, 0.5)` used at the ends of each run so it tapers.
7. Rim is brightest on the **hardest silhouette turns** — shoulder tops, the crown of the head,
   the outer edge of a raised arm, the top of a hat brim, the outer edge of a cloak.
8. Rim must **not** appear: on the bottom 25% of the sprite, inside the silhouette, on the key-lit
   side, or on flat frontal planes.
9. Rim brightness must exceed the adjacent fill by **ΔL ≥ 0.20** or it will not read.

```
Key light: top-left.  Back/rim light: upper-right, behind.
'R' = RIM   'r' = RIM_SOFT   '=' = dropped outline (key-lit edge)
'#' = base  's' = shadow1    'o' = tinted outline

  . . = = # r R R r . .        crown: rim run of 5, tapering both ends
  . = # # # # s s R R .        upper-right arc: rim on the outermost px
  = # # # # # s s s r .        gap begins (surface turns away)
  = # # # # # s s s o .
  = # # # # # s s R R .        second run: shoulder turn catches rim again
  o # # # # # s s s r .
  o # # # # s s s s o .
  . o # # s s s s o o .
  . . o o o o o o . .          bottom 25%: NO rim, darkest outline only
```

Wrong versions:

```
CONTINUOUS RIM (bad)      RIM ON KEY SIDE (bad)    RIM 2px+ AT 48x64 (bad)
  . R R R R R R R .         R R = = # # s R .        . R R R R R . .
  R # # # # # # s R         R # # # # # s s R        R R # # # s R R
  R # # # # # s s R         R # # # # # s s R        R R # # s s R R
  R # # # # s s s R         R # # # # s s s R        . R R s s R R .
  . R R R R R R R .         . = = # # s s R .        . . R R R R . .
  -> glow sticker           -> two keys, reads flat  -> bloated, eats form
```

---

## 6. Anti-aliasing

### 6.1 The hard rule for billboard sprites

**Never anti-alias the outer silhouette edge.** The sprite is composited over 3D backgrounds of
unknown and changing color. AA pixels are chosen to blend toward a specific background; over any
other background they appear as a dirty fringe, and at the alpha boundary they produce visible
halos when the renderer scales the sprite. This is stated explicitly in the classic sources
(Derek Yu; Pixel Parmesan) and it applies doubly in HD-2D where the background is dynamic.

The outer edge must be **fully opaque or fully transparent**. Alpha values other than 0 and 255
are forbidden in the sprite's edge ring.

### 6.2 Where AA belongs

- **Interior edges only**: where two of the sprite's own colors meet — band boundaries, the edge
  of hair against skin, a belt against a tunic, the inside curve of a cloak.
- Only on canvases **≥ 48 × 64**. At 32 × 48 and below, AA reads as noise and should be skipped
  almost entirely.
- Only on **curves and shallow-angle diagonals**. Never AA a 45° diagonal (it is already
  optimal) and never AA a horizontal or vertical line.

### 6.3 How to place AA pixels

The rule from the sources: _the longer the segment, the longer the AA_. A stair-step line is a
sequence of runs; AA pixels go **at the ends of each run, in the corner of the step**, using an
intermediate value.

Number of AA pixels per corner, by run length:

| Run length | AA pixels per corner | Shades                          |
| ---------- | -------------------- | ------------------------------- |
| 1–2 px     | 0 (do not AA)        | —                               |
| 3–4 px     | 1                    | 1 intermediate                  |
| 5–8 px     | 2                    | 2 intermediates (or 1 repeated) |
| 9+ px      | 3                    | 2–3 intermediates, tapering     |

The AA color must be an **existing palette color** whose lightness sits between the two it
joins — ideally the ramp step between them. Do not average RGB; averaged colors are muddy
(Pixel Parmesan). If no intermediate exists in the ramp, do not AA.

```
STAIR-STEP, NO AA          CORRECT AA                 WRONG AA
runs 4,3,2,1               a = intermediate           (AA on every pixel,
                                                       AA on outer edge)
  ####                       ####a                      aaaa
  ####                       ####a                     a####a
      ###                    a####                     a####a
      ###                     a###a                    aa###aa
         ##                    a###                     aa###a
         ##                     a##a                    aa###a
           #                     a##                     aa##a
                                  a#                      aa#a

Left: acceptable, clean.   Middle: 1-2 px at each      Right: destroys the
                           step corner, tapering.       edge, fringe halo.
```

Run lengths in the left column **decrease monotonically** (4,3,2,1) — that is a clean curve.
If they go 4,2,3,1 you have jaggies (§11.2) and you must fix the _line_, not AA over it.

### 6.4 The mandatory exception list

Do not AA:

1. The outer silhouette (absolute).
2. Anything on a canvas ≤ 32 px wide.
3. Eyes, mouth, and any feature ≤ 3 px — AA turns them to mush.
4. Where AA would create a value that appears **only once** in the sprite (that is palette waste).
5. In parallel, equal-length runs along two adjacent edges — that is banding (§7).

---

## 7. Banding and pillow shading

### 7.1 Banding

**Definition:** two or more color boundaries running parallel to each other and to the outline,
with uniform band thickness, so the eye locks onto the _lines between the colors_ instead of the
form. Derek Yu: it "draws the eye by reinforcing the theoretical grid."

The specific pixel pattern to detect: a run of pixels of color A adjacent, along its whole
length, to a run of color B of the **same length and same shape**, especially on a diagonal.

```
BANDING (bad)               FIXED (good)
  ..#####..                   ..#####..
  .#11111#.                   .#11111#.
  .#22222#.    <- three       .#12211#.    <- boundaries follow the form,
  .#33333#.       parallel    .#22321#.       band thicknesses vary,
  .#33333#.       uniform     .#23321#.       colors interlock
  .#22222#.       stripes     .#22221#.
  ..#####..                   ..#####..

BANDING on a diagonal (bad)     FIXED (good)
  1......                         1......
  21.....                         21.....
  321....                         31.....      break the parallel run:
  4321...     each ramp step      3 21...      let steps skip and vary
  .4321..     is a perfect        43 1...      in length
  ..4321.     parallel diagonal   4 32...
```

**Avoidance rules:**

1. No two adjacent color boundaries may be parallel for more than **4 consecutive pixels**.
2. Band thickness must **vary** along its length — thin where the form turns fast, thick where
   it turns slowly.
3. Never place a shadow band that exactly mirrors the outline at a constant 1–2 px offset. That
   is simultaneously banding _and_ pillow shading.
4. Ramp steps do not all have to appear in every cross-section. Skipping a step
   (`base → shadow2` directly in a hard crease) is correct and breaks the band.

### 7.2 Pillow shading

**Definition:** shading applied concentrically inward from the silhouette — dark at the edges,
light in the middle — with no light direction. Every form looks like an inflated cushion.

```
PILLOW SHADING (bad)        DIRECTIONAL (good, key top-left)
  .#######.                   .#######.
  #3333333#                   #2211112#
  #3222223#                   #211111 2#      lightest mass sits offset
  #3211123#                   #2111223#       toward the key, not centered;
  #3211123#                   #2112233#       darkest is on the far side
  #3222223#                   #2122333#       only, not all around
  #3333333#                   #2233333#
  .#######.                   .#######.
```

**Detection heuristic (computable):** for each filled pixel, compute distance to the nearest
transparent pixel (a distance transform). If lightness correlates with that distance at
**Pearson r > 0.6** across the sprite, you have pillow shading. In a correctly lit sprite the
correlation between lightness and `dot(pixel_normal_estimate, L)` should dominate instead.

**Fix:** delete all shading, keep the flats, and re-shade from §9 step 3 with a single explicit
light vector. Pillow shading cannot be patched; it must be redone.

### 7.3 The "shadow everywhere on the outline" variant

A ring of `shadow1` one pixel inside the outline all the way around is pillow shading wearing a
disguise. The shadow ring must be **absent on the key-lit 25–40%** of the perimeter.

---

## 8. Dithering

At HD-2D character-sprite scales, **the default answer is: do not dither.** Dither is a
resolution-hungry technique; at 48 × 64 with a 20-color palette it reads as dirt and it fights
the clean cel banding that defines the style. HD-2D character sprites are essentially
dither-free.

Permitted uses, in order of acceptability:

1. **Texture, not gradient.** Rough stone, dirt, fur, rust, burlap — where the noise _is_ the
   material. Apply within a single band, not across a band boundary.
2. **Transparency / ethereal effects.** Ghosts, smoke, magic auras, fading edges — a 50%
   checkerboard is the standard tool.
3. **Extending a ramp** on a large flat area (`hd2d-large` canvases, capes, big shields) where
   you genuinely lack a palette step.

Patterns, with correct usage:

```
50% checkerboard        25% (sparse)          75% (dense)        BAD: random noise
  # . # . # .            # . . . # .           # # . # # .        # . # # . .
  . # . # . #            . . . . . .           # . # # . #        . . # . # #
  # . # . # .            . . # . . .           . # # . # #        # # . . # .
  . # . # . #            . . . . . .           # # . # # .        . # . # . #
  use between two        use at the edge       use at the edge    never: this is
  adjacent ramp steps    of a dither field     of a dither field  noise, not dither
```

Rules when you do dither:

- Only between **adjacent** ramp steps (ΔL ≤ 0.13). Dithering between distant values produces
  visible speckle.
- Minimum dither field: **6 × 6 px**. Smaller fields read as mistakes.
- Use a **gradient of densities** (75% → 50% → 25%) across the transition, at least 3 px per
  density. A single density abutting a flat is just a texture patch.
- Never dither across the outer silhouette edge.
- Never dither the face.

---

## 9. Detail hierarchy — the drawing order

Execute in this order. Do not proceed to step N+1 until step N passes its checks.

| #   | Step              | What you place                                                                       | Why here                                                                                                                                                               |
| --- | ----------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Silhouette**    | One opaque color, full character mass                                                | Shape is what the viewer resolves first and what is hardest to change later. Everything downstream is painted _into_ this mask.                                        |
| 2   | **Base flats**    | Each material's `base` color, no shading                                             | Establishes the material map and the color-area proportions. Cheap to revise; revising it after shading means redoing all shading.                                     |
| 3   | **Core shadow**   | `shadow1` on every form's away-from-key side                                         | Shadow before light: the shadow shape _is_ the form description. Placing light first tempts you into pillow shading because you shade inward from the edge.            |
| 4   | **Light**         | `light1` on the toward-key side, small and decisive                                  | Light areas should be smaller than shadow areas (≈ 25% light / 40% base / 35% shadow by pixel count). Placed after shadow so you can see how much value range is left. |
| 5   | **Outline pass**  | Tinted selective outline; drop it on lit arcs                                        | The outline color depends on the fill it borders, which only exists after steps 2–4. Outlining first forces you to guess and produces flat black.                      |
| 6   | **Detail**        | `shadow2` AO, cast shadows, small features, interior separators, folds, straps, face | Detail must be subordinate to the big read. Adding it earlier means you protect it and refuse to fix the form.                                                         |
| 7   | **Accents / rim** | Specular pixels, eye highlights, `RIM` runs, emissive accents                        | Highest-contrast pixels go last so you can place them exactly where they add the most and count them (rim coverage 15–25%, specular ≤ 6 px).                           |
| 8   | **AA + cleanup**  | Interior AA, orphan-pixel removal, palette audit                                     | AA is a polish operation over finished edges; doing it earlier means re-doing it.                                                                                      |

Rationale in one line: **each step constrains the next, and each step is cheap to redo only
while the later steps do not exist.**

---

## 10. Color variation and palette swaps

### 10.1 The principle

A recolor must preserve the **value structure** exactly. Value carries form and readability;
hue carries identity. If a swap changes lightness, it changes the perceived shape.

### 10.2 Procedure

1. Extract the source palette as an ordered list per material ramp.
2. For each ramp, record the OKLCH lightness of each step: `L0 < L1 < L2 < L3`.
3. Build the replacement ramp with **the same L values (±0.02)**, changing only hue `H` and
   chroma `C`.
4. Preserve the _hue-shift deltas_, not just the base hue. If the source ramp rotated +16°
   toward blue per shadow step, the recolor must also rotate ≈ +16° from its new base.
5. Re-check §2.5: every adjacent-color boundary must still have ΔL ≥ 0.07. A hue-only swap can
   never break this, which is the point.

```
source blue cloth (§2.4)              recolor to plum
L=0.415  #373E9A hsl(236,47%,41%) ->  L=0.415  #83213F hsl(342,60%,32%)
L=0.520  #3764BE hsl(220,55%,48%) ->  L=0.519  #9E4377 hsl(326,40%,44%)
L=0.636  #4093CA hsl(204,57%,52%) ->  L=0.638  #B173A7 hsl(310,28%,57%)
                                      hue rotated +106 across the whole ramp;
                                      L column held to 0.002; shift deltas
                                      preserved (+16 darker, -16 lighter)
```

The rotation is applied to every step by the same amount, which is what keeps the per-step
deltas — not just the base hue — intact. Note that the per-step rotation stays **signed**: it is
+12° to +20° in HSL going darker whatever the new base hue is, so a recolor must be checked in
its new position rather than assumed correct because the source was.

### 10.3 What may move and what may not

**May move freely:**

- Main cloth hue — any rotation.
- Secondary cloth / trim hue.
- Hair hue (within believable range, or fully free for fantasy casts).
- Leather hue within ±40° of brown.
- Accent / gem hue.

**May move within limits:**

- Skin: hue may move **±25°** around 20–35° (and toward 0–15° for deeper tones); chroma may
  change; **lightness may change but must move the entire ramp together**, keeping ΔL between
  steps. Never desaturate skin to grey.
- Metal: hue may swap steel→gold→bronze, but the **value spread must stay ≥ 0.45** or it stops
  reading as metal.

**Must not move:**

- `OUTLINE_DARK` lightness. The outline may take on the new hue tint (§4.2) but the darkest
  value in the sprite stays the darkest value.
- `RIM` — it is the scene light, shared by all characters. Changing it per character breaks the
  lighting illusion.
- Eye-white / eye-dark values.
- Any L value in any ramp (that is the whole rule).

### 10.4 Team palette coherence

For a party of sprites: limit the whole cast to **2–3 dominant hue families** plus one shared
accent, and give each character exactly **one** high-chroma signature hue occupying **8–15% of
their pixels**. More than one signature hue per character and the party reads as a clown troupe.

---

## 11. Common failure modes, detection heuristics, and fixes

Each heuristic is computable from the RGBA pixel buffer. Run all of them in step 8.

### 11.1 Noise (orphan pixels)

**Symptom:** isolated single pixels of a color surrounded by a different color; speckle.

**Detect:** for every pixel `p`, count its 8-neighbours with the same color `n(p)`.

- `n(p) == 0` → **orphan**. Fail if orphan count > **2% of filled pixels**, or > 6 pixels total
  on `hd2d-field`.
- `n(p) <= 1` on more than **6%** of filled pixels → the sprite is speckled.
- Exception whitelist: eye highlight, single specular pixel on metal, deliberate AA corner
  pixels (which by definition have ≥ 2 same-color or ramp-adjacent neighbours in a run).

**Fix:** merge each orphan into its most common neighbour color. If it was carrying information,
grow it into a 2×1 or 2×2 cluster instead of deleting it. Minimum meaningful mark is **2 px**.

### 11.2 Jaggies (broken lines/curves)

**Symptom:** a curve whose run lengths do not change monotonically — `4,2,3,1` instead of
`4,3,2,1`. The line looks chewed.

**Detect:** trace each contiguous outline edge into a run-length sequence. Flag when:

- the sequence is non-monotonic over a span of 4+ runs (up-down-up), or
- a run of length 1 appears between two runs of length ≥ 3, or
- the same run length repeats > 5 times then jumps by > 2 (an abrupt kink).

**Fix:** rewrite the whole run sequence to a legal one. Legal curve run sequences at these
scales: `1,1,1,...` (45°), `2,2,2,...`, `3,3,3,...`, and monotone sequences like `5,4,3,2,1,1`
or `1,1,2,3,4,6`. Do not patch a jaggy with AA — AA on a bad line makes a blurry bad line.

### 11.3 Muddy mid-tones

**Symptom:** the sprite looks grey/brown and flat; forms don't separate.

**Detect:**

- Compute the OKLCH lightness histogram of all filled pixels. If **> 55%** of pixels fall within
  a 0.15-wide L window, the sprite is value-compressed.
- Compute total L range (max − min). If **< 0.55**, contrast is too low.
- Count pairs of palette colors with **ΔL < 0.05 and ΔH < 20°** — each such pair is a wasted
  slot and a mud source. Should be **0**.
- Greyscale the sprite and rerun the §3.4 thumbnail test. If it fails in greyscale but passed in
  color, the color is doing work the values should be doing.

**Fix:** merge the redundant palette pairs, then push the extremes. The range is carried by the
shared slots, not by one material: check that `OUTLINE_DARK` and `RIM` actually sit in their
§2.4 bands (0.10–0.16 and 0.88–0.94) and that they are being _used_, before touching a material
ramp — a ramp cannot be stretched past the per-step brackets of §2.4 to buy range. Where a ramp
genuinely is flat, increase chroma in its shadows rather than lightness.

### 11.4 Inconsistent light direction

**Symptom:** one form lit from the left, another from the right; the sprite reads as a collage.

**Detect:** segment the sprite into connected regions per material. For each region, compute the
vector from the centroid of its darkest band to the centroid of its lightest band — the
**local light vector**. Take the circular mean across regions. Flag any region whose vector
deviates **> 45°** from the mean, and flag the sprite if the mean deviates > 30° from the
project's declared key direction. Also flag if the circular standard deviation across regions
exceeds **35°**.

**Fix:** re-shade the offending regions only. Do not rotate the whole sprite's lighting to match
a mistake.

### 11.5 Over-detailing at small sizes

**Symptom:** buttons, buckles, fingers, embroidery — all illegible, all noisy.

**Detect:**

- Count distinct connected components of each non-base color. If any color has **> 8 components**
  on a 48 × 64 sprite, detail is fragmenting.
- Count components with area **≤ 2 px**. If > 10% of components, over-detailed.
- Compute the color-change rate: number of horizontal adjacent-pixel pairs with different
  colors ÷ filled pixels. Above **0.45** the sprite is busy; HD-2D field sprites sit at
  **0.22–0.38**.

**Fix:** apply the **detail budget**: on a 48 × 64 sprite, allow at most **5 "features"** below
4 × 4 px (eyes count as 1 feature, belt buckle 1, etc.). Delete the rest and let larger shapes
imply them. Detail spend should follow attention: **60% of detail pixels in the top 40% of the
sprite** (face, head, shoulders), because that is where the viewer looks.

### 11.6 Losing the silhouette

**Symptom:** the sprite reads as a blob, or sinks into the background.

**Detect:**

- Run the §3.4 perimeter²/area test on the alpha mask: target **18–28**.
- Compute solidity = `filled_area / convex_hull_area`. Below **0.55** the shape is spindly;
  above **0.88** it has no negative space and no interesting protrusions. Target **0.62–0.82**.
- Count interior holes (transparent regions fully enclosed or notches ≥ 2×2). Require **≥ 1**.
- Edge contrast: for each outline pixel, ΔL against the mean scene background (or against mid-grey
  `L = 0.5` if unknown) should be **≥ 0.25** for at least **70%** of the perimeter. This is what
  the rim light exists to guarantee.

**Fix:** widen or exaggerate the defining extremity (weapon, hat, hair), carve a notch between
arm and torso, and increase rim coverage on the top and upper-back edges.

### 11.7 Quick numeric summary of all thresholds

| Metric                                | Target                           |
| ------------------------------------- | -------------------------------- |
| Palette size (48×64)                  | 14–22, hard max 32               |
| Orphan pixels                         | ≤ 2% of filled, ≤ 6 absolute     |
| Pixels with ≤ 1 like-neighbour        | ≤ 6%                             |
| OKLCH L range                         | ≥ 0.55, ideally ≥ 0.60           |
| Pixels within any 0.15 L window       | ≤ 55%                            |
| Palette pairs with ΔL<0.05 and ΔH<20° | 0                                |
| `shadow2` (AO) coverage               | ≤ 8% of filled, hard fail > 12%  |
| Light/base/shadow pixel split         | ≈ 25 / 40 / 35                   |
| Rim coverage of perimeter             | 15–25%, fail > 35%               |
| Outline coverage of perimeter         | 60–75%                           |
| Horizontal color-change rate          | 0.22–0.38                        |
| Perimeter² / area (alpha mask)        | 18–28                            |
| Solidity                              | 0.62–0.82                        |
| Light-vector circular std dev         | ≤ 35°                            |
| Lightness ↔ edge-distance correlation | r ≤ 0.6 (above = pillow shading) |
| Alpha values used                     | only 0 and 255                   |

---

# Checklist per step

Terse, machine-followable. Each item has an explicit pass condition. Do not advance to the next
step while any item in the current step fails.

### Step 0 — Setup

1. Choose a tier from §1.2. Record `W`, `H`, contact row. PASS: `W` and `H` are even.
2. Declare the key light vector `L = (−0.55, −0.75, +0.36)` and the shared `OUTLINE_DARK` and
   `RIM` colors. PASS: all three are written down before any pixel is placed.
3. Declare the target head count (3.0–4.0 for HD-2D) and compute the landmark rows from §1.4.
   PASS: crown, chin, shoulder, waist, hip, knee, sole rows all assigned.

### Step 1 — Silhouette

1. Fill the character mass in a single opaque color. No other color exists on the canvas.
   PASS: exactly 1 non-transparent color present.
2. Verify occupancy: bbox height ≥ 0.85·H, bbox width in [0.45·W, 0.75·W]. PASS/FAIL numeric.
3. Verify margins: ≥ 1 px transparent on all four sides; ≥ 2 px at top if a head extremity exists.
   PASS: no filled pixel in row 0, column 0, row H−1, column W−1.
4. Verify feet reach the declared contact row exactly. PASS: lowest filled row == contact row.
5. Count silhouette protrusions. PASS: 2–4 distinct extremities.
6. Count negative-space holes/notches ≥ 2×2 px. PASS: ≥ 1.
7. Tangent scan: no two part-edges adjacent or 1 px apart for ≥ 3 consecutive pixels.
   PASS: 0 tangents; fix by overlapping ≥ 2 px or gapping ≥ 2 px.
8. Symmetry check: silhouette must NOT be bilaterally identical. PASS: ≥ 1 asymmetric element.
9. Thumbnail test: downscale alpha to 50%, compute perimeter²/area. PASS: 18–28.
10. Solidity check. PASS: 0.62–0.82.

### Step 2 — Base flats

1. Assign each material its `base` color only. PASS: number of colors == number of materials,
   and no shading colors present.
2. Verify every material's `base` differs from every adjacent material's `base` by ΔL ≥ 0.07.
   PASS: 0 violations.
3. Verify area proportions: no single material except skin+main-cloth exceeds 40% of filled
   pixels. PASS/FAIL.
4. Verify one and only one high-chroma signature hue exists, at 8–15% of pixels. PASS/FAIL.
5. Greyscale the flats. PASS: major forms (head, torso, arms, legs, weapon) are still separable.

### Step 3 — Core shadow

1. For each form > 6×6 px, fill the side facing away from `L` with that material's `shadow1`.
   PASS: every such form has shadow pixels.
2. Shadow boundaries must follow form cross-sections, not the outline offset. Run the pillow
   test: lightness↔edge-distance correlation. PASS: r ≤ 0.6.
3. No shadow band parallel to an adjacent boundary for > 4 consecutive pixels.
   PASS: 0 banding runs.
4. Band thickness varies along each band. PASS: thickness std dev ≥ 1 px per band.
5. The key-lit 25–40% of the perimeter has NO inward shadow ring. PASS/FAIL.
6. Shadow pixel share ≈ 35% ±8 of filled pixels. PASS/FAIL.
7. Forms < 4×4 px received no shadow. PASS: 0 violations.

### Step 4 — Light

1. Apply `light1` to toward-key surfaces only. PASS: all light pixels lie on the upper-left side
   of their form's centroid.
2. Light pixel share ≈ 25% ±8. PASS/FAIL. Light must be LESS than shadow share.
3. No pixel exceeds L = 0.94 yet (specular is step 7). PASS/FAIL.
4. No pure white, no pure black anywhere. PASS: `#FFFFFF` and `#000000` absent.
5. Light-direction consistency: per-region light vectors, circular std dev ≤ 35°, mean within
   30° of declared `L`. PASS/FAIL.
6. Each material now shows exactly its budgeted band count (§2.2). PASS/FAIL per material.

### Step 5 — Outline pass

1. For each perimeter pixel, compute `outline = mix(adjacent_fill_shadow, OUTLINE_DARK, t)`
   with `t = 0.75` shadow side, `0.45` perpendicular. PASS: no perimeter pixel is
   `OUTLINE_DARK` unmixed, and none is `#000000`.
2. Drop the outline on key-lit arcs; those perimeter pixels become `light1` (or `base`).
   PASS: outline coverage 60–75% of perimeter.
3. Outline thickness == 1 px everywhere (2 px allowed only on ≥96×128, shadow side only).
   PASS/FAIL.
4. Bottom 20% of the sprite has a full, darkest outline. PASS: 0 dropped pixels in that band.
5. Outline hue varies by neighbouring material. PASS: ≥ 3 distinct outline colors on a sprite
   with ≥ 3 materials.
6. Alpha audit: every outline pixel is alpha 255; every pixel outside is alpha 0.
   PASS: no intermediate alpha.

### Step 6 — Detail

1. Place `shadow2` AO only at: under-chin, under-brim, under-belt, neckline, armpit, limb gaps,
   contact row. PASS: `shadow2` ≤ 8% of filled pixels (hard fail > 12%).
2. Place 2–4 cast shadows in `shadow1`, offset (+1,+2) from their casters. PASS: count in [2,4].
3. Place interior separators ONLY where adjacent forms have ΔL < 0.10. PASS: 0 separators drawn
   between forms already differing by ΔL ≥ 0.10.
4. Separator runs ≤ 8 px before breaking. PASS/FAIL.
5. Face: eyes are 1–2 px each, 2 colors max, on the eye-line row. PASS/FAIL.
6. Detail budget: ≤ 5 features below 4×4 px on a 48×64 canvas. PASS/FAIL.
7. Detail distribution: ≥ 60% of detail pixels in the top 40% of the sprite. PASS/FAIL.
8. Color-change rate 0.22–0.38. PASS/FAIL.
9. Dithering: if used, field ≥ 6×6 px, only between adjacent ramp steps, never on the face,
   never crossing the silhouette. PASS/FAIL; default is 0 dither pixels.

### Step 7 — Accents and rim

1. Specular: ≤ 6 pixels total, only on metal/glass/eye, max L 0.97. PASS/FAIL.
2. Rim: place `RIM` on outermost pixels of the upper-RIGHT arc and crown (opposite the key).
   PASS: 0 rim pixels on the key-lit side.
3. Rim thickness 1 px (2 px allowed at ≥64×96). PASS/FAIL.
4. Rim broken into runs of 3–7 px with gaps of 1–3 px. PASS: 0 runs longer than 8 px.
5. Rim coverage 15–25% of perimeter. PASS/FAIL, hard fail > 35%.
6. Rim taper: each run's end pixels use `RIM_SOFT`. PASS: every run of length ≥ 4 has soft ends.
7. No rim in the bottom 25% of the sprite. PASS/FAIL.
8. Rim-to-neighbour contrast ΔL ≥ 0.20. PASS/FAIL.
9. Rim color is identical across every sprite in the project. PASS/FAIL.

### Step 8 — AA and cleanup

1. Outer silhouette AA: NONE. PASS: alpha set is exactly {0, 255}, and no perimeter pixel is a
   blend of the fill and nothing.
2. Interior AA only, only on curves and shallow diagonals, only at run corners, counts per §6.3.
   PASS: 0 AA pixels on the perimeter, 0 AA on 45° diagonals, 0 AA on features ≤ 3 px.
3. AA colors are existing palette entries. PASS: palette size did not grow during this step by
   more than 2.
4. Jaggie scan: run-length sequences per edge are monotone or constant. PASS: 0 flagged
   sequences (no 1 between two ≥3 runs, no up-down-up over 4 runs).
5. Orphan scan: pixels with 0 same-color neighbours ≤ 6 absolute and ≤ 2% of filled, excluding
   the whitelist (eye highlight, metal specular). PASS/FAIL.
6. Speckle scan: pixels with ≤ 1 like-neighbour ≤ 6% of filled. PASS/FAIL.
7. Palette audit: total colors within tier budget; 0 pairs with ΔL < 0.05 and ΔH < 20°;
   0 colors used fewer than 3 times (except specular/eye). PASS/FAIL.
8. Value audit: L range ≥ 0.55; ≤ 55% of pixels inside any 0.15 L window; darkest L ≥ 0.10;
   lightest L ≤ 0.94 outside specular. PASS/FAIL.
9. Pillow test: lightness↔edge-distance correlation r ≤ 0.6. PASS/FAIL.
10. Banding test: 0 pairs of parallel adjacent boundaries longer than 4 px. PASS/FAIL.
11. Final thumbnail test at 50% and at 25%: class still identifiable at 50%; silhouette still
    coherent at 25%. PASS/FAIL.
12. Greyscale test: sprite still reads with hue removed. PASS/FAIL.
13. Background test: composite the sprite over black, over white, and over mid-grey `L=0.5`.
    PASS: no fringe pixels appear, and the silhouette reads on all three.

---

## Sources

- [Derek Yu — Pixel Art Tutorial: Basics](https://www.derekyu.com/makegames/pixelart.html) — outlining vs. selective outlining, banding, jaggies, anti-aliasing cautions, palette sizes.
- [Pixel Parmesan — Anti-Aliasing Fundamentals for Pixel Artists](https://pixelparmesan.com/blog/anti-aliasing-fundamentals-for-pixel-artists) — AA length vs. segment length, where not to AA, avoiding averaged/muddy AA colors.
- [Pedro Medeiros (Saint11) — How to start making pixel art #4: Basic Shading](https://medium.com/pixel-grimoire/how-to-start-making-pixel-art-4-f57f51dcfa02)
- [Pedro Medeiros (Saint11) — How to start making pixel art #5: Anti-Alias and Banding](https://medium.com/pixel-grimoire/how-to-start-making-pixel-art-4-ff4bfcd2d085)
- [Pedro Medeiros (Saint11) — How to start making pixel art #6: Basic Color Theory](https://medium.com/pixel-grimoire/how-to-start-making-pixel-art-6-a74f562a4056)
- [Slynyrd — Pixelblog 6: Light and Shadow](https://www.slynyrd.com/blog/2018/6/15/pixelblog-6-light-and-shadow) — light direction conventions (above, top-left/top-right), cast shadow character.
- [Slynyrd — Pixelblog 22: Top Down Character Sprites](https://www.slynyrd.com/blog/2019/10/21/pixelblog-22-top-down-character-sprites) — 1×2 tile sprite footprint, head as a third to a half of the sprite, proportion abstraction at small sizes.
- [Slynyrd — Pixelblog catalogue](https://www.slynyrd.com/pixelblog-catalogue)
- [Lospec — selective outlining tutorials](https://lospec.com/pixel-art-tutorials/tags/selectiveoutlining) — Tsugumo Ch.12, Pixel-Zone selout series, Pedro Medeiros "Outlines".
- [Wikipedia — HD-2D](https://en.wikipedia.org/wiki/HD-2D) — definition, Square Enix trademark, sprites-in-3D composition.
- [Wikipedia — Octopath Traveler](https://en.wikipedia.org/wiki/Octopath_Traveler) — "retro SNES-style character sprites with polygonal environments and HD effects."
- [The Spriters Resource — Final Fantasy VI (SNES)](https://www.spriters-resource.com/snes/ff6/)
- [The Spriters Resource — Octopath Traveler (Switch)](https://www.spriters-resource.com/nintendo_switch/octopathtraveler/)
- [JRPG graphics and sprites analysis (jbahamon)](https://jbahamon.github.io/jrpgs/2021/01/22/graphics-and-sprites.html) — FFVI 16×24 base sprite size; Radiant Historia 22×33 comparison.
- [Pixel Beef devlog — adding light and depth to a pixel art game](https://pixel-beef.itch.io/xdasher/devlog/192949/4-things-we-did-to-add-light-and-depth-to-our-pixel-art-game) — rim-light shader on sprite outermost pixels for depth.
- [Manabit — Hue Shifting](https://manabit.app/tutorials/hue-shifting/) and [Pixel-Editor — Color Theory for Pixel Art](https://www.pixel-editor.com/articles/color-theory-for-pixel-art) — per-step hue rotation of ~15°, ≤ ~45° across a ramp, saturation up into shadow / down into highlight.

_Pixel Logic (Michafrar) was not directly consulted; the outlining, AA and banding rules here are
synthesized from the freely available sources listed above._
