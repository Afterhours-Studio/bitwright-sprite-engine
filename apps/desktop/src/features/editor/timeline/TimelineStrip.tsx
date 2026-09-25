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
 * The timeline strip: the open sprite's frames, their timing and playback,
 * laid out as the reference studio's own timeline (see "Timeline strip" in
 * `docs/architecture/animation.md`).
 *
 * EVERYTHING HERE GOES THROUGH `useAnimationStore`. The strip holds no
 * animation of its own; a control calls the store and the store's answer, or
 * an agent's `document://animation`, redraws the strip. The only local state
 * is what a person is in the middle of typing or dragging, because a duration
 * half typed is not yet a duration and must not be sent.
 *
 * THE CURRENT CARD IS THE OPEN FRAME, NOT THE PLAYHEAD. Playback is a view:
 * the editor stays on the open frame while the preview cycles, so the ring
 * stays where the next stroke will land and the bar's preview is what moves.
 *
 * DELETE ASKS FIRST. A frame is a whole asset with its own edit history, and
 * deleting one cannot be undone from the frame that replaces it, so the
 * confirmation says what goes. The last frame cannot be deleted at all -
 * `frame_delete` refuses it - and the button says so rather than failing.
 */

import { ChevronLeft, ChevronRight, Copy, Eye, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from '@/components/ui/Dialog';
import { useWorkflowLabels } from '@/features/editor/labels';
import { FrameThumbnail } from '@/features/editor/timeline/FrameThumbnail';
import { cn } from '@/lib/cn';
import { useAnimationStore } from '@/stores/useAnimationStore';
import { useDocumentStore } from '@/stores/useDocumentStore';
import {
  FRAME_DURATION_MAX,
  FRAME_DURATION_MIN,
  PLAYBACKS,
  type Frame,
  type Playback,
} from '@/types/animation';

/** The slowest and fastest the FPS slider offers. */
const FPS_MIN = 1;
const FPS_MAX = 24;

/** The glyph each playback mode is drawn with, as in the reference. */
const PLAYBACK_GLYPHS: Readonly<Record<Playback, string>> = {
  forward: '→',
  reverse: '←',
  pingpong: '↔',
};

/** Every card's frame; the state adds its border, fill and ring. */
const CARD =
  'group relative flex flex-shrink-0 flex-col items-center cursor-pointer rounded p-1 border';

/** The small square buttons at the end of the bar. */
const ICON_BUTTON =
  'p-1 rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:pointer-events-none disabled:opacity-40';

/** The move buttons in a card's hover footer. */
const MOVE_BUTTON =
  'rounded p-0.5 text-neutral-300 hover:bg-neutral-800 hover:text-white disabled:pointer-events-none disabled:opacity-30';

/**
 * The frames per second a duration amounts to, as the slider can show it.
 *
 * @param ms - A frame's duration.
 * @returns The nearest whole FPS between 1 and 24.
 */
function fpsOf(ms: number): number {
  return Math.min(FPS_MAX, Math.max(FPS_MIN, Math.round(1000 / ms)));
}

/**
 * Clamps a typed duration to what a frame may last.
 *
 * @param ms - The number typed.
 * @returns It, rounded and held to 10..=10000.
 */
function clampDuration(ms: number): number {
  return Math.min(FRAME_DURATION_MAX, Math.max(FRAME_DURATION_MIN, Math.round(ms)));
}

/**
 * The timeline strip.
 *
 * Fills the full width of the region it is mounted in, at a fixed `h-40`. It
 * clips nothing but its own row of cards, so a popover opened above it by a
 * neighbour is not cut off.
 *
 * @returns The playback bar, and one card per frame with an Add button.
 */
export function TimelineStrip(): ReactElement {
  const { t } = useTranslation('timeline');
  const labels = useWorkflowLabels();

  const animation = useAnimationStore((state) => state.animation);
  const playing = useAnimationStore((state) => state.playing);
  const playhead = useAnimationStore((state) => state.playhead);
  const onionSkin = useAnimationStore((state) => state.onionSkin);
  const add = useAnimationStore((state) => state.add);
  const remove = useAnimationStore((state) => state.remove);
  const move = useAnimationStore((state) => state.move);
  const setDuration = useAnimationStore((state) => state.setDuration);
  const setFps = useAnimationStore((state) => state.setFps);
  const setPlayback = useAnimationStore((state) => state.setPlayback);
  const play = useAnimationStore((state) => state.play);
  const pause = useAnimationStore((state) => state.pause);
  const toggleOnionSkin = useAnimationStore((state) => state.toggleOnionSkin);
  const select = useAnimationStore((state) => state.select);

  const openId = useDocumentStore((state) => state.assetId);
  const seq = useDocumentStore((state) => state.seq);

  const frames = animation?.frames ?? [];
  const openIndex = Math.max(
    0,
    frames.findIndex((frame) => frame.assetId === openId),
  );
  const openFrame: Frame | undefined = frames[openIndex];
  const shownIndex = playing && frames[playhead] !== undefined ? playhead : openIndex;
  const shown: Frame | undefined = frames[shownIndex];

  const [durationDraft, setDurationDraft] = useState('');
  const [fpsDraft, setFpsDraft] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const openDuration = openFrame?.durationMs;
  useEffect(() => {
    // A new frame opened, or the duration changed underneath the field (an
    // agent, or the FPS slider): whatever was half typed no longer applies.
    setDurationDraft(openDuration === undefined ? '' : String(openDuration));
  }, [openFrame?.assetId, openDuration]);

  /**
   * The revision a frame's composite is cached under. The open frame's also
   * carries the op log sequence, which moves on every stroke, so its card
   * follows the drawing rather than waiting for the row to be re-read.
   */
  const revisionOf = (frame: Frame): string =>
    frame.assetId === openId ? `${frame.updatedAt}:${seq}` : String(frame.updatedAt);

  if (animation === null || openFrame === undefined || shown === undefined) {
    return (
      <section
        aria-label={t('label')}
        className="h-40 w-full bg-neutral-950 border-t border-neutral-800 flex flex-col shrink-0 select-none"
      >
        <div className="h-10 px-3 border-b border-neutral-800/80 bg-neutral-900/50 flex items-center text-xs text-neutral-300">
          <p className="text-[11px] text-neutral-400">{t('noDocument')}</p>
        </div>
      </section>
    );
  }

  const commitDuration = (): void => {
    const typed = Number.parseInt(durationDraft, 10);
    if (!Number.isFinite(typed)) {
      setDurationDraft(String(openFrame.durationMs));
      return;
    }
    const ms = clampDuration(typed);
    setDurationDraft(String(ms));
    if (ms !== openFrame.durationMs) {
      void setDuration(openFrame.assetId, ms);
    }
  };

  const onDurationKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitDuration();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      // Handled here, so the Escape that reverts a field does not also close
      // whatever the strip is mounted in.
      event.stopPropagation();
      setDurationDraft(String(openFrame.durationMs));
    }
  };

  const fps = fpsDraft ?? fpsOf(openFrame.durationMs);
  const lastFrame = frames.length <= 1;

  return (
    <section
      aria-label={t('label')}
      className="h-40 w-full bg-neutral-950 border-t border-neutral-800 flex flex-col shrink-0 select-none"
    >
      <div className="h-10 px-3 border-b border-neutral-800/80 bg-neutral-900/50 flex items-center justify-between gap-3 text-xs text-neutral-300">
        <div className="flex min-w-0 items-center space-x-2">
          <span className="text-[11px] text-neutral-400">{t('playback')}</span>
          <div
            role="group"
            aria-label={t('playbackModes')}
            className="flex bg-neutral-900 border border-neutral-800 rounded p-0.5"
          >
            {PLAYBACKS.map((mode) => {
              const on = animation.playback === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  aria-label={t(mode)}
                  title={t(mode)}
                  aria-pressed={on}
                  className={cn(
                    'w-6 h-5 rounded text-[11px] font-semibold',
                    on
                      ? 'bg-pink-600 text-white'
                      : 'text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800',
                  )}
                  onClick={() => {
                    if (!on) {
                      void setPlayback(mode);
                    }
                  }}
                >
                  {PLAYBACK_GLYPHS[mode]}
                </button>
              );
            })}
          </div>

          <div className="flex min-w-0 items-center gap-2 pl-2 border-l border-neutral-800">
            <div
              role="img"
              aria-label={t('preview')}
              className="w-6 h-6 shrink-0 rounded bg-neutral-900 border border-neutral-700 checkerboard-pattern p-0.5"
            >
              <FrameThumbnail assetId={shown.assetId} revision={revisionOf(shown)} />
            </div>
            <span className="whitespace-nowrap text-[11px] text-neutral-400">
              {t('frameOf', { index: shownIndex + 1, count: frames.length })}
            </span>
            <span className="truncate text-[11px] font-medium text-pink-400">{shown.name}</span>
          </div>

          <label className="flex items-center gap-2 pl-3 border-l border-neutral-800">
            <span className="text-[11px] font-medium text-neutral-400">{t('fps')}</span>
            <input
              type="range"
              min={FPS_MIN}
              max={FPS_MAX}
              step={1}
              value={fps}
              aria-label={t('fpsLabel')}
              className="w-20 h-1.5 bg-neutral-800 accent-pink-500"
              onChange={(event) => {
                const next = Number(event.target.value);
                setFpsDraft(next);
                void setFps(next).finally(() => {
                  setFpsDraft(null);
                });
              }}
            />
            <span className="text-[11px] tabular-nums text-neutral-200 w-10">
              {t('fpsValue', { fps })}
            </span>
          </label>

          <label className="flex items-center gap-1.5 pl-3 border-l border-neutral-800">
            <span className="text-[11px] font-medium text-neutral-400">{t('frameDuration')}</span>
            <input
              type="text"
              inputMode="numeric"
              value={durationDraft}
              aria-label={t('frameDurationLabel', {
                min: FRAME_DURATION_MIN,
                max: FRAME_DURATION_MAX,
              })}
              className="w-14 bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5 text-[11px] tabular-nums text-neutral-200 focus:border-pink-500 focus:outline-none"
              onChange={(event) => {
                setDurationDraft(event.target.value);
              }}
              onKeyDown={onDurationKey}
              onBlur={commitDuration}
            />
            <span className="text-[11px] text-neutral-500">{t('ms')}</span>
          </label>
        </div>

        <div className="flex shrink-0 items-center space-x-2">
          <button
            type="button"
            aria-pressed={playing}
            className="flex items-center gap-1.5 px-3 py-1 rounded font-semibold text-xs bg-pink-600 hover:bg-pink-500 border border-pink-500 text-white shadow-sm shadow-pink-600/30"
            onClick={() => {
              if (playing) {
                pause();
              } else {
                play();
              }
            }}
          >
            {playing ? (
              <Pause aria-hidden="true" className="h-3 w-3" />
            ) : (
              <Play aria-hidden="true" className="h-3 w-3 fill-current" />
            )}
            {playing ? t('pause') : t('play')}
          </button>
          <button
            type="button"
            aria-pressed={onionSkin}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border',
              onionSkin
                ? 'bg-sky-600 text-white border-sky-400'
                : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-neutral-200',
            )}
            onClick={toggleOnionSkin}
          >
            <Eye aria-hidden="true" className="h-3.5 w-3.5" />
            {t('onionSkin')}
          </button>
          <span aria-hidden="true" className="h-4 w-px bg-neutral-800" />
          <button
            type="button"
            aria-label={t('duplicate')}
            title={t('duplicate')}
            className={ICON_BUTTON}
            onClick={() => {
              void add(true);
            }}
          >
            <Copy aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={t('delete')}
            title={lastFrame ? t('deleteLast') : t('delete')}
            disabled={lastFrame}
            className={cn(ICON_BUTTON, 'hover:text-red-400')}
            onClick={() => {
              setConfirmingDelete(true);
            }}
          >
            <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <ol
        aria-label={t('frames')}
        className="flex-1 overflow-x-auto p-3 flex items-center space-x-2.5"
      >
        {frames.map((frame, index) => {
          const current = index === openIndex;
          const number = index + 1;
          return (
            <li
              key={frame.assetId}
              aria-current={current ? 'true' : undefined}
              className={cn(
                CARD,
                current
                  ? 'bg-neutral-900 border-pink-500 shadow-md shadow-pink-500/10 ring-1 ring-pink-500'
                  : 'bg-neutral-900/60 border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900',
              )}
            >
              <button
                type="button"
                aria-label={t('openFrame', { number, name: frame.name })}
                title={frame.name}
                className="flex flex-col items-center gap-1"
                onClick={() => {
                  void select(frame.assetId);
                }}
              >
                <span className="flex w-16 items-center justify-between gap-1">
                  <span
                    className={cn(
                      'text-[10px] tabular-nums',
                      current ? 'text-pink-400 font-semibold' : 'text-neutral-500',
                    )}
                  >
                    {t('frameNumber', { number })}
                  </span>
                  <span className="truncate rounded bg-neutral-800 px-1 text-[9px] leading-tight text-neutral-400">
                    {labels.step[frame.step]}
                  </span>
                </span>
                <span className="block w-16 h-16 rounded bg-neutral-950 border border-neutral-800 checkerboard-pattern p-1">
                  <FrameThumbnail assetId={frame.assetId} revision={revisionOf(frame)} />
                </span>
              </button>
              <div className="absolute inset-x-0 bottom-0 flex justify-between rounded-b bg-gradient-to-t from-neutral-950/80 px-1 pb-1 pt-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <button
                  type="button"
                  aria-label={t('moveLeft', { number })}
                  disabled={index === 0}
                  className={MOVE_BUTTON}
                  onClick={() => {
                    void move(frame.assetId, index - 1);
                  }}
                >
                  <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={t('moveRight', { number })}
                  disabled={index === frames.length - 1}
                  className={MOVE_BUTTON}
                  onClick={() => {
                    void move(frame.assetId, index + 1);
                  }}
                >
                  <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          );
        })}
        <li className="flex-shrink-0 h-full">
          <button
            type="button"
            aria-label={t('addLabel')}
            title={t('addLabel')}
            className="flex h-full w-[76px] flex-col items-center justify-center gap-1 rounded border-2 border-dashed border-neutral-800 text-[11px] text-neutral-500 hover:border-neutral-600 hover:text-neutral-300"
            onClick={() => {
              void add(true);
            }}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            {t('add')}
          </button>
        </li>
      </ol>

      <ConfirmDialog
        open={confirmingDelete}
        title={t('deleteTitle')}
        body={t('deleteBody', { name: openFrame.name })}
        confirmLabel={t('deleteConfirm')}
        onDismiss={() => {
          setConfirmingDelete(false);
        }}
        onConfirm={() => {
          setConfirmingDelete(false);
          void remove(openFrame.assetId);
        }}
      />
    </section>
  );
}
