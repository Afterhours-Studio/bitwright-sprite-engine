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
 * Home's left column: whether an agent is attached, the three ways to start
 * something, the sections, and the language.
 *
 * WHY THE AGENT CARD COMES FIRST
 *
 * Drawing here is done as often by an agent over MCP as by hand, and an agent
 * that is not attached is the one thing that makes half of the application
 * silently do nothing. It is the first thing in the column so that state is
 * read before anything is started.
 */

import {
  Bot,
  Folder,
  FolderPlus,
  House,
  ImagePlus,
  Images,
  Languages,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { NewProjectDialog } from '@/features/home/NameDialogs';
import { pngToPixel } from '@/features/home/pngToPixel';
import { useMcpStore } from '@/features/settings/mcp/useMcpStore';
import { cn } from '@/lib/cn';
import { LANGUAGES, setLanguage, type Language } from '@/lib/i18n';
import { inShell } from '@/lib/tauri';
import { useProjectStore } from '@/stores/useProjectStore';
import { useShellStore } from '@/stores/useShellStore';
import { DEFAULT_PRESET } from '@/types/document';

/** The sections home's navigation lists. */
export type HomeView = 'recent' | 'projects' | 'settings';

export interface HomeSidebarProps {
  /** Which section is showing. */
  active: HomeView;
  /** Called when a section is chosen. */
  onNavigate: (view: HomeView) => void;
}

const NAV: readonly { view: HomeView; icon: LucideIcon }[] = [
  { view: 'recent', icon: House },
  { view: 'projects', icon: Folder },
  { view: 'settings', icon: Settings },
];

/**
 * The copyright sign, passed into the footer line rather than written in the
 * locale files: it is the same mark in every language, and Unicode files it
 * under the pictographic characters the locale check keeps out of translations.
 */
const COPYRIGHT_SIGN = '©';

const ACTION =
  'group w-full flex items-center space-x-2.5 px-3 py-2 rounded bg-neutral-800/40 border border-neutral-800/40 hover:bg-neutral-700/40 text-neutral-400 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50';

/** Home's sidebar. */
export function HomeSidebar({ active, onNavigate }: HomeSidebarProps): ReactElement {
  const { t, i18n } = useTranslation('home');
  const { t: tc } = useTranslation('common');
  const languageId = useId();

  const status = useMcpStore((state) => state.status);
  const refresh = useMcpStore((state) => state.refresh);
  const subscribe = useMcpStore((state) => state.subscribe);
  const dispose = useMcpStore((state) => state.dispose);

  const setScreen = useShellStore((state) => state.setScreen);
  const setNewSpriteOpen = useShellStore((state) => state.setNewSpriteOpen);
  const appVersion = useShellStore((state) => state.appVersion);

  const projects = useProjectStore((state) => state.projects);
  const projectId = useProjectStore((state) => state.projectId);
  const presets = useProjectStore((state) => state.presets);

  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    // Outside a shell there is no server to ask, and asking would only record
    // `shell.unavailable` as the MCP panel's error.
    if (!inShell()) {
      return;
    }
    void refresh();
    void subscribe();
    return () => {
      dispose();
    };
  }, [refresh, subscribe, dispose]);

  const connected = (status?.sessions.length ?? 0) > 0;
  // The selected project if there is one, else the first: PNG to Pixel is a
  // one-click action and asking which project first would make it two.
  const target = projects.find((project) => project.id === projectId) ?? projects[0] ?? null;
  const language: Language = LANGUAGES.find((code) => code === i18n.language) ?? 'en';

  const convert = async (): Promise<void> => {
    if (target === null) {
      return;
    }
    setConverting(true);
    const asset = await pngToPixel(target.id, presets[target.id] ?? DEFAULT_PRESET);
    setConverting(false);
    if (asset !== null) {
      setScreen('editor');
    }
  };

  return (
    <aside
      aria-label={t('sidebar.label')}
      className="w-56 md:w-60 bg-studio-home-side border-r border-neutral-800/80 pt-5 px-5 pb-5 flex flex-col shrink-0"
    >
      <div className="bg-neutral-800/40 border border-neutral-800/40 hover:bg-neutral-700/40 rounded p-3 mb-5 flex flex-col gap-2.5 shadow-sm">
        <div className="flex items-center gap-2.5" role="status">
          <span className="w-8 h-8 rounded-full bg-neutral-700/40 flex items-center justify-center shrink-0">
            <Bot
              className={cn('w-4 h-4', connected ? 'text-emerald-400' : 'text-neutral-400')}
              aria-hidden="true"
            />
          </span>
          <span className="text-xs font-semibold text-neutral-300">
            {connected ? t('sidebar.agentConnected') : t('sidebar.agentDisconnected')}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setScreen('settings');
          }}
          className="w-full py-1.5 px-2 rounded bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-semibold text-[11px]"
        >
          {connected ? t('sidebar.manageAgent') : t('sidebar.connectAgent')}
        </button>
      </div>

      <div className="space-y-1 mb-4" role="group" aria-label={t('sidebar.actions')}>
        <button
          type="button"
          className={ACTION}
          onClick={() => {
            setNewSpriteOpen(true);
          }}
        >
          <ImagePlus className="w-4 h-4 group-hover:text-pink-400" aria-hidden="true" />
          <span>{t('sidebar.newSprite')}</span>
        </button>
        <button
          type="button"
          className={ACTION}
          onClick={() => {
            setNewProjectOpen(true);
          }}
        >
          <FolderPlus className="w-4 h-4 group-hover:text-pink-400" aria-hidden="true" />
          <span>{t('sidebar.newProject')}</span>
        </button>
        <button
          type="button"
          className={ACTION}
          disabled={target === null || converting}
          title={target === null ? t('sidebar.pngToPixelHint') : undefined}
          onClick={() => {
            void convert();
          }}
        >
          <Images className="w-4 h-4 group-hover:text-pink-400" aria-hidden="true" />
          <span>{t('sidebar.pngToPixel')}</span>
        </button>
      </div>

      <div className="border-t border-neutral-800/80 my-3" />

      <nav aria-label={t('sidebar.nav')} className="space-y-1">
        {NAV.map(({ view, icon: Icon }) => {
          const on = view === active;
          return (
            <button
              key={view}
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => {
                onNavigate(view);
              }}
              className={cn(
                'w-full flex items-center space-x-2.5 px-3 py-2 rounded text-xs',
                on
                  ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white font-semibold shadow-xs'
                  : 'bg-neutral-800/30 border border-transparent hover:bg-neutral-800/60 text-neutral-400 hover:text-neutral-100',
              )}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              <span>{t(`sidebar.${view}`)}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto pt-4">
        <label
          htmlFor={languageId}
          className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-neutral-500"
        >
          <Languages className="h-3.5 w-3.5" aria-hidden="true" />
          {tc('language.label')}
        </label>
        <select
          id={languageId}
          value={language}
          onChange={(event) => {
            const next = LANGUAGES.find((code) => code === event.target.value);
            if (next !== undefined) {
              void setLanguage(next);
            }
          }}
          className="w-full rounded border border-neutral-800 bg-neutral-900/70 px-3 py-2 pr-8 text-xs text-neutral-300 focus:border-pink-500 focus:outline-none"
        >
          {LANGUAGES.map((code) => (
            <option key={code} value={code}>
              {tc(`language.${code}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 pt-4 border-t border-neutral-800/60 text-[11px] text-neutral-500">
        <p>{t('sidebar.copyright', { mark: COPYRIGHT_SIGN })}</p>
        <p className="text-[10px] text-neutral-600">
          {t('sidebar.studio', { version: appVersion })}
        </p>
      </div>

      <NewProjectDialog
        open={newProjectOpen}
        onClose={() => {
          setNewProjectOpen(false);
        }}
      />
    </aside>
  );
}
