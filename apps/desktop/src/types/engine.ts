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
 * The shapes the sidecar HTTP API exchanges.
 *
 * These mirror the Pydantic models in `bitwright_engine/api/schemas`. Changing
 * one without the other breaks generation at run time, so the two are reviewed
 * together.
 */

/** Which backend serves generation. */
export type BackendKind = 'cuda' | 'mps' | 'remote';

/** An optional feature a backend may support. */
export type Capability = 'lora_hotswap' | 'controlnet' | 'ip_adapter' | 'batch';

/** Every capability, in the order the settings screen lists them. */
export const CAPABILITIES: readonly Capability[] = [
  'batch',
  'lora_hotswap',
  'controlnet',
  'ip_adapter',
];

/** One backend, as reported by `GET /v1/backends`. */
export interface BackendInfo {
  /** Backend identifier. */
  kind: BackendKind;
  /** Whether the backend can generate right now. */
  available: boolean;
  /** Stable reason code when unavailable, empty otherwise. */
  detail: string;
  /** Device or endpoint description when available. */
  device: string;
  /** Optional features this backend supports. */
  capabilities: Capability[];
  /** Whether this backend is currently serving requests. */
  selected: boolean;
}

/** The response from `GET /v1/backends`. */
export interface BackendListResponse {
  backends: BackendInfo[];
}

/** One registry entry, as reported by `GET /v1/models`. */
export interface ModelInfo {
  modelId: string;
  name: string;
  kind: 'base' | 'lora' | 'segmentation';
  licenseId: string;
  licenseUrl: string;
  commercialUse: boolean;
  sizeMb: number;
  cached: boolean;
}

/** Post-processing options sent with a generation request. */
export interface PostProcessOptions {
  removeBackground: boolean;
  backgroundTolerance: number;
  paletteSize: number | null;
  dither: boolean;
  pixelGrid: number | null;
}

/** A generation request. */
export interface GenerateRequest {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  guidanceScale: number;
  seed: number | null;
  batchSize: number;
  modelId: string;
  loraId: string | null;
  postprocess: PostProcessOptions;
}

/** One generated sprite. */
export interface SpriteImage {
  /** PNG bytes, base64 encoded, with no data URL prefix. */
  data: string;
  width: number;
  height: number;
}

/** The response from `POST /v1/generate`. */
export interface GenerateResponse {
  images: SpriteImage[];
  backend: BackendKind;
  durationMs: number;
  warnings: string[];
}

/** The response from `GET /health`. */
export interface HealthResponse {
  status: string;
  version: string;
  backend: BackendKind;
  backendReady: boolean;
}

/**
 * Determines which capabilities a request depends on.
 *
 * The generate screen calls this with the parameters currently entered, and
 * compares the result against the selected backend, so unsupported controls are
 * disabled rather than failing after the user presses generate. It mirrors
 * `required_capabilities` in `backends/base.py`.
 *
 * @param request - The parameters currently entered.
 * @returns The capabilities the request cannot run without.
 */
export function requiredCapabilities(
  request: Pick<GenerateRequest, 'batchSize' | 'loraId'>,
): Capability[] {
  const required: Capability[] = [];
  if (request.batchSize > 1) {
    required.push('batch');
  }
  if (request.loraId !== null) {
    required.push('lora_hotswap');
  }
  return required;
}
