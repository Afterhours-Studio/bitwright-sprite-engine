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
 * A button that puts one string on the clipboard, and says whether it did.
 *
 * The panel offers this for the server URL and the manual snippet. Both are
 * things a person moves into another application's configuration file, and a
 * copy that silently failed is worse than no copy button at all: it leaves a
 * stale address in a client config and a connection that refuses to explain
 * itself. So the result is checked and reported, and the button changes label
 * until the next press.
 *
 * The outcome is carried by the label alone. Colouring the text as well would
 * fight the variant's own text colour, which `cn` does not merge away.
 *
 * The label reverts on a timer rather than on the next press, because a user
 * who copies and then looks away has to find the button back in its normal
 * state when they return to it.
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

/**
 * The copy button.
 *
 * @param props - What to copy, and what to call it.
 * @returns The button.
 */
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
      size="xs"
      onClick={onClick}
      data-slot="copy-outcome"
      data-outcome={outcome}
    >
      {outcome === 'copied' ? copiedLabel : outcome === 'failed' ? failedLabel : label}
    </Button>
  );
}
