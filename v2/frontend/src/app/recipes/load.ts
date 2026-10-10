import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { computed, type Signal } from '@angular/core';
import type { Recipe } from '../api/types';
import { normaliseTag } from './tags';

/**
 * v1 parsed the id with parseInt, so "3abc" is recipe 3 and "0", "-1", "abc" are not a recipe.
 * Kept as it was so every live link resolves the same way (inventory §1).
 */
export function parseId(value: string): number | null {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** The search and the tag filter a recipe page was reached from, carried on by its links. */
export interface Carried {
  q?: string;
  tag?: string;
}

/**
 * `{ q, tag }` for a link that carries the search (§3.1) and the tag filter (ST-784) on, without
 * the blank ones.
 */
export function carry(q: string | undefined, tag?: string): Carried {
  const term = (q ?? '').trim();
  const name = normaliseTag(tag ?? '');
  return { ...(term ? { q: term } : {}), ...(name ? { tag: name } : {}) };
}

/** S-404R for an unknown or invalid id, S-500 when the API fails (§2.12, §2.14). */
export type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

/** What a 404 or any other failed request means for the page. */
export function failureOf(error: unknown): 'not-found' | 'error' {
  return error instanceof HttpErrorResponse && error.status === 404 ? 'not-found' : 'error';
}

/**
 * The recipe behind a `/recipes/:id…` page. Call it from a field initialiser (it creates an
 * httpResource). An invalid id never reaches the API.
 */
export function loadRecipe(id: Signal<string>) {
  const recipeId = computed(() => parseId(id()));
  const recipe = httpResource<Recipe>(() => {
    const value = recipeId();
    return value === null ? undefined : `/api/recipes/${String(value)}`;
  });
  const state = computed<LoadState>(() => {
    if (recipeId() === null) return 'not-found';
    const error = recipe.error();
    if (error) return failureOf(error);
    return recipe.hasValue() ? 'ready' : 'loading';
  });
  return { recipe, state };
}
