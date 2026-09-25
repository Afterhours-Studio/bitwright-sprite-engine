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
 * The tools column chooses editor state and nothing else; these tests check
 * that each control reaches the store and that the fill switch only appears
 * where it means something.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { ToolColumn } from '@/features/editor/tools/ToolColumn';
import { TOOLS, useEditorStore } from '@/stores/useEditorStore';

beforeEach(() => {
  useEditorStore.setState({ tool: 'pencil', shapeFill: false, symmetry: 'off' });
});

describe('ToolColumn', () => {
  it('lists every tool in order with its key and marks the active one', () => {
    render(<ToolColumn />);
    const group = screen.getByRole('group', { name: 'Drawing tools' });
    const rows = within(group).getAllByRole('button');
    expect(rows).toHaveLength(TOOLS.length);
    expect(rows[0]).toHaveAccessibleName('Pencil');
    expect(rows[0]).toHaveAttribute('aria-pressed', 'true');
    expect(rows[0]).toHaveTextContent('B');
    expect(rows[0]).toHaveTextContent('Draw freehand pixels');
    expect(rows[1]).toHaveAttribute('aria-pressed', 'false');
    expect(rows[5]).toHaveAttribute('title', expect.stringContaining('Shift: everywhere'));
  });

  it('chooses a tool when its row is clicked', () => {
    render(<ToolColumn />);
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }));
    expect(useEditorStore.getState().tool).toBe('eraser');
    expect(screen.getByRole('button', { name: 'Eraser' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Pencil' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the fill toggle only for rectangle and ellipse', () => {
    render(<ToolColumn />);
    expect(screen.queryByRole('button', { name: /^Fill/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Line' }));
    expect(screen.queryByRole('button', { name: /^Fill/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Rectangle' }));
    const toggle = screen.getByRole('button', { name: /^Fill/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(useEditorStore.getState().shapeFill).toBe(true);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
    expect(screen.getByRole('button', { name: /^Fill/ })).toBeInTheDocument();
  });

  it('sets mirror symmetry and shows its state', () => {
    render(<ToolColumn />);
    const group = screen.getByRole('group', { name: 'Mirror symmetry' });
    const button = (name: string): HTMLElement => within(group).getByRole('button', { name });

    expect(button('Off')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button('Both'));
    expect(useEditorStore.getState().symmetry).toBe('both');
    expect(button('Both')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Off')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(button('Horizontal'));
    expect(useEditorStore.getState().symmetry).toBe('horizontal');
  });
});
