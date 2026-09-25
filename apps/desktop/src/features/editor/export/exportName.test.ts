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

/** The names the export dialog builds for an animation's GIF and sheet. */

import { describe, expect, it } from 'vitest';

import { expandPattern, gifPath } from '@/features/editor/export/exportName';

const PARTS = { project: 'forest', asset: 'walk', kind: 'character', scale: 2 };

describe('expandPattern', () => {
  it('fills every placeholder', () => {
    expect(expandPattern('{project}-{asset}-{kind}@{scale}x', PARTS)).toBe(
      'forest-walk-character@2x',
    );
  });

  it('can leave the project for the shell', () => {
    expect(expandPattern('{project}/{asset}', PARTS, true)).toBe('{project}/walk');
  });
});

describe('gifPath', () => {
  it('joins the folder and the expanded pattern with a .gif extension', () => {
    expect(gifPath('D:/exports', '{asset}@{scale}x', PARTS)).toBe('D:/exports/walk@2x.gif');
    expect(gifPath('D:\\exports\\', '{asset}', PARTS)).toBe('D:\\exports\\walk.gif');
  });

  it('replaces separators and swaps a .png extension for .gif', () => {
    expect(gifPath('/out', '../{asset}.png', PARTS)).toBe('/out/_walk.gif');
  });

  it('escapes a reserved stem and refuses an empty one', () => {
    expect(gifPath('/out', 'con', PARTS)).toBe('/out/_con.gif');
    expect(gifPath('/out', ' .. ', PARTS)).toBeNull();
  });
});
