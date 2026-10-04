import { httpResource } from '@angular/common/http';
import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Recipe } from '../api/types';
import { Flash } from '../chrome/flash';
import { Mast } from '../chrome/mast';
import { bindTitle, SITE } from '../chrome/title';
import { type Card, toCard, toIndex } from '../format';
import { Site } from '../site';

const SIDE_SUB = [
  '',
  'Den nest siste oppskriften i samlingen.',
  'De to siste oppskriftene i samlingen.',
  'De tre siste oppskriftene i samlingen.',
];

type State = 'loading' | 'error' | 'empty' | 'no-hits' | 'hits' | 'front';

/**
 * `/` and `/?q=` (inventory §2.1–2.5). The unsearched front page is laid out like the opening
 * spread of a magazine; a search answers with a plain register of hits instead.
 */
@Component({
  selector: 'app-list-page',
  imports: [Flash, Mast, NgOptimizedImage, RouterLink],
  templateUrl: './list.html',
  styleUrl: './list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListPage {
  readonly q = input<string>();
  readonly flash = input<string>();

  private readonly site = inject(Site);
  protected readonly query = computed(() => (this.q() ?? '').trim());

  /** Search goes to the API (title only, newest first). The front page uses the whole list. */
  private readonly hits = httpResource<Recipe[]>(() =>
    this.query() ? { url: '/api/recipes', params: { q: this.query() } } : undefined,
  );

  protected readonly state = computed<State>(() => {
    const all = this.site.recipes;
    if (this.query()) {
      if (this.hits.error()) return 'error';
      if (!this.hits.hasValue() || all.isLoading()) return 'loading';
      // An empty collection wins over "no hits" (inventory §2.4).
      if (this.hits.value().length === 0) {
        return all.hasValue() && all.value().length === 0 ? 'empty' : 'no-hits';
      }
      return 'hits';
    }
    if (all.error()) return 'error';
    if (!all.hasValue()) return 'loading';
    return all.value().length === 0 ? 'empty' : 'front';
  });

  protected readonly cards = computed<Card[]>(() => {
    const source = this.query() ? this.hits : this.site.recipes;
    return source.hasValue() ? source.value().map(toCard) : [];
  });

  /** "N treff på «q»" — "treff" for one hit as well. */
  protected readonly count = computed(
    () => `${String(this.cards().length)} treff på «${this.query()}»`,
  );

  protected readonly front = computed(() => {
    const cards = this.cards();
    const side = cards.slice(1, 4);
    return {
      lead: cards[0],
      side,
      sideSub: SIDE_SUB[side.length] ?? '',
      index: toIndex(cards),
      indexSub:
        cards.length === 1
          ? 'Den ene oppskriften i samlingen.'
          : `Alle ${String(cards.length)} oppskriftene, i alfabetisk rekkefølge.`,
      rest: cards.slice(4),
    };
  });

  /** Carried on to the recipe page from a search hit, and to the S-LISTERR retry. */
  protected readonly retryHref = computed(() =>
    this.query() ? `/?q=${encodeURIComponent(this.query())}` : '/',
  );

  constructor() {
    bindTitle(() =>
      this.query() ? `Søk: ${this.query()} — ${SITE}` : `${SITE} — familiens oppskrifter`,
    );
  }
}
