# Animating

An animation in Bitwright is a row of frames, and every frame is an ordinary
asset: its own nine layers, its own workflow step and gates, its own history.
Everything in the overview works on a frame exactly as it works on a sprite.
The animation tools only arrange the row — add, delete, reorder, time it and
choose how it loops.

A sprite you have never added a frame to is an animation of one frame, 125 ms,
playing forward.

## 1. The loop

1. **Draw frame 1 through the whole workflow.** Reference, palette,
   silhouette, flats, shading, outline, detail, accent, cleanup — every gate
   passing. This is the key pose; every other frame starts as a copy of it.
2. **`add_frame` per pose.** It inserts right after the frame you name (or the
   open one), copies its layers, palette and step by default, and opens the
   new frame in your session, so the next write lands on it.
3. **Change only what moves.** Read the new frame, then redraw the parts that
   differ — a leg, an arm, the hem of a coat. Use `translate` for a limb that
   shifts whole, `clear_layer` and redraw for one that changes shape. Leave the
   rest alone: pixels that stay put are what make an animation read as one
   body instead of a flicker.
4. **Keep the palette.** Frames share one palette. `set_palette` on any frame
   writes every frame. Never invent a ramp for one pose.
5. **Check every frame's gates.** Each frame has its own step. Run
   `check_step` on each; a copied frame starts at its source's step, so it is
   gated like a finished sprite from the first write.
6. **Time it, then export.** `set_animation_duration` for an even rate,
   `set_frame_duration` to hold a key pose longer, `set_playback` for the loop,
   then `export_gif` or `export_sheet`.

## 2. The tools

| Tool                     | Arguments                   | Returns                |
| ------------------------ | --------------------------- | ---------------------- |
| `read_animation`         | `{ assetId? }`              | the animation          |
| `add_frame`              | `{ assetId?, copy?: true }` | `{ animation, frame }` |
| `delete_frame`           | `{ assetId }`               | the animation          |
| `move_frame`             | `{ assetId, to }`           | the animation          |
| `set_frame_duration`     | `{ assetId, ms }`           | the animation          |
| `set_animation_duration` | `{ assetId?, ms }`          | the animation          |
| `set_playback`           | `{ assetId?, mode }`        | the animation          |

`assetId` names any frame; omitted, it is the session's open asset. The
animation is:

```jsonc
{
  "rootId": "…", // the first frame; the animation is listed under it
  "playback": "forward", // forward | reverse | pingpong
  "frames": [
    {
      "assetId": "…",
      "position": 0,
      "durationMs": 125,
      "name": "hero-walk",
      "step": "cleanup",
      "updatedAt": 1790000000,
    },
    {
      "assetId": "…",
      "position": 1,
      "durationMs": 125,
      "name": "hero-walk #2",
      "step": "cleanup",
      "updatedAt": 1790000000,
    },
  ],
}
```

- `add_frame` with `copy: false` starts an empty frame with the same palette,
  at the silhouette step (or earlier, if its source was earlier). Use it for a
  pose too different to edit from the last one.
- `delete_frame` refuses the last frame (`animation.last_frame`). Deleting the
  first frame makes the next one first; the animation keeps its name. If you
  delete the frame you have open, the session moves to the one that took its
  place.
- `move_frame` positions count from 0; a position past the end means last.
- Durations are 10 to 10000 ms (`animation.invalid_duration`). 125 ms is
  8 FPS, 83 ms about 12, 42 ms about 24.
- Timing set on a lone sprite is kept: `set_playback` or a duration on it is
  stored, and the frames you add later start from it.
- Frames are named after the first: `hero-walk`, `hero-walk #2`, … Renaming a
  later frame is refused; rename the first.

## 3. Undo and the shared palette

Each frame keeps its own history. A palette write lands on every frame, each
recorded in that frame's own log, so `undo` on one frame undoes only that
frame's copy of the palette. To take a palette change back everywhere, write
the old palette again with `set_palette`.

## 4. A walk cycle, start to finish

```
open_asset { "assetId": "<hero-walk>" }         … draw the contact pose to cleanup
add_frame {}                                    → frame 2, open, a copy
read_canvas { "layer": "silhouette" }
translate { "layer": "silhouette", … }          … move the legs to the passing pose
… redo flats / shading / outline where the legs moved, check_step at each gate
add_frame {}                                    → frame 3 (the other contact)
mirror { … } on the legs, redraw what the mirror got wrong
add_frame {}                                    → frame 4 (the other passing pose)
set_animation_duration { "ms": 125 }
set_frame_duration { "assetId": "<frame 1>", "ms": 167 }   hold the contact
read_animation {}                               … every frame at cleanup?
export_gif { "scale": 4 }
```
