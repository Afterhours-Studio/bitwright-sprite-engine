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

import { Checkbox } from '@/components/ui/Checkbox';

describe('Checkbox', () => {
  it('is a checkbox named by its label, reflecting the checked prop', () => {
    const { rerender } = render(
      <Checkbox label="Snap to grid" checked={false} onCheckedChange={() => {}} />,
    );

    const box = screen.getByRole('checkbox', { name: 'Snap to grid' });
    expect(box.getAttribute('aria-checked')).toBe('false');

    rerender(<Checkbox label="Snap to grid" checked onCheckedChange={() => {}} />);
    expect(
      screen.getByRole('checkbox', { name: 'Snap to grid' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('asks to be checked when it is unchecked', () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox label="Snap to grid" checked={false} onCheckedChange={onCheckedChange} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Snap to grid' }));

    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('asks to be unchecked when it is checked', () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox label="Snap to grid" checked onCheckedChange={onCheckedChange} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Snap to grid' }));

    expect(onCheckedChange).toHaveBeenCalledTimes(1);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it('does not change while disabled', () => {
    const onCheckedChange = vi.fn();
    render(
      <Checkbox label="Snap to grid" checked={false} disabled onCheckedChange={onCheckedChange} />,
    );

    const box = screen.getByRole('checkbox', { name: 'Snap to grid' });
    expect(box.hasAttribute('disabled')).toBe(true);

    fireEvent.click(box);

    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('is still named by the label when the label is hidden', () => {
    const onCheckedChange = vi.fn();
    render(
      <Checkbox label="Snap to grid" checked={false} hideLabel onCheckedChange={onCheckedChange} />,
    );

    const box = screen.getByRole('checkbox', { name: 'Snap to grid' });
    expect(box.textContent).toBe('Snap to grid');

    fireEvent.click(box);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
