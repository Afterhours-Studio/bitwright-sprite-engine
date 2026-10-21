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

/** The new project dialog: it sends the era, view and proportions that were chosen. */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewProjectDialog } from '@/features/home/NameDialogs';
import i18n from '@/lib/i18n';
import { useProjectStore } from '@/stores/useProjectStore';

let createProject: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await i18n.changeLanguage('en');
  createProject = vi.fn().mockResolvedValue(undefined);
  useProjectStore.setState({ createProject } as never);
});

describe('NewProjectDialog', () => {
  it('offers standard proportions first and sends them by default', () => {
    const onClose = vi.fn();
    render(<NewProjectDialog open onClose={onClose} />);
    expect(screen.getByRole('combobox', { name: 'Proportions' })).toHaveTextContent('Standard');

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: ' forest ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(createProject).toHaveBeenCalledWith('forest', '32bit', 'topdown', 'standard', 'derived');
    expect(onClose).toHaveBeenCalled();
  });

  it('sends chibi when it is chosen', () => {
    render(<NewProjectDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'forest' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'Proportions' }));
    fireEvent.click(screen.getByRole('option', { name: 'Chibi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(createProject).toHaveBeenCalledWith('forest', '32bit', 'topdown', 'chibi', 'derived');
  });

  it('offers a derived line first and sends a single line first when chosen', () => {
    render(<NewProjectDialog open onClose={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Line' })).toHaveTextContent('Derived from fills');
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'hero' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'Line' }));
    fireEvent.click(screen.getByRole('option', { name: 'Single colour, line first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(createProject).toHaveBeenCalledWith('hero', '32bit', 'topdown', 'standard', 'single');
  });
});
