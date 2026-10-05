import { afterRenderEffect, Directive, ElementRef, inject, input } from '@angular/core';

/** The preview is drawn no larger than this; a 12-megapixel original stays out of the page. */
const PREVIEW_EDGE = 800;

/** The whole photo, at most PREVIEW_EDGE on its long side; CSS crops it to the frame. */
export function draw(bitmap: ImageBitmap, canvas: HTMLCanvasElement): void {
  const scale = Math.min(1, PREVIEW_EDGE / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
}

/**
 * Draws a decoded photo on the canvas. A chosen file is shown this way: NgOptimizedImage takes no
 * blob: URLs, and the lint rules want every <img> to use it.
 */
@Directive({ selector: 'canvas[appBitmap]' })
export class DrawBitmap {
  readonly appBitmap = input<ImageBitmap | null>(null);

  constructor() {
    const canvas = inject<ElementRef<HTMLCanvasElement>>(ElementRef).nativeElement;
    afterRenderEffect(() => {
      const bitmap = this.appBitmap();
      if (bitmap) draw(bitmap, canvas);
    });
  }
}
