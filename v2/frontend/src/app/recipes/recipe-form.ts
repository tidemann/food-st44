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
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RecipeInput, ValidationErrors } from '../api/types';
import { failureOf } from './load';

/** The API's message per field (§3.2). Only title and ingredients have rules. */
export interface FieldErrors {
  title?: string;
  ingredients?: string;
}

export const EMPTY: RecipeInput = { title: '', ingredients: '', instructions: '' };

/**
 * What a failed save means for the page: the field errors to show (a 422), or S-404R / S-500.
 * The rules live in the API; this only reads its answer.
 */
export function saveFailure(error: unknown): FieldErrors | 'not-found' | 'error' {
  if (error instanceof HttpErrorResponse && error.status === 422) {
    const { errors } = error.error as ValidationErrors;
    const found: FieldErrors = {};
    if (errors['title']) found.title = errors['title'];
    if (errors['ingredients']) found.ingredients = errors['ingredients'];
    // A 422 for no field the form has is not something the user can fix.
    return found.title || found.ingredients ? found : 'error';
  }
  return failureOf(error);
}

/**
 * The recipe form shared by S-NEW and S-EDIT, with their error states (§2.7–2.10). The page owns
 * the request; this shows the fields, the API's errors and the busy button (§3.5).
 */
@Component({
  selector: 'app-recipe-form',
  imports: [RouterLink],
  templateUrl: './recipe-form.html',
  styleUrl: './recipe-form.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeForm {
  /** The values the form starts from: empty for a new recipe, the stored ones for an edit. */
  readonly initial = input<RecipeInput>(EMPTY);
  readonly errors = input<FieldErrors>({});
  /** A save is in flight: the button is disabled and says "Lagrer…" (§3.5). */
  readonly busy = input(false);
  readonly submitLabel = input.required<string>();
  /** Where "Avbryt" goes. */
  readonly cancelLink = input.required<readonly (string | number)[]>();
  readonly cancelQuery = input<{ q?: string }>({});

  /** The values as typed, untrimmed, so they survive an error (§2.8). */
  readonly save = output<RecipeInput>();

  /** Only the fields the API takes, even when `initial` is a whole stored recipe. */
  protected readonly draft = linkedSignal<RecipeInput>(() => {
    const { title, ingredients, instructions } = this.initial();
    return { title, ingredients, instructions };
  });
  protected readonly invalid = computed(() => !!(this.errors().title ?? this.errors().ingredients));

  private readonly summary = viewChild<ElementRef<HTMLElement>>('summary');

  constructor() {
    // Each failed save moves focus to the summary, as v1's autofocus did on every 400. The ring
    // shows too, as it did after v1's page load, although the save began with a click.
    afterRenderEffect(() => {
      this.errors();
      this.summary()?.nativeElement.focus({ focusVisible: true });
    });
  }

  protected edit(field: keyof RecipeInput, value: string): void {
    this.draft.update((draft) => ({ ...draft, [field]: value }));
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (this.busy()) return;
    this.save.emit(this.draft());
  }

  /** `href="#title"` would resolve against <base href="/"> and leave the page; focus instead. */
  protected jump(event: Event, field: HTMLElement): void {
    event.preventDefault();
    field.focus();
  }
}
