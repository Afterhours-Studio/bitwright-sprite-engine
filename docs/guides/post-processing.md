# Post-processing

What happens to an image between the model and the gallery, and why the steps
run in the order they do.

Diffusion output is smooth, full colour, and sits on a background. Sprites are
none of those things. Post-processing is what closes the gap, and it runs on
every generated image.

## The steps

| Step              | Default | What it does                                          |
| ----------------- | ------- | ----------------------------------------------------- |
| Pixel grid        | Off     | Averages each block of pixels into one flat colour    |
| Palette size      | 32      | Reduces the image to that many colours                |
| Dither            | Off     | Spreads quantization error across neighbouring pixels |
| Remove background | On      | Makes the background transparent                      |

## Order

The steps run in a fixed order, and the order is the point:

```
model output -> snap to grid -> quantize palette -> remove background -> sprite
```

Snapping first fixes the pixel grid, so quantization then works on blocks that
are already flat. Background removal runs last, on the final colours, rather
than on colours that quantization is about to change underneath it.

## Pixel grid

Set this when the output is smoother than the size suggests, which happens when
you generate above the target resolution. A grid of 4 on a 128 pixel image
produces something that reads as 32 by 32 while keeping the coherence of the
larger render.

Leave it off when generating directly at the sprite size.

## Palette size

Fewer colours is what makes an image read as pixel art rather than as a small
painting.

| Colours    | Look                             |
| ---------- | -------------------------------- |
| 4 to 8     | Game Boy or one-bit style        |
| 16         | Classic 8-bit                    |
| 32         | Balanced, and the default        |
| 64 or more | Modern pixel art, softer shading |

Alpha survives quantization: the colour channels are reduced and the original
alpha band is put back. Without that, the palette's single transparent index
would make soft edges opaque.

## Dither

Dithering trades banding for noise. At sprite sizes noise usually loses, which
is why it is off by default. It is worth turning on for a large sprite with a
wide gradient, such as a sky.

## Background removal

The background is cleared by flood filling from the four corners. A pixel is
cleared when it is connected to a corner and within the tolerance of that
corner's colour.

Filling from the corners rather than matching a colour globally is what stops a
sprite that contains the background colour from developing holes: an enclosed
region is not connected to a corner, so it stays.

Tolerance defaults to 12 out of 255. Raise it when a faint halo remains around
the sprite; lower it when part of the sprite is being eaten.

Removal is exact for the flat backgrounds a pixel art prompt normally produces.
A photographic background needs a segmentation model instead; the registry
carries `rembg-u2net` for that, and it is not wired into this release.

## Sprite sheets

A batch can be packed into one sheet. Every cell is the size of the largest
frame, so a consumer can address frame `n` by arithmetic instead of reading per
frame offsets. Smaller frames are centred in their cell.

The engine returns the sheet along with the rectangle of every frame, so an
importer knows exactly where each one landed. The layout defaults to near
square, and the column count and the gap between cells can both be set.

## Turning it all off

Set the palette to empty, the pixel grid to empty, and background removal off,
and the raw model output comes through untouched. That is useful when you want
to post-process in your own art tool.
