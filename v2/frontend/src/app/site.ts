import { httpResource } from '@angular/common/http';
import { computed, Injectable } from '@angular/core';
import type { Recipe } from './api/types';
import { formatLong } from './format';

/**
 * The whole collection, newest first. The masthead and footer carry its size and the date it was
 * last added to, and the unsearched front page is laid out from it. Reload after every change.
 */
@Injectable({ providedIn: 'root' })
export class Site {
  readonly recipes = httpResource<Recipe[]>(() => '/api/recipes');

  /** False while loading or when the list could not be fetched: the count is then unknown. */
  readonly known = computed(() => this.recipes.hasValue());
  readonly total = computed(() => (this.recipes.hasValue() ? this.recipes.value().length : 0));
  /** "2. oktober 2026": newest created_at, or '' for an empty or unknown collection. */
  readonly updated = computed(() => {
    const newest = this.recipes.hasValue() ? this.recipes.value()[0] : undefined;
    return newest ? formatLong(newest.created_at) : '';
  });

  reload(): void {
    this.recipes.reload();
  }
}
