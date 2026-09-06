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

import type { ReactElement } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { GalleryScreen } from '@/features/gallery/GalleryScreen';
import { GenerateScreen } from '@/features/generation/GenerateScreen';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { useShellBootstrap } from '@/hooks/useShellBootstrap';
import { useShellStore } from '@/stores/useShellStore';

/** The application root: bootstrap the shell, then render the current screen. */
export function App(): ReactElement {
  useShellBootstrap();
  const screen = useShellStore((state) => state.screen);

  return (
    <AppShell>
      {screen === 'generate' && <GenerateScreen />}
      {screen === 'gallery' && <GalleryScreen />}
      {screen === 'settings' && <SettingsScreen />}
    </AppShell>
  );
}

export default App;
