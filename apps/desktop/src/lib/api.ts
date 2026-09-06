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
  engineActivateProvider,
  engineBackends,
  engineCancelDownload,
  engineDownloadModel,
  engineGenerate,
  engineModels,
  enginePauseDownload,
  engineProviders,
  engineRemoveProvider,
  engineSaveProvider,
  engineSelectBackend,
  engineRuntimeCancel,
  engineRuntimeInfo,
  engineRuntimeInstall,
  engineRuntimeRemove,
  engineRuntimeRepair,
  engineTestProvider,
  storageInfo,
  storagePickDirectory,
  storageResetRoot,
  storageSetRoot,
  storageValidate,
  type ShellError,
} from '@/lib/tauri';
import type {
  BackendKind,
  BackendListResponse,
  ConnectionTestResult,
  GenerateRequest,
  GenerateResponse,
  ModelInfo,
  ProviderListResponse,
  ProviderSaveRequest,
  RuntimeInfo,
  RuntimeRequest,
  StorageChange,
  StorageInfo,
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

/**
 * Starts, or continues, downloading a model's weights.
 *
 * Resolves once the engine has accepted the transfer, not once it has
 * finished, so the caller has to follow the progress by re-reading the list.
 * A model whose `resumable` flag is set continues from the bytes already on
 * disk; this is also the call the Resume control makes.
 */
export function downloadModel(modelId: string): Promise<ModelInfo> {
  return unwrap(engineDownloadModel(modelId));
}

/**
 * Stops a download and deletes what it had transferred.
 *
 * Destructive: the bytes are gone and downloading again starts from the
 * beginning. Also what discards a paused download.
 */
export function cancelDownload(modelId: string): Promise<ModelInfo> {
  return unwrap(engineCancelDownload(modelId));
}

/**
 * Stops a download and keeps what it had transferred.
 *
 * Destroys nothing: {@link downloadModel} continues from where this stopped,
 * including after the application has been closed and reopened.
 */
export function pauseDownload(modelId: string): Promise<ModelInfo> {
  return unwrap(enginePauseDownload(modelId));
}

/**
 * Reports whether the GPU runtime is installed, and what installing it costs.
 *
 * Everything the user must be shown before a multi-gigabyte download comes back
 * in one answer: the size, the free space, and the licence of every package.
 */
export function getRuntime(): Promise<RuntimeInfo> {
  return unwrap(engineRuntimeInfo());
}

/**
 * Starts installing the GPU runtime.
 *
 * Resolves once the engine has accepted the install, not once it has finished,
 * so the caller has to follow the progress by re-reading the state.
 */
export function installRuntime(accelerator: RuntimeRequest): Promise<RuntimeInfo> {
  return unwrap(engineRuntimeInstall(accelerator));
}

/**
 * Adds the packages the installed runtime is missing.
 *
 * Fetches the difference rather than the whole runtime, which is what makes
 * a package added after the fact cost megabytes instead of gigabytes.
 */
export function repairRuntime(): Promise<RuntimeInfo> {
  return unwrap(engineRuntimeRepair());
}

/** Asks a running install to stop. Nothing half written is left behind. */
export function cancelRuntimeInstall(): Promise<RuntimeInfo> {
  return unwrap(engineRuntimeCancel());
}

/** Deletes the installed GPU runtime and reclaims its gigabytes. */
export function removeRuntime(): Promise<RuntimeInfo> {
  return unwrap(engineRuntimeRemove());
}

/** Reports where downloaded data is kept, and how much room is left there. */
export function getStorage(): Promise<StorageInfo> {
  return unwrap(storageInfo());
}

/**
 * Checks a directory without adopting it.
 *
 * Rejects with the reason code for a directory that cannot hold the data, so
 * the user learns that a drive is read-only before they confirm rather than
 * four gigabytes into a download.
 */
export function validateStorage(path: string): Promise<StorageInfo> {
  return unwrap(storageValidate(path));
}

/**
 * Moves where downloaded data is kept.
 *
 * Weights already on disk are not moved. The result names what stayed at the
 * old location so the user can be told.
 */
export function setStorageRoot(path: string): Promise<StorageChange> {
  return unwrap(storageSetRoot(path));
}

/** Goes back to the per-user default location. */
export function resetStorageRoot(): Promise<StorageChange> {
  return unwrap(storageResetRoot());
}

/**
 * Opens the system's own directory picker.
 *
 * Resolves to null when the dialog was closed without a choice.
 */
export function pickDirectory(): Promise<string | null> {
  return unwrap(storagePickDirectory());
}

/**
 * Lists configured providers, the built-in catalogue, and where keys are kept.
 *
 * Nothing this returns carries an API key. See {@link saveProvider} for the
 * direction a key does travel in.
 */
export function listProviders(): Promise<ProviderListResponse> {
  return unwrap(engineProviders());
}

/**
 * Creates a provider, or replaces an existing one.
 *
 * A key goes in here and never comes back out. Omitting `apiKey` from the
 * request leaves the stored credential untouched, so a form can round-trip a
 * provider it was never shown the key for.
 */
export function saveProvider(request: ProviderSaveRequest): Promise<ProviderListResponse> {
  return unwrap(engineSaveProvider(request));
}

/** Deletes a provider and the credential stored for it. */
export function removeProvider(providerId: string): Promise<ProviderListResponse> {
  return unwrap(engineRemoveProvider(providerId));
}

/** Selects the provider that serves generation. */
export function activateProvider(providerId: string): Promise<ProviderListResponse> {
  return unwrap(engineActivateProvider(providerId));
}

/**
 * Runs one connection test against a stored provider.
 *
 * Resolves with the outcome whether or not the endpoint answered. A refused key
 * is the result, not an error.
 */
export function testProvider(providerId: string): Promise<ConnectionTestResult> {
  return unwrap(engineTestProvider(providerId));
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
