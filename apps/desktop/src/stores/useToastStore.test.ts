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
 * Notifications: the queue behind the visible three, dismissal in two steps,
 * pause and resume timing, and the history the bell reads.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadList, saveList } from '@/lib/persist';
import { EXIT_MS, MAX_VISIBLE, useToastStore } from '@/stores/useToastStore';

vi.mock('@/lib/persist', () => ({
  loadList: vi.fn(() => []),
  saveList: vi.fn(),
  STORAGE_KEYS: { notifications: 'bitwright.notifications', view: 'bitwright.view' },
}));

beforeEach(() => {
  vi.mocked(loadList).mockClear();
  vi.mocked(saveList).mockClear();
  useToastStore.setState({
    visible: [],
    queued: [],
    history: [],
    unread: 0,
    bellAnchor: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('notify', () => {
  it('returns the id of the raised notification', () => {
    const id = useToastStore.getState().notify({ severity: 'info', messageKey: 'a' });
    expect(useToastStore.getState().visible[0]?.id).toBe(id);
  });

  it('fills visible up to MAX_VISIBLE', () => {
    for (let i = 0; i < MAX_VISIBLE; i += 1) {
      useToastStore.getState().notify({ severity: 'info', messageKey: `m${String(i)}` });
    }
    expect(useToastStore.getState().visible).toHaveLength(MAX_VISIBLE);
    expect(useToastStore.getState().queued).toHaveLength(0);
  });

  it('queues notifications beyond MAX_VISIBLE', () => {
    for (let i = 0; i < MAX_VISIBLE + 2; i += 1) {
      useToastStore.getState().notify({ severity: 'info', messageKey: `m${String(i)}` });
    }
    expect(useToastStore.getState().visible).toHaveLength(MAX_VISIBLE);
    expect(useToastStore.getState().queued).toHaveLength(2);
  });
});

describe('dismiss', () => {
  it('marks a visible toast leaving, then removes it after EXIT_MS', () => {
    vi.useFakeTimers();
    const id = useToastStore.getState().notify({ severity: 'info', messageKey: 'a' });

    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().visible.find((item) => item.id === id)?.leaving).toBe(true);

    vi.advanceTimersByTime(EXIT_MS);
    expect(useToastStore.getState().visible.find((item) => item.id === id)).toBeUndefined();
    expect(useToastStore.getState().history.some((item) => item.id === id)).toBe(true);
  });

  it('promotes a queued toast into the freed slot', () => {
    vi.useFakeTimers();
    const ids: string[] = [];
    for (let i = 0; i < MAX_VISIBLE + 1; i += 1) {
      ids.push(useToastStore.getState().notify({ severity: 'info', messageKey: `m${String(i)}` }));
    }
    expect(useToastStore.getState().queued).toHaveLength(1);

    useToastStore.getState().dismiss(ids[0] as string);
    vi.advanceTimersByTime(EXIT_MS);

    expect(useToastStore.getState().visible).toHaveLength(MAX_VISIBLE);
    expect(useToastStore.getState().queued).toHaveLength(0);
    expect(useToastStore.getState().visible.some((item) => item.id === ids[MAX_VISIBLE])).toBe(
      true,
    );
  });
});

describe('dismissAll', () => {
  it('empties the queue and dismisses everything on screen', () => {
    vi.useFakeTimers();
    for (let i = 0; i < MAX_VISIBLE + 2; i += 1) {
      useToastStore.getState().notify({ severity: 'info', messageKey: `m${String(i)}` });
    }

    useToastStore.getState().dismissAll();
    expect(useToastStore.getState().queued).toHaveLength(0);
    expect(useToastStore.getState().visible.every((item) => item.leaving)).toBe(true);

    vi.advanceTimersByTime(EXIT_MS);
    expect(useToastStore.getState().visible).toHaveLength(0);
  });
});

describe('pause and resume', () => {
  it('holds the remaining time on pause and re-arms it on resume', () => {
    vi.useFakeTimers();
    const id = useToastStore.getState().notify({ severity: 'success', messageKey: 'a' });

    vi.advanceTimersByTime(1000);
    useToastStore.getState().pause(id);

    // While paused, the toast does not dismiss itself even past its timeout.
    vi.advanceTimersByTime(10_000);
    expect(useToastStore.getState().visible.some((item) => item.id === id)).toBe(true);

    useToastStore.getState().resume(id);
    // Roughly the remaining time (success = 4000ms, ~1000ms elapsed already).
    vi.advanceTimersByTime(3000);
    expect(useToastStore.getState().visible.find((item) => item.id === id)?.leaving).toBe(true);
  });
});

describe('markRead', () => {
  it('clears the unread count', () => {
    useToastStore.getState().notify({ severity: 'info', messageKey: 'a' });
    expect(useToastStore.getState().unread).toBe(1);

    useToastStore.getState().markRead();
    expect(useToastStore.getState().unread).toBe(0);
  });
});

describe('clearHistory', () => {
  it('empties the history and persists the empty list', () => {
    useToastStore.setState({
      history: [
        {
          id: 'toast-1',
          severity: 'info',
          titleKey: null,
          messageKey: 'a',
          values: null,
          createdAt: 1,
          leaving: false,
        },
      ],
    });

    useToastStore.getState().clearHistory();

    expect(useToastStore.getState().history).toEqual([]);
    expect(saveList).toHaveBeenCalledWith('bitwright.notifications', [], 50);
  });
});

describe('setBellAnchor', () => {
  it('records where the bell is', () => {
    useToastStore.getState().setBellAnchor({ x: 10, y: 20 });
    expect(useToastStore.getState().bellAnchor).toEqual({ x: 10, y: 20 });
  });

  it('clears the anchor when the bell is gone', () => {
    useToastStore.setState({ bellAnchor: { x: 10, y: 20 } });
    useToastStore.getState().setBellAnchor(null);
    expect(useToastStore.getState().bellAnchor).toBeNull();
  });
});

describe('dispose', () => {
  it('archives visible and queued notifications to the history and empties the screen', () => {
    vi.useFakeTimers();
    for (let i = 0; i < MAX_VISIBLE + 1; i += 1) {
      useToastStore.getState().notify({ severity: 'info', messageKey: `m${String(i)}` });
    }

    useToastStore.getState().dispose();

    const state = useToastStore.getState();
    expect(state.visible).toEqual([]);
    expect(state.queued).toEqual([]);
    expect(state.history).toHaveLength(MAX_VISIBLE + 1);
  });
});
