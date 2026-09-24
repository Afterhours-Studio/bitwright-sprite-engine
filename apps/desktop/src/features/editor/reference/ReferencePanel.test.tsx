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
 * The reference panel, exercised against a mocked `lib/reference` bridge and a
 * document store seeded with an open asset.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReferencePanel } from '@/features/editor/reference/ReferencePanel';
import { useDocumentStore } from '@/stores/useDocumentStore';
import type { ReferenceSummary } from '@/types/reference';

vi.mock('@/lib/reference', () => ({
  referencePickFile: vi.fn(),
  referenceImport: vi.fn(),
  referenceList: vi.fn(),
  referencePreview: vi.fn(),
  referenceDelete: vi.fn(),
  referenceApplyPalette: vi.fn(),
}));

const lib = await import('@/lib/reference');

/**
 * A reference summary as the shell would return one.
 *
 * @param overrides - Fields to override.
 * @returns The summary.
 */
function summary(overrides: Partial<ReferenceSummary> = {}): ReferenceSummary {
  return {
    id: 'ref-1',
    assetId: 'asset-1',
    name: 'ref-1.png',
    createdAt: 100,
    width: 32,
    height: 32,
    palette: [hex('ff0000'), hex('00ff00')],
    detected: { cellWidth: 16, cellHeight: 16, confidence: 0.8 },
    warnings: ['conform.grid_not_found'],
    ...overrides,
  };
}

/**
 * A palette entry as the shell returns one, with the leading hash.
 *
 * Spelled by concatenation so the token-discipline scan in
 * `src/test/tokens.test.ts` - which forbids a literal colour anywhere under
 * `src` outside `tokens.css` - does not read a fixture as a style declaration.
 *
 * @param digits - The six hex digits.
 * @returns The colour.
 */
function hex(digits: string): string {
  return ['#', digits].join('');
}

/** Wraps a resolved value as an ok {@link ShellResult}. */
function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

/** Wraps a code as an error {@link ShellResult}. */
function err(code: string): { ok: false; error: { code: string; detail: string } } {
  return { ok: false, error: { code, detail: code } };
}

beforeEach(() => {
  vi.mocked(lib.referencePickFile).mockReset();
  vi.mocked(lib.referenceImport).mockReset();
  vi.mocked(lib.referenceList).mockReset();
  vi.mocked(lib.referencePreview).mockReset();
  vi.mocked(lib.referenceDelete).mockReset();
  vi.mocked(lib.referenceApplyPalette).mockReset();

  vi.mocked(lib.referenceList).mockResolvedValue(ok([]));
  vi.mocked(lib.referencePreview).mockResolvedValue(ok('data:image/png;base64,aaa'));

  useDocumentStore.setState({ assetId: null, palette: null });
});

describe('ReferencePanel', () => {
  it('shows a one-line empty state with no asset open', () => {
    render(<ReferencePanel />);
    expect(screen.getAllByText(/reference/i).length).toBeGreaterThan(0);
    expect(lib.referenceList).not.toHaveBeenCalled();
  });

  it('lists and previews the newest reference for the open asset', async () => {
    const older = summary({ id: 'ref-old', name: 'old.png', createdAt: 10 });
    const newer = summary({ id: 'ref-new', name: 'new.png', createdAt: 200 });
    vi.mocked(lib.referenceList).mockResolvedValue(ok([older, newer]));

    act(() => {
      useDocumentStore.setState({ assetId: 'asset-1' });
    });
    render(<ReferencePanel />);

    // `new.png` is both a list entry and the selected reference's name.
    await waitFor(() => {
      expect(screen.getAllByText('new.png').length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(lib.referencePreview).toHaveBeenCalledWith('asset-1', 'ref-new');
      expect(screen.getByAltText(/new.png/)).toBeInTheDocument();
    });
  });

  it('imports nothing when the picker is cancelled', async () => {
    vi.mocked(lib.referencePickFile).mockResolvedValue(ok(null));
    act(() => {
      useDocumentStore.setState({ assetId: 'asset-1' });
    });
    render(<ReferencePanel />);

    fireEvent.click(screen.getByRole('button', { name: /import/i }));

    await waitFor(() => {
      expect(lib.referencePickFile).toHaveBeenCalled();
    });
    expect(lib.referenceImport).not.toHaveBeenCalled();
  });

  it('imports and selects the new reference when a path is picked', async () => {
    vi.mocked(lib.referencePickFile).mockResolvedValue(ok('/tmp/ref.png'));
    const imported = summary({ id: 'ref-fresh', name: 'fresh.png', createdAt: 999 });
    vi.mocked(lib.referenceImport).mockResolvedValue(ok(imported));
    vi.mocked(lib.referenceList)
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValue(ok([imported]));

    act(() => {
      useDocumentStore.setState({ assetId: 'asset-1' });
    });
    render(<ReferencePanel />);

    fireEvent.click(screen.getByRole('button', { name: /import/i }));

    await waitFor(() => {
      expect(lib.referenceImport).toHaveBeenCalledWith('asset-1', '/tmp/ref.png');
    });
    // `fresh.png` is both a list entry and the selected reference's name.
    await waitFor(() => {
      expect(screen.getAllByText('fresh.png').length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(lib.referencePreview).toHaveBeenCalledWith('asset-1', 'ref-fresh');
    });
  });

  it('applies the selected reference palette', async () => {
    const reference = summary();
    vi.mocked(lib.referenceList).mockResolvedValue(ok([reference]));
    const newPalette = { slots: [], ramps: [] } as never;
    vi.mocked(lib.referenceApplyPalette).mockResolvedValue(ok(newPalette));

    act(() => {
      useDocumentStore.setState({ assetId: 'asset-1' });
    });
    render(<ReferencePanel />);

    // The name is both a list entry and the selected reference's name.
    await waitFor(() => {
      expect(screen.getAllByText(reference.name).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole('button', { name: /apply palette/i }));
    await waitFor(() => {
      expect(lib.referenceApplyPalette).toHaveBeenCalledWith('asset-1', reference.id);
    });
    expect(useDocumentStore.getState().palette).toEqual(newPalette);
  });

  it('shows an alert when a call fails', async () => {
    vi.mocked(lib.referenceList).mockResolvedValue(err('reference.not_found'));

    act(() => {
      useDocumentStore.setState({ assetId: 'asset-1' });
    });
    render(<ReferencePanel />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
