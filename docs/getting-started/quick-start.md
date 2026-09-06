# Quick start

Generate your first sprite, from a fresh install to an image in the gallery.

This assumes Bitwright is installed. If it is not, see
[Installation](installation.md).

## 1. Pick an engine

Open **Settings**, then **Engine**. Every engine is listed with its
availability:

| Engine | Available when |
| --- | --- |
| Local GPU (NVIDIA) | A CUDA driver and a supported GPU are present |
| Local GPU (Apple) | The machine is an Apple Silicon Mac |
| Remote API | An endpoint and an API key are configured |

An unavailable engine is disabled and shows why. `No CUDA driver was found`
means the NVIDIA driver is missing, not that the application is broken.

Press **Use this engine** on the one you want. If none of the local engines is
available, configure a remote endpoint; see
[Using a remote API](../guides/using-remote-api.md).

Each engine lists what it supports under **Supports**. That list drives the
controls on the Generate screen: an option the engine cannot do is disabled
there rather than failing after you press Generate.

## 2. Write a prompt

Open **Generate** and describe the sprite. Be concrete about the view, since a
sprite sheet needs a consistent one:

```
a knight in silver armour, side view, idle pose
```

Add a negative prompt for what you do not want:

```
blurry, text, watermark, drop shadow
```

## 3. Set the size

The parameters panel is on the right. For a first run:

| Parameter | Value | Why |
| --- | --- | --- |
| Width, Height | 64 | A common sprite size, and fast to generate |
| Steps | 20 | Enough quality without a long wait |
| Guidance | 7 | Follows the prompt without over-baking it |
| Seed | Empty | A random seed each run |

Leave post-processing at its defaults. Background removal is on, and the
palette is limited to 32 colours, which is what turns a smooth render into
something that reads as pixel art.

## 4. Generate

Press **Generate**. The status bar at the bottom shows the engine in use and
the progress of the run.

The first run on a local engine downloads the model, which is several
gigabytes. Later runs start immediately. The licence of the model is shown in
Settings under **Models** before anything is downloaded.

The result appears on the checkerboard canvas. The checkerboard is not part of
the image; it shows which pixels are transparent.

## 5. Iterate

To vary a result you like, note its seed from the status line and set it in
**Seed**. The same seed with the same parameters reproduces the same image, so
you can then change one thing at a time.

To try several variations at once, raise **Batch size**. If that control is
disabled, the selected engine does not support batching; the Settings screen
lists what it does support.

## 6. Review the gallery

Open **Gallery** to see everything generated in this session. Mark the ones
worth keeping as favourites and filter to them.

The gallery is in memory only. It is cleared when the application closes.

## Next

- [Generating sprites](../guides/generating-sprites.md) - what each parameter does.
- [Post-processing](../guides/post-processing.md) - background removal, palettes, and sheets.
- [Choosing a backend](../guides/choosing-a-backend.md) - which engine to run on.
