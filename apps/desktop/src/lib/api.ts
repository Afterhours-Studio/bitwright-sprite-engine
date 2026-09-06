// Bitwright - Sprite Engine
// Copyright (C) 2026 Afterhours Studio
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

/**
 * Client for the engine.
 *
 * Every call goes through a shell command rather than `fetch`. The engine
 * authenticates its callers with a token that only the shell holds, and refuses
 * any request carrying an `Origin`, which a webview always sends. So the
 * webview is not a client of the engine, by design: a compromised page has
 * nothing to replay.
 */

import {
  engineBackends,
  engineGenerate,
  engineModels,
  engineSelectBackend,
  type ShellError,
} from '@/lib/tauri';
import type {
  BackendKind,
  BackendListResponse,
  GenerateRequest,
  GenerateResponse,
  ModelInfo,
} from '@/types/engine';

/** A failure from the engine, carrying a code the `errors` namespace translates. */
export class ApiError extends Error {
  /** Stable reason code. */
  readonly code: string;

  constructor(code: string, detail: string) {
    super(detail === '' ? code : detail);
    this.name = 'ApiError';
    this.code = code;
  }

  /** Builds an ApiError from a shell failure. */
  static fromShell(error: ShellError): ApiError {
    return new ApiError(error.code, error.detail);
  }
}

/**
 * Unwraps a shell result, throwing the failure as an {@link ApiError}.
 *
 * @param result - The result of a shell command.
 * @returns The command's value.
 * @throws ApiError When the command failed.
 */
async function unwrap<T>(
  result: Promise<{ ok: true; value: T } | { ok: false; error: ShellError }>,
): Promise<T> {
  const settled = await result;
  if (!settled.ok) {
    throw ApiError.fromShell(settled.error);
  }
  return settled.value;
}

/** Lists every backend with its availability and capabilities. */
export function listBackends(): Promise<BackendListResponse> {
  return unwrap(engineBackends());
}

/** Switches the active backend. Resolves to the refreshed backend list. */
export function selectBackend(kind: BackendKind): Promise<BackendListResponse> {
  return unwrap(engineSelectBackend(kind));
}

/** Lists registered models with their licences and cache state. */
export async function listModels(): Promise<ModelInfo[]> {
  const response = await unwrap(engineModels());
  return response.models;
}

/** Generates sprites. */
export function generate(body: GenerateRequest): Promise<GenerateResponse> {
  return unwrap(engineGenerate(body));
}

/**
 * Turns base64 PNG bytes into a data URL the browser can render.
 *
 * @param data - Base64 encoded PNG bytes, with no prefix.
 * @returns A data URL.
 */
export function toDataUrl(data: string): string {
  return `data:image/png;base64,${data}`;
}
