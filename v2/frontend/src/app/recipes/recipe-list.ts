import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import type { Recipe } from '../api/types';
import { Site } from '../site';
import { pluralise, toCard, toIndex } from './format';

type State = 'loading' | 'empty' | 'error' | 'no-hits' | 'hits' | 'front';

const SIDE_SUB = [
  '',
  'Den nest siste oppskriften i samlingen.',
  'De to siste oppskriftene i samlingen.',
  'De tre siste oppskriftene i samlingen.',
];

/**
 * `/` and `/?q=…`: the front page (S-LIST), search hits (S-SEARCH), no hits (S-NOHITS), the empty
 * collection (S-EMPTY) and the list that could not be loaded (S-LISTERR). Inventory §2.1–2.5.
 */
@Component({
  selector: 'app-recipe-list',
  imports: [RouterLink],
  templateUrl: './recipe-list.html',
  styleUrl: './recipe-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeList {
  private readonly site = inject(Site);

  /** The `q` query parameter. */
  readonly q = input<string>();
  protected readonly term = computed(() => (this.q() ?? '').trim());

  private readonly hits = httpResource<Recipe[]>(() => {
    const q = this.term();
    return q ? { url: '/api/recipes', params: { q } } : undefined;
  });

  protected readonly state = computed<State>(() => {
    const all = this.site.recipes;
    // An empty collection wins over a search (§3.1).
    if (all.hasValue() && all.value().length === 0) return 'empty';
    if (!this.term()) {
      if (all.error()) return 'error';
      return all.hasValue() ? 'front' : 'loading';
    }
    if (this.hits.error()) return 'error';
    if (!this.hits.hasValue() || all.isLoading()) return 'loading';
    return this.hits.value().length ? 'hits' : 'no-hits';
  });

  private readonly cards = computed(() =>
    this.site.recipes.hasValue() ? this.site.recipes.value().map(toCard) : [],
  );
  protected readonly lead = computed(() => this.cards()[0]);
  /** "9 ingredienser, lagt inn 2. oktober 2026." */
  protected readonly leadDek = computed(() => {
    const lead = this.lead();
    if (!lead) return '';
    const count = pluralise(lead.ingredientCount, 'ingrediens', 'ingredienser');
    return lead.added ? `${count}, lagt inn ${lead.added}.` : `${count}.`;
  });
  protected readonly side = computed(() => this.cards().slice(1, 4));
  protected readonly sideSub = computed(() => SIDE_SUB[this.side().length] ?? '');
  protected readonly index = computed(() => toIndex(this.cards()));
  protected readonly rest = computed(() => this.cards().slice(4));
  protected readonly restCols = computed(() => Math.min(this.rest().length, 4));

  protected readonly hitCards = computed(() =>
    this.hits.hasValue() ? this.hits.value().map(toCard) : [],
  );
  protected readonly retryHref = computed(() =>
    this.term() ? `/?q=${encodeURIComponent(this.term())}` : '/',
  );

  constructor() {
    const title = inject(Title);
    effect(() => {
      const q = this.term();
      title.setTitle(q ? `Søk: ${q} — food.st44.no` : 'food.st44.no — familiens oppskrifter');
    });
  }
}
