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

import { AppShell } from '@/components/layout/AppShell';
import { WindowControls } from '@/components/layout/WindowControls';
import { EditorScreen } from '@/features/editor/EditorScreen';
import { useAgentOpen } from '@/features/editor/live';
import { HomeScreen } from '@/features/home/HomeScreen';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { useAssetNameSync } from '@/hooks/useAssetNameSync';
import { useShellBootstrap } from '@/hooks/useShellBootstrap';
import { useDocumentStore } from '@/stores/useDocumentStore';
import { useShellStore } from '@/stores/useShellStore';

/**
 * The application root: bootstrap the shell, then render the current screen.
 *
 * AN EDITOR WITH NOTHING IN IT IS HOME. Every route into the editor opens an
 * asset first, so the editor with no document is only reached by a request
 * that failed or by asking for the screen by name; either way the thing to do
 * next is choosing a sprite, and home is where that is done. The redirect is
 * written back into the shell store as well as rendered, so the command
 * palette and anything else reading `screen` agree with what is on screen.
 */
export function App(): ReactElement {
  useShellBootstrap();
  useAgentOpen();
  useAssetNameSync();
  const screen = useShellStore((state) => state.screen);
  const setScreen = useShellStore((state) => state.setScreen);
  const hasDocument = useDocumentStore((state) => state.assetId !== null);

  const shown = screen === 'editor' && !hasDocument ? 'home' : screen;

  useEffect(() => {
    if (shown !== screen) {
      setScreen(shown);
    }
  }, [screen, shown, setScreen]);

  return (
    <AppShell>
      {shown === 'home' && <HomeScreen trailing={<WindowControls />} />}
      {shown === 'editor' && <EditorScreen />}
      {shown === 'settings' && <SettingsScreen />}
    </AppShell>
  );
}

export default App;
