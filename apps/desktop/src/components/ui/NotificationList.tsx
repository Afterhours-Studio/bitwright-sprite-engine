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
import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { SeverityIcon } from '@/components/ui/Toast';
import { useToastText } from '@/hooks/useToastText';
import { cn } from '@/lib/cn';
import { useToastStore } from '@/stores/useToastStore';

export interface NotificationListProps {
  /** Extra classes for layout only, never colour. */
  className?: string;
}

/**
 * What the notification bell shows: everything that has been raised this
 * session, newest first.
 *
 * THIS IS PANEL CONTENT, NOT A PANEL.
 *
 * It draws no surface, no border, and no shadow, and it positions nothing. The
 * dock puts it inside its own `Overlay`, which is the one popover the
 * application has; a second one written here would be a second set of dismiss
 * rules, a second alignment model, and a second thing to keep in step with the
 * first. It carries `min-w` rather than `w`, so the caller sizing the overlay
 * wins and an empty panel is still wide enough to read.
 *
 * The list is scrollable and the heading is not, so a long history cannot push
 * the clear button off the end of the panel.
 */
export function NotificationList({ className }: NotificationListProps): ReactElement {
  const { t, i18n } = useTranslation();
  const text = useToastText();
  const history = useToastStore((state) => state.history);
  const clearHistory = useToastStore((state) => state.clearHistory);

  // Rebuilt only when the language changes. A formatter is not cheap to make,
  // and this one would otherwise be made once per row per render.
  const time = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }),
    [i18n.language],
  );

  return (
    <div className={cn('flex min-w-[280px] flex-col', className)}>
      <div className="flex items-center justify-between gap-3 px-2 py-1">
        <h2 className="text-sm font-medium text-fg-primary">{t('notifications.title')}</h2>
        {history.length > 0 && (
          <Button variant="ghost" onClick={clearHistory}>
            {t('notifications.clear')}
          </Button>
        )}
      </div>

      {history.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-fg-secondary">
          {t('notifications.empty')}
        </p>
      ) : (
        <ul className="max-h-80 overflow-y-auto">
          {history.map((item) => (
            <li key={item.id} className="flex items-start gap-3 rounded-sm px-2 py-2">
              <SeverityIcon severity={item.severity} />
              {/* Severity is drawn as a shape and a colour, neither of which a
                  screen reader reports. This is the only thing that tells one
                  reading of the list from another. */}
              <span className="sr-only">{t(`notifications.severity.${item.severity}`)}</span>

              <div className="min-w-0 flex-1">
                {item.titleKey !== null && (
                  <p className="text-sm font-medium leading-snug text-fg-primary">
                    {text(item.titleKey, item.values)}
                  </p>
                )}
                <p
                  className={cn(
                    'break-words text-sm leading-snug',
                    item.titleKey === null ? 'text-fg-primary' : 'text-fg-secondary',
                  )}
                >
                  {text(item.messageKey, item.values)}
                </p>
              </div>

              <time
                dateTime={new Date(item.createdAt).toISOString()}
                className="shrink-0 pt-0.5 text-xs tabular-nums text-fg-secondary"
              >
                {time.format(item.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
