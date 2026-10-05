import { HttpClient } from '@angular/common/http';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  type ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import type { RecipeDraft, RecipeInput } from '../api/types';
import { ServerError } from '../pages/server-error';
import { DrawBitmap } from './bitmap';
import { formatLong } from './format';
import { newRecipe } from './new-recipe';
import { formatSize, PHOTO_MAX_MB, PHOTO_TYPES, photoProblem } from './photo';
import { READING_URL, readFailure } from './read-photo';
import { hasErrors, RecipeForm } from './recipe-form';

/**
 * Where the page is (design rows 7–10): choosing the photo, reading it, checking the filled-in
 * form, or the photo could not be read. The photo lives only here, in memory: it goes to the
 * reader and is never saved on the recipe.
 */
type Step =
  | { kind: 'pick'; error?: string }
  | { kind: 'reading'; file: File }
  | { kind: 'check'; file: File; draft: RecipeInput; read: string }
  | { kind: 'unreadable'; file: File };

/** Under row 7 and on row 10. */
const TIPS = [
  'Hold kameraet rett over siden, så teksten ikke skråner.',
  'God belysning, og ingen skygge eller finger over teksten.',
  'Én oppskrift om gangen — ikke et oppslag med to sider.',
];

/** `/recipes/new/photo`: "Les oppskrift fra bilde" (M4). Only matched for editors with reading on. */
@Component({
  selector: 'app-recipe-from-photo',
  imports: [DrawBitmap, RecipeForm, RouterLink, ServerError],
  templateUrl: './recipe-from-photo.html',
  styleUrls: ['./form-page.css', './recipe-from-photo.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeFromPhoto {
  private readonly http = inject(HttpClient);

  protected readonly saving = newRecipe();
  protected readonly step = signal<Step>({ kind: 'pick' });

  protected readonly accept = PHOTO_TYPES.join(',');
  protected readonly maxMb = PHOTO_MAX_MB;
  protected readonly dragging = signal(false);

  /** The photo, decoded for the preview; null until it is, or if the browser cannot. */
  protected readonly bitmap = signal<ImageBitmap | null>(null);
  /** "1,8 MB · 2048 × 1536" (design row 10); the pixels once the file is decoded. */
  protected readonly meta = computed(() => {
    const step = this.step();
    if (step.kind === 'pick') return '';
    const bitmap = this.bitmap();
    const size = formatSize(step.file.size);
    return bitmap ? `${size} · ${String(bitmap.width)} × ${String(bitmap.height)}` : size;
  });

  protected readonly tips = TIPS;

  /** Each step, narrowed for the template. */
  protected readonly checking = computed(() => {
    const step = this.step();
    return step.kind === 'check' ? step : null;
  });
  protected readonly unreadable = computed(() => {
    const step = this.step();
    return step.kind === 'unreadable' ? step.file : null;
  });
  protected readonly readingFile = computed(() => {
    const step = this.step();
    return step.kind === 'reading' ? step.file : null;
  });
  protected readonly pickError = computed(() => {
    const step = this.step();
    return step.kind === 'pick' ? step.error : undefined;
  });
  protected readonly headline = computed(() => {
    switch (this.step().kind) {
      case 'check':
        return 'Les gjennom oppskriften';
      case 'unreadable':
        return 'Fikk ikke lest oppskriften';
      default:
        return 'Les oppskrift fra bilde';
    }
  });

  private reading: Subscription | null = null;
  /**
   * Where focus goes when the step changes, so a screen reader hears where it is: the heading,
   * or "Avbryt" while reading (the status line is announced on its own).
   */
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly cancelButton = viewChild<ElementRef<HTMLElement>>('cancelButton');

  constructor() {
    const title = inject(Title);
    effect(() => {
      if (this.saving.failed()) return;
      title.setTitle(this.pageTitle());
    });
    // Not on arrival: the page loads like any other.
    let arrived = false;
    afterRenderEffect(() => {
      const target = this.step().kind === 'reading' ? this.cancelButton() : this.heading();
      if (arrived) target?.nativeElement.focus();
      arrived = true;
    });
    inject(DestroyRef).onDestroy(() => {
      this.reading?.unsubscribe();
      this.bitmap()?.close();
    });
  }

  private pageTitle(): string {
    return this.checking() && hasErrors(this.saving.errors())
      ? `Feil — ${this.headline()}`
      : `${this.headline()} — food.st44.no`;
  }

  protected picked(input: HTMLInputElement): void {
    const file = input.files?.[0];
    // Cleared, so choosing the same file again still fires `change`.
    input.value = '';
    if (file) this.read(file);
  }

  protected dragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected drop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) this.read(file);
  }

  /** "Avbryt" while reading: the request is dropped and the editor can choose again. */
  protected cancel(): void {
    this.reading?.unsubscribe();
    this.reading = null;
    this.again();
  }

  /** "Bytt bilde", "Prøv et nytt bilde": back to row 7. What was read is let go. */
  protected again(error?: string): void {
    this.setBitmap(null);
    this.step.set(error ? { kind: 'pick', error } : { kind: 'pick' });
  }

  private read(file: File): void {
    const problem = photoProblem(file);
    if (problem) {
      this.step.set({ kind: 'pick', error: problem });
      return;
    }
    this.setBitmap(null);
    this.step.set({ kind: 'reading', file });
    // A file the browser cannot decode gets no preview; the reader may still manage it.
    createImageBitmap(file).then(
      (bitmap) => {
        const step = this.step();
        if (step.kind !== 'pick' && step.file === file) this.setBitmap(bitmap);
        else bitmap.close();
      },
      () => undefined,
    );

    const body = new FormData();
    body.append('photo', file);
    this.reading = this.http.post<RecipeDraft>(READING_URL, body).subscribe({
      next: ({ readable, title, ingredients, instructions }) => {
        this.reading = null;
        this.step.set(
          readable
            ? {
                kind: 'check',
                file,
                draft: { title, ingredients, instructions },
                read: formatLong(new Date().toISOString()),
              }
            : { kind: 'unreadable', file },
        );
      },
      error: (error: unknown) => {
        this.reading = null;
        this.again(readFailure(error));
      },
    });
  }

  private setBitmap(bitmap: ImageBitmap | null): void {
    this.bitmap()?.close();
    this.bitmap.set(bitmap);
  }
}
