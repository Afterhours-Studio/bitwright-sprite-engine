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
 * The editor's view of what an agent is doing to the open document.
 *
 * Two pieces, and the caller chooses which: the chip that shows a session is
 * attached, and the hook that turns a burst of writes into one re-read per
 * frame. Neither mounts itself, because the editor screen is the only thing
 * that knows where in its layout each one belongs.
 */

export { default as AgentActivityIndicator } from '@/features/editor/live/AgentActivityIndicator';
export { useLiveRefresh } from '@/features/editor/live/useLiveRefresh';
