import { httpResource } from '@angular/common/http';
import { computed, type Signal } from '@angular/core';
import type { Meal } from '../api/types';
import { ingredientLines, pluralise } from '../recipes/format';
import { failureOf, type LoadState, parseId } from '../recipes/load';

// Meals (ST-1968): a dinner without a recipe, only a name, what to buy and a short note.

/** One item as the meal page shows it: the name, and the amount after a dotted leader. */
export interface Item {
  name: string;
  amount: string;
}

// The recipe page's units (recipes/format.ts) and the packs a shop sells: «1 beger raita».
const UNITS =
  'g|kg|hg|dl|cl|ml|l|ts|ss|stk|pk|pakke|pakker|boks|bokser|glass|pose|poser|beger|flaske|' +
  'flasker|brett|bunt|bunter|krukke|kartong|nett|neve|never|fedd|porsjon|porsjoner';
const NUMBER = '(?:\\d+(?:[.,]\\d+)?|[¼½¾⅓⅔⅛])';
// "2 pk naan" → amount "2 pk", name "naan". "1 stor pakke (ca. 1,2 kg) kylling" keeps the
// number only. "mango chutney" has no amount.
const AMOUNT = new RegExp(
  `^(${NUMBER}(?:\\s*[-–/]\\s*${NUMBER})?)\\s*(${UNITS})?\\.?(?=\\s)\\s+(.+)$`,
  'i',
);

export function splitItem(line: string): Item {
  const match = AMOUNT.exec(line);
  if (!match) return { name: line, amount: '' };
  const [, number = '', unit, name = ''] = match;
  return { name: name.trim(), amount: unit ? `${number} ${unit}` : number };
}

export function itemsFor(items: string): Item[] {
  return ingredientLines(items).map(splitItem);
}

/** "7 varer", "1 vare" */
export function itemsLabel(count: number): string {
  return pluralise(count, 'vare', 'varer');
}

/** "6 måltider", "1 måltid" */
export function mealsLabel(count: number): string {
  return pluralise(count, 'måltid', 'måltider');
}

/** "Alle 6 måltidene", "Det ene måltidet" */
export function allMealsLabel(count: number): string {
  return count === 1 ? 'Det ene måltidet' : `Alle ${String(count)} måltidene`;
}

export const byTitle = (a: Meal, b: Meal): number => a.title.localeCompare(b.title, 'nb');

/**
 * The meal behind a `/maltider/:id…` page. Call it from a field initialiser (it creates an
 * httpResource). An invalid id never reaches the API.
 */
export function loadMeal(id: Signal<string>) {
  const mealId = computed(() => parseId(id()));
  const meal = httpResource<Meal>(() => {
    const value = mealId();
    return value === null ? undefined : `/api/meals/${String(value)}`;
  });
  const state = computed<LoadState>(() => {
    if (mealId() === null) return 'not-found';
    const error = meal.error();
    if (error) return failureOf(error);
    return meal.hasValue() ? 'ready' : 'loading';
  });
  return { meal, state };
}
