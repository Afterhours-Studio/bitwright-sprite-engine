# Coding standards

The conventions each language follows here, and the reasoning behind the ones
that are not obvious.

Everything below is enforced by a tool. If a rule is not enforced, it belongs in
review rather than in this document.

## Everything

- Source, comments, documentation, and commit messages are in English. The only
  Vietnamese in the repository is under `apps/desktop/src/locales/vi/`.
- No emoji anywhere. Not in code, documentation, commit messages, or the
  interface.
- `.editorconfig` sets indentation and line endings. Configure your editor to
  read it.
- Every source file starts with the AGPL header naming Afterhours Studio. Copy
  it from a neighbouring file, and do not put your own name in the copyright
  line; authorship is in the git history.
- A comment explains why, not what. `// increment i` is noise; `// The eye
  separates dark values less well` is not.

## Python

Formatted and linted by ruff, checked by `mypy --strict`. Line length 100.

### Types

Every function is annotated, arguments and return. `Any` is a last resort, and
carries a comment saying which external API forced it.

```python
def quantize(image: Image.Image, colors: int = 32, dither: bool = False) -> Image.Image:
```

### Docstrings

Google style, on every public module, class, and function.

```python
def remove_background(image: Image.Image, tolerance: int = 12) -> Image.Image:
    """Make the background transparent by flood filling from the corners.

    Pixels connected to a corner whose colour is within ``tolerance`` of that
    corner become fully transparent. Interior pixels of the same colour are
    kept, so a sprite that contains the background colour does not develop
    holes.

    Args:
        image: Source image. Converted to RGBA if it is not already.
        tolerance: Maximum per-channel difference, 0 to 255, still treated as
            background.

    Returns:
        A new image with the background cleared.

    Raises:
        ValueError: ``tolerance`` is outside 0 to 255.
    """
```

A `Raises:` section for every exception a caller has to handle.

### Interfaces

`Protocol` rather than inheritance, so that callers, tests, and fakes are not
tied to a base class. A base class may exist alongside it to hold shared
behaviour; `BaseBackend` does exactly that.

### Errors

Every exception a user can reach carries a stable `code`. The frontend
translates the code, so the exception message is for logs.

```python
class BackendUnavailableError(BackendError):
    code = "backend.unavailable"
```

Add each new code to both `locales/en/errors.json` and `locales/vi/errors.json`.

### Data

`@dataclass(frozen=True, slots=True)` for values, Pydantic for anything crossing
the HTTP boundary. Frozen because a value that arrives from a request should not
be mutated on the way through.

## TypeScript

ESLint and Prettier. `strict` is on, and so are `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`.

### Types

No `any`. Use `unknown` and narrow it.

```typescript
export function toShellError(error: unknown): ShellError {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    // ...
  }
}
```

Every exported function declares its return type.

### Components

Components are presentational. They read from stores, call actions, and render.
State lives in Zustand; side effects live in hooks. That is what lets a screen
be rendered in a test with an arbitrary store state.

```typescript
export function GenerateScreen(): ReactElement {
  const request = useGenerationStore((state) => state.request);
  const run = useGenerationStore((state) => state.run);
  // no local state, no fetching
}
```

### Strings

No user-visible string is hardcoded. Everything goes through `useTranslation`.
The keys are typed from the English locale files, so a typo does not compile.

```typescript
const { t } = useTranslation('generation');
return <button>{t('actions.generate')}</button>;
```

### Colour

No hex, `rgb()`, or `hsl()` in a component. ESLint rejects them, and a test
scans the source as well. Colour comes from a token, through a Tailwind class
such as `bg-surface-2`. See [the design system](design-system.md).

### Documentation

TSDoc on exported functions, types, and component props.

```typescript
/**
 * Determines which capabilities a request depends on.
 *
 * @param request - The parameters currently entered.
 * @returns The capabilities the request cannot run without.
 */
```

## Rust

`cargo fmt` and `cargo clippy -- -D warnings` are clean.

### Errors

No `unwrap()` or `expect()` on anything that can fail at run time. `expect()` is
allowed for an invariant that would be a programming error, and its message says
why the invariant holds:

```rust
let window = app
    .get_webview_window("main")
    .expect("the main window is declared in tauri.conf.json");
```

Errors are typed with `thiserror`, and every variant carries a stable code:

```rust
#[derive(Debug, thiserror::Error)]
pub enum SidecarError {
    #[error("sidecar.spawn_failed")]
    SpawnFailed(String),
}
```

Every Tauri command returns `Result<T, CommandError>`.

### Locks

A poisoned lock is recovered rather than propagated. A panic while holding the
status lock would otherwise leave the window blank:

```rust
self.status.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
```

### Documentation

`///` on every public item, `//!` at the top of every module. `# Errors` on
anything returning a `Result`.

## Commits

Conventional Commits, described in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Tests

See [Testing](testing.md).
