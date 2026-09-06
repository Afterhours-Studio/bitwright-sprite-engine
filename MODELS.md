# Models

Bitwright - Sprite Engine does not ship machine learning model weights, and the
weights it downloads are not covered by this repository's license.

## Weights are not code

The source code in this repository is licensed under AGPL-3.0-only, copyright
Afterhours Studio. Model weights are data files produced by third parties. They
are:

- Not distributed with the application binaries or the source tree.
- Downloaded on first use, from the model host named in the registry entry.
- Stored in the local model cache, outside the repository.
- Governed by the license of the party that published them, not by AGPL-3.0.

Using Bitwright does not grant you any right to a model. Before generating with
a model, read its license and confirm your use is permitted. Commercial use in
particular differs from model to model.

## Where weights are stored

| Platform | Default cache path |
| --- | --- |
| Windows | `%LOCALAPPDATA%\studio.afterhours.bitwright\models` |
| macOS | `~/Library/Application Support/studio.afterhours.bitwright/models` |
| Linux | `~/.local/share/studio.afterhours.bitwright/models` |

The path is configurable through `models.cache_dir`. See
[docs/reference/configuration.md](docs/reference/configuration.md).

## Model registry

The registry in `packages/engine/bitwright_engine/models/registry.py` is the
single source of truth. The table below mirrors it.

| Registry ID | Purpose | Publisher | License | Commercial use |
| --- | --- | --- | --- | --- |
| `sd15-base` | Base diffusion model | Stability AI, RunwayML | CreativeML Open RAIL-M | Permitted with use restrictions |
| `sdxl-base` | Higher resolution base model | Stability AI | CreativeML Open RAIL++-M | Permitted with use restrictions |
| `pixel-art-lora` | Pixel art style adapter | Community | CreativeML Open RAIL-M | Permitted with use restrictions |
| `rembg-u2net` | Background removal | rembg project | Apache-2.0 | Permitted |

The RAIL licenses attach use restrictions. Among other things they forbid
generating content that harasses individuals, or that is presented as legal,
medical, or financial advice. Read the full text before shipping Bitwright as
part of a product.

## Remote API backends

When the remote backend is selected, no weights are downloaded. Prompts and
generation parameters are sent to the endpoint you configure, and that
provider's terms of service and privacy policy apply to the request. Bitwright
does not proxy requests through Afterhours Studio infrastructure.

## Adding a model

1. Add an entry to `registry.py` with the download source, revision, SHA-256
   digest, and SPDX license identifier.
2. Add a row to the table above.
3. Confirm the license permits redistribution of the download URL, and that no
   weights enter the repository.
