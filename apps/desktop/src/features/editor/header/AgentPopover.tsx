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
 * The header's Agent button and the popover it opens.
 *
 * WHY THIS LIVES IN THE EDITOR. The sprite on the stage can be drawn by an
 * agent over MCP, and the person watching it needs three answers without
 * leaving the canvas: is the server up and where, is anything attached, and
 * what is it doing right now. Configuring a client is the rare act, so it is
 * a shortcut to Settings rather than a copy of the settings card.
 *
 * TWO SOURCES, BECAUSE THEY ANSWER DIFFERENT QUESTIONS. The MCP store holds
 * what the shell reported - the transport, the address, every attached
 * session and the last tool each one called - and is re-read when the
 * popover opens so it is never showing a status from before the window last
 * looked. The live chip from `features/editor/live` answers "drawing right
 * now", which is a two second window the store deliberately does not keep.
 *
 * The store's subscription is started here and never disposed here: the
 * settings card owns that lifecycle, and tearing it down from a popover would
 * silence the card while it is on screen.
 */

import { Brain, Settings } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { AgentActivityIndicator } from '@/features/editor/live';
import { useMcpStore } from '@/features/settings/mcp/useMcpStore';
import { useDismiss } from '@/hooks/useDismiss';
import { cn } from '@/lib/cn';
import { inShell } from '@/lib/tauri';
import { useShellStore } from '@/stores/useShellStore';

/** The header's text toggle, on. */
const TOGGLE_ON =
  'px-2.5 py-1.5 text-xs font-medium rounded border bg-neutral-800 text-neutral-200 border-neutral-700';

/** The header's text toggle, off. */
const TOGGLE_OFF =
  'px-2.5 py-1.5 text-xs font-medium rounded border bg-neutral-900 text-neutral-500 border-neutral-800';

/**
 * The Agent button, and the popover under it while it is open.
 *
 * @returns The button, with the popover anchored below it.
 */
export function AgentPopover(): ReactElement {
  const { t } = useTranslation('studio');
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const status = useMcpStore((state) => state.status);
  const refresh = useMcpStore((state) => state.refresh);
  const subscribe = useMcpStore((state) => state.subscribe);
  const setScreen = useShellStore((state) => state.setScreen);

  const dismiss = useCallback(() => {
    setOpen(false);
  }, []);
  useDismiss(open, root, dismiss);

  useEffect(() => {
    // Outside a shell there is no server to ask, and every command would come
    // back `shell.unavailable`, which the popover would then show as a fault.
    if (!open || !inShell()) {
      return;
    }
    void subscribe();
    void refresh();
  }, [open, subscribe, refresh]);

  const sessions = status?.sessions ?? [];
  const running = status?.running === true;

  return (
    <div ref={root} className="relative no-drag">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t('header.agentHint')}
        className={cn('flex items-center space-x-1.5', open ? TOGGLE_ON : TOGGLE_OFF)}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <Brain aria-hidden="true" className="w-3.5 h-3.5" />
        <span className="sr-only min-[1400px]:not-sr-only">{t('header.agent')}</span>
      </button>

      {/* Kept mounted while closed, only hidden, so the live chip inside has
          been listening since the header appeared rather than since the
          popover last opened: an agent that attached a minute ago still
          reads as attached. */}
      <div
        hidden={!open}
        role="dialog"
        aria-label={t('agent.title')}
        className="absolute right-0 top-full mt-2 z-50 w-72 bg-neutral-950/90 backdrop-blur border border-neutral-800 rounded shadow-md p-3 space-y-3 text-xs"
      >
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-neutral-300">{t('agent.server')}</span>
            <span className={running ? 'text-emerald-400' : 'text-neutral-500'}>
              {status === null
                ? t('agent.unknown')
                : running
                  ? t('agent.running')
                  : t('agent.stopped')}
            </span>
          </div>
          {running && status.url !== null && (
            <div className="flex items-center justify-between space-x-2">
              <span className="text-neutral-500">{t('agent.address')}</span>
              <code className="truncate text-[11px] text-sky-400">{status.url}</code>
            </div>
          )}
        </div>

        <div className="h-px bg-neutral-800" />

        <div className="space-y-1.5">
          <span className="block font-semibold text-neutral-300">{t('agent.sessions')}</span>
          {sessions.length === 0 ? (
            <p className="text-neutral-500">{t('agent.noSessions')}</p>
          ) : (
            <>
              <p className="text-neutral-400">
                {t('agent.sessionCount', { count: sessions.length })}
              </p>
              <ul className="space-y-1">
                {sessions.map((session) => (
                  <li key={session.id} className="flex flex-col">
                    <code className="truncate text-[11px] text-neutral-300">{session.id}</code>
                    <span className="text-[11px] text-neutral-500">
                      {session.lastTool === null
                        ? t('agent.idle')
                        : t('agent.lastTool', { tool: session.lastTool })}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <AgentActivityIndicator />
        </div>

        <div className="h-px bg-neutral-800" />

        <button
          type="button"
          className="w-full flex items-center justify-center space-x-1.5 px-3 py-1.5 rounded text-xs bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800"
          onClick={() => {
            setOpen(false);
            setScreen('settings');
          }}
        >
          <Settings aria-hidden="true" className="w-3.5 h-3.5" />
          <span>{t('agent.configure')}</span>
        </button>
      </div>
    </div>
  );
}
