import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { RecipeInput } from '../api/types';
import { Mast } from '../chrome/mast';
import { bindTitle, SITE } from '../chrome/title';
import { Recipes } from '../recipes';
import { Site } from '../site';
import { ErrorPage } from './error';
import { NotFoundPage } from './not-found';
import { type FieldErrors, RecipeForm } from './recipe-form';
import { recipeResource, searchParams } from './recipe-resource';

/** S-EDIT / S-EDIT-ERR, `/recipes/:id/edit` (inventory §2.9, §2.10). */
@Component({
  selector: 'app-edit-page',
  imports: [ErrorPage, Mast, NotFoundPage, RecipeForm, RouterLink],
  template: `
    @switch (state()) {
      @case ('not-found') {
        <app-not-found />
      }
      @case ('error') {
        <app-error-page />
      }
      @default {
        <app-mast />
        <main id="main" tabindex="-1">
          @if (initial(); as initial) {
            <div class="wrap">
              <div class="form-head">
                <div class="rule"></div>
                <h1>Rediger oppskrift</h1>
                <p>
                  <a [routerLink]="recipeLink()" [queryParams]="search()"
                    >Tilbake til oppskriften</a
                  >
                </p>
              </div>
              <app-recipe-form
                mode="edit"
                [initial]="initial"
                [errors]="errors()"
                [saving]="saving()"
                [cancelLink]="recipeLink()"
                [cancelParams]="search()"
                (save)="update($event)"
              />
            </div>
          }
        </main>
      }
    }
  `,
  styleUrl: './form-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditPage {
  readonly id = input<string>();
  readonly q = input<string>();

  private readonly recipes = inject(Recipes);
  private readonly site = inject(Site);
  private readonly router = inject(Router);

  private readonly recipe = recipeResource(this.id);
  protected readonly search = computed(() => searchParams(this.q()));
  protected readonly recipeLink = computed(() => ['/recipes', String(this.recipe.id())]);

  protected readonly initial = computed<RecipeInput | null>(() => {
    const recipe = this.recipe.value();
    return recipe
      ? { title: recipe.title, ingredients: recipe.ingredients, instructions: recipe.instructions }
      : null;
  });

  protected readonly errors = signal<FieldErrors>({});
  protected readonly saving = signal(false);
  /** A save that found the recipe gone, or failed: shown in place, like v1. */
  private readonly saveState = signal<'not-found' | 'error' | null>(null);
  protected readonly state = computed(() => this.saveState() ?? this.recipe.state());
  private readonly hasErrors = computed(() => Object.keys(this.errors()).length > 0);

  constructor() {
    bindTitle(() => {
      if (this.state() !== 'ready') return null;
      return this.hasErrors() ? 'Feil — Rediger oppskrift' : `Rediger oppskrift — ${SITE}`;
    });
  }

  protected async update(input: RecipeInput): Promise<void> {
    const id = this.recipe.id();
    if (id === null) return;
    this.saving.set(true);
    const outcome = await this.recipes.update(id, input);
    if (outcome.kind === 'ok') {
      this.site.reload();
      // v1 order: ?flash=updated&q=… (inventory §3.3).
      await this.router.navigate(['/recipes', id], {
        queryParams: { flash: 'updated', ...this.search() },
      });
      return;
    }
    this.saving.set(false);
    if (outcome.kind === 'invalid') this.errors.set(outcome.errors);
    else this.saveState.set(outcome.kind === 'not-found' ? 'not-found' : 'error');
  }
}
