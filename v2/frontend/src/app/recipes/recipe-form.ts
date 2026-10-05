import { HttpErrorResponse } from '@angular/common/http';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Recipe, RecipeInput, ValidationErrors } from '../api/types';
import { failureOf } from './load';
import { type PhotoChange, PhotoStepError, TOO_LARGE } from './photo';
import { PhotoField, type Rejected } from './photo-field';

/** The API's message per field (§3.2): title and ingredients, and the photo (M3). */
export interface FieldErrors {
  title?: string;
  ingredients?: string;
  photo?: string;
}

export function hasErrors(errors: FieldErrors): boolean {
  return !!(errors.title ?? errors.ingredients ?? errors.photo);
}

/** What "Lagre" asks the page to save. */
export interface RecipeSave {
  recipe: RecipeInput;
  photo: PhotoChange;
}

export const EMPTY: RecipeInput = { title: '', ingredients: '', instructions: '' };

/**
 * What a failed save means for the page: the field errors to show (a 422, or a 413 for the
 * photo), or S-404R / S-500. The rules live in the API; this only reads its answer.
 */
export function saveFailure(error: unknown): FieldErrors | 'not-found' | 'error' {
  if (error instanceof PhotoStepError) return saveFailure(error.cause);
  if (error instanceof HttpErrorResponse && (error.status === 422 || error.status === 413)) {
    // A 413 from nginx, before Django, is its own HTML page.
    const body = error.error as Partial<ValidationErrors> | string | null;
    const errors = typeof body === 'object' ? (body?.errors ?? {}) : {};
    const found: FieldErrors = {};
    if (errors['title']) found.title = errors['title'];
    if (errors['ingredients']) found.ingredients = errors['ingredients'];
    if (errors['photo']) found.photo = errors['photo'];
    else if (error.status === 413) found.photo = TOO_LARGE;
    // A 422 for no field the form has is not something the user can fix.
    return hasErrors(found) ? found : 'error';
  }
  return failureOf(error);
}

/**
 * The recipe form shared by S-NEW and S-EDIT, with their error states (§2.7–2.10) and the photo
 * field (M3). The page owns the requests; this shows the fields, the API's errors and the busy
 * button (§3.5).
 */
@Component({
  selector: 'app-recipe-form',
  imports: [RouterLink, PhotoField],
  templateUrl: './recipe-form.html',
  styleUrl: './recipe-form.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeForm {
  /** The values the form starts from: empty for a new recipe, the stored ones for an edit. */
  readonly initial = input<RecipeInput | Recipe>(EMPTY);
  readonly errors = input<FieldErrors>({});
  /** The text was saved but the photo was not: the summary says so instead of "not saved". */
  readonly photoOnly = input(false);
  /** A save is in flight: the button is disabled and says "Lagrer…" (§3.5). */
  readonly busy = input(false);
  readonly submitLabel = input.required<string>();
  /** Where "Avbryt" goes. */
  readonly cancelLink = input.required<readonly (string | number)[]>();
  readonly cancelQuery = input<{ q?: string }>({});

  /** The values as typed, untrimmed, so they survive an error (§2.8), and the photo change. */
  readonly save = output<RecipeSave>();

  /** Only the fields the API takes, even when `initial` is a whole stored recipe. */
  protected readonly draft = linkedSignal<RecipeInput>(() => {
    const { title, ingredients, instructions } = this.initial();
    return { title, ingredients, instructions };
  });
  protected readonly currentPhoto = computed(() => {
    const initial = this.initial();
    return 'photo_url' in initial ? initial.photo_url : null;
  });
  protected readonly photo = signal<PhotoChange>('keep');
  protected readonly rejected = signal<Rejected | null>(null);

  /** The page's errors, or the refused photo when "Lagre" was pressed with it showing. */
  protected readonly shown = linkedSignal(() => this.errors());
  protected readonly invalid = computed(() => hasErrors(this.shown()));
  /** Saves refused because a refused file was showing. */
  private readonly refused = signal(0);
  protected readonly summaryTitle = computed(() =>
    this.photoOnly() && !this.shown().title && !this.shown().ingredients
      ? 'Oppskriften er lagret, men ikke bildet'
      : 'Oppskriften ble ikke lagret',
  );

  private readonly summary = viewChild<ElementRef<HTMLElement>>('summary');

  constructor() {
    // Each failed save moves focus to the summary, as v1's autofocus did on every 400. The ring
    // shows too, as it did after v1's page load, although the save began with a click.
    // A save refused here, before any request, counts too; changing the photo does not.
    afterRenderEffect(() => {
      this.errors();
      this.refused();
      this.summary()?.nativeElement.focus({ focusVisible: true });
    });
  }

  protected edit(field: keyof RecipeInput, value: string): void {
    this.draft.update((draft) => ({ ...draft, [field]: value }));
  }

  /** A new photo or "Fjern bilde" answers the photo's error, so the summary drops it. */
  protected photoChanged(photo: PhotoChange): void {
    this.photo.set(photo);
    if (this.shown().photo) {
      const rest = { ...this.shown() };
      delete rest.photo;
      this.shown.set(rest);
    }
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (this.busy()) return;
    // A refused file is still on screen: nothing is sent until it is replaced or removed.
    const rejected = this.rejected();
    if (rejected) {
      this.shown.set({ photo: rejected.message });
      this.refused.update((n) => n + 1);
      return;
    }
    this.save.emit({ recipe: this.draft(), photo: this.photo() });
  }

  /** `href="#title"` would resolve against <base href="/"> and leave the page; focus instead. */
  protected jump(event: Event, field: HTMLElement | PhotoField): void {
    event.preventDefault();
    field.focus();
  }
}
