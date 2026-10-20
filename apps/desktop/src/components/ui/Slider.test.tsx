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

import { Slider, snap } from '@/components/ui/Slider';

// jsdom has no PointerEvent, and without one Testing Library builds a plain
// event with no clientX. A MouseEvent carries the coordinates, which is all
// the slider reads.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventShim extends MouseEvent {
    pointerId: number;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  window.PointerEvent = PointerEventShim as unknown as typeof PointerEvent;
}

describe('snap', () => {
  it('clamps below the minimum', () => {
    expect(snap(-5, 0, 10, 1)).toBe(0);
  });

  it('clamps above the maximum', () => {
    expect(snap(25, 0, 10, 1)).toBe(10);
  });

  it('snaps to the nearest step', () => {
    expect(snap(7.4, 0, 10, 0.5)).toBe(7.5);
  });

  it('leaves a value already on a step alone', () => {
    expect(snap(3, 0, 10, 1)).toBe(3);
  });

  it('snaps from the minimum, not from zero', () => {
    expect(snap(1.9, 1, 5, 0.5)).toBe(2);
  });

  it('returns a clean number rather than float noise', () => {
    expect(snap(0.1 + 0.2, 0, 1, 0.1)).toBe(0.3);
  });
});

describe('Slider', () => {
  it('exposes its name and range to assistive technology', () => {
    render(<Slider label="Opacity" value={4} min={0} max={10} onValueChange={() => undefined} />);

    const slider = screen.getByRole('slider', { name: 'Opacity' });
    expect(slider).toHaveAttribute('aria-valuenow', '4');
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '10');
  });

  it('steps up on ArrowRight', () => {
    const onValueChange = vi.fn();
    render(<Slider label="Opacity" value={4} min={0} max={10} onValueChange={onValueChange} />);

    fireEvent.keyDown(screen.getByRole('slider', { name: 'Opacity' }), { key: 'ArrowRight' });
    expect(onValueChange).toHaveBeenCalledWith(5);
  });

  it('steps down on ArrowLeft', () => {
    const onValueChange = vi.fn();
    render(<Slider label="Opacity" value={4} min={0} max={10} onValueChange={onValueChange} />);

    fireEvent.keyDown(screen.getByRole('slider', { name: 'Opacity' }), { key: 'ArrowLeft' });
    expect(onValueChange).toHaveBeenCalledWith(3);
  });

  it('jumps to the maximum on End', () => {
    const onValueChange = vi.fn();
    render(<Slider label="Opacity" value={4} min={0} max={10} onValueChange={onValueChange} />);

    fireEvent.keyDown(screen.getByRole('slider', { name: 'Opacity' }), { key: 'End' });
    expect(onValueChange).toHaveBeenCalledWith(10);
  });

  it('jumps to the minimum on Home', () => {
    const onValueChange = vi.fn();
    render(<Slider label="Opacity" value={4} min={2} max={10} onValueChange={onValueChange} />);

    fireEvent.keyDown(screen.getByRole('slider', { name: 'Opacity' }), { key: 'Home' });
    expect(onValueChange).toHaveBeenCalledWith(2);
  });

  it('does nothing when already at the maximum', () => {
    const onValueChange = vi.fn();
    render(<Slider label="Opacity" value={10} min={0} max={10} onValueChange={onValueChange} />);

    fireEvent.keyDown(screen.getByRole('slider', { name: 'Opacity' }), { key: 'ArrowRight' });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('does nothing while disabled', () => {
    const onValueChange = vi.fn();
    render(
      <Slider label="Opacity" value={4} min={0} max={10} disabled onValueChange={onValueChange} />,
    );

    const slider = screen.getByRole('slider', { name: 'Opacity' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onValueChange).not.toHaveBeenCalled();
    expect(slider).toHaveAttribute('aria-disabled', 'true');
    expect(slider).toHaveAttribute('tabindex', '-1');
  });

  it('picks the value under the pointer on a press', () => {
    const onValueChange = vi.fn();
    render(
      <Slider
        label="Opacity"
        value={0}
        min={0}
        max={10}
        step={0.5}
        onValueChange={onValueChange}
      />,
    );

    const slider = screen.getByRole('slider', { name: 'Opacity' });
    slider.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 16 }) as DOMRect;
    fireEvent.pointerDown(slider, { clientX: 150, pointerId: 1 });

    expect(onValueChange).toHaveBeenCalledWith(7.5);
  });

  it('follows the pointer while dragging and stops on release', () => {
    const onValueChange = vi.fn();
    render(<Slider label="Opacity" value={0} min={0} max={10} onValueChange={onValueChange} />);

    const slider = screen.getByRole('slider', { name: 'Opacity' });
    slider.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 16 }) as DOMRect;

    fireEvent.pointerMove(slider, { clientX: 50, pointerId: 1 });
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(slider, { clientX: 20, pointerId: 1 });
    expect(onValueChange).toHaveBeenCalledWith(2);

    fireEvent.pointerMove(slider, { clientX: 80, pointerId: 1 });
    expect(onValueChange).toHaveBeenCalledWith(8);

    onValueChange.mockClear();
    fireEvent.pointerUp(slider, { pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 10, pointerId: 1 });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('ignores the pointer while disabled', () => {
    const onValueChange = vi.fn();
    render(
      <Slider label="Opacity" value={0} min={0} max={10} disabled onValueChange={onValueChange} />,
    );

    const slider = screen.getByRole('slider', { name: 'Opacity' });
    slider.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 16 }) as DOMRect;

    fireEvent.pointerDown(slider, { clientX: 40, pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 60, pointerId: 1 });
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
