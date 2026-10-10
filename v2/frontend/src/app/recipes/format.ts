// How stored recipe text is shown (inventory §3.6), ported from v1's src/view-model.js.
// The API returns the four stored fields; the amount column, the numbered steps, the dates and
// the meta lines are all derived here so the templates stay free of logic.
import type { Recipe } from '../api/types';

const ZONE = 'Europe/Oslo';
const shortDate = new Intl.DateTimeFormat('nb-NO', {
  day: 'numeric',
  month: 'short',
  timeZone: ZONE,
});
const longDate = new Intl.DateTimeFormat('nb-NO', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: ZONE,
});
const weekdayDate = new Intl.DateTimeFormat('nb-NO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: ZONE,
});

function parse(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "2. okt" */
export function formatShort(value: string): string {
  const date = parse(value);
  return date ? shortDate.format(date).replace(/\.$/, '') : '';
}

/** "2. oktober 2026" */
export function formatLong(value: string): string {
  const date = parse(value);
  return date ? longDate.format(date) : '';
}

/** "Søndag 4. oktober 2026" — the dated line across the top of the masthead. */
export function formatMastheadDate(date: Date = new Date()): string {
  const text = weekdayDate.format(date);
  return text.charAt(0).toLocaleUpperCase('nb') + text.slice(1);
}

export function pluralise(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

export function ingredientLines(ingredients: string): string[] {
  return ingredients
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export interface Ingredient {
  amount: string;
  name: string;
}

const UNITS =
  'g|kg|hg|dl|cl|ml|l|ts|ss|stk|pk|pakke|boks|bokser|glass|pose|poser|neve|never|cm|mm|porsjon|porsjoner';
const NUMBER = '(?:\\d+(?:[.,]\\d+)?|[¼½¾⅓⅔⅛])';
// "600 g kjøttdeig av storfe" → amount "600 g", name "kjøttdeig av storfe".
// "1 liten løk, finrevet" → amount "1". "salt og pepper" → no amount.
const AMOUNT = new RegExp(
  `^(${NUMBER}(?:\\s*[-–/]\\s*${NUMBER})?(?:\\s+${NUMBER})?)\\s*(${UNITS})?\\.?(?=\\s)\\s+(.+)$`,
  'i',
);

export function splitIngredient(line: string): Ingredient {
  const match = AMOUNT.exec(line);
  if (!match) return { amount: '', name: line };
  const [, number = '', unit, name = ''] = match;
  return { amount: unit ? `${number} ${unit}` : number, name: name.trim() };
}

export function ingredientsFor(ingredients: string): Ingredient[] {
  return ingredientLines(ingredients).map(splitIngredient);
}

/**
 * Paragraphs are steps; if the cook wrote one paragraph, every line is a step. Numbers the
 * cook typed ("1. Rør deigen") are stripped so they are not doubled.
 */
export function stepsFor(instructions: string): string[] {
  const text = instructions.trim();
  if (!text) return [];
  let parts = text
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 1) {
    parts = text
      .split(/\n+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return parts.map((part) => part.replace(/^\(?\d+[.):]\s+/, '').replace(/\s*\n\s*/g, ' '));
}

/** Everything a card, a register row or the lead needs. */
export interface Card {
  id: number;
  title: string;
  ingredientCount: number;
  /** "9 ingredienser · 2. okt" */
  meta: string;
  /** "2. okt" */
  date: string;
  /** "2. oktober 2026" */
  added: string;
  /** Its emneord, lower case, in Norwegian order (ST-784). */
  tags: string[];
  /** The dish's photo, or null: the plate stands in for it. */
  photo: string | null;
}

export function toCard(recipe: Recipe): Card {
  const ingredientCount = ingredientLines(recipe.ingredients).length;
  const count = pluralise(ingredientCount, 'ingrediens', 'ingredienser');
  const date = formatShort(recipe.created_at);
  return {
    id: recipe.id,
    title: recipe.title,
    ingredientCount,
    meta: date ? `${count} · ${date}` : count,
    date,
    added: formatLong(recipe.created_at),
    photo: recipe.photo_url,
    tags: recipe.tags,
  };
}

const collator = new Intl.Collator('nb');

/** The alphabetical register: nb collation, so Æ Ø Å sort last. */
export function toIndex(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => collator.compare(a.title, b.title));
}
