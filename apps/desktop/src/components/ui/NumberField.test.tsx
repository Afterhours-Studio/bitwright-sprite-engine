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
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NumberField } from '@/components/ui/NumberField';

describe('NumberField', () => {
  it('commits typed text on blur', () => {
    const onValueChange = vi.fn();
    render(<NumberField label="Width" value={4} onValueChange={onValueChange} />);
    const field = screen.getByRole('spinbutton', { name: 'Width' });
    fireEvent.change(field, { target: { value: '12' } });
    fireEvent.blur(field);
    expect(onValueChange).toHaveBeenLastCalledWith(12);
  });

  it('clamps to max', () => {
    const onValueChange = vi.fn();
    render(<NumberField label="Width" value={4} max={10} onValueChange={onValueChange} />);
    const field = screen.getByRole('spinbutton', { name: 'Width' });
    fireEvent.change(field, { target: { value: '50' } });
    fireEvent.blur(field);
    expect(onValueChange).toHaveBeenLastCalledWith(10);
  });

  it('draws the compact field for size sm', () => {
    render(<NumberField label="Width" size="sm" value={4} onValueChange={vi.fn()} />);
    const field = screen.getByRole('spinbutton', { name: 'Width' });
    expect(field).toHaveClass('px-2');
    expect(field).not.toHaveClass('px-3');
  });

  it('puts the label on one row for layout inline', () => {
    const { container } = render(
      <NumberField label="Width" layout="inline" value={4} onValueChange={vi.fn()} />,
    );
    expect(container.firstElementChild).toHaveClass('items-center');
  });

  it('keeps a hidden label for assistive technology', () => {
    render(<NumberField label="Width" hideLabel value={4} onValueChange={vi.fn()} />);
    expect(screen.getByText('Width')).toHaveClass('sr-only');
    expect(screen.getByRole('spinbutton', { name: 'Width' })).toBeInTheDocument();
  });

  it('steps with the stepper', () => {
    const onValueChange = vi.fn();
    render(<NumberField label="Width" value={4} step={2} onValueChange={onValueChange} />);
    const increase = screen.getAllByRole('button')[0];
    expect(increase).toBeDefined();
    if (increase === undefined) {
      return;
    }
    fireEvent.pointerDown(increase);
    fireEvent.pointerUp(increase);
    expect(onValueChange).toHaveBeenLastCalledWith(6);
  });
});
