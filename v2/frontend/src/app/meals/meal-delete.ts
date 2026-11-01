import { HttpClient, httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { NotFound } from '../pages/not-found';
import { ServerError } from '../pages/server-error';
import { dayLong } from '../plan/plan';
import { failureOf, type LoadState } from '../recipes/load';
import { Site } from '../site';
import { loadMeal } from './meal';

/** "torsdag 29. oktober", "torsdag 29. oktober og fredag 6. november", "a, b og c" */
function listOf(days: readonly string[]): string {
  const names = days.map(dayLong);
  const last = names.pop();
  return names.length ? `${names.join(', ')} og ${last ?? ''}` : (last ?? '');
}

/**
 * `/maltider/:id/slett` (ST-1968, ST-1970 pictures 10, 11): its own page, as for a recipe, and
 * the only surface filled with red. It says which days of the plan carry the meal: they keep
 * its name, without the link.
 */
@Component({
  selector: 'app-meal-delete',
  imports: [RouterLink, NotFound, ServerError],
  template: `
    @switch (state()) {
      @case ('not-found') {
        <app-not-found kind="meal" />
      }
      @case ('error') {
        <app-server-error />
      }
      @case ('ready') {
        @if (stored(); as stored) {
          <div class="wrap">
            <div class="notice">
              <div class="notice-rule"></div>
              <h1>Slett «{{ stored.title }}»?</h1>
              <p>Måltidet blir borte for godt. Dette kan ikke angres.</p>
              @if (planned(); as planned) {
                <p>
                  Det står på {{ planned }} i ukeplanen. Navnet blir stående
                  {{ plannedCount() === 1 ? 'på den dagen' : 'på de dagene' }}, men lenken til
                  måltidet forsvinner.
                </p>
              }
              <form class="notice-actions" (submit)="remove($event, stored.id)">
                <a class="btn btn-lg" [routerLink]="['/maltider', stored.id]">Avbryt</a>
                <button
                  class="btn btn-danger btn-lg"
                  type="submit"
                  [disabled]="busy()"
                  [attr.aria-busy]="busy() ? 'true' : null"
                >
                  Slett måltidet
                </button>
              </form>
            </div>
          </div>
        }
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MealDelete {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly site = inject(Site);

  /** The `:id` route parameter. */
  readonly id = input.required<string>();

  private readonly load = loadMeal(this.id);
  protected readonly stored = computed(() =>
    this.load.meal.hasValue() ? this.load.meal.value() : undefined,
  );
  /** The days from today on that carry the meal. If they cannot be read, the line is left out. */
  private readonly days = httpResource<string[]>(() => {
    const stored = this.stored();
    return stored ? `/api/meals/${String(stored.id)}/days` : undefined;
  });
  protected readonly plannedCount = computed(() =>
    this.days.hasValue() ? this.days.value().length : 0,
  );
  protected readonly planned = computed(() =>
    this.days.hasValue() ? listOf(this.days.value()) : '',
  );

  protected readonly busy = signal(false);
  private readonly failure = signal<'not-found' | 'error' | null>(null);
  protected readonly state = computed<LoadState>(() => this.failure() ?? this.load.state());

  constructor() {
    const title = inject(Title);
    effect(() => {
      const stored = this.stored();
      if (this.state() === 'ready' && stored) {
        title.setTitle(`Slett «${stored.title}»? — food.st44.no`);
      }
    });
  }

  protected remove(event: Event, id: number): void {
    event.preventDefault();
    if (this.busy()) return;
    this.busy.set(true);
    this.http.delete(`/api/meals/${String(id)}`).subscribe({
      next: () => {
        this.site.mealsChanged();
        void this.router.navigate(['/maltider'], { queryParams: { flash: 'deleted' } });
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.failure.set(failureOf(error));
      },
    });
  }
}
