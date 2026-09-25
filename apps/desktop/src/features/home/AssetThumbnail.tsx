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
 * A sprite's composite, drawn at its own resolution and scaled up without
 * smoothing.
 *
 * WHY THE COMPOSITES ARE CACHED BY ID AND UPDATE TIME
 *
 * Home can list hundreds of sprites, and every composite is a command that
 * flattens every layer. Switching between Recent and Projects, or between the
 * grid and the list, mounts the same thumbnails again; asking again each time
 * would put the whole library on the wire per click. The update time is part
 * of the key, so an edit makes a new key and the stale picture is never shown.
 *
 * WHY IT WAITS UNTIL IT IS SEEN
 *
 * A thumbnail below the fold is one nobody is looking at yet. Where the
 * webview can say what is on screen the composite is asked for when the card
 * scrolls in; where it cannot, it is asked for at once.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';

import { cn } from '@/lib/cn';
import { composite } from '@/features/home/thumbnailCache';
import type { Asset } from '@/types/document';

export interface AssetThumbnailProps {
  /** The sprite to draw. */
  asset: Asset;
  /** Extra classes for the canvas, such as its size. */
  className?: string;
}

/** The composite of one sprite, drawn into a pixelated canvas. */
export function AssetThumbnail({ asset, className }: AssetThumbnailProps): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const element = canvas.current;
    if (visible || element === null) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    let cancelled = false;
    void composite(asset).then((image) => {
      const element = canvas.current;
      if (cancelled || image === null || element === null) {
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
      cancelled = true;
    };
  }, [asset, visible]);

  return (
    <canvas
      ref={canvas}
      width={asset.width}
      height={asset.height}
      aria-hidden="true"
      className={cn('pixelated h-full w-full object-contain', className)}
    />
  );
}
