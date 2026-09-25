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

/** The names the export dialog builds for an animation's sheet. */

import { describe, expect, it } from 'vitest';

import { expandPattern } from '@/features/editor/export/exportName';

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
