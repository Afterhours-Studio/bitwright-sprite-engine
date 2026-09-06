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

import { useEffect } from 'react';

import {
  checkGpu,
  platformInfo,
  sidecarStatus,
  SHELL_EVENTS,
  on,
  vibrancyState,
  type GpuReport,
  type SidecarStatus,
} from '@/lib/tauri';
import { useEngineStore } from '@/stores/useEngineStore';
import { applyRootAttributes, useShellStore } from '@/stores/useShellStore';

/**
 * Asks the shell for everything the interface needs at startup, and subscribes
 * to the events that follow.
 *
 * Both a poll and a subscription are used on purpose. The sidecar can become
 * ready before the webview finishes loading, in which case the event has
 * already fired and only the poll sees it.
 */
export function useShellBootstrap(): void {
  const setPlatform = useShellStore((state) => state.setPlatform);
  const setVibrancy = useShellStore((state) => state.setVibrancy);
  const setGpu = useShellStore((state) => state.setGpu);
  const theme = useShellStore((state) => state.theme);
  const setSidecar = useEngineStore((state) => state.setSidecar);

  // The stored theme is applied before anything renders, so the first paint is
  // already in the right palette.
  useEffect(() => {
    applyRootAttributes({ theme });
  }, [theme]);

  useEffect(() => {
    // An abort signal rather than a captured flag: the effect can be torn down
    // while the four commands are still in flight, and a late resolution must
    // not write into an unmounted tree.
    const controller = new AbortController();

    void (async () => {
      const [platform, vibrancy, sidecar, gpu] = await Promise.all([
        platformInfo(),
        vibrancyState(),
        sidecarStatus(),
        checkGpu(),
      ]);

      if (controller.signal.aborted) {
        return;
      }
      if (platform.ok) {
        setPlatform(platform.value);
      }
      // Vibrancy is only ever taken from the shell. Assuming it is on would
      // leave text over a transparent surface whenever the effect failed.
      if (vibrancy.ok) {
        setVibrancy(vibrancy.value);
      }
      if (sidecar.ok) {
        setSidecar(sidecar.value);
      }
      if (gpu.ok) {
        setGpu(gpu.value);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [setGpu, setPlatform, setSidecar, setVibrancy]);

  useEffect(() => {
    const unsubscribers: Promise<() => void>[] = [
      on<SidecarStatus>(SHELL_EVENTS.sidecarReady, setSidecar),
      on<SidecarStatus>(SHELL_EVENTS.sidecarFailed, setSidecar),
      on<GpuReport>(SHELL_EVENTS.gpu, setGpu),
    ];

    return () => {
      for (const pending of unsubscribers) {
        void pending.then((unsubscribe) => {
          unsubscribe();
        });
      }
    };
  }, [setGpu, setSidecar]);
}
