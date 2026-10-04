import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { Flash } from '../pages/flash';
import { NotFound } from '../pages/not-found';
import { ServerError } from '../pages/server-error';
import { formatLong, ingredientsFor, stepsFor } from './format';
import { carry, loadRecipe } from './load';

/** `/recipes/:id` (S-DETAIL, §2.6), or S-404R / S-500 when it cannot be shown. */
@Component({
  selector: 'app-recipe-detail',
  imports: [RouterLink, NotFound, ServerError, Flash],
  templateUrl: './recipe-detail.html',
  styleUrl: './recipe-detail.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeDetail {
  /** The `:id` route parameter. */
  readonly id = input.required<string>();
  /** The search this page was reached from, carried on by the crumb and the actions (§3.1). */
  readonly q = input<string>();
  /** `?flash=created|updated` after a save (§3.3). */
  readonly flash = input<string>();

  protected readonly carried = computed(() => carry(this.q()));

  private readonly load = loadRecipe(this.id);
  protected readonly recipe = this.load.recipe;
  protected readonly state = this.load.state;

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
