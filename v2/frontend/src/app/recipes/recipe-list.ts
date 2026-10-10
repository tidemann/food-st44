import { NgOptimizedImage } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import type { Recipe } from '../api/types';
import { Auth } from '../auth';
import { Flash } from '../pages/flash';
import { Site } from '../site';
import { pluralise, toCard, toIndex } from './format';
import { TagLine } from './tag-line';
import { tagLabel, tagParam } from './tags';

type State = 'loading' | 'empty' | 'error' | 'no-hits' | 'hits' | 'front';

const SIDE_SUB = [
  '',
  'Den nest siste oppskriften i samlingen.',
  'De to siste oppskriftene i samlingen.',
  'De tre siste oppskriftene i samlingen.',
];

/** `{ q, tag }` for a link, without the ones that are blank. */
function query(q: string, tag: string): { q?: string; tag?: string } {
  return { ...(q ? { q } : {}), ...(tag ? { tag } : {}) };
}

/**
 * `/` and `/?q=…`: the front page (S-LIST), search hits (S-SEARCH), no hits (S-NOHITS), the empty
 * collection (S-EMPTY) and the list that could not be loaded (S-LISTERR). Inventory §2.1–2.5.
 * `/?tag=…` keeps one emneord, alone or with `q` (ST-784); the tag band above the list sets it.
 */
@Component({
  selector: 'app-recipe-list',
  imports: [NgOptimizedImage, RouterLink, Flash, TagLine],
  templateUrl: './recipe-list.html',
  styleUrl: './recipe-list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecipeList {
  private readonly site = inject(Site);
  /** Only an editor is offered to add the first recipe (M2). */
  protected readonly editor = inject(Auth).isEditor;

  /** The `q` query parameter. */
  readonly q = input<string>();
  /** The `tag` query parameter (ST-784). */
  readonly tag = input<string>();
  /** `?flash=deleted` after a delete (§3.3); any of the three keys is shown (§3.4). */
  readonly flash = input<string>();
  protected readonly term = computed(() => (this.q() ?? '').trim());
  /** The tag filtered on, as stored: lower case. '' when there is none. */
  protected readonly active = computed(() => tagParam(this.tag()));
  private readonly filtered = computed(() => !!this.term() || !!this.active());

  private readonly hits = httpResource<Recipe[]>(() =>
    this.filtered()
      ? { url: '/api/recipes', params: query(this.term(), this.active()) }
      : undefined,
  );

  /** The band: every tag in use, each a link that sets it, or clears it when it is the one on. */
  protected readonly band = computed(() => {
    const tags = this.site.tags;
    if (!tags.hasValue()) return [];
    const q = this.term();
    return tags.value().map(({ name, count }) => {
      const on = name === this.active();
      return { name, count, on, label: tagLabel(name), query: query(q, on ? '' : name) };
    });
  });
  /** Links from a hit carry the search and the filter on to the recipe. */
  protected readonly carried = computed(() => query(this.term(), this.active()));
  /** "Tøm søk" keeps the filter; "Tøm filter" keeps the search. */
  protected readonly withoutSearch = computed(() => query('', this.active()));
  protected readonly withoutTag = computed(() => query(this.term(), ''));
  /** "«kylling» merket «middag»", the words after "N treff på" or "Ingen treff på". */
  protected readonly what = computed(() => {
    const q = this.term();
    const tag = this.active();
    if (!tag) return `«${q}»`;
    return q ? `«${q}» merket «${tag}»` : `merket «${tag}»`;
  });
  protected readonly countLine = computed(() => {
    const n = this.hitCards().length;
    return this.term()
      ? `${String(n)} treff på ${this.what()}`
      : `${pluralise(n, 'oppskrift', 'oppskrifter')} ${this.what()}`;
  });
  protected readonly noHitsLine = computed(() =>
    this.term() ? `Ingen treff på ${this.what()}` : `Ingen oppskrifter ${this.what()}`,
  );

  protected readonly state = computed<State>(() => {
    const all = this.site.recipes;
    // An empty collection wins over a search (§3.1).
    if (all.hasValue() && all.value().length === 0) return 'empty';
    if (!this.filtered()) {
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
  protected readonly retryHref = computed(() => {
    const params = new URLSearchParams(this.carried()).toString();
    return params ? `/?${params}` : '/';
  });

  constructor() {
    const title = inject(Title);
    effect(() => {
      const q = this.term();
      const tag = this.active();
      if (q && tag) title.setTitle(`Søk: ${q}, merket ${tag} — food.st44.no`);
      else if (q) title.setTitle(`Søk: ${q} — food.st44.no`);
      else if (tag) title.setTitle(`Emneord: ${tag} — food.st44.no`);
      else title.setTitle('food.st44.no — familiens oppskrifter');
    });
  }
}
