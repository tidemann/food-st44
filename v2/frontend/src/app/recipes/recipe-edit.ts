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
import type { Recipe, RecipeInput } from '../api/types';
import { NotFound } from '../pages/not-found';
import { ServerError } from '../pages/server-error';
import { Site } from '../site';
import { carry, type LoadState, loadRecipe } from './load';
import { type FieldErrors, RecipeForm, saveFailure } from './recipe-form';

/** `/recipes/:id/edit`: S-EDIT and S-EDIT-ERR (§2.9, §2.10), or S-404R / S-500. */
@Component({
  selector: 'app-recipe-edit',
  imports: [RouterLink, RecipeForm, NotFound, ServerError],
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
            <div class="form-head">
              <div class="form-head-rule"></div>
              <h1>Rediger oppskrift</h1>
              <p>
                <a [routerLink]="['/recipes', stored.id]" [queryParams]="carried()"
                  >Tilbake til oppskriften</a
                >
              </p>
            </div>
            <app-recipe-form
              submitLabel="Lagre endringer"
              [initial]="stored"
              [cancelLink]="['/recipes', stored.id]"
              [cancelQuery]="carried()"
              [errors]="errors()"
              [busy]="busy()"
              (save)="update(stored.id, $event)"
            />
          </div>
        }
      }
    }
  `,
  styleUrl: './form-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeEdit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly site = inject(Site);

  /** The `:id` route parameter. */
  readonly id = input.required<string>();
  /** The search the recipe was reached from: kept on every link and after the save (§3.1). */
  readonly q = input<string>();
  protected readonly carried = computed(() => carry(this.q()));

  private readonly load = loadRecipe(this.id);
  protected readonly stored = computed(() =>
    this.load.recipe.hasValue() ? this.load.recipe.value() : undefined,
  );

  protected readonly errors = signal<FieldErrors>({});
  protected readonly busy = signal(false);
  /** A save that failed with something the form cannot show: the recipe is gone, or S-500. */
  private readonly failure = signal<'not-found' | 'error' | null>(null);
  protected readonly state = computed<LoadState>(() => this.failure() ?? this.load.state());

  constructor() {
    const title = inject(Title);
    effect(() => {
      if (this.state() !== 'ready') return;
      const invalid = this.errors().title ?? this.errors().ingredients;
      title.setTitle(invalid ? 'Feil — Rediger oppskrift' : 'Rediger oppskrift — food.st44.no');
    });
  }

  protected update(id: number, input: RecipeInput): void {
    this.busy.set(true);
    this.http.put<Recipe>(`/api/recipes/${String(id)}`, input).subscribe({
      next: (recipe) => {
        this.site.recipes.reload();
        void this.router.navigate(['/recipes', recipe.id], {
          queryParams: { flash: 'updated', ...this.carried() },
        });
      },
      error: (error: unknown) => {
        this.busy.set(false);
        const failure = saveFailure(error);
        if (typeof failure === 'string') this.failure.set(failure);
        else this.errors.set(failure);
      },
    });
  }
}
