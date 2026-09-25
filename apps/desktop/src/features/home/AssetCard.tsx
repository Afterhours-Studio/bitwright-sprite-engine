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
 * One sprite on the home screen, as a card in the grid or a row in the list.
 *
 * The card is not one big button. Opening, renaming and deleting are three
 * different acts, and a button cannot contain buttons, so the thumbnail is the
 * open control and the two hover actions sit beside it in the same box.
 */

import { Pencil, Trash2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { AssetThumbnail } from '@/features/home/AssetThumbnail';
import { formatRelative } from '@/features/home/relativeTime';
import type { Asset } from '@/types/document';

export interface AssetItemProps {
  /** The sprite shown. */
  asset: Asset;
  /** The name of the project it belongs to, shown in the list. */
  projectName?: string | undefined;
  /** Opens the sprite in the editor. */
  onOpen: (asset: Asset) => void;
  /** Asks to rename it. */
  onRename: (asset: Asset) => void;
  /** Asks to delete it; the caller confirms first. */
  onDelete: (asset: Asset) => void;
}

/** One sprite as a card in the grid. */
export function AssetCard({ asset, onOpen, onRename, onDelete }: AssetItemProps): ReactElement {
  const { t, i18n } = useTranslation('home');
  const { t: tp } = useTranslation('projects');

  return (
    <div className="group flex min-w-0 flex-col gap-1.5">
      <div className="relative aspect-square bg-studio-card border border-neutral-800/80 hover:border-pink-500/50 rounded overflow-hidden flex items-center justify-center p-3">
        <button
          type="button"
          aria-label={t('card.open', { name: asset.name })}
          onClick={() => {
            onOpen(asset);
          }}
          className="checkerboard-pattern absolute inset-0 flex items-center justify-center p-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pink-500"
        >
          <AssetThumbnail
            asset={asset}
            className="transition-transform duration-150 group-hover:scale-105"
          />
        </button>
        <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[9px] text-neutral-300 border border-neutral-700/50">
          {t('card.size', { width: asset.width, height: asset.height })}
        </span>
        <span className="pointer-events-none absolute top-1.5 right-1.5 rounded bg-pink-950/80 px-1.5 py-0.5 text-[9px] font-medium text-pink-400 border border-pink-700/50">
          {tp(`steps.${asset.step}`)}
        </span>
        <div className="absolute bottom-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            aria-label={t('card.rename', { name: asset.name })}
            title={t('card.rename', { name: asset.name })}
            onClick={() => {
              onRename(asset);
            }}
            className="rounded bg-black/75 p-1 text-neutral-300 border border-neutral-700/50 hover:text-white"
          >
            <Pencil className="w-3 h-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t('card.delete', { name: asset.name })}
            title={t('card.delete', { name: asset.name })}
            onClick={() => {
              onDelete(asset);
            }}
            className="rounded bg-black/75 p-1 text-neutral-300 border border-neutral-700/50 hover:text-red-400"
          >
            <Trash2 className="w-3 h-3" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-neutral-300 group-hover:text-pink-500 truncate">{asset.name}</p>
        <p className="text-[11px] text-neutral-500">
          {formatRelative(asset.updatedAt, Date.now(), i18n.language)}
        </p>
      </div>
    </div>
  );
}

/** One sprite as a row of the list view's table. */
export function AssetRow({
  asset,
  projectName,
  onOpen,
  onRename,
  onDelete,
}: AssetItemProps): ReactElement {
  const { t, i18n } = useTranslation('home');
  const { t: tp } = useTranslation('projects');

  return (
    <tr className="group border-b border-neutral-800/60 hover:bg-neutral-800/30">
      <td className="py-1.5 pr-3">
        <button
          type="button"
          aria-label={t('card.open', { name: asset.name })}
          onClick={() => {
            onOpen(asset);
          }}
          className="flex min-w-0 items-center gap-2.5 text-left"
        >
          <span className="checkerboard-pattern flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-neutral-800/80 bg-studio-card p-0.5">
            <AssetThumbnail asset={asset} />
          </span>
          <span className="truncate text-xs text-neutral-300 group-hover:text-pink-500">
            {asset.name}
          </span>
        </button>
      </td>
      <td className="py-1.5 pr-3 text-neutral-500">{projectName ?? ''}</td>
      <td className="py-1.5 pr-3 text-neutral-400">
        {t('card.size', { width: asset.width, height: asset.height })}
      </td>
      <td className="py-1.5 pr-3 text-neutral-400">{tp(`kinds.${asset.kind}`)}</td>
      <td className="py-1.5 pr-3 text-pink-400">{tp(`steps.${asset.step}`)}</td>
      <td className="py-1.5 pr-3 text-neutral-500">
        {formatRelative(asset.updatedAt, Date.now(), i18n.language)}
      </td>
      <td className="py-1.5 text-right">
        <div className="inline-flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            aria-label={t('card.rename', { name: asset.name })}
            title={t('card.rename', { name: asset.name })}
            onClick={() => {
              onRename(asset);
            }}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t('card.delete', { name: asset.name })}
            title={t('card.delete', { name: asset.name })}
            onClick={() => {
              onDelete(asset);
            }}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-red-400"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </td>
    </tr>
  );
}
