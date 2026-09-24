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
 * The reference bridge says the names the shell expects.
 *
 * There is no implementation here to exercise: every function is one call
 * that names a command and its argument keys. That indirection is the whole
 * risk, because a command name, or an argument key, that does not match the
 * Rust side is not a compile error on either side. It answers `invalid args`
 * at run time, or a panel quietly shows nothing. So these tests assert the
 * literal strings on the wire rather than behaviour.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  referenceApplyPalette,
  referenceDelete,
  referenceImport,
  referenceList,
  referencePickFile,
  referencePreview,
} from '@/lib/reference';

vi.mock('@/lib/tauri', () => ({ invoke: vi.fn() }));

const tauri = await import('@/lib/tauri');

/**
 * Makes the next command answer with a value.
 *
 * @param value - What the command returns.
 */
function answersWith(value: unknown): void {
  vi.mocked(tauri.invoke).mockResolvedValue({ ok: true, value } as never);
}

beforeEach(() => {
  vi.mocked(tauri.invoke).mockReset();
});

describe('referencePickFile', () => {
  it('calls reference_pick_file with no arguments', async () => {
    answersWith('/tmp/pic.png');

    await referencePickFile();
    expect(tauri.invoke).toHaveBeenCalledWith('reference_pick_file');
  });
});

describe('referenceImport', () => {
  it('sends assetId, path and name under the keys the command declares', async () => {
    answersWith({});

    await referenceImport('asset-1', '/tmp/pic.png', 'concept');
    expect(tauri.invoke).toHaveBeenCalledWith('reference_import', {
      assetId: 'asset-1',
      path: '/tmp/pic.png',
      name: 'concept',
    });
  });
});

describe('referenceList', () => {
  it('sends assetId', async () => {
    answersWith([]);

    await referenceList('asset-1');
    expect(tauri.invoke).toHaveBeenCalledWith('reference_list', { assetId: 'asset-1' });
  });
});

describe('referencePreview', () => {
  it('sends assetId and referenceId', async () => {
    answersWith('data:image/png;base64,abc');

    await referencePreview('asset-1', 'ref-1');
    expect(tauri.invoke).toHaveBeenCalledWith('reference_preview', {
      assetId: 'asset-1',
      referenceId: 'ref-1',
    });
  });
});

describe('referenceDelete', () => {
  it('sends assetId and referenceId', async () => {
    answersWith(undefined);

    await referenceDelete('asset-1', 'ref-1');
    expect(tauri.invoke).toHaveBeenCalledWith('reference_delete', {
      assetId: 'asset-1',
      referenceId: 'ref-1',
    });
  });
});

describe('referenceApplyPalette', () => {
  it('sends assetId, referenceId and maxSlots', async () => {
    answersWith({ slots: [] });

    await referenceApplyPalette('asset-1', 'ref-1', 16);
    expect(tauri.invoke).toHaveBeenCalledWith('reference_apply_palette', {
      assetId: 'asset-1',
      referenceId: 'ref-1',
      maxSlots: 16,
    });
  });
});
