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
 * One frame's composite, drawn at its own resolution and scaled up without
 * smoothing.
 *
 * The picture is Rust's `document_composite`, the same bytes the stage draws,
 * so a card cannot show a frame differently from how the frame looks when
 * opened. The canvas is filled through ImageData rather than CSS colours, which
 * is how sprite colours reach the screen everywhere else.
 */

import { useEffect, useRef, type ReactElement } from 'react';

import { frameComposite } from '@/features/editor/timeline/frameComposites';
import { cn } from '@/lib/cn';

export interface FrameThumbnailProps {
  /** The frame to draw. */
  assetId: string;
  /** Changes whenever the frame's pixels may have; see `frameComposites.ts`. */
  revision: string;
  /** Extra classes for the canvas, such as its size. */
  className?: string;
}

/** A frame's composite in a pixelated canvas. */
export function FrameThumbnail({
  assetId,
  revision,
  className,
}: FrameThumbnailProps): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // A mutable object so the check after the await is not narrowed away.
    const request = { cancelled: false };
    void frameComposite(assetId, revision).then((image) => {
      const element = canvas.current;
      if (request.cancelled || image === null || element === null) {
        return;
      }
      element.width = image.width;
      element.height = image.height;
      const context = element.getContext('2d');
      if (context === null) {
        return;
      }
      const bytes = Uint8ClampedArray.from(image.data);
      context.putImageData(new ImageData(bytes, image.width, image.height), 0, 0);
    });
    return () => {
      request.cancelled = true;
    };
  }, [assetId, revision]);

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      className={cn('pixelated h-full w-full object-contain', className)}
    />
  );
}
