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

import { Select } from '@/components/ui/Select';

const OPTIONS = [
  { value: 'recent', label: 'Recent' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name', label: 'Name' },
];

describe('Select', () => {
  it('shows the label, opens on click, and commits the option that is clicked', () => {
    const onValueChange = vi.fn();
    render(<Select label="Sort" value="recent" options={OPTIONS} onValueChange={onValueChange} />);

    expect(screen.getByText('Sort')).toBeDefined();

    const trigger = screen.getByRole('combobox', { name: 'Sort' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('option')).toHaveLength(3);

    const options = screen.getAllByRole('option');
    fireEvent.click(options[1] as HTMLElement);
    expect(onValueChange).toHaveBeenCalledWith('oldest');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens with ArrowDown, moves with ArrowDown, and commits with Enter', () => {
    const onValueChange = vi.fn();
    render(<Select label="Sort" value="recent" options={OPTIONS} onValueChange={onValueChange} />);

    const trigger = screen.getByRole('combobox', { name: 'Sort' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'Enter' });

    expect(onValueChange).toHaveBeenCalledWith('oldest');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps a hidden label for assistive technology only', () => {
    render(
      <Select label="Sort" value="recent" options={OPTIONS} hideLabel onValueChange={vi.fn()} />,
    );

    const label = screen.getByText('Sort');
    expect(label.className.split(' ')).toContain('sr-only');
    expect(screen.getByRole('combobox', { name: 'Sort' })).toBeDefined();
  });

  it('draws a bare trigger without a border', () => {
    render(
      <Select
        label="Sort"
        value="recent"
        options={OPTIONS}
        variant="bare"
        onValueChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'Sort' });
    expect(trigger.className.split(' ')).not.toContain('border');
  });

  it('puts the label on the same row as the control in the inline layout', () => {
    const { container } = render(
      <Select
        label="Sort"
        value="recent"
        options={OPTIONS}
        layout="inline"
        onValueChange={vi.fn()}
      />,
    );

    const root = container.firstElementChild;
    expect(root?.className).toContain('flex items-center');
  });
});
