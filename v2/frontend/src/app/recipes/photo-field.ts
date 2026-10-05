import { NgOptimizedImage } from '@angular/common';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  inject,
  input,
  linkedSignal,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { formatSize, PHOTO_MAX_MB, PHOTO_TYPES, type PhotoChange, photoProblem } from './photo';

/** A file the field refused before anything was sent (design row 6). */
export interface Rejected {
  name: string;
  /** "24,8 MB" */
  size: string;
  message: string;
}

/** The preview is drawn no larger than this; a 12-megapixel original stays out of the page. */
const PREVIEW_EDGE = 800;

/**
 * The photo field on the recipe form (design rows 4–6): "Ta bilde" (phone) and "Velg bilde",
 * a preview with "Bytt bilde" and "Fjern bilde", and the error under the field. It only records
 * what the save should do; the page sends it after "Lagre".
 */
@Component({
  selector: 'app-photo-field',
  imports: [NgOptimizedImage],
  templateUrl: './photo-field.html',
  styleUrl: './photo-field.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoField {
  /** The stored photo (on edit), or null. */
  readonly current = input<string | null>(null);
  /** The API's message for the photo, from the last save. */
  readonly error = input<string>();
  /** What the save will do with the photo. */
  readonly value = model<PhotoChange>('keep');
  /** Set while a refused file is shown; the form does not save then. */
  readonly rejected = model<Rejected | null>(null);

  protected readonly accept = PHOTO_TYPES.join(',');
  protected readonly maxMb = PHOTO_MAX_MB;

  /** The API's message stays until the photo is changed again. */
  private readonly apiError = linkedSignal(() => this.error());
  protected readonly message = computed(() => this.rejected()?.message ?? this.apiError());

  /**
   * The chosen file, decoded. It is drawn on a canvas: NgOptimizedImage takes no blob: URLs,
   * and the lint rules want every <img> to use it.
   */
  private readonly bitmap = signal<ImageBitmap | null>(null);
  protected readonly dragging = signal(false);

  protected readonly chosen = computed(() => {
    const value = this.value();
    if (!(value instanceof File)) return null;
    const bitmap = this.bitmap();
    return {
      name: value.name,
      // "2,4 MB · 3024 × 4032" (design row 5); the pixels once the file is decoded.
      meta: bitmap
        ? `${formatSize(value.size)} · ${String(bitmap.width)} × ${String(bitmap.height)}`
        : formatSize(value.size),
    };
  });
  protected readonly stored = computed(() => (this.value() === 'keep' ? this.current() : null));
  protected readonly removing = computed(() => this.value() === 'remove');

  /** "Velg bilde", or "Bytt bilde" when there is a photo: where the error summary sends focus. */
  private readonly primary = viewChild<ElementRef<HTMLButtonElement>>('primary');
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  constructor() {
    afterRenderEffect(() => {
      const bitmap = this.bitmap();
      const canvas = this.canvas()?.nativeElement;
      if (bitmap && canvas) draw(bitmap, canvas);
    });
    inject(DestroyRef).onDestroy(() => {
      this.bitmap()?.close();
    });
  }

  focus(): void {
    this.primary()?.nativeElement.focus();
  }

  protected picked(input: HTMLInputElement): void {
    const file = input.files?.[0];
    // Cleared, so choosing the same file again after "Fjern bilde" still fires `change`.
    input.value = '';
    if (file) this.take(file);
  }

  protected dragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected drop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) this.take(file);
  }

  protected remove(): void {
    this.apiError.set(undefined);
    this.rejected.set(null);
    this.setBitmap(null);
    this.value.set(this.current() ? 'remove' : 'keep');
  }

  private take(file: File): void {
    this.apiError.set(undefined);
    const problem = photoProblem(file);
    if (problem) {
      this.rejected.set({ name: file.name, size: formatSize(file.size), message: problem });
      return;
    }
    this.rejected.set(null);
    this.setBitmap(null);
    this.value.set(file);
    // A file the browser cannot decode gets no preview; the API has the last word on it.
    createImageBitmap(file).then(
      (bitmap) => {
        if (this.value() === file) this.setBitmap(bitmap);
        else bitmap.close();
      },
      () => undefined,
    );
  }

  private setBitmap(bitmap: ImageBitmap | null): void {
    this.bitmap()?.close();
    this.bitmap.set(bitmap);
  }
}

/** The whole photo, at most PREVIEW_EDGE on its long side; CSS crops it to the frame. */
function draw(bitmap: ImageBitmap, canvas: HTMLCanvasElement): void {
  const scale = Math.min(1, PREVIEW_EDGE / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
}
