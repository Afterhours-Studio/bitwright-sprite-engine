# Contributing to Bitwright - Sprite Engine

Thank you for considering a contribution. This document covers the workflow,
the Contributor License Agreement, commit and branch conventions, coding
standards, and the checks your pull request must pass.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Table of Contents

- [Before you start](#before-you-start)
- [Contributor License Agreement](#contributor-license-agreement)
- [Development setup](#development-setup)
- [Workflow](#workflow)
- [Branch naming](#branch-naming)
- [Commit messages](#commit-messages)
- [Coding standards](#coding-standards)
- [Running tests](#running-tests)
- [Adding translated strings](#adding-translated-strings)
- [License headers](#license-headers)
- [Pull request checklist](#pull-request-checklist)

## Before you start

- For a bug, open an issue with the bug report template first, unless the fix
  is a one-line typo.
- For a feature, open a feature request and wait for a maintainer to agree on
  the approach. Large unsolicited pull requests are often declined for reasons
  that have nothing to do with their quality.
- For a security issue, do not open an issue. Follow [SECURITY.md](SECURITY.md).

## Contributor License Agreement

Every contributor must sign the Contributor License Agreement before a pull
request can be merged. The CLA bot comments on your first pull request with a
link; signing takes one click and is recorded against your GitHub account.

**The CLA assigns copyright in your contribution to Afterhours Studio**, the
organization that maintains this project. It is not assigned to any individual
maintainer.

Why the assignment exists:

- Afterhours Studio can then relicense the whole work without tracking down
  every past contributor. That matters for a project under AGPL-3.0, where a
  commercial licensee may need different terms.
- A single copyright holder can enforce the AGPL against a party that ships a
  closed fork.
- It keeps provenance unambiguous if the project is ever audited or
  transferred.

You keep the right to use your own contribution however you like. The CLA grants
Afterhours Studio rights; it does not take yours away.

If your employer owns your work, have someone authorized to bind the company
sign the corporate CLA before you contribute.

## Development setup

Requirements: Node.js 20 or later, Python 3.11, Rust stable, and the platform
prerequisites listed in [docs/development/setup.md](docs/development/setup.md).

```bash
git clone https://github.com/Afterhours-Studio/bitwright-sprite-engine.git
cd bitwright-sprite-engine

# Linux and macOS
./scripts/setup-dev.sh

# Windows (PowerShell)
./scripts/setup-dev.ps1
```

Full instructions, including CUDA and Apple Silicon notes, are in
[docs/development/setup.md](docs/development/setup.md).

## Workflow

1. Fork the repository and clone your fork.
2. Add the upstream remote:
   `git remote add upstream https://github.com/Afterhours-Studio/bitwright-sprite-engine.git`
3. Create a branch from an up to date `main`.
4. Make your change, with tests.
5. Run the checks in [Running tests](#running-tests) locally.
6. Push to your fork and open a pull request against `main`.
7. Fill in the pull request template, and link the issue it closes.
8. Address review feedback by pushing more commits. Do not force push during
   review; the maintainer squashes on merge.

Keep a pull request to one logical change. Split unrelated fixes.

## Branch naming

`<type>/<short-description>`, lowercase, words separated by hyphens.

| Prefix   | Use for                            |
| -------- | ---------------------------------- |
| `feat/`  | New functionality                  |
| `fix/`   | Bug fixes                          |
| `docs/`  | Documentation only                 |
| `chore/` | Tooling, dependencies, maintenance |

Examples: `feat/mps-backend-lora`, `fix/sidecar-port-collision`,
`docs/quick-start-windows`, `chore/bump-diffusers`.

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<optional scope>): <description>

<optional body>

<optional footer>
```

The description is imperative, lowercase, and has no trailing period. Keep the
subject line at 72 characters or fewer.

| Type       | When to use                            | Example                                                  |
| ---------- | -------------------------------------- | -------------------------------------------------------- |
| `feat`     | A new feature                          | `feat(backends): add capability probe for LoRA hot swap` |
| `fix`      | A bug fix                              | `fix(sidecar): release the port when startup fails`      |
| `docs`     | Documentation only                     | `docs(i18n): explain how to add a locale`                |
| `style`    | Formatting with no code change         | `style(ui): apply prettier to layout components`         |
| `refactor` | Neither fixes a bug nor adds a feature | `refactor(pipeline): extract grid packing helper`        |
| `perf`     | Improves performance                   | `perf(quantize): cache the palette lookup table`         |
| `test`     | Adds or corrects tests                 | `test(backends): cover the remote timeout path`          |
| `build`    | Build system or dependencies           | `build(deps): bump diffusers to 0.31`                    |
| `ci`       | CI configuration                       | `ci: run cargo clippy on windows`                        |
| `chore`    | Anything else with no source impact    | `chore: add editorconfig for rust files`                 |
| `revert`   | Reverts an earlier commit              | `revert: feat(backends): add capability probe`           |

Breaking changes carry a `!` after the type, and a `BREAKING CHANGE:` footer:

```
feat(api)!: return capabilities as a list instead of a bitmask

BREAKING CHANGE: GET /v1/backends now returns capabilities as an array of
strings. Clients reading the previous integer field must be updated.
```

Scopes in common use: `ui`, `backends`, `pipeline`, `api`, `sidecar`, `tauri`,
`i18n`, `docs`, `deps`.

## Coding standards

Details live in [docs/development/coding-standards.md](docs/development/coding-standards.md).
The short version:

### Python

- Formatted and linted by ruff. Line length 100.
- `mypy --strict` passes. Every function is annotated. Do not use `Any` unless
  an external API leaves no alternative, and add a comment when you do.
- Google style docstrings on every public module, class, and function.
- Prefer `Protocol` over inheritance for interfaces.

### TypeScript

- ESLint and Prettier. TypeScript `strict` is on, and so is
  `noUncheckedIndexedAccess`.
- No `any`. Use `unknown` and narrow it.
- Components are presentational. State goes in Zustand stores, and side effects
  go in hooks.
- No user visible string is hardcoded. Everything goes through
  `useTranslation`.

### Rust

- `cargo fmt` and `cargo clippy -- -D warnings` are clean.
- No `unwrap()` or `expect()` on a path that can fail at runtime. Return a
  typed error with `thiserror`.
- Every Tauri command returns `Result<T, CommandError>`.

## Running tests

Run all three suites before you open a pull request. CI runs the same commands
on Linux, Windows, and macOS.

```bash
# Frontend
cd apps/desktop
npm run lint
npm run typecheck
npm run test

# Backend
cd packages/engine
ruff check .
ruff format --check .
mypy .
pytest

# Tauri shell
cd apps/desktop/src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

## Adding translated strings

Bitwright ships English (`en`, the default and the fallback) and Vietnamese
(`vi`). Both locales must carry the same set of keys; CI fails on a mismatch.

When you add a string:

1. Add the key to the right namespace file under
   `apps/desktop/src/locales/en/`. The namespaces are `common`, `generation`,
   `settings`, and `errors`.
2. Add the same key to `apps/desktop/src/locales/vi/`. If you do not speak
   Vietnamese, copy the English text so the key exists, and note it in the pull
   request description so a reviewer can translate it. A missing key is a
   failure; an untranslated one is a follow up.
3. Use the key through `useTranslation`, never a literal:

   ```tsx
   const { t } = useTranslation('generation');
   return <button>{t('actions.generate')}</button>;
   ```

4. Keep keys nested and descriptive: `actions.generate`, not `btn1`.
5. Run `npm run test` in `apps/desktop`. The locale parity test compares the
   key sets.

See [docs/development/i18n.md](docs/development/i18n.md) to add a new language.

## License headers

Every source file (`.py`, `.ts`, `.tsx`, `.rs`) starts with the AGPL header,
naming Afterhours Studio as the copyright holder. Copy it from a neighboring
file. Do not put your own name in the copyright line; authorship is recorded in
the git history.

## Pull request checklist

- [ ] CLA signed.
- [ ] Branch named with the right prefix, commits follow Conventional Commits.
- [ ] Lint, type check, and tests pass for every language you touched.
- [ ] New source files carry the license header.
- [ ] New strings exist in both `en` and `vi`.
- [ ] Documentation updated when behavior changed.
- [ ] `CHANGELOG.md` updated under Unreleased for a user visible change.
- [ ] No emoji anywhere in the diff.
