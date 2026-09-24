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
 * Putting text on the clipboard.
 *
 * The panel offers this for the server URL, the bearer token and the manual
 * snippet, which is the whole reason those three exist on screen: a token a
 * user cannot copy is a token they cannot use, and re-typing one is how they
 * end up pasting a broken credential into their client and debugging a
 * connection that is fine.
 *
 * The asynchronous clipboard API is the one that works in a webview. When the
 * page does not have focus or the permission was not granted, the call rejects
 * and this function reports the failure so the UI can show it.
 *
 * @param text - The text to put on the clipboard.
 * @returns Whether the clipboard took it.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
