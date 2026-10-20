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
 * The MCP card in Settings.
 *
 * One compact block: the transport as a small inline select with the server's
 * state beside it, the URL with a copy button, the sessions attached right
 * now, one row per client the shell can configure, and a manual snippet for
 * clients it cannot write to. There is no credential to show: the server asks
 * for none (see `mcp/server.rs`).
 *
 * The client rows are re-read whenever the window comes back to the front, not
 * only on mount. Claude Desktop rewrites its configuration file from memory
 * while it runs, so an entry Bitwright wrote can vanish behind the panel's
 * back; re-reading is what keeps "Registered" from lying about it.
 *
 * The card is self-contained: it mounts the store, subscribes to events, and
 * tears everything down on unmount. The screen only has to render it.
 *
 * Outside a Tauri window the card falls back to a single line, because the
 * server is a shell feature that does not exist in a plain browser.
 */

import { useEffect, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Disclosure } from '@/components/ui/Disclosure';
import { Select } from '@/components/ui/Select';
import { CopyButton } from '@/features/settings/mcp/CopyButton';
import { useMcpStore, pendingClients } from '@/features/settings/mcp/useMcpStore';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { cn } from '@/lib/cn';
import { inShell } from '@/lib/tauri';
import type { McpClient, McpSession, McpTransport } from '@/types/mcp';

/**
 * How many full minutes have elapsed since an epoch-ms timestamp.
 *
 * @param epochMs - The timestamp to measure from.
 * @returns Whole minutes elapsed, at least zero.
 */
function minutesAgo(epochMs: number): number {
  return Math.max(0, Math.floor((Date.now() - epochMs) / 60_000));
}

/**
 * The MCP server card in the Settings screen.
 *
 * Reads the store directly, so the screen can mount it as `<McpCard />` with
 * nothing to wire up.
 *
 * @returns The card.
 */
export default function McpCard(): ReactElement {
  const { t, i18n } = useTranslation('settings');
  const translateError = useErrorMessage();

  const status = useMcpStore((s) => s.status);
  const clients = useMcpStore((s) => s.clients);
  const manualConfig = useMcpStore((s) => s.manualConfig);
  const loading = useMcpStore((s) => s.loading);
  const error = useMcpStore((s) => s.error);
  const refresh = useMcpStore((s) => s.refresh);
  const recheck = useMcpStore((s) => s.recheck);
  const setTransport = useMcpStore((s) => s.setTransport);
  const registerClient = useMcpStore((s) => s.register);
  const unregisterClient = useMcpStore((s) => s.unregister);
  const configureAllDetected = useMcpStore((s) => s.configureAllDetected);
  const loadManualConfig = useMcpStore((s) => s.loadManualConfig);
  const subscribe = useMcpStore((s) => s.subscribe);
  const dispose = useMcpStore((s) => s.dispose);

  useEffect(() => {
    void subscribe();
    return () => {
      dispose();
    };
  }, [subscribe, dispose]);

  useEffect(() => {
    if (!inShell()) {
      return undefined;
    }
    void refresh();

    // The person is most likely coming back from quitting or reopening a
    // client, which is exactly when a registration may have changed.
    const onFocus = (): void => {
      void recheck();
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        void recheck();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, recheck]);

  // MCP failures are explained in this card's own words when it has them;
  // anything else goes through the shared error table.
  const failure =
    error === null
      ? null
      : i18n.exists(`settings:mcp.errors.${error}`)
        ? (t as unknown as (key: string) => string)(`mcp.errors.${error}`)
        : translateError(error);
  const running = status?.running === true;
  const url = status?.url ?? null;
  const sessions = status?.sessions ?? [];
  const pending = pendingClients(clients, running);

  if (!inShell()) {
    return (
      <Card title={t('mcp.title')} description={t('mcp.description')}>
        <p className="text-xs text-fg-secondary">{t('mcp.unavailable')}</p>
      </Card>
    );
  }

  return (
    <Card title={t('mcp.title')} description={t('mcp.description')}>
      <div className="flex flex-col gap-4">
        {/* Transport, state and address */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Select
              size="sm"
              layout="inline"
              label={t('mcp.transport.label')}
              value={status?.transport ?? 'off'}
              options={[
                { value: 'http', label: t('mcp.transport.http') },
                { value: 'off', label: t('mcp.transport.off') },
              ]}
              disabled={loading}
              onValueChange={(value) => {
                void setTransport(value as McpTransport);
              }}
            />
            <span className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
              <span
                aria-hidden="true"
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full transition-colors',
                  running ? 'bg-severity-success' : 'bg-fg-muted',
                )}
              />
              {running ? t('mcp.status.running') : t('mcp.status.stopped')}
            </span>
          </div>
          {running && url !== null && (
            <div className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded-sm border border-line-subtle bg-surface-content-alt px-2 py-1 font-mono text-[11px] text-fg-primary">
                {url}
              </code>
              <CopyButton
                value={url}
                label={t('mcp.copy.label')}
                copiedLabel={t('mcp.copy.copied')}
                failedLabel={t('mcp.copy.failed')}
              />
            </div>
          )}
        </div>

        {/* Sessions */}
        <Section label={t('mcp.sessions.label')}>
          {sessions.length === 0 ? (
            <p className="text-xs text-fg-muted">{t('mcp.sessions.empty')}</p>
          ) : (
            <Rows>
              {sessions.map((session) => (
                <SessionRow key={session.id} session={session} />
              ))}
            </Rows>
          )}
        </Section>

        {/* Clients */}
        <Section
          label={t('mcp.clients.label')}
          action={
            <Button
              variant="ghost"
              size="xs"
              disabled={loading || pending.length === 0}
              onClick={() => {
                void configureAllDetected();
              }}
            >
              {t('mcp.clients.configureAll')}
            </Button>
          }
        >
          <Rows>
            {clients.map((client) => (
              <ClientRow
                key={client.id}
                client={client}
                serverRunning={running}
                loading={loading}
                onRegister={() => {
                  void registerClient(client.id);
                }}
                onUnregister={() => {
                  void unregisterClient(client.id);
                }}
              />
            ))}
          </Rows>
        </Section>

        {/* Manual configuration */}
        <Disclosure
          summary={t('mcp.manual.label')}
          onOpenChange={(open) => {
            if (open) {
              void loadManualConfig();
            }
          }}
        >
          <div className="flex flex-col gap-2">
            <p className="text-xs text-fg-secondary">{t('mcp.manual.description')}</p>
            {manualConfig !== null && (
              <div className="flex items-start gap-1.5">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-line-subtle bg-surface-content-alt p-2 font-mono text-[11px] text-fg-primary">
                  {manualConfig}
                </pre>
                <CopyButton
                  value={manualConfig}
                  label={t('mcp.copy.label')}
                  copiedLabel={t('mcp.copy.copied')}
                  failedLabel={t('mcp.copy.failed')}
                />
              </div>
            )}
          </div>
        </Disclosure>

        {failure !== null && <p className="text-xs text-severity-error">{failure}</p>}
      </div>
    </Card>
  );
}

interface SectionProps {
  label: string;
  /** A control on the right of the heading, such as Configure all. */
  action?: ReactNode;
  children: ReactNode;
}

/** A small heading over a block of rows. */
function Section({ label, action, children }: SectionProps): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <p className="text-xs font-medium text-fg-secondary">{label}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

/** A bordered list whose rows are separated by hairlines. */
function Rows({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col divide-y divide-line-subtle rounded-md border border-line-subtle">
      {children}
    </div>
  );
}

interface SessionRowProps {
  session: McpSession;
}

function SessionRow({ session }: SessionRowProps): ReactElement {
  const { t } = useTranslation('settings');
  const shortId = session.id.length > 8 ? session.id.slice(0, 8) : session.id;

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-2 px-2.5 py-1 text-xs">
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-severity-success" />
      <code className="font-mono text-fg-primary">{shortId}</code>
      <span className="text-fg-muted">
        {t('mcp.sessions.connected', { minutes: minutesAgo(session.connectedAt) })}
      </span>
      {session.lastTool !== null && (
        <span className="ml-auto text-fg-secondary">
          {t('mcp.sessions.tool', { tool: session.lastTool })}
        </span>
      )}
    </div>
  );
}

interface ClientRowProps {
  client: McpClient;
  serverRunning: boolean;
  loading: boolean;
  onRegister: () => void;
  onUnregister: () => void;
}

/**
 * One client: its name, where it stands, and the one thing to do about it.
 *
 * The note under the status is the part a person acts on: Claude Desktop has
 * to be fully quit (from its tray icon, not just the window closed) for an
 * entry to load and survive, and an HTTP client cannot be registered while
 * there is no URL to write.
 */
function ClientRow({
  client,
  serverRunning,
  loading,
  onRegister,
  onUnregister,
}: ClientRowProps): ReactElement {
  const { t } = useTranslation('settings');
  const blockedByServer = client.launch === 'http' && !serverRunning;

  const state = client.registered
    ? t('mcp.clients.registered')
    : client.detected
      ? t('mcp.clients.detected')
      : t('mcp.clients.notFound');

  let note: string | null = null;
  if (client.needsRestart) {
    note = client.registered ? t('mcp.clients.restart') : t('mcp.clients.quitFirst');
  } else if (blockedByServer && client.detected && !client.registered) {
    note = t('mcp.clients.needsServer');
  }

  return (
    <div className="flex min-h-8 items-center gap-2 px-2.5 py-1 text-xs">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-fg-primary">{client.name}</span>
          <span
            className={cn(
              'transition-colors',
              client.registered ? 'text-severity-success' : 'text-fg-muted',
            )}
          >
            {state}
          </span>
        </div>
        {note !== null && <span className="text-[11px] text-severity-warning">{note}</span>}
      </div>
      {client.registered ? (
        <Button variant="ghost" size="xs" disabled={loading} onClick={onUnregister}>
          {t('mcp.clients.remove')}
        </Button>
      ) : (
        <Button
          variant="secondary"
          size="xs"
          disabled={loading || !client.detected || blockedByServer}
          onClick={onRegister}
        >
          {t('mcp.clients.register')}
        </Button>
      )}
    </div>
  );
}
