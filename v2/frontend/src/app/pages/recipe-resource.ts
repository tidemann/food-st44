import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { computed, type Signal } from '@angular/core';
import type { Params } from '@angular/router';
import type { Recipe } from '../api/types';

export type RecipeState = 'loading' | 'not-found' | 'error' | 'ready';

/**
 * One recipe for the `/recipes/:id…` pages. v1 read `:id` with parseInt, so `/recipes/3abc` is
 * recipe 3 and `0`, `-1`, `abc` are a recipe 404 without asking the API (inventory §1). Kept, so
 * links in the wild keep working.
 */
export function recipeResource(id: Signal<string | undefined>) {
  const recipeId = computed(() => parseRecipeId(id()));
  const resource = httpResource<Recipe>(() => {
    const value = recipeId();
    return value === null ? undefined : `/api/recipes/${String(value)}`;
  });
  const state = computed<RecipeState>(() => {
    if (recipeId() === null) return 'not-found';
    const error = resource.error();
    if (error)
      return error instanceof HttpErrorResponse && error.status === 404 ? 'not-found' : 'error';
    return resource.hasValue() ? 'ready' : 'loading';
  });
  return {
    id: recipeId,
    state,
    value: computed(() => (resource.hasValue() ? resource.value() : null)),
  };
}

export function parseRecipeId(value: string | undefined): number | null {
  const id = Number.parseInt(value ?? '', 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** `?q=` to hand on, or nothing: a search is carried from page to page (inventory §3.1). */
export function searchParams(q: string | undefined): Params {
  const query = (q ?? '').trim();
  return query ? { q: query } : {};
}
