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
  GenerateRequest,
  GenerateResponse,
  ModelInfo,
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

/** Returns which window background effect was applied. */
export function vibrancyState(): Promise<ShellResult<VibrancyState>> {
  return invoke<VibrancyState>('vibrancy_state');
}

/** Returns the platform facts the title bar depends on. */
export function platformInfo(): Promise<ShellResult<PlatformInfo>> {
  return invoke<PlatformInfo>('platform_info');
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
