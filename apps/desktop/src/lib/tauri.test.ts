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
 * The Tauri bridge carries command names and argument keys to the shell.
 *
 * Every exported function either calls `invoke` or `on` with a command name
 * that must match the Rust side verbatim, or it checks `inShell()` to decide
 * whether to degrade gracefully. These tests assert the command names, argument
 * keys, and error translation so that a rename made on one side of the boundary
 * surfaces as a test failure, not as `invalid args` at run time.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SHELL_EVENTS,
  appVersion,
  engineConform,
  inShell,
  invoke,
  on,
  openDirectory,
  openExternal,
  platformInfo,
  sidecarStatus,
  storageInfo,
  storagePickDirectory,
  storageResetRoot,
  storageSetRoot,
  storageValidate,
  toShellError,
  windowClose,
  windowIsMaximized,
  windowMinimize,
  windowToggleMaximize,
  vibrancyState,
} from '@/lib/tauri';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

const coreApi = await import('@tauri-apps/api/core');
const eventApi = await import('@tauri-apps/api/event');

/**
 * Makes the next Tauri core invoke call resolve to a value.
 *
 * @param value - What the command returns.
 */
function answersWithValue(value: unknown): void {
  vi.mocked(coreApi.invoke).mockResolvedValueOnce(value);
}

/**
 * Makes the next Tauri core invoke call reject with an error.
 *
 * @param error - What the command rejects with.
 */
function answersWithError(error: unknown): void {
  vi.mocked(coreApi.invoke).mockRejectedValueOnce(error);
}

beforeEach(() => {
  vi.mocked(coreApi.invoke).mockReset();
  vi.mocked(eventApi.listen).mockReset();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe('inShell', () => {
  it('returns true when running inside a Tauri window', () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    expect(inShell()).toBe(true);
  });

  it('returns false outside a Tauri window', () => {
    expect(inShell()).toBe(false);
  });
});

describe('toShellError', () => {
  it('normalizes an error object with code and detail', () => {
    const error = { code: 'io_error', detail: 'file not found' };
    expect(toShellError(error)).toEqual({
      code: 'io_error',
      detail: 'file not found',
    });
  });

  it('fills detail with empty string when missing', () => {
    const error = { code: 'some_error' };
    expect(toShellError(error)).toEqual({
      code: 'some_error',
      detail: '',
    });
  });

  it('uses unknown code when code is not a string', () => {
    const error = { code: 123, detail: 'numeric code' };
    expect(toShellError(error)).toEqual({
      code: 'unknown',
      detail: 'numeric code',
    });
  });

  it('uses unknown code when detail is not a string', () => {
    const error = { code: 'some_error', detail: 123 };
    expect(toShellError(error)).toEqual({
      code: 'some_error',
      detail: '',
    });
  });

  it('normalizes a string error to unknown with the string as detail', () => {
    expect(toShellError('something went wrong')).toEqual({
      code: 'unknown',
      detail: 'something went wrong',
    });
  });

  it('normalizes a non-object non-string error', () => {
    expect(toShellError(42)).toEqual({
      code: 'unknown',
      detail: '42',
    });
  });

  it('normalizes null to unknown', () => {
    expect(toShellError(null)).toEqual({
      code: 'unknown',
      detail: 'null',
    });
  });
});

describe('invoke', () => {
  it('returns shell unavailable outside a Tauri window without calling core invoke', async () => {
    const result = await invoke<string>('test_command');

    expect(result).toEqual({
      ok: false,
      error: { code: 'shell.unavailable', detail: 'not running in Tauri' },
    });
    expect(coreApi.invoke).not.toHaveBeenCalled();
  });

  it('passes the command name to core invoke inside a shell', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithValue('result');

    await invoke<string>('test_command');

    expect(coreApi.invoke).toHaveBeenCalledWith('test_command', undefined);
  });

  it('passes command and arguments to core invoke inside a shell', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithValue('result');

    await invoke<string>('test_command', { key: 'value' });

    expect(coreApi.invoke).toHaveBeenCalledWith('test_command', { key: 'value' });
  });

  it('returns success with the resolved value', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithValue('success_value');

    const result = await invoke<string>('test_command');

    expect(result).toEqual({ ok: true, value: 'success_value' });
  });

  it('maps a rejected error object', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithError({ code: 'io_error', detail: 'failed to read' });

    const result = await invoke<string>('test_command');

    expect(result).toEqual({
      ok: false,
      error: { code: 'io_error', detail: 'failed to read' },
    });
  });

  it('maps a rejected string error', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithError('something broke');

    const result = await invoke<string>('test_command');

    expect(result).toEqual({
      ok: false,
      error: { code: 'unknown', detail: 'something broke' },
    });
  });
});

describe('on', () => {
  it('returns a no-op function outside a Tauri window', async () => {
    const handler = vi.fn();
    const unlisten = await on<string>('test_event', handler);

    expect(typeof unlisten).toBe('function');
    expect(vi.mocked(eventApi.listen)).not.toHaveBeenCalled();
  });

  it('subscribes to an event inside a shell', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    vi.mocked(eventApi.listen).mockResolvedValueOnce(() => {});
    const handler = vi.fn();

    await on<string>('test_event', handler);

    expect(vi.mocked(eventApi.listen)).toHaveBeenCalledWith('test_event', expect.any(Function));
  });

  it('forwards the payload from the event message', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    const handler = vi.fn();
    vi.mocked(eventApi.listen).mockImplementationOnce((_, handlerArg) => {
      const listenHandler = handlerArg as (msg: { payload: string }) => void;
      listenHandler({ payload: 'event_data' });
      return Promise.resolve(() => {});
    });

    await on<string>('test_event', handler);

    expect(handler).toHaveBeenCalledWith('event_data');
  });
});

describe('SHELL_EVENTS', () => {
  it('names each event verbatim, as the shell emits it', () => {
    expect(SHELL_EVENTS).toEqual({
      sidecarReady: 'sidecar://ready',
      sidecarFailed: 'sidecar://failed',
    });
  });
});

describe('sidecarStatus', () => {
  it('calls sidecar_status with no arguments', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithValue({ ready: true, port: 9000, version: '0.1.0', error: '', detail: '' });

    await sidecarStatus();

    expect(coreApi.invoke).toHaveBeenCalledWith('sidecar_status', undefined);
  });
});

describe('engineConform', () => {
  it('sends the request under the request key', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithValue({ error: null });

    await engineConform({ test: 'data' });

    expect(coreApi.invoke).toHaveBeenCalledWith('engine_conform', {
      request: { test: 'data' },
    });
  });
});

describe('storageInfo', () => {
  it('calls storage_info with no arguments', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithValue({ path: '/data', free: 1000 });

    await storageInfo();

    expect(coreApi.invoke).toHaveBeenCalledWith('storage_info', undefined);
  });
});

describe('storageValidate', () => {
  it('sends the path under the path key', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithValue({ path: '/data', free: 1000 });

    await storageValidate('/test/path');

    expect(coreApi.invoke).toHaveBeenCalledWith('storage_validate', {
      path: '/test/path',
    });
  });
});

describe('storageSetRoot', () => {
  it('sends the path under the path key', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithValue({ previous: '/old', current: '/new', orphaned: [] });

    await storageSetRoot('/new/path');

    expect(coreApi.invoke).toHaveBeenCalledWith('storage_set_root', {
      path: '/new/path',
    });
  });
});

describe('storageResetRoot', () => {
  it('calls storage_reset_root with no arguments', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithValue({ previous: '/old', current: '/default', orphaned: [] });

    await storageResetRoot();

    expect(coreApi.invoke).toHaveBeenCalledWith('storage_reset_root', undefined);
  });
});

describe('storagePickDirectory', () => {
  it('calls storage_pick_directory with no arguments', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithValue('/selected/path');

    await storagePickDirectory();

    expect(coreApi.invoke).toHaveBeenCalledWith('storage_pick_directory', undefined);
  });
});

describe('vibrancyState', () => {
  it('calls vibrancy_state with no arguments', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithValue({ applied: true, effect: 'blur', reason: '' });

    await vibrancyState();

    expect(coreApi.invoke).toHaveBeenCalledWith('vibrancy_state', undefined);
  });
});

describe('platformInfo', () => {
  it('calls platform_info with no arguments', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithValue({ os: 'windows', systemWindowControls: true });

    await platformInfo();

    expect(coreApi.invoke).toHaveBeenCalledWith('platform_info', undefined);
  });
});

describe('appVersion', () => {
  it('calls app_version with no arguments', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithValue('0.1.0');

    await appVersion();

    expect(coreApi.invoke).toHaveBeenCalledWith('app_version', undefined);
  });
});

describe('windowMinimize', () => {
  it('calls window_minimize with no arguments', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithValue(null);

    await windowMinimize();

    expect(coreApi.invoke).toHaveBeenCalledWith('window_minimize', undefined);
  });
});

describe('windowToggleMaximize', () => {
  it('calls window_toggle_maximize with no arguments', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithValue(true);

    await windowToggleMaximize();

    expect(coreApi.invoke).toHaveBeenCalledWith('window_toggle_maximize', undefined);
  });
});

describe('windowIsMaximized', () => {
  it('calls window_is_maximized with no arguments', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithValue(true);

    await windowIsMaximized();

    expect(coreApi.invoke).toHaveBeenCalledWith('window_is_maximized', undefined);
  });
});

describe('windowClose', () => {
  it('calls window_close with no arguments', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithValue(null);

    await windowClose();

    expect(coreApi.invoke).toHaveBeenCalledWith('window_close', undefined);
  });
});

describe('openDirectory', () => {
  it('sends the path under the path key', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithValue(null);

    await openDirectory('/path/to/open');

    expect(coreApi.invoke).toHaveBeenCalledWith('open_directory', {
      path: '/path/to/open',
    });
  });
});

describe('openExternal', () => {
  it('sends the url under the url key', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = true;
    answersWithValue(null);

    await openExternal('https://example.com');

    expect(coreApi.invoke).toHaveBeenCalledWith('open_external', {
      url: 'https://example.com',
    });
  });
});
