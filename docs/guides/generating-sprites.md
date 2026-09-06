# Generating sprites

What each generation parameter does, and how to use seeds to iterate rather
than start over.

## Prompts

The prompt describes the sprite. A prompt for a sprite differs from one for an
illustration in two ways: it should state the view, and it should stay short,
because a 64 pixel image cannot hold much detail.

```
a knight in silver armour, side view, idle pose
a green slime, front view, simple shape
a wooden treasure chest, three quarter view, closed
```

The negative prompt lists what to steer away from. These are worth having by
default:

```
blurry, text, watermark, signature, drop shadow, photorealistic
```

Consistency across a set matters more than any single image. Keep the view and
the lighting words identical between runs, and change only the subject.

## Parameters

| Parameter     | Range           | Default     | What it does                                                               |
| ------------- | --------------- | ----------- | -------------------------------------------------------------------------- |
| Width, Height | 8 to 2048       | 64          | Output size before post-processing                                         |
| Steps         | 1 to 150        | 20          | Denoising steps. More is slower, with diminishing returns past about 30    |
| Guidance      | 0 to 30         | 7           | How closely the prompt is followed. Above about 12 the image becomes harsh |
| Seed          | 0 to 2147483647 | Random      | Reproduces a result exactly                                                |
| Batch size    | 1 to 16         | 1           | Images per run. Needs an engine that supports batching                     |
| Model         | Registry        | `sd15-base` | The base diffusion model                                                   |
| Style adapter | Registry        | None        | A LoRA. Needs an engine that supports adapters                             |

### Size

Generate at the size you want to ship. Generating large and scaling down blurs
the pixel grid, which is exactly what a sprite must not have.

Diffusion models are trained at a particular resolution and go strange far
below it. If a 32 by 32 output is incoherent, generate at 128 and set
**Pixel grid** to 4 in post-processing, which averages each 4 by 4 block into
one flat pixel.

### Steps

Twenty is enough for a sprite. The extra detail from 50 steps is mostly lost to
palette quantization afterwards.

### Guidance

Seven is a good default. Lower gives the model more freedom and often a more
natural shape; higher forces the prompt and tends toward hard, over-saturated
edges.

### Seed

An empty seed picks a random one. Every result records the seed that produced
it, so once you have a run worth keeping you can put its seed in the field and
change one parameter at a time.

That is the whole iteration loop:

1. Generate with a random seed until the shape is roughly right.
2. Note the seed.
3. Fix the seed, then adjust the prompt or the guidance.

### Batch size

Above one, this needs the `batch` capability. The control is disabled when the
selected engine lacks it. See
[Choosing a backend](choosing-a-backend.md).

### Style adapter

A LoRA shifts the model toward a style without replacing it. This needs the
`lora_hotswap` capability, so it is unavailable on the remote backend in this
release.

## Capabilities

Every engine declares what it supports, and the interface disables the rest.
This is deliberate: being told after a two minute wait that an option was never
available is worse than not being offered it.

| Capability     | What it enables          |
| -------------- | ------------------------ |
| `batch`        | Batch size above one     |
| `lora_hotswap` | Style adapters           |
| `controlnet`   | Pose control, planned    |
| `ip_adapter`   | Reference image, planned |

## Reproducibility

The same seed, model, prompt, and parameters produce the same image on the same
engine. Across engines they do not: CUDA and Metal differ in floating point
behaviour, and a remote provider may use a different scheduler entirely. Record
the engine along with the seed when a result matters.
