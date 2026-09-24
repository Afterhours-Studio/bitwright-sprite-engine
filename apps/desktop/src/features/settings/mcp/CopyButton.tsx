/**
 * A button that puts one string on the clipboard, and says whether it did.
 *
 * The panel offers this for the server URL, the bearer token and the manual
 * snippet. All three are things a person moves into another application's
 * configuration file - the token included, because it has to be pasted into
 * the client's own configuration - and a copy that silently failed is worse
 * than no copy button at all: it leaves a broken credential in a client config
 * and a connection that refuses to explain itself. So the result is checked and
 * reported, and the button changes label until the next press.
 *
 * The label reverts on a timer rather than on the next press, because a user
 * who copies the token and then looks away has to find the button back in its
 * normal state when they return to it.
 *
 * @param props - What to copy, and what to call it.
 * @returns The button.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/Button';
import { copyToClipboard } from '@/features/settings/mcp/clipboard';

/** How long the confirmation stays before the label reverts. */
const CONFIRM_MS = 2000;

export interface CopyButtonProps {
  /** The text to put on the clipboard. */
  value: string;
  /** Accessible name, and the label at rest. Always translated. */
  label: string;
  /** Label while the copy is confirmed. Always translated. */
  copiedLabel: string;
  /** Label after a copy the clipboard refused. Always translated. */
  failedLabel: string;
}

export function CopyButton({
  value,
  label,
  copiedLabel,
  failedLabel,
}: CopyButtonProps): ReactElement {
  // Three states rather than a boolean, because a failed copy has to keep
  // saying so until the user tries again.
  const [outcome, setOutcome] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    },
    [],
  );

  const onClick = (): void => {
    void (async () => {
      const copied = await copyToClipboard(value);
      setOutcome(copied ? 'copied' : 'failed');
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
      if (copied) {
        timer.current = window.setTimeout(() => {
          timer.current = null;
          setOutcome('idle');
        }, CONFIRM_MS);
      }
    })();
  };

  return (
    <Button
      variant="ghost"
      className="px-2 py-1 text-xs"
      onClick={onClick}
      data-slot="copy-outcome"
      data-outcome={outcome}
    >
      {outcome === 'copied' ? copiedLabel : outcome === 'failed' ? failedLabel : label}
    </Button>
  );
}
