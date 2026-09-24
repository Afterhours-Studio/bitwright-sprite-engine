# Testing

What is tested in each language, how to run it, and which checks exist to stop
a whole class of mistake rather than one bug.

## Running everything

```bash
# Frontend
npm run test

# Colour tokens
npm run check:contrast

# Engine
cd packages/engine && pytest

# Shell
cd apps/desktop/src-tauri && cargo test

# Dependency licences
python scripts/check-licenses.py
```

CI runs all of these on Linux, Windows, and macOS.

## Engine (pytest)

```bash
cd packages/engine
pytest                     # all
pytest tests/test_api.py   # one file
pytest -k capability       # by name
pytest -v                  # verbose
```

| File                  | Covers                                              |
| --------------------- | --------------------------------------------------- |
| `test_conform.py`     | Grid detection, the modal vote, palettes, clean-up  |
| `test_postprocess.py` | Background removal, quantization, grid packing      |
| `test_storage.py`     | The data root: validation, switching, defaults      |
| `test_security.py`    | The token, and the refusal of a request with Origin |
| `test_watchdog.py`    | Exiting when the parent process is gone             |
| `test_api.py`         | Every HTTP endpoint                                 |

Conform is where the interesting tests are, because it is the one part of the
engine with an answer that can be checked rather than merely observed. The tests
build an image by upscaling a known grid at a known phase, run detection over
it, and assert that the cell size and offset come back exactly. A test written
that way fails when the mathematics is wrong; a test that asserts the output has
the right dimensions passes whatever the mathematics did.

```python
def test_detects_the_phase_of_an_offset_grid() -> None:
    source = upscale(known_sprite, factor=8, offset=(3, 5))
    grid = detect_grid(source, target=(16, 16))
    assert (grid.phase_x, grid.phase_y) == (3, 5)
```

Tests never touch the network and never write outside a temporary directory. The
`settings` fixture points the data root at one.

## Frontend (Vitest)

```bash
npm run test          # once
npm run test:watch    # watch
```

### Screen rendering

`src/test/screens.test.tsx` renders every screen in both themes. No Tauri bridge
is installed, so the shell helpers report that it is absent, which is exactly
the path the interface must survive.

It also checks that a rendered screen contains no inline colour. A component
reaching for a literal instead of a token would look right in one theme and
wrong in the other, so it is caught mechanically rather than by eye.

### Locale parity

`src/locales/locales.test.ts` compares the key sets of every language.

A key present in English and missing in Vietnamese falls back silently at run
time, which reads as a bug to a Vietnamese speaker and is easy to miss in
review. The test makes it a build failure. It also rejects empty strings and
emoji.

### Token discipline

`src/test/tokens.test.ts` scans the source for a hex colour or an `rgb()`,
`hsl()` call outside `tokens.css`, and checks that both themes declare the same
colour tokens.

## Shell (cargo test)

```bash
cd apps/desktop/src-tauri
cargo test
```

Rust now carries the document store, the raster core and the MCP server, so this
is where most of the application's logic is and where most of its tests belong.
The existing ones cover handshake parsing, the base URL guard and the platform
report; the ones that arrive with the store and the raster core cover the op set
and the workflow gates, which are pure functions over a pixel buffer and are
therefore the easiest thing in the project to test properly. Window management
and process spawning need a real window and a real child, and are exercised by
running the application.

```rust
#[test]
fn ignores_log_lines() {
    assert!(parse_handshake("INFO loading model").is_none());
}
```

That one is worth having: a stray print on standard output must never be
mistaken for a handshake.

## Colour tokens

```bash
npm run check:contrast
```

`scripts/check-contrast.ts` reads `tokens.css` and enforces the promises the
design system makes: the minimum lightness step between adjacent surfaces, the
contrast ratio of every declared text pairing, and that both modes declare the
same tokens. It runs as its own CI job and blocks a merge.

Reading its output is covered in [Theming](theming.md).

## Dependency licences

```bash
python scripts/check-licenses.py            # fail on a violation
python scripts/check-licenses.py --report   # list everything
```

Fails on a dependency whose licence is incompatible with AGPL-3.0-only, and on
one that declares no licence. A licence the script does not recognise also
fails, deliberately: an unreviewed licence should stop the build rather than
pass quietly.

## What to test

Test the contract, not the implementation. A test that asserts a function calls
another function breaks when the code is tidied and catches nothing.

Worth a test:

- A workflow gate failing a silhouette that is two disconnected regions.
- An op applied and then undone leaving the buffer byte for byte as it was.
- Grid detection recovering a cell size and phase that a test constructed.
- A reason code being returned rather than an exception escaping.
- A conform step preserving alpha.
- A locale gaining a key in one language only.
- A colour token pairing falling below its contrast threshold.

Not worth a test:

- That a component renders a specific class name.
- That a getter returns what was set.
- Third party behaviour.

## Adding a test

| Language   | Location                               | Naming                                                 |
| ---------- | -------------------------------------- | ------------------------------------------------------ |
| Python     | `packages/engine/tests/`               | `test_<module>.py`, functions describing the behaviour |
| TypeScript | Next to the code, or `src/test/`       | `<name>.test.ts` or `.test.tsx`                        |
| Rust       | A `#[cfg(test)] mod tests` in the file | Functions describing the behaviour                     |

Name a test after the behaviour, not the function:
`test_detects_the_phase_of_an_offset_grid`, not `test_conform_2`.
