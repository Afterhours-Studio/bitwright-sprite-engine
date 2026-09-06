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
import { useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Toast } from '@/components/ui/Toast';
import { useToastBridge } from '@/hooks/useToastBridge';
import { useToastStore } from '@/stores/useToastStore';

/**
 * The toast layer: mounted once, at the top of the window, above everything the
 * screens draw.
 *
 * WHERE IT SITS, AND WHY
 *
 * Inside the rounded inner container rather than over the whole window, beside
 * the content area and the command palette. The bezel is the ring of window
 * that carries the platform's background effect and no text at all; a toast
 * painted over it would sit outside the window's own rounded corner, which
 * reads as a rendering fault. The container clips, so nothing here can escape.
 *
 * Held clear of the dock, which floats twelve pixels off the bottom and stands
 * about forty tall. The stack grows upward from just above it, so the newest
 * toast is the one nearest the dock and nearest the bell it came out of, and
 * the older ones are pushed away from it.
 *
 * ORDER
 *
 * Oldest first in the markup, which is both the reading order a screen reader
 * follows and, because the stack is anchored at its bottom edge, the order that
 * puts the newest toast lowest on screen.
 *
 * The layer takes no pointer events of its own. Only the toasts do, so the
 * empty space above the stack does not swallow clicks meant for the screen
 * behind it.
 */
export function ToastViewport(): ReactElement {
  const { t } = useTranslation();
  const visible = useToastStore((state) => state.visible);

  useToastBridge();

  useEffect(
    () => () => {
      // Every timer this store owns goes with the layer that was drawing the
      // toasts they belong to. Nothing is left able to fire into a tree that is
      // no longer there, and nothing is left on screen without a timer to take
      // it away again.
      useToastStore.getState().dispose();
    },
    [],
  );

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-end px-4 pb-16">
      <ol aria-label={t('notifications.label')} className="pointer-events-auto flex flex-col">
        {visible.map((toast) => (
          <Toast key={toast.id} toast={toast} />
        ))}
      </ol>
    </div>
  );
}
