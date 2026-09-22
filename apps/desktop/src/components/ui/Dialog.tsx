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
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { useDismiss } from '@/hooks/useDismiss';
import { cn } from '@/lib/cn';

export interface DialogProps {
  /** Whether the dialog is showing. */
  open: boolean;
  /** Heading. Always a translated string. */
  title: string;
  /** The body, above the buttons. */
  children: ReactNode;
  /** Label for the button that commits. Always a translated string. */
  confirmLabel: string;
  /** Whether committing reads as destructive. */
  destructive?: boolean;
  /** Whether the commit button can be pressed. */
  confirmDisabled?: boolean;
  /** Called when the dialog should close without committing. */
  onDismiss: () => void;
  /** Called when the dialog commits. */
  onConfirm: () => void;
}

/**
 * A modal question, with one thing to press to answer it and one to leave.
 *
 * It covers the content area rather than the window, so the bezel and the
 * window's own rounded corner are never painted over - the same arrangement the
 * command palette and the toast layer use, and it works for the same reason:
 * the dialog is mounted inside the shell's positioned container and lays itself
 * out against it.
 *
 * The body is a form, so that Enter commits from any field inside it. A dialog
 * whose only way forward is the mouse is one that has to be crossed twice for
 * every sprite created, and creating sprites is not a rare act here.
 *
 * Nothing is unmounted while closed. The panel animates out, which is what the
 * rest of the interface's overlays do; unmounting would snap.
 */
export function Dialog({
  open,
  title,
  children,
  confirmLabel,
  destructive = false,
  confirmDisabled = false,
  onDismiss,
  onConfirm,
}: DialogProps): ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const firstField = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => {
    onDismiss();
  }, [onDismiss]);
  useDismiss(open, panel, dismiss);

  useEffect(() => {
    if (!open) {
      return;
    }
    // The first control inside the body, not the dialog itself: a name field
    // that has to be clicked before it can be typed into is the slowest part
    // of creating anything.
    const field = firstField.current?.querySelector('input, select, button');
    if (field instanceof HTMLElement) {
      field.focus();
    }
  }, [open]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!confirmDisabled) {
      onConfirm();
    }
  };

  return (
    <div
      className={cn(
        'absolute inset-0 z-50 flex items-center justify-center p-4',
        'transition-opacity duration-150',
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
      aria-hidden={!open}
      {...(open ? {} : { inert: '' })}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={cn(
          'w-full max-w-sm rounded-lg border border-line bg-surface-float p-4 shadow-lg',
          'origin-center transition-transform duration-150',
          open ? 'scale-100' : 'scale-95',
        )}
      >
        <h2 id={id} className="text-sm font-semibold text-fg-primary">
          {title}
        </h2>
        <form onSubmit={submit}>
          <div ref={firstField} className="mt-3 flex flex-col gap-3">
            {children}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={dismiss}>
              {t('actions.cancel')}
            </Button>
            <Button
              type="submit"
              variant={destructive ? 'danger' : 'primary'}
              disabled={confirmDisabled}
            >
              {confirmLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export interface ConfirmDialogProps {
  /** Whether the dialog is showing. */
  open: boolean;
  /** Heading. Always a translated string. */
  title: string;
  /**
   * What pressing the button will actually do, in full.
   *
   * Not a question. "Are you sure?" tells a reader nothing they did not already
   * know, and the things this dialog guards - a whole project, a sprite's whole
   * edit history - are exactly the ones where what is lost is more than what
   * was clicked on.
   */
  body: string;
  /** Label for the button that commits. Always a translated string. */
  confirmLabel: string;
  /** Called when the dialog should close without committing. */
  onDismiss: () => void;
  /** Called when the dialog commits. */
  onConfirm: () => void;
}

/** A dialog that only confirms, with the consequence written out in the body. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onDismiss,
  onConfirm,
}: ConfirmDialogProps): ReactElement {
  return (
    <Dialog
      open={open}
      title={title}
      confirmLabel={confirmLabel}
      destructive
      onDismiss={onDismiss}
      onConfirm={onConfirm}
    >
      <p className="text-xs text-fg-secondary">{body}</p>
    </Dialog>
  );
}
