import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import type { Recipe } from '../api/types';
import { NotFound } from '../pages/not-found';
import { ServerError } from '../pages/server-error';
import { formatLong, ingredientsFor, stepsFor } from './format';

/**
 * v1 parsed the id with parseInt, so "3abc" is recipe 3 and "0", "-1", "abc" are not a recipe.
 * Kept as it was so every live link resolves the same way (inventory §1).
 */
function parseId(value: string): number | null {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** `/recipes/:id` (S-DETAIL, §2.6), or S-404R / S-500 when it cannot be shown. */
@Component({
  selector: 'app-recipe-detail',
  imports: [RouterLink, NotFound, ServerError],
  templateUrl: './recipe-detail.html',
  styleUrl: './recipe-detail.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeDetail {
  /** The `:id` route parameter. */
  readonly id = input.required<string>();
  /** The search this page was reached from, carried on by the crumb and the actions (§3.1). */
  readonly q = input<string>();

  protected readonly recipeId = computed(() => parseId(this.id()));
  protected readonly term = computed(() => (this.q() ?? '').trim());
  protected readonly carried = computed(() => (this.term() ? { q: this.term() } : {}));

  protected readonly recipe = httpResource<Recipe>(() => {
    const id = this.recipeId();
    return id === null ? undefined : `/api/recipes/${String(id)}`;
  });

  protected readonly state = computed(() => {
    if (this.recipeId() === null) return 'not-found';
    const error = this.recipe.error();
    if (error) {
      return error instanceof HttpErrorResponse && error.status === 404 ? 'not-found' : 'error';
    }
    return this.recipe.hasValue() ? 'ready' : 'loading';
  });

  protected readonly view = computed(() => {
    if (!this.recipe.hasValue()) return undefined;
    const recipe = this.recipe.value();
    return {
      recipe,
      ingredients: ingredientsFor(recipe.ingredients),
      steps: stepsFor(recipe.instructions),
      added: formatLong(recipe.created_at),
    };
  });

  constructor() {
    const title = inject(Title);
    effect(() => {
      const view = this.view();
      if (this.state() === 'ready' && view) title.setTitle(`${view.recipe.title} — food.st44.no`);
    });
  }
}
