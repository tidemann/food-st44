import { HttpClient } from '@angular/common/http';
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
import { Site } from '../site';
import { carry, failureOf, type LoadState, loadRecipe } from './load';

/** `/recipes/:id/delete`: S-DELETE (§2.11), or S-404R / S-500. No JS confirm: this page is it. */
@Component({
  selector: 'app-recipe-delete',
  imports: [RouterLink, NotFound, ServerError],
  template: `
    @switch (state()) {
      @case ('not-found') {
        <app-not-found kind="recipe" />
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
              <p>Oppskriften blir borte for godt. Dette kan ikke angres.</p>
              <form class="notice-actions" (submit)="remove($event, stored.id)">
                <a
                  class="btn btn-lg"
                  [routerLink]="['/recipes', stored.id]"
                  [queryParams]="carried()"
                  >Avbryt</a
                >
                <button
                  class="btn btn-danger btn-lg"
                  type="submit"
                  [disabled]="busy()"
                  [attr.aria-busy]="busy() ? 'true' : null"
                >
                  Slett oppskriften
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
export class RecipeDelete {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly site = inject(Site);

  /** The `:id` route parameter. */
  readonly id = input.required<string>();
  /** The search the recipe was reached from: "Avbryt" keeps it, a delete drops it (§3.1). */
  readonly q = input<string>();
  protected readonly carried = computed(() => carry(this.q()));

  private readonly load = loadRecipe(this.id);
  protected readonly stored = computed(() =>
    this.load.recipe.hasValue() ? this.load.recipe.value() : undefined,
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
    // A second click while the first is in flight would only meet a 404 (§3.5).
    if (this.busy()) return;
    this.busy.set(true);
    this.http.delete(`/api/recipes/${String(id)}`).subscribe({
      next: () => {
        this.site.recipes.reload();
        void this.router.navigate(['/'], { queryParams: { flash: 'deleted' } });
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.failure.set(failureOf(error));
      },
    });
  }
}
