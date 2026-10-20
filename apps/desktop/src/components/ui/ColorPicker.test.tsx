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

import { ColorPicker, hexToHsv, hsvToHex } from '@/components/ui/ColorPicker';

const HASH = '#';

function setup(value = `${HASH}ff0000`): ReturnType<typeof vi.fn> {
  const onValueChange = vi.fn();
  render(
    <ColorPicker
      label="Colour"
      value={value}
      onValueChange={onValueChange}
      saturationLabel="Saturation"
      hueLabel="Hue"
      hexLabel="Hex"
    />,
  );
  return onValueChange;
}

describe('hex conversion', () => {
  it('round-trips', () => {
    for (const hex of [
      'ff0000',
      `${HASH}00ff00`,
      `${HASH}123456`,
      `${HASH}ffffff`,
      `${HASH}000000`,
    ]) {
      const hsv = hexToHsv(hex);
      expect(hsv).not.toBeNull();
      if (hsv !== null) {
        expect(hsvToHex(hsv)).toBe(hex.startsWith('#') ? hex : `#${hex}`);
      }
    }
  });

  it('rejects bad input and accepts upper case', () => {
    expect(hexToHsv('zzz')).toBeNull();
    expect(hexToHsv(`${HASH}ABCDEF`)).not.toBeNull();
  });
});

describe('ColorPicker', () => {
  it('opens from the swatch', () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'Colour' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Colour' })).toBeInTheDocument();
  });

  it('commits a typed hex on Enter', () => {
    const onValueChange = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Colour' }));
    const hex = screen.getByLabelText('Hex');
    fireEvent.change(hex, { target: { value: `${HASH}00ff00` } });
    fireEvent.keyDown(hex, { key: 'Enter' });
    expect(onValueChange).toHaveBeenCalledWith(`${HASH}00ff00`);
  });

  it('restores the value after bad text', () => {
    const onValueChange = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Colour' }));
    const hex = screen.getByLabelText('Hex');
    fireEvent.change(hex, { target: { value: 'nope' } });
    fireEvent.blur(hex);
    expect(onValueChange).not.toHaveBeenCalled();
    expect(hex).toHaveValue(`${HASH}ff0000`);
  });

  it('moves the hue with the arrow keys', () => {
    const onValueChange = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Colour' }));
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Hue' }), { key: 'ArrowRight' });
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0]?.[0]).not.toBe(`${HASH}ff0000`);
  });
});
