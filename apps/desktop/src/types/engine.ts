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

/**
 * One registry entry, as reported by `GET /v1/models`.
 *
 * A model that is neither `cached` nor `downloading` but reports `resumable`
 * is paused: bytes are on disk and downloading again continues from them. The
 * engine derives that from the cache directory rather than remembering it, so
 * it survives the application being closed and reopened.
 */
export interface ModelInfo {
  modelId: string;
  name: string;
  kind: 'base' | 'lora' | 'segmentation';
  licenseId: string;
  licenseUrl: string;
  commercialUse: boolean;
  sizeMb: number;
  cached: boolean;
  /** True while the engine is fetching these weights. */
  downloading: boolean;
  /**
   * How much of the download is done, from 0 to 1. Reported for a paused
   * download as well as a running one, so the row can draw its bar either way.
   */
  progress: number;
  /** Bytes of this download already on disk, running or paused. */
  downloadedBytes: number;
  /**
   * Full size of the download in bytes, or 0 when the host has not announced
   * one. `sizeMb` is only an estimate and is not substituted for it.
   */
  totalBytes: number;
  /** Whether a paused download can be continued rather than started again. */
  resumable: boolean;
  /** Stable reason code for the last failed download, empty otherwise. */
  error: string;
}

/**
 * One data root, as reported by `GET /v1/storage`.
 *
 * Weights are several gigabytes each, so the volume this sits on matters more
 * than any other path in the application.
 */
export interface StorageInfo {
  /** The directory that holds everything the application downloads. */
  root: string;
  /** Where weights live inside that root. */
  modelsDir: string;
  /** The per-user default, so the interface can offer to go back to it. */
  defaultRoot: string;
  /** Whether `root` is that default. */
  isDefault: boolean;
  /** Free space on the volume behind `root`, or null when it cannot be read. */
  freeBytes: number | null;
  /** Size of that volume, or null for the same reason. */
  totalBytes: number | null;
  /** Bytes already taken by models under this root. */
  usedBytes: number;
  /** Identifiers of the models found under this root. */
  existingModels: string[];
}

/** The outcome of moving the data root, from `POST /v1/storage`. */
export interface StorageChange {
  /** The root now in use. */
  current: StorageInfo;
  /** The root that was in use, and whatever is still sitting in it. */
  previous: StorageInfo;
  /**
   * Always false. The application never moves gigabytes on its own, so what
   * was already downloaded stays where it is and the user has to be told.
   */
  dataMoved: boolean;
}

/** Which hardware a PyTorch build drives. */
export type RuntimeAccelerator = 'cuda' | 'mps' | 'cpu';

/** What the caller asks to install. `auto` lets the engine choose. */
export type RuntimeRequest = RuntimeAccelerator | 'auto';

/** One package an install would fetch, from `GET /v1/runtime`. */
export interface RuntimePackage {
  /** Distribution name. */
  name: string;
  /** Exact pinned version. */
  version: string;
  /** SPDX expression the distribution declares. */
  licenseId: string;
  /** Download size of its wheel, in bytes. */
  sizeBytes: number;
}

/** What installing one runtime build would do. */
export interface RuntimePlan {
  /** The hardware this build drives. */
  accelerator: RuntimeAccelerator;
  /** Version of torch it installs. */
  torchVersion: string;
  /** CUDA version the build targets, or an empty string. */
  cudaVersion: string;
  /**
   * True when the wheels carry NVIDIA's redistributable CUDA libraries, which
   * come under NVIDIA's own licence rather than PyTorch's. The user has to be
   * shown that before the download starts.
   */
  bundlesNvidia: boolean;
  /** Bytes fetched over the network. */
  downloadBytes: number;
  /** Bytes the result occupies on disk. */
  installedBytes: number;
  /** Free space needed at the peak of the install. */
  requiredBytes: number;
  /** Every package, torch first, with its licence. */
  packages: RuntimePackage[];
  /** Where PyTorch's licence is published. */
  torchLicenseUrl: string;
  /** Where NVIDIA's licence is published. Empty when none is involved. */
  cudaLicenseUrl: string;
}

/** The GPU runtime, as reported by `GET /v1/runtime`. */
export interface RuntimeInfo {
  /** Whether this platform and interpreter have a pinned wheel set at all. */
  supported: boolean;
  /** Stable reason code when `supported` is false. */
  unsupportedReason: string;
  /** Manifest key for this machine, such as `win_amd64-cp314`. */
  target: string;
  /** Where the runtime lives, or would live. */
  installDir: string;

  /** Whether a complete runtime is present on disk. */
  installed: boolean;
  /** Which build is installed, or an empty string. */
  installedAccelerator: string;
  /** Version of torch on disk, which is not necessarily the one running. */
  installedTorchVersion: string;

  /** Whether the engine process can import torch right now. */
  torchImportable: boolean;
  /** Version torch reports, once imported. */
  torchVersion: string;
  /** Whether torch reports a usable CUDA device. The only real answer. */
  cudaAvailable: boolean;
  /** Whether torch reports a usable Metal device. */
  mpsAvailable: boolean;
  /** Name of the device torch found, or an empty string. */
  device: string;
  /** Stable reason code when torch is present but unusable. */
  probeDetail: string;
  /** Packages the installed tree lacks against the manifest this build ships. */
  missingPackages: string[];
  /** How many packages the installed variant pins. */
  totalPackages: number;
  /** What adding them would download. */
  missingBytes: number;
  /** True when a runtime is installed and the engine has not picked it up yet. */
  restartRequired: boolean;

  /** Free space on the volume the runtime lands on, or null when unreadable. */
  freeBytes: number | null;
  /** Size of that volume, or null for the same reason. */
  totalBytes: number | null;
  /** Bytes the installed runtime occupies right now. */
  usedBytes: number;

  /** Which build suits the GPU the shell probed for, or an empty string. */
  recommendedAccelerator: string;
  /** What each installable build would download. */
  plans: RuntimePlan[];

  /** True while an install is running. */
  installing: boolean;
  /** `download`, `extract`, `publish`, or an empty string. */
  phase: string;
  /** How much of the install is done, from 0 to 1. Zero when idle. */
  progress: number;
  /** Which build is being installed. */
  installingAccelerator: string;
  /** Stable reason code for the last failed install, empty otherwise. */
  error: string;
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
/** The art styles the engine offers, in the order they are listed. */
export const ART_STYLES = ['pixel', 'hd2d', 'modern2d', 'classic', 'isometric'] as const;

/** One of {@link ART_STYLES}. */
export type ArtStyle = (typeof ART_STYLES)[number];

/** Where the camera sits relative to the character. */
export const CAMERA_ANGLES = ['side', 'top_down', 'isometric', 'front'] as const;

/** One of {@link CAMERA_ANGLES}. */
export type CameraAngle = (typeof CAMERA_ANGLES)[number];

/**
 * The direction counts each camera offers.
 *
 * Mirrors the engine, which is the authority: a side view has no north, so two
 * is as far as it goes, and a portrait facing the viewer has exactly one - more
 * would be a different pose rather than a different direction.
 */
export const DIRECTION_COUNTS: Record<CameraAngle, readonly number[]> = {
  side: [1, 2],
  top_down: [1, 2, 4, 8],
  isometric: [1, 4, 8],
  front: [1],
};

/** What to correct about a sprite that already exists. */
export interface ConformOptions {
  /** Whether to make the background transparent. */
  removeBackground: boolean;
  /** How close a pixel must be to the corner colour to count as background. */
  backgroundTolerance: number;
  /** Cell size to resample onto, or 1 to leave the grid alone. */
  snapTo: number;
  /** Colours to reduce to, or null to leave them alone. */
  paletteSize: number | null;
  /** Whether to dither while reducing. */
  dither: boolean;
}

/** A corrected sprite. */
export interface ConformResponse {
  /** The result, base64 encoded PNG. */
  image: string;
  /** Result width in pixels. */
  width: number;
  /** Result height in pixels. */
  height: number;
  /** Every colour the result uses, most used first. */
  palette: string[];
}

export interface GenerateRequest {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  guidanceScale: number;
  seed: number | null;
  batchSize: number;
  /** Art style, which adds terms to both prompts in the engine. */
  style: ArtStyle;
  /** Where the camera sits relative to the character. */
  camera: CameraAngle;
  /** How many directions the character is drawn facing. */
  directions: number;
  modelId: string;
  loraId: string | null;
  postprocess: PostProcessOptions;
}

/** One generated sprite. */
/** One sprite already written to disk. */
export interface SavedSprite {
  /** File name, which is also its identifier. */
  name: string;
  /** Full path, for showing where it lives. */
  path: string;
  width: number;
  height: number;
  /** PNG bytes, base64 encoded, with no data URL prefix. */
  data: string;
  /** When it was written, as a Unix timestamp. */
  modifiedAt: number;
}

/** Every sprite on disk, newest first. */
export interface SpriteListResponse {
  sprites: SavedSprite[];
}

export interface SpriteImage {
  /** Where the sprite was written, or an empty string when it could not be. */
  path: string;
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

/** Whether a provider came from the built-in catalogue or from the user. */
export type ProviderKind = 'preset' | 'custom';

/** How a provider expects the credential to be presented. */
export type AuthScheme = 'bearer' | 'header' | 'none';

/**
 * Where API keys are being kept on this machine.
 *
 * `keychain` is the operating system credential store. `file` is the fallback
 * for a machine that offers none, and is weaker: it is a permission-restricted
 * plain file. The interface shows which one is in force, because a guarantee
 * the user cannot see is one they cannot act on.
 */
export type SecretStorage = 'keychain' | 'file';

/**
 * One configured provider, as reported by `GET /v1/providers`.
 *
 * There is deliberately no field carrying the API key. The engine accepts a
 * key and never returns one; {@link hasKey} and {@link keyHint} are what comes
 * back instead.
 */
export interface ProviderInfo {
  /** Stable identifier. */
  providerId: string;
  /** Display name, chosen by the user. */
  name: string;
  /** Whether this came from the catalogue or from the user. */
  kind: ProviderKind;
  /** Catalogue entry this came from, empty for a custom provider. */
  presetId: string;
  /** Where requests are sent, with no trailing slash. */
  baseUrl: string;
  /** Model identifier sent with generation requests. */
  model: string;
  /** How the credential is presented. */
  authScheme: AuthScheme;
  /** Header the credential is sent in, when `authScheme` is `header`. */
  authHeader: string;
  /** Further headers this provider requires. */
  extraHeaders: Record<string, string>;
  /** Request timeout in seconds. */
  timeoutS: number;
  /** Whether a credential is stored for this provider. */
  hasKey: boolean;
  /** Masked hint, such as `****a1b2`. Empty when no credential is stored. */
  keyHint: string;
  /** Whether this provider serves generation. */
  active: boolean;
}

/** One catalogue entry, offered when adding a provider. */
export interface ProviderPreset {
  presetId: string;
  name: string;
  baseUrl: string;
  /** Model proposed when the provider is added. Empty when the user must choose. */
  defaultModel: string;
  authScheme: AuthScheme;
  authHeader: string;
  /** Where the user gets a key. */
  documentationUrl: string;
}

/** The response from `GET /v1/providers`. */
export interface ProviderListResponse {
  providers: ProviderInfo[];
  presets: ProviderPreset[];
  /** Identifier of the provider serving generation, empty when none is. */
  activeId: string;
  /** How credentials are being held on this machine. */
  secretStorage: SecretStorage;
  /** How many providers may be stored in total. */
  maxProviders: number;
}

/**
 * A provider to create or replace.
 *
 * `apiKey` travels in this direction only. Omitting it leaves the stored
 * credential untouched, which is what an edit that never opened the key field
 * sends; an empty string removes it.
 */
export interface ProviderSaveRequest {
  providerId: string;
  name: string;
  kind: ProviderKind;
  presetId: string;
  baseUrl: string;
  model: string;
  authScheme: AuthScheme;
  authHeader: string;
  extraHeaders: Record<string, string>;
  timeoutS: number;
  apiKey?: string;
  activate: boolean;
}

/** The outcome of one connection test. */
export interface ConnectionTestResult {
  /** Whether the endpoint answered and accepted the credential. */
  ok: boolean;
  /** Stable reason code, translated by the `errors` namespace, including on success. */
  code: string;
  /** Short English description, for logs and bug reports. */
  detail: string;
  /** Round trip time in milliseconds. */
  latencyMs: number;
  /** How many models the endpoint listed. */
  modelCount: number;
  /** The identifiers that draw, which is what this application asks for. */
  models: string[];
  /** Everything the provider listed, drawing or not. */
  allModels: string[];
}

/** Reserved preset identifier meaning "the user supplies the base URL". */
export const CUSTOM_PRESET_ID = 'custom';

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
