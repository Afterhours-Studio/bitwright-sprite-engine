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
 * Where the layers column sends the next stroke.
 *
 * The failure worth catching is a finished layer repainted by a stray click:
 * choosing a role the step does not own must ask first, and dismissing the
 * question must leave the target alone.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { LayerList } from '@/features/editor/tools/LayerList';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { LAYER_ROLES } from '@/types/document';
import type { Layer, LayerRole, StepState } from '@/types/document';

/**
 * A layer of the given role with some painted pixels.
 *
 * @param role - Its role.
 * @param ordinal - Its composite order.
 * @param data - Its four pixels.
 * @returns The layer.
 */
function layer(role: LayerRole, ordinal: number, data: number[]): Layer {
  return {
    id: role,
    role,
    ordinal,
    visible: true,
    locked: false,
    opacity: 1,
    buffer: { width: 2, height: 2, data },
  };
}

const STEP = { assetId: 'asset-1', step: 'shadow', canAdvance: false } as unknown as StepState;

beforeEach(() => {
  useDocumentStore.setState({
    step: STEP,
    layers: [
      layer('silhouette', 10, [1, 1, 1, 0]),
      layer('flats', 20, [2, 0, 0, 0]),
      layer('shadow-core', 30, [0, 0, 0, 0]),
      layer('shadow-deep', 31, [0, 0, 0, 0]),
    ],
  });
  useEditorStore.setState({ targetRole: null });
});

describe('LayerList', () => {
  it('lists every workflow role, top first, with the owning step and pixel count', () => {
    render(<LayerList />);

    const rows = within(screen.getByRole('list', { name: 'Layers, top first' })).getAllByRole(
      'listitem',
    );
    expect(rows).toHaveLength(LAYER_ROLES.length);
    expect(rows[0]).toHaveTextContent('Accents');
    expect(rows.at(-1)).toHaveTextContent('Silhouette');
    expect(rows.at(-1)).toHaveTextContent('Silhouette step');
    expect(rows.at(-1)).toHaveTextContent('3 px');
    expect(rows[0]).toHaveTextContent('Not created yet');
  });

  it('marks the step layer as the current target', () => {
    render(<LayerList />);

    expect(screen.getByRole('button', { name: /Core shadow/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('switches between the step own roles without asking', () => {
    render(<LayerList />);

    fireEvent.click(screen.getByRole('button', { name: /Deep shadow/ }));

    expect(useEditorStore.getState().targetRole).toBe('shadow-deep');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks before drawing on a layer another step owns', () => {
    render(<LayerList />);

    fireEvent.click(screen.getByRole('button', { name: /Flats Flats step/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(useEditorStore.getState().targetRole).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useEditorStore.getState().targetRole).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Flats Flats step/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Draw on it' }));
    expect(useEditorStore.getState().targetRole).toBe('flats');
  });

  it('offers the override and the way back from "Draw on…"', () => {
    useEditorStore.setState({ targetRole: 'flats' });
    render(<LayerList />);

    fireEvent.click(screen.getByRole('button', { name: 'Draw on…' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitemradio', { name: 'Flats' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Follow the step' }));
    expect(useEditorStore.getState().targetRole).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Draw on…' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Silhouette' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
