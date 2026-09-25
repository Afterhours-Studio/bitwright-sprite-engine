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
import { fireEvent, render } from '@testing-library/react';
import { useRef, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useDismiss } from '@/hooks/useDismiss';

function Overlay({ open, onDismiss }: { open: boolean; onDismiss: () => void }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, onDismiss);
  return <div ref={ref} />;
}

describe('useDismiss', () => {
  it('closes only the newest overlay on Escape', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const { rerender } = render(
      <>
        <Overlay open onDismiss={outer} />
        <Overlay open={false} onDismiss={inner} />
      </>,
    );
    rerender(
      <>
        <Overlay open onDismiss={outer} />
        <Overlay open onDismiss={inner} />
      </>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();

    rerender(
      <>
        <Overlay open onDismiss={outer} />
        <Overlay open={false} onDismiss={inner} />
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('keeps its place when the older overlay re-renders with a new handler', () => {
    const inner = vi.fn();
    const { rerender } = render(
      <>
        <Overlay open onDismiss={() => undefined} />
        <Overlay open={false} onDismiss={inner} />
      </>,
    );
    rerender(
      <>
        <Overlay open onDismiss={() => undefined} />
        <Overlay open onDismiss={inner} />
      </>,
    );
    const outer = vi.fn();
    rerender(
      <>
        <Overlay open onDismiss={outer} />
        <Overlay open onDismiss={inner} />
      </>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});
