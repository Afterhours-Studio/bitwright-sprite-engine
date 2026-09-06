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
 * What has been downloaded, and how it ended.
 *
 * Transfers in flight are not kept here. They are already reported by the
 * stores that own them - the model list and the runtime state - and copying a
 * moving number into a second place is how two parts of one screen come to
 * disagree. This store holds only the record of transfers that have finished,
 * which nothing else remembers once they leave.
 *
 * It is written to storage so that closing the application does not erase it.
 * A transfer that failed overnight is exactly what someone comes back to look
 * for.
 */

import { create } from 'zustand';

import { loadList, saveList, STORAGE_KEYS } from '@/lib/persist';

/**
 * How many finished transfers are kept.
 *
 * Ten. A download record is read to answer "did that finish, and if not why",
 * which is a question about the last few, not about the last hundred.
 */
export const DOWNLOAD_HISTORY_LIMIT = 10;

/** How a transfer ended. */
export type DownloadOutcome = 'done' | 'failed' | 'cancelled';

/** One finished transfer. */
export interface DownloadRecord {
  /** Stable identifier, and the React key. */
  id: string;
  /** What was being fetched, already translated: a model or package name. */
  name: string;
  /** How it ended. */
  outcome: DownloadOutcome;
  /** Stable reason code when it failed, empty otherwise. */
  error: string;
  /** Bytes the transfer covered, or zero when it was never known. */
  bytes: number;
  /** When it ended, as a timestamp. */
  at: number;
}

interface DownloadState {
  /** Finished transfers, newest first. */
  history: DownloadRecord[];
  /** Records one, keeping the newest {@link DOWNLOAD_HISTORY_LIMIT}. */
  record: (entry: Omit<DownloadRecord, 'id' | 'at'>) => void;
  /** Forgets every finished transfer. */
  clear: () => void;
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  history: loadList<DownloadRecord>(STORAGE_KEYS.downloads, DOWNLOAD_HISTORY_LIMIT),

  record: (entry) => {
    const at = Date.now();
    const record: DownloadRecord = { ...entry, id: `${entry.name}-${String(at)}`, at };
    // The same transfer can be reported twice in quick succession, because the
    // poll that notices it finished may run again before the flag it read has
    // been cleared. A repeat of the newest entry is dropped rather than filed.
    const [newest] = get().history;
    if (newest !== undefined && newest.name === record.name && newest.outcome === record.outcome) {
      return;
    }
    const history = [record, ...get().history].slice(0, DOWNLOAD_HISTORY_LIMIT);
    set({ history });
    saveList(STORAGE_KEYS.downloads, history, DOWNLOAD_HISTORY_LIMIT);
  },

  clear: () => {
    set({ history: [] });
    saveList(STORAGE_KEYS.downloads, [], DOWNLOAD_HISTORY_LIMIT);
  },
}));
