import { httpResource } from '@angular/common/http';
import { computed, Injectable } from '@angular/core';
import type { Recipe } from './api/types';
import { formatLong } from './recipes/format';

/**
 * The whole collection, newest first. The masthead and footer show its size and the date it was
 * last added to on every page, and the unsearched front page is laid out from it. If it cannot be
 * loaded the size is simply unknown: the search stays visible and the count is hidden (§2.14).
 */
@Injectable({ providedIn: 'root' })
export class Site {
  readonly recipes = httpResource<Recipe[]>(() => '/api/recipes');

  readonly total = computed(() => (this.recipes.hasValue() ? this.recipes.value().length : 0));
  /** "Sist oppdatert": the newest `created_at`, or '' when there is none. */
  readonly updated = computed(() => {
    const newest = this.recipes.hasValue() ? this.recipes.value()[0] : undefined;
    return newest ? formatLong(newest.created_at) : '';
  });
  /**
   * The search is hidden when the collection is known to be empty, and shown when it could not
   * be loaded. While loading it stays hidden, so an empty site never flashes a search field.
   */
  readonly searchable = computed(() => this.total() > 0 || this.recipes.error() !== undefined);
}
