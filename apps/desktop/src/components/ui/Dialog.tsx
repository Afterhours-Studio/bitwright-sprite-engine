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

/** How wide the panel may grow. */
export type DialogSize = 'sm' | 'md' | 'lg';

const SIZES: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export interface DialogProps {
  /** Whether the dialog is showing. */
  open: boolean;
  /** Heading. Always a translated string. */
  title: string;
  /** An icon drawn before the heading, in the accent colour. */
  icon?: ReactNode;
  /** The body, above the buttons. */
  children: ReactNode;
  /** Label for the button that commits. Always a translated string. */
  confirmLabel: string;
  /** Whether committing reads as destructive. */
  destructive?: boolean;
  /** Whether the commit button can be pressed. */
  confirmDisabled?: boolean;
  /** How wide the panel may grow. `lg` is the new sprite dialog's width. */
  size?: DialogSize;
  /**
   * Whether the body is a `<form>`, so Enter in a field commits. On by default.
   *
   * Turn it off for a dialog that hosts a whole panel rather than a few
   * fields - the reference panel is one - and above all for one whose body can
   * open a dialog of its own. A form cannot contain a form: the parser drops
   * the inner one, so the nested dialog's Enter and its commit button would
   * submit the outer dialog instead. With this off the body is a plain
   * container and the commit button calls `onConfirm` on click.
   */
  asForm?: boolean;
  /** Called when the dialog should close without committing. */
  onDismiss: () => void;
  /** Called when the dialog commits. */
  onConfirm: () => void;
}

/**
 * A modal question, with one thing to press to answer it and one to leave.
 *
 * Drawn like the new sprite dialog: the whole window dimmed and blurred behind
 * it, a near-black panel with a large corner, and a heading strip. The panel
 * carries no transform, on purpose: a transformed ancestor becomes the box a
 * `fixed` descendant is laid out against, so a dialog opened from inside this
 * one (a confirmation inside the reference panel) would be squeezed into this
 * panel instead of covering the window.
 *
 * The body is a form by default, so that Enter commits from any field inside
 * it. A dialog whose only way forward is the mouse is one that has to be
 * crossed twice for every sprite created. See `asForm` for when it must not be.
 *
 * Nothing is unmounted while closed. The dialog fades out, which is what the
 * rest of the interface's overlays do; unmounting would snap.
 */
export function Dialog({
  open,
  title,
  icon,
  children,
  confirmLabel,
  destructive = false,
  confirmDisabled = false,
  size = 'sm',
  asForm = true,
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

  const confirm = (): void => {
    if (!confirmDisabled) {
      onConfirm();
    }
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    // A React submit event bubbles through the component tree, not only the
    // DOM one, so a form-bodied dialog rendered under another one (through a
    // portal, say) would otherwise commit both.
    event.stopPropagation();
    confirm();
  };

  const content = (
    <>
      <div
        ref={firstField}
        className={cn('flex flex-col gap-4 p-5', !asForm && 'min-h-0 overflow-y-auto')}
      >
        {children}
      </div>
      <div className="flex justify-end gap-2 rounded-b-xl border-t border-neutral-800 bg-neutral-900/30 px-5 py-3">
        <Button variant="ghost" onClick={dismiss}>
          {t('actions.cancel')}
        </Button>
        <Button
          type={asForm ? 'submit' : 'button'}
          variant={destructive ? 'danger' : 'primary'}
          disabled={confirmDisabled}
          {...(asForm ? {} : { onClick: confirm })}
        >
          {confirmLabel}
        </Button>
      </div>
    </>
  );

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm',
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
          'flex max-h-full w-full flex-col rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-100 shadow-2xl',
          SIZES[size],
        )}
      >
        <div className="flex items-center gap-2 rounded-t-xl border-b border-neutral-800 bg-neutral-900/50 p-4">
          {icon !== undefined && (
            <span aria-hidden="true" className="flex text-pink-500 [&>svg]:h-4 [&>svg]:w-4">
              {icon}
            </span>
          )}
          <h2 id={id} className="text-base font-semibold">
            {title}
          </h2>
        </div>
        {asForm ? (
          <form onSubmit={submit} className="flex min-h-0 flex-col">
            {content}
          </form>
        ) : (
          <div className="flex min-h-0 flex-col">{content}</div>
        )}
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
      <p className="text-xs leading-relaxed text-neutral-400">{body}</p>
    </Dialog>
  );
}
