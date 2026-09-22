# 12. Pivot from diffusion generation to an agent-driven pixel editor

Date: 2026-09-23

## Status

Accepted. Supersedes [0011](0011-gpu-runtime-installation.md) in full, since
there is no longer anything for a GPU runtime to run. Amends
[0003](0003-python-sidecar-architecture.md) and
[0007](0007-sidecar-packaging-strategy.md), whose sidecar survives with a much
smaller job; each carries a note saying which of its reasoning still holds.

## Context

Bitwright was built to generate a sprite with a diffusion model and then repair
the result. The repair step never stopped being a repair step, and the
repository had already written down why, at length, before this decision was
made.

`../pixel-editing-plan.md` states the diagnosis in its first paragraph: a
diffusion model does not produce pixel art, it produces an image of pixel art.
Measured rather than glanced at, the difference is not subtle. A model asked
for a 64 by 64 sprite at 512 pixels lays down blocks that are near enough eight
pixels wide to read as a grid and not exactly eight pixels wide anywhere, so
the grid drifts across the image and usually starts at a fractional offset.
Every block boundary carries a pixel or two of blend, because the training
images had been resampled. A sixteen colour sprite arrives with tens of
thousands of distinct colours, each within a couple of units of one of the
sixteen and none of them equal to it.

That document then spends most of its length describing the machinery needed to
undo all of this: discrete Fourier analysis to recover the cell size and phase,
a modal vote per cell, weighted k-means in Oklab to build a palette the model
never committed to, alpha hardening, halo removal, despeckling. It is good
machinery and it works. What it cannot do is make the generator produce the
grid in the first place. Every improvement to the model changes what conform
has to fight, and conform is the only part of the pipeline that knows what a
pixel is.

The second problem is that the loop is closed to inspection. A diffusion
pipeline produces an image and has no way to answer "is the outline one pixel
thick" or "does the shading have a single light direction", because the
question is about a structure the pipeline never represented. The most a user
could do with a nearly-right sprite was generate again with a different seed.

Three ways out were weighed.

**Keep generating and improve conform.** Cheapest, and the failure mode is
known: the conform work is already close to the limit of what can be recovered
from a resampled image, and further effort goes into estimating intent that was
never encoded. It also leaves a 2.5 GB PyTorch download, a per-user model
cache of several gigabytes, a GPU runtime installer, remote provider
credentials, and three backends between a user and their first sprite.

**Train or fine-tune a model that emits a real indexed grid.** This is the
honest technical answer to the diagnosis, and it is a research project. For a
two person team it is the whole project, and it would still produce a single
shot with no way to revise part of a result.

**Put an agent in the drawing seat instead of the model.** An agent that works
through a tool API on a real indexed canvas does not approximate pixel art; it
writes palette indices into a buffer. It can read back exactly what it drew as
text, notice that the outline has a two-pixel run on row 41, and fix those two
pixels without touching anything else. The work becomes ordered and revisable
rather than a single opaque sample, and the application it needs is a pixel art
editor, which is a bounded piece of software this team can finish.

The cost of the third option is the one thing the first two have: pressing a
button and receiving a finished sprite in twenty seconds, with no client
attached and nothing to describe beyond a prompt.

## Decision

**Local and remote diffusion generation is deleted, and Bitwright becomes a
pixel art editor whose canvas an MCP client drives.**

What goes, entirely: the backend abstraction and the CUDA, MPS and remote
backends behind it; the model registry, downloader and weight cache; the GPU
runtime installer of ADR 0011 and its pinned wheel manifest; remote provider
configuration and its credential storage; the Generate screen, the parameter
panel, the preview rail, and the engine, provider and runtime cards in
Settings. The 14.9 GB of weights and the PyTorch tree under the user's data
root go with them.

What stays, unchanged: the design system and its token discipline, the shell,
the custom titlebar and window controls, the dock, the command palette, the
toasts, and the internationalisation machinery. None of that was about
diffusion.

What stays with a new job: the conform pipeline. Grid detection, weighted
k-means in Oklab, modal downsampling, alpha hardening, dithering and background
removal are all retained, and they stop being a repair step applied to every
generated image. They become the importer that takes a reference picture a
person found or drew and turns it into an indexed canvas and a palette the
agent can work from. The algorithms do not change; what changes is that their
input is now an image someone chose to import rather than an image this
application produced and then had to apologise for.

The drawing surface is indexed, not RGBA: a document's pixels are palette
indices, one byte each, so that readback is cheap, recolouring is free, and
palette discipline is enforceable rather than advisory. The tool surface an
agent sees, and the schema underneath it, are specified in
[the document model](../document-model.md) and [the MCP tools](../mcp-tools.md).

The rollout is staged rather than simultaneous, and the stages are written down
in [the plan](../../plan/PLAN.md). The demolition and the document model come
first, the MCP server after them, the workflow gates and the reference importer
after that.

## Consequences

Positive:

- The output is pixel art by construction. There is no grid to recover, no
  colour to round to the nearest palette entry, and no soft edge to harden,
  because nothing ever wrote a pixel the palette did not contain.
- The agent can see what it drew. A 64 by 64 layer reads back as four kilobytes
  of text, which is nothing to a model and is the difference between correcting
  a sprite and regenerating it.
- The download collapses. An installer that carried a machine learning runtime
  and pointed at gigabytes of weights becomes an application that is measured in
  tens of megabytes and needs no GPU at all.
- The hard problems move to where they can be checked. Whether a silhouette is
  one connected region, whether shading has a single light direction, whether an
  outline strays outside the subject — each is a computation over a pixel buffer
  rather than a judgement about a render.
- Revision is local. Each workflow step owns its own layer, so redoing the
  shading does not destroy the detail pass.

Negative:

- **One-shot generation is gone, and it was the product.** A user who wanted to
  type a prompt and get a sprite has to attach an MCP client and let an agent
  work through the steps. That is slower for the first sprite, and it is a
  harder thing to explain.
- The application is no longer self-contained. Without a client connected, it is
  an editor a person draws in by hand, which is a crowded category with better
  incumbents. The agent is the reason to use it, and the agent is somewhere
  else.
- A large amount of working, tested code is deleted: the backends, the
  downloader, the runtime installer and the whole generation interface. ADR 0011
  in particular records weeks of work on a problem that no longer exists.
- Quality now depends on the model at the other end of the MCP connection, which
  this project does not control and cannot pin the way it pinned a wheel
  manifest.

Neutral:

- The Python sidecar survives, so ADRs 0003, 0007 and 0008 keep most of their
  force. It has a much smaller job, and whether it was worth keeping at all is
  argued in [0013](0013-rust-mcp-server-in-the-tauri-process.md).
- `pixel-editing-plan.md` is kept rather than retired. Its diagnosis is the
  reason for this record, and its conform work is retained; only its framing,
  which assumed a generated image to repair, has been rewritten.
