import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  type ElementRef,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import type { Meal, MealInput, ValidationErrors } from '../api/types';
import { NotFound } from '../pages/not-found';
import { ServerError } from '../pages/server-error';
import { failureOf, type LoadState } from '../recipes/load';
import { Site } from '../site';
import { loadMeal } from './meal';

/** The API's message per field. */
interface FieldErrors {
  title?: string;
  items?: string;
  note?: string;
}

const EMPTY: MealInput = { title: '', items: '', note: '' };

/**
 * `/maltider/ny` and `/maltider/:id/rediger` (ST-1968, ST-1970 pictures 05–09, 35): title, the
 * items one per line, and an optional note. The rules live in the API; a 422 is shown as a
 * summary with links to the fields and a message under each, as on the recipe form.
 */
@Component({
  selector: 'app-meal-form',
  imports: [RouterLink, NotFound, ServerError],
  templateUrl: './meal-form.html',
  styleUrls: ['../recipes/form-page.css', '../recipes/recipe-form.css', './maltid.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MealForm {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly site = inject(Site);

  /** The `:id` route parameter; none on `/maltider/ny`. */
  readonly id = input<string>();
  protected readonly editing = computed(() => this.id() !== undefined);

  private readonly load = loadMeal(computed(() => this.id() ?? ''));
  protected readonly stored = computed(() =>
    this.editing() && this.load.meal.hasValue() ? this.load.meal.value() : undefined,
  );
  /** A save that failed with something the form cannot show: the meal is gone, or S-500. */
  private readonly failure = signal<'not-found' | 'error' | null>(null);
  protected readonly state = computed<LoadState>(
    () => this.failure() ?? (this.editing() ? this.load.state() : 'ready'),
  );

  /** The values as typed, untrimmed, so they survive an error. */
  protected readonly draft = linkedSignal<MealInput>(() => {
    const stored = this.stored();
    return stored ? { title: stored.title, items: stored.items, note: stored.note } : EMPTY;
  });
  protected readonly errors = signal<FieldErrors>({});
  protected readonly invalid = computed(() => {
    const errors = this.errors();
    return !!(errors.title ?? errors.items ?? errors.note);
  });
  protected readonly busy = signal(false);
  protected readonly heading = computed(() => (this.editing() ? 'Rediger måltid' : 'Nytt måltid'));

  private readonly summary = viewChild<ElementRef<HTMLElement>>('summary');

  constructor() {
    const title = inject(Title);
    effect(() => {
      if (this.state() !== 'ready') return;
      title.setTitle(
        this.invalid() ? `Feil — ${this.heading()}` : `${this.heading()} — food.st44.no`,
      );
    });
    // Each failed save moves focus to the summary, as on the recipe form.
    afterRenderEffect(() => {
      this.errors();
      this.summary()?.nativeElement.focus({ focusVisible: true });
    });
  }

  protected edit(field: keyof MealInput, value: string): void {
    this.draft.update((draft) => ({ ...draft, [field]: value }));
  }

  /** Where "Avbryt" and "Tilbake" go. */
  protected readonly back = computed(() => {
    const stored = this.stored();
    return stored ? ['/maltider', stored.id] : ['/maltider'];
  });

  protected submit(event: Event): void {
    event.preventDefault();
    if (this.busy()) return;
    this.busy.set(true);
    const stored = this.stored();
    const request = stored
      ? this.http.put<Meal>(`/api/meals/${String(stored.id)}`, this.draft())
      : this.http.post<Meal>('/api/meals', this.draft());
    request.subscribe({
      next: (meal) => {
        this.site.mealsChanged();
        void this.router.navigate(['/maltider', meal.id], {
          queryParams: { flash: stored ? 'updated' : 'created' },
        });
      },
      error: (error: unknown) => {
        this.busy.set(false);
        const found = fieldErrors(error);
        if (found) this.errors.set(found);
        else this.failure.set(failureOf(error));
      },
    });
  }

  /** `href="#tittel"` would resolve against <base href="/"> and leave the page; focus instead. */
  protected jump(event: Event, field: HTMLElement): void {
    event.preventDefault();
    field.focus();
  }
}

/** A 422's messages for the form's fields, or null for anything the form cannot show. */
function fieldErrors(error: unknown): FieldErrors | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 422) return null;
  const body = error.error as Partial<ValidationErrors> | null;
  const errors = body?.errors ?? {};
  const found: FieldErrors = {};
  if (errors['title']) found.title = errors['title'];
  if (errors['items']) found.items = errors['items'];
  if (errors['note']) found.note = errors['note'];
  return (found.title ?? found.items ?? found.note) ? found : null;
}
