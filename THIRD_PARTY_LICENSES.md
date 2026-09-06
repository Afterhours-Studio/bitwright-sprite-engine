# Third Party Licenses

Bitwright - Sprite Engine depends on the third party software listed here. Each
dependency remains under its own license. This file lists direct dependencies.
Run `python scripts/check-licenses.py --report` for the resolved transitive set.

Model weights are not listed here, because they are not dependencies of the
build. See [MODELS.md](MODELS.md).

## Python (packages/engine)

| Package           | License      | Project                                       |
| ----------------- | ------------ | --------------------------------------------- |
| fastapi           | MIT          | https://github.com/fastapi/fastapi            |
| uvicorn           | BSD-3-Clause | https://github.com/encode/uvicorn             |
| pydantic          | MIT          | https://github.com/pydantic/pydantic          |
| pydantic-settings | MIT          | https://github.com/pydantic/pydantic-settings |
| httpx             | BSD-3-Clause | https://github.com/encode/httpx               |
| pillow            | MIT-CMU      | https://github.com/python-pillow/Pillow       |
| keyring           | MIT          | https://github.com/jaraco/keyring             |

Local generation extras (`cuda` and `mps`), not installed by default:

| Package      | License      | Project                                     |
| ------------ | ------------ | ------------------------------------------- |
| torch        | BSD-3-Clause | https://github.com/pytorch/pytorch          |
| diffusers    | Apache-2.0   | https://github.com/huggingface/diffusers    |
| transformers | Apache-2.0   | https://github.com/huggingface/transformers |
| safetensors  | Apache-2.0   | https://github.com/huggingface/safetensors  |
| numpy        | BSD-3-Clause | https://github.com/numpy/numpy              |

Development only:

| Package        | License                                     | Project                                      |
| -------------- | ------------------------------------------- | -------------------------------------------- |
| pytest         | MIT                                         | https://github.com/pytest-dev/pytest         |
| pytest-asyncio | Apache-2.0                                  | https://github.com/pytest-dev/pytest-asyncio |
| ruff           | MIT                                         | https://github.com/astral-sh/ruff            |
| mypy           | MIT                                         | https://github.com/python/mypy               |
| pyinstaller    | GPL-2.0 with an exception for frozen output | https://github.com/pyinstaller/pyinstaller   |

## JavaScript (apps/desktop)

| Package         | License           | Project                                  |
| --------------- | ----------------- | ---------------------------------------- |
| react           | MIT               | https://github.com/facebook/react        |
| react-dom       | MIT               | https://github.com/facebook/react        |
| i18next         | MIT               | https://github.com/i18next/i18next       |
| react-i18next   | MIT               | https://github.com/i18next/react-i18next |
| zustand         | MIT               | https://github.com/pmndrs/zustand        |
| cmdk            | MIT               | https://github.com/pacocoursey/cmdk      |
| @tauri-apps/api | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri      |

Development only:

| Package         | License           | Project                                     |
| --------------- | ----------------- | ------------------------------------------- |
| vite            | MIT               | https://github.com/vitejs/vite              |
| typescript      | Apache-2.0        | https://github.com/microsoft/TypeScript     |
| tailwindcss     | MIT               | https://github.com/tailwindlabs/tailwindcss |
| vitest          | MIT               | https://github.com/vitest-dev/vitest        |
| eslint          | MIT               | https://github.com/eslint/eslint            |
| prettier        | MIT               | https://github.com/prettier/prettier        |
| @tauri-apps/cli | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri         |

## Rust (apps/desktop/src-tauri)

| Crate               | License           | Project                                         |
| ------------------- | ----------------- | ----------------------------------------------- |
| tauri               | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri             |
| tauri-plugin-dialog | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace |
| tauri-build         | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri             |
| tauri-plugin-shell  | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace |
| serde               | Apache-2.0 OR MIT | https://github.com/serde-rs/serde               |
| serde_json          | Apache-2.0 OR MIT | https://github.com/serde-rs/json                |
| tokio               | MIT               | https://github.com/tokio-rs/tokio               |
| reqwest             | Apache-2.0 OR MIT | https://github.com/seanmonstar/reqwest          |
| thiserror           | Apache-2.0 OR MIT | https://github.com/dtolnay/thiserror            |
| log                 | Apache-2.0 OR MIT | https://github.com/rust-lang/log                |

## Policy

Permissive licenses (MIT, BSD, Apache-2.0, ISC, MPL-2.0, Unlicense, Zlib,
Python-2.0) are accepted. Strong copyleft on a dependency (GPL-2.0, GPL-3.0,
AGPL-3.0, SSPL, BUSL) and unlicensed packages fail CI, because they constrain
redistribution beyond what this project's own AGPL-3.0 grant covers. The
allowlist and denylist live in `scripts/check-licenses.py`.

One exemption is recorded there: PyInstaller is GPL-2.0 with an explicit
exception permitting the frozen output to be distributed under any licence. It
is a build tool, and its own code is not part of the bundle. Any further
exemption needs the same kind of reading, written down next to it.
