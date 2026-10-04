import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Flash } from '../chrome/flash';
import { Mast } from '../chrome/mast';
import { bindTitle, SITE } from '../chrome/title';
import { formatLong, ingredientsFor, photoFor, stepsFor } from '../format';
import { recipeResource, searchParams } from './recipe-resource';
import { ErrorPage } from './error';
import { NotFoundPage } from './not-found';

/** S-DETAIL, `/recipes/:id` (inventory §2.6). */
@Component({
  selector: 'app-detail-page',
  imports: [ErrorPage, Flash, Mast, NgOptimizedImage, NotFoundPage, RouterLink],
  templateUrl: './detail.html',
  styleUrl: './detail.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailPage {
  readonly id = input<string>();
  readonly q = input<string>();
  readonly flash = input<string>();

  protected readonly recipe = recipeResource(this.id);
  /** The search this page was reached from, handed on to every way back (inventory §3.1). */
  protected readonly search = computed(() => searchParams(this.q()));

  protected readonly view = computed(() => {
    const recipe = this.recipe.value();
    if (!recipe) return null;
    return {
      recipe,
      photo: photoFor(recipe.title),
      ingredients: ingredientsFor(recipe.ingredients),
      steps: stepsFor(recipe.instructions),
      added: formatLong(recipe.created_at),
    };
  });

  constructor() {
    bindTitle(() => {
      const recipe = this.recipe.value();
      return recipe ? `${recipe.title} — ${SITE}` : null;
    });
  }
}
