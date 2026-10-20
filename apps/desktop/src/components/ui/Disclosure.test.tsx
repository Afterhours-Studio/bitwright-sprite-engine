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

import { Disclosure } from '@/components/ui/Disclosure';

describe('Disclosure', () => {
  it('is closed by default', () => {
    render(
      <Disclosure summary="Advanced">
        <p>Hidden body</p>
      </Disclosure>,
    );

    expect(screen.getByRole('button', { name: 'Advanced' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('region', { hidden: true })).toHaveAttribute('aria-hidden', 'true');
  });

  it('opens and closes when the heading is clicked, reporting each change', () => {
    const onOpenChange = vi.fn();
    render(
      <Disclosure summary="Advanced" onOpenChange={onOpenChange}>
        <p>Hidden body</p>
      </Disclosure>,
    );

    const header = screen.getByRole('button', { name: 'Advanced' });

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region')).toHaveAttribute('aria-hidden', 'false');
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it('stays open when controlled, but still reports the toggle', () => {
    const onOpenChange = vi.fn();
    render(
      <Disclosure summary="Advanced" open onOpenChange={onOpenChange}>
        <p>Hidden body</p>
      </Disclosure>,
    );

    const header = screen.getByRole('button', { name: 'Advanced' });
    expect(header).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders open when defaultOpen is set', () => {
    render(
      <Disclosure summary="Advanced" defaultOpen>
        <p>Hidden body</p>
      </Disclosure>,
    );

    expect(screen.getByRole('button', { name: 'Advanced' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('region')).toHaveAttribute('aria-hidden', 'false');
  });
});
