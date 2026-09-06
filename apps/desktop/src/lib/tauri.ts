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
 * The bridge to the Rust shell.
 *
 * Every call goes through {@link invoke}, which returns a discriminated result
 * rather than throwing. Outside a Tauri window, such as under Vitest or in a
 * plain browser, the bridge reports that it is absent and callers fall back to
 * safe defaults. That is what keeps the interface testable without a shell.
 */

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type {
  BackendKind,
  BackendListResponse,
  ConformResponse,
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

/** A failed command, carrying a code the `errors` namespace can translate. */
export interface ShellError {
  code: string;
  detail: string;
}

/** The outcome of a command: either a value, or a translatable failure. */
export type ShellResult<T> = { ok: true; value: T } | { ok: false; error: ShellError };

/**
 * Sidecar status, as reported by the shell.
 *
 * There is deliberately no token here. The engine's token stays in Rust: a
 * token the webview holds is a token any script in the webview holds, and the
 * engine refuses requests from a browser anyway.
 */
export interface SidecarStatus {
  ready: boolean;
  port: number;
  version: string;
  error: string;
  detail: string;
}

/** Which window background effect the shell managed to apply. */
export interface VibrancyState {
  applied: boolean;
  effect: string;
  reason: string;
}

/** Facts about the host that the title bar layout depends on. */
export interface PlatformInfo {
  os: 'macos' | 'windows' | 'linux';
  systemWindowControls: boolean;
}

/** The result of the startup GPU probe. */
export interface GpuReport {
  kind: 'cuda' | 'metal' | 'none';
  available: boolean;
  code: string;
  detail: string;
}

/** Events the shell emits. */
export const SHELL_EVENTS = {
  sidecarReady: 'sidecar://ready',
  sidecarFailed: 'sidecar://failed',
  gpu: 'startup://gpu',
} as const;

/**
 * Reports whether the page is running inside a Tauri window.
 *
 * @returns True when shell commands are available.
 */
export function inShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Calls a shell command.
 *
 * @param command - Command name, as registered in `commands.rs`.
 * @param args - Command arguments.
 * @returns The command's value, or a translatable failure.
 */
export async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<ShellResult<T>> {
  if (!inShell()) {
    return { ok: false, error: { code: 'shell.unavailable', detail: 'not running in Tauri' } };
  }

  try {
    return { ok: true, value: await tauriInvoke<T>(command, args) };
  } catch (error) {
    return { ok: false, error: toShellError(error) };
  }
}

/**
 * Normalises whatever a command rejected with into a {@link ShellError}.
 *
 * Rust returns `{ code, detail }`, but a bridge level failure rejects with a
 * string, so both shapes are handled here rather than at every call site.
 *
 * @param error - The rejection value.
 * @returns A translatable error.
 */
export function toShellError(error: unknown): ShellError {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const shaped = error as { code: unknown; detail?: unknown };
    return {
      code: typeof shaped.code === 'string' ? shaped.code : 'unknown',
      detail: typeof shaped.detail === 'string' ? shaped.detail : '',
    };
  }
  return { code: 'unknown', detail: typeof error === 'string' ? error : String(error) };
}

/**
 * Subscribes to a shell event.
 *
 * @param event - Event name from {@link SHELL_EVENTS}.
 * @param handler - Called with each payload.
 * @returns A function that cancels the subscription, or a no-op outside a shell.
 */
// The type parameter appears once by design: it is how a caller states the
// payload type of an event that the shell describes only at run time.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export async function on<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!inShell()) {
    return () => {};
  }
  return listen<T>(event, (message) => {
    handler(message.payload);
  });
}

/** Returns the sidecar's current status. */
export function sidecarStatus(): Promise<ShellResult<SidecarStatus>> {
  return invoke<SidecarStatus>('sidecar_status');
}

/** Lists every backend with its availability and capabilities. */
export function engineBackends(): Promise<ShellResult<BackendListResponse>> {
  return invoke<BackendListResponse>('engine_backends');
}

/** Switches the active backend. Resolves to the refreshed backend list. */
export function engineSelectBackend(kind: BackendKind): Promise<ShellResult<BackendListResponse>> {
  return invoke<BackendListResponse>('engine_select_backend', { kind });
}

/** Generates sprites. */
export function engineGenerate(request: GenerateRequest): Promise<ShellResult<GenerateResponse>> {
  return invoke<GenerateResponse>('engine_generate', { request });
}

/** Lists registered models with their licences and cache state. */
export function engineModels(): Promise<ShellResult<{ models: ModelInfo[] }>> {
  return invoke<{ models: ModelInfo[] }>('engine_models');
}

/**
 * Starts, or continues, downloading a model's weights.
 *
 * The engine answers as soon as it has accepted the transfer, not when the
 * transfer finishes, and reports the model's new state. A model with a paused
 * download on disk is continued from where it stopped; there is no separate
 * resume call, because whether bytes are already here is a fact about the
 * cache rather than something the caller decides.
 */
export function engineDownloadModel(modelId: string): Promise<ShellResult<ModelInfo>> {
  return invoke<ModelInfo>('engine_download_model', { modelId });
}

/** Stops a download and deletes the bytes it had. */
export function engineCancelDownload(modelId: string): Promise<ShellResult<ModelInfo>> {
  return invoke<ModelInfo>('engine_cancel_download', { modelId });
}

/** Corrects one sprite that already exists. */
export function engineConform(request: unknown): Promise<ShellResult<ConformResponse>> {
  return invoke<ConformResponse>('engine_conform', { request });
}

/** Deletes a model's weights from this machine. */
export function engineRemoveModel(modelId: string): Promise<ShellResult<ModelInfo>> {
  return invoke<ModelInfo>('engine_remove_model', { modelId });
}

/** Stops a download and keeps the bytes it had, so it can be continued. */
export function enginePauseDownload(modelId: string): Promise<ShellResult<ModelInfo>> {
  return invoke<ModelInfo>('engine_pause_download', { modelId });
}

/**
 * Reports whether the GPU runtime is installed, and what installing it costs.
 *
 * The shell probes for the GPU on the way through, so the engine answers with a
 * recommendation for the hardware actually present rather than a guess.
 */
export function engineRuntimeInfo(): Promise<ShellResult<RuntimeInfo>> {
  return invoke<RuntimeInfo>('engine_runtime_info');
}

/**
 * Starts installing the GPU runtime.
 *
 * The engine answers as soon as it has accepted the transfer, not when the
 * gigabytes have landed, so the caller follows progress by re-reading the state.
 */
export function engineRuntimeInstall(
  accelerator: RuntimeRequest,
): Promise<ShellResult<RuntimeInfo>> {
  return invoke<RuntimeInfo>('engine_runtime_install', { accelerator });
}

/** Adds the packages the installed runtime is missing, and nothing else. */
export function engineRuntimeRepair(): Promise<ShellResult<RuntimeInfo>> {
  return invoke<RuntimeInfo>('engine_runtime_repair');
}

/** Asks a running install to stop. Nothing half written survives. */
export function engineRuntimeCancel(): Promise<ShellResult<RuntimeInfo>> {
  return invoke<RuntimeInfo>('engine_runtime_cancel');
}

/** Deletes the installed GPU runtime and reclaims its gigabytes. */
export function engineRuntimeRemove(): Promise<ShellResult<RuntimeInfo>> {
  return invoke<RuntimeInfo>('engine_runtime_remove');
}

/** Reports where downloaded data is kept, and how much room is left there. */
export function storageInfo(): Promise<ShellResult<StorageInfo>> {
  return invoke<StorageInfo>('storage_info');
}

/**
 * Checks a directory without adopting it.
 *
 * The engine creates it if it is missing and proves it writable by writing a
 * file and deleting it again, then reports the free space on its volume. That
 * is what lets the interface warn before a four gigabyte download onto a
 * volume with one gigabyte left.
 */
export function storageValidate(path: string): Promise<ShellResult<StorageInfo>> {
  return invoke<StorageInfo>('storage_validate', { path });
}

/**
 * Moves where downloaded data is kept, and remembers the choice.
 *
 * Nothing on disk is moved. The result names what stayed at the old location.
 */
export function storageSetRoot(path: string): Promise<ShellResult<StorageChange>> {
  return invoke<StorageChange>('storage_set_root', { path });
}

/** Goes back to the per-user default location. */
export function storageResetRoot(): Promise<ShellResult<StorageChange>> {
  return invoke<StorageChange>('storage_reset_root');
}

/**
 * Opens the system's own directory picker.
 *
 * Resolves to null when the user closed the dialog without choosing, which is
 * an answer rather than a failure.
 */
export function storagePickDirectory(): Promise<ShellResult<string | null>> {
  return invoke<string | null>('storage_pick_directory');
}

/**
 * Lists configured providers, the built-in catalogue, and where keys are kept.
 *
 * No response from any of these commands carries an API key. The engine
 * accepts one and never returns it; what comes back is a presence flag and a
 * masked hint.
 */
export function engineProviders(): Promise<ShellResult<ProviderListResponse>> {
  return invoke<ProviderListResponse>('engine_providers');
}

/**
 * Creates a provider, or replaces an existing one.
 *
 * Omitting `apiKey` leaves the stored credential alone, which is what an edit
 * that never opened the key field sends.
 */
export function engineSaveProvider(
  request: ProviderSaveRequest,
): Promise<ShellResult<ProviderListResponse>> {
  return invoke<ProviderListResponse>('engine_save_provider', { request });
}

/** Deletes a provider and the credential stored for it. */
export function engineRemoveProvider(
  providerId: string,
): Promise<ShellResult<ProviderListResponse>> {
  return invoke<ProviderListResponse>('engine_remove_provider', { providerId });
}

/** Selects the provider that serves generation. */
export function engineActivateProvider(
  providerId: string,
): Promise<ShellResult<ProviderListResponse>> {
  return invoke<ProviderListResponse>('engine_activate_provider', { providerId });
}

/**
 * Runs one connection test against a stored provider.
 *
 * Resolves rather than rejects when the endpoint refuses: a rejected key is the
 * answer the user asked for, not a failure of the call.
 */
export function engineTestProvider(providerId: string): Promise<ShellResult<ConnectionTestResult>> {
  return invoke<ConnectionTestResult>('engine_test_provider', { providerId });
}

/** Returns which window background effect was applied. */
export function vibrancyState(): Promise<ShellResult<VibrancyState>> {
  return invoke<VibrancyState>('vibrancy_state');
}

/** Returns the platform facts the title bar depends on. */
export function platformInfo(): Promise<ShellResult<PlatformInfo>> {
  return invoke<PlatformInfo>('platform_info');
}

/** Returns the application's own version, as built into the shell. */
export function appVersion(): Promise<ShellResult<string>> {
  return invoke<string>('app_version');
}

/** Probes for a usable GPU. */
export function checkGpu(): Promise<ShellResult<GpuReport>> {
  return invoke<GpuReport>('check_gpu');
}

/** Minimizes the window. */
export function windowMinimize(): Promise<ShellResult<null>> {
  return invoke<null>('window_minimize');
}

/** Maximizes the window, or restores it. Resolves to the new maximized state. */
export function windowToggleMaximize(): Promise<ShellResult<boolean>> {
  return invoke<boolean>('window_toggle_maximize');
}

/** Reports whether the window is maximized. */
export function windowIsMaximized(): Promise<ShellResult<boolean>> {
  return invoke<boolean>('window_is_maximized');
}

/** Closes the window, which quits the application. */
export function windowClose(): Promise<ShellResult<null>> {
  return invoke<null>('window_close');
}
