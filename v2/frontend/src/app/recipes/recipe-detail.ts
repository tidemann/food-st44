import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { Auth } from '../auth';
import { Flash } from '../pages/flash';
import { NotFound } from '../pages/not-found';
import { ServerError } from '../pages/server-error';
import { formatLong, ingredientsFor, stepsFor } from './format';
import { carry, loadRecipe } from './load';
import { tagLabel } from './tags';

/** `/recipes/:id` (S-DETAIL, §2.6), or S-404R / S-500 when it cannot be shown. */
@Component({
  selector: 'app-recipe-detail',
  imports: [NgOptimizedImage, RouterLink, NotFound, ServerError, Flash],
  templateUrl: './recipe-detail.html',
  styleUrl: './recipe-detail.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeDetail {
  /** The `:id` route parameter. */
  readonly id = input.required<string>();
  /** The search this page was reached from, carried on by the crumb and the actions (§3.1). */
  readonly q = input<string>();
  /** The tag filter this page was reached from (ST-784): the crumb goes back to it. */
  readonly tag = input<string>();
  /** `?flash=created|updated` after a save (§3.3). */
  readonly flash = input<string>();

  protected readonly carried = computed(() => carry(this.q(), this.tag()));
  /** "Oppskrifter" in the crumb: the search only. The tag has its own step after it. */
  protected readonly searched = computed(() => carry(this.q()));
  /** The crumb's middle step, "Middag", when the page was reached from a filtered list. */
  protected readonly crumbTag = computed(() => {
    const tag = this.carried().tag;
    return tag ? tagLabel(tag) : undefined;
  });
  /** "Rediger" and "Slett" are only for the household's editors (M2). */
  protected readonly editor = inject(Auth).isEditor;

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
      tags: recipe.tags.map((name) => ({ name, label: tagLabel(name) })),
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
