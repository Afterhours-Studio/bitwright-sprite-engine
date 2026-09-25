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

/**
 * The dialog's two body shapes: a form that Enter commits, and a plain
 * container that can host a panel with a dialog of its own inside it.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Dialog } from '@/components/ui/Dialog';

describe('Dialog', () => {
  it('commits from Enter in a field when the body is a form', () => {
    const onConfirm = vi.fn();
    render(
      <Dialog open title="Rename" confirmLabel="Save" onDismiss={vi.fn()} onConfirm={onConfirm}>
        <input aria-label="Name" defaultValue="hero" />
      </Dialog>,
    );

    const field = screen.getByRole('textbox', { name: 'Name' });
    const form = field.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not commit while the confirm button is disabled', () => {
    const onConfirm = vi.fn();
    render(
      <Dialog
        open
        title="Rename"
        confirmLabel="Save"
        confirmDisabled
        onDismiss={vi.fn()}
        onConfirm={onConfirm}
      >
        <input aria-label="Name" />
      </Dialog>,
    );

    fireEvent.submit(
      screen.getByRole('textbox', { name: 'Name' }).closest('form') as HTMLFormElement,
    );

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('nests a dialog without nesting a form, and each commits only itself', () => {
    const outerConfirm = vi.fn();
    const innerConfirm = vi.fn();
    render(
      <Dialog
        open
        title="Reference"
        confirmLabel="Done"
        asForm={false}
        onDismiss={vi.fn()}
        onConfirm={outerConfirm}
      >
        <Dialog
          open
          title="Delete reference"
          confirmLabel="Delete"
          destructive
          onDismiss={vi.fn()}
          onConfirm={innerConfirm}
        >
          <p>Gone for good.</p>
        </Dialog>
      </Dialog>,
    );

    // The outer body is not a form, so the inner one is the only form there
    // is and nothing sits inside another form.
    expect(document.querySelectorAll('form')).toHaveLength(1);
    expect(document.querySelector('form form')).toBeNull();

    const inner = screen.getByRole('dialog', { name: 'Delete reference' });
    fireEvent.click(within(inner).getByRole('button', { name: 'Delete' }));
    expect(innerConfirm).toHaveBeenCalledTimes(1);
    expect(outerConfirm).not.toHaveBeenCalled();

    const outerDone = screen.getByRole('button', { name: 'Done' });
    expect(outerDone).toHaveAttribute('type', 'button');
    fireEvent.click(outerDone);
    expect(outerConfirm).toHaveBeenCalledTimes(1);
    expect(innerConfirm).toHaveBeenCalledTimes(1);
  });
});
