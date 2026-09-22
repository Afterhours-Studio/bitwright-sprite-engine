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
 * The composited document, as sRGB bytes for the canvas to draw.
 *
 * RUST COMPOSITES. Every layer is a buffer of palette indices, and turning
 * nine of those into one image means walking the ordinals, skipping the
 * hidden layers, resolving each index through the palette and blending the
 * opacities in Oklab. That is `document_composite`, it already exists, and a
 * second implementation here would be a second answer to the question "what
 * does this sprite look like" - so an agent's readback and the artist's screen
 * could disagree about the same document.
 *
 * WHEN IT RE-ASKS. Once per document, and then whenever the store's `seq`
 * moves or its palette is replaced. `seq` is the op log sequence, set from
 * `document://changed`, so an agent drawing over MCP moves it exactly as a
 * person's stroke does and the picture follows either of them without this
 * hook knowing which was which.
 *
 * A composite that arrives after the document it belongs to has been closed,
 * or after a newer one was asked for, is dropped rather than shown. Two
 * overlapping requests can finish in either order, and the older one winning
 * would put a sprite on screen that is one write out of date and then leave it
 * there until the next write.
 */

import { useEffect, useState } from 'react';

import { documentComposite } from '@/lib/document';
import type { RgbaImage } from '@/types/document';

/** What the stage has to draw, and whether it is still being fetched. */
export interface Composite {
  /** The image, or null before the first one has arrived. */
  image: RgbaImage | null;
  /** Stable reason code for the last failed composite, or null. */
  error: string | null;
}

/**
 * Keeps a composited image of the open document.
 *
 * @param assetId - The open asset, or null when none is open.
 * @param revision - Anything whose change means the picture changed: the op
 *   log sequence, and the palette object the store is holding.
 * @returns The image to draw, and the reason code if it could not be made.
 */
export function useComposite(assetId: string | null, revision: unknown): Composite {
  const [composite, setComposite] = useState<Composite>({ image: null, error: null });

  useEffect(() => {
    if (assetId === null) {
      setComposite({ image: null, error: null });
      return;
    }

    // A mutable object rather than a boolean, so that the check below is a
    // property read the compiler cannot narrow to a constant. The flag is set
    // by the cleanup, which runs after the closure was written and before the
    // await resolves, and a narrowed `let` would make the guard dead code.
    const request = { cancelled: false };
    void (async () => {
      const result = await documentComposite(assetId);
      if (request.cancelled) {
        return;
      }
      if (!result.ok) {
        // The last good picture is left on screen. A document that failed to
        // composite is still there, and blanking the stage would say it is not.
        setComposite((previous) => ({ image: previous.image, error: result.error.code }));
        return;
      }
      setComposite({ image: result.value, error: null });
    })();

    return () => {
      request.cancelled = true;
    };
  }, [assetId, revision]);

  return composite;
}
