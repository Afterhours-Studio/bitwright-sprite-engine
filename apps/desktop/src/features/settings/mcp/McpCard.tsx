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
 * Shows the loopback HTTP server's state, the bearer token a user pastes into
 * their own client, the sessions that are attached right now, the clients the
 * shell can configure, and a manual snippet for clients it cannot write to.
 *
 * The card is self-contained: it mounts the store, subscribes to events, and
 * tears everything down on unmount. The screen only has to render it.
 *
 * Outside a Tauri window the card falls back to a single line, because the
 * server is a shell feature that does not exist in a plain browser.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import type { Segment } from '@/components/ui/SegmentedTabs';
import { CopyButton } from '@/features/settings/mcp/CopyButton';
import { useMcpStore, pendingClients } from '@/features/settings/mcp/useMcpStore';
import { useErrorMessage } from '@/hooks/useErrorMessage';
import { inShell } from '@/lib/tauri';
import type { McpClientId, McpSession } from '@/types/mcp';

/** The transport tabs, in the order the user reaches for them. */
const TRANSPORT_SEGMENTS: Segment[] = [
  { value: 'http', label: 'HTTP Local' },
  { value: 'off', label: 'Off' },
];

/**
 * Masks a bearer token so only the last four characters are visible.
 *
 * @param token - The full token.
 * @returns The masked form.
 */
function maskToken(token: string): string {
  return `\u2022\u2022\u2022\u2022${token.slice(-4)}`;
}

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
  const { t } = useTranslation('settings');
  const translateError = useErrorMessage();

  const status = useMcpStore((s) => s.status);
  const clients = useMcpStore((s) => s.clients);
  const manualConfig = useMcpStore((s) => s.manualConfig);
  const loading = useMcpStore((s) => s.loading);
  const error = useMcpStore((s) => s.error);
  const refresh = useMcpStore((s) => s.refresh);
  const setTransport = useMcpStore((s) => s.setTransport);
  const regenerateToken = useMcpStore((s) => s.regenerateToken);
  const registerClient = useMcpStore((s) => s.register);
  const unregisterClient = useMcpStore((s) => s.unregister);
  const configureAllDetected = useMcpStore((s) => s.configureAllDetected);
  const loadManualConfig = useMcpStore((s) => s.loadManualConfig);
  const subscribe = useMcpStore((s) => s.subscribe);
  const dispose = useMcpStore((s) => s.dispose);

  const [tokenRevealed, setTokenRevealed] = useState(false);

  useEffect(() => {
    void subscribe();
    return () => {
      dispose();
    };
  }, [subscribe, dispose]);

  useEffect(() => {
    if (inShell()) {
      void refresh();
    }
  }, [refresh]);

  const failure = translateError(error);
  const running = status?.running === true;
  const url = status?.url ?? null;
  const token = status?.token ?? null;
  const sessions = status?.sessions ?? [];
  const pending = pendingClients(clients);

  if (!inShell()) {
    return (
      <Card title={t('mcp.title')} description={t('mcp.description')}>
        <p className="text-xs text-fg-secondary">{t('mcp.unavailable')}</p>
      </Card>
    );
  }

  return (
    <Card title={t('mcp.title')} description={t('mcp.description')}>
      <div className="flex flex-col gap-3">
        {/* Transport */}
        <SegmentedTabs
          segments={TRANSPORT_SEGMENTS.map((segment) => ({
            ...segment,
            label: t(
              ('mcp.transport.' + segment.value) as 'mcp.transport.http' | 'mcp.transport.off',
            ),
          }))}
          value={status?.transport ?? 'off'}
          label={t('mcp.transport.label')}
          onValueChange={(value) => {
            void setTransport(value as 'http' | 'off');
          }}
        />

        {/* Status */}
        <div className="flex flex-wrap items-center gap-2">
          <Pill active={running}>
            {running ? t('mcp.status.running') : t('mcp.status.stopped')}
          </Pill>
          {running && url !== null && (
            <CopyButton
              value={url}
              label={url}
              copiedLabel={t('mcp.copy.copied')}
              failedLabel={t('mcp.copy.failed')}
            />
          )}
        </div>

        {/* Token */}
        {token !== null && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-fg-secondary">{t('mcp.token.label')}:</span>
            <code className="rounded bg-surface-content-alt px-2 py-1 text-xs text-fg-primary">
              {tokenRevealed ? token : maskToken(token)}
            </code>
            <Button
              variant="ghost"
              className="px-2 py-1 text-xs"
              onClick={() => {
                setTokenRevealed(!tokenRevealed);
              }}
            >
              {tokenRevealed ? t('mcp.token.hide') : t('mcp.token.reveal')}
            </Button>
            <CopyButton
              value={token}
              label={t('mcp.copy.label')}
              copiedLabel={t('mcp.copy.copied')}
              failedLabel={t('mcp.copy.failed')}
            />
            <Button
              variant="ghost"
              className="px-2 py-1 text-xs"
              disabled={loading}
              onClick={() => {
                void regenerateToken();
              }}
            >
              {t('mcp.token.regenerate')}
            </Button>
          </div>
        )}

        {/* Sessions */}
        <div>
          <p className="mb-1 text-xs font-medium text-fg-secondary">{t('mcp.sessions.label')}</p>
          {sessions.length === 0 ? (
            <p className="text-xs text-fg-secondary">{t('mcp.sessions.empty')}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {sessions.map((session) => (
                <SessionRow key={session.id} session={session} />
              ))}
            </div>
          )}
        </div>

        {/* Clients */}
        <div>
          <p className="mb-1 text-xs font-medium text-fg-secondary">{t('mcp.clients.label')}</p>
          <Button
            variant="secondary"
            className="mb-2 px-3 py-1 text-xs"
            disabled={loading || pending.length === 0}
            onClick={() => {
              void configureAllDetected();
            }}
          >
            {t('mcp.clients.configureAll')}
          </Button>
          <div className="flex flex-col gap-1">
            {clients.map((client) => (
              <ClientRow
                key={client.id}
                id={client.id}
                name={client.name}
                detected={client.detected}
                registered={client.registered}
                loading={loading}
                onRegister={() => {
                  void registerClient(client.id);
                }}
                onUnregister={() => {
                  void unregisterClient(client.id);
                }}
              />
            ))}
          </div>
        </div>

        {/* Manual configuration */}
        <ManualSnippet
          onReveal={() => {
            void loadManualConfig();
          }}
          manualConfig={manualConfig}
        />

        {failure !== null && <p className="text-xs text-fg-secondary">{failure}</p>}
      </div>
    </Card>
  );
}

interface SessionRowProps {
  session: McpSession;
}

function SessionRow({ session }: SessionRowProps): ReactElement {
  const { t } = useTranslation('settings');
  const shortId = session.id.length > 8 ? session.id.slice(0, 8) : session.id;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-line-subtle bg-surface-content-alt px-2 py-1 text-xs">
      <code className="text-fg-primary">{shortId}</code>
      <span className="text-fg-secondary">
        {t('mcp.sessions.connected', { minutes: minutesAgo(session.connectedAt) })}
      </span>
      {session.lastTool !== null && (
        <span className="text-fg-secondary">
          {t('mcp.sessions.tool', { tool: session.lastTool })}
        </span>
      )}
    </div>
  );
}

interface ClientRowProps {
  id: McpClientId;
  name: string;
  detected: boolean;
  registered: boolean;
  loading: boolean;
  onRegister: () => void;
  onUnregister: () => void;
}

function ClientRow({
  name,
  detected,
  registered,
  loading,
  onRegister,
  onUnregister,
}: ClientRowProps): ReactElement {
  const { t } = useTranslation('settings');

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-line-subtle bg-surface-content-alt px-2 py-1 text-xs">
      <span className="text-fg-primary">{name}</span>
      <Pill active={detected}>
        {detected ? t('mcp.clients.detected') : t('mcp.clients.notFound')}
      </Pill>
      <span className="text-fg-secondary">{registered ? t('mcp.clients.registered') : ''}</span>
      {registered ? (
        <Button
          variant="ghost"
          className="px-2 py-1 text-xs"
          disabled={loading}
          onClick={onUnregister}
        >
          {t('mcp.clients.remove')}
        </Button>
      ) : (
        <Button
          variant="ghost"
          className="px-2 py-1 text-xs"
          disabled={loading || !detected}
          onClick={onRegister}
        >
          {t('mcp.clients.register')}
        </Button>
      )}
    </div>
  );
}

interface ManualSnippetProps {
  onReveal: () => void;
  manualConfig: string | null;
}

function ManualSnippet({ onReveal, manualConfig }: ManualSnippetProps): ReactElement {
  const { t } = useTranslation('settings');
  const [open, setOpen] = useState(false);

  return (
    <details
      open={open}
      onToggle={(event) => {
        const nextOpen = (event.target as HTMLDetailsElement).open;
        setOpen(nextOpen);
        if (nextOpen) {
          onReveal();
        }
      }}
    >
      <summary className="cursor-pointer text-xs font-medium text-fg-secondary">
        {t('mcp.manual.label')}
      </summary>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-xs text-fg-secondary">{t('mcp.manual.description')}</p>
          {manualConfig !== null && (
            <>
              <pre className="overflow-x-auto rounded bg-surface-content-alt p-2 text-xs text-fg-primary">
                {manualConfig}
              </pre>
              <CopyButton
                value={manualConfig}
                label={t('mcp.copy.label')}
                copiedLabel={t('mcp.copy.copied')}
                failedLabel={t('mcp.copy.failed')}
              />
            </>
          )}
        </div>
      )}
    </details>
  );
}
