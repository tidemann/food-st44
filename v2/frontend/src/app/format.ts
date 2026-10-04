// Presentation helpers, ported from v1's src/view-model.js (inventory §3.6, §3.8).
//
// A recipe is four things: title, a newline list of ingredients, a block of instructions and
// created_at. Everything the design shows — the amount column, the numbered steps, the photo,
// the meta line — is derived from those four here, so the templates stay free of logic.
import type { Recipe } from './api/types';

const TIME_ZONE = 'Europe/Oslo';

const shortDate = new Intl.DateTimeFormat('nb-NO', {
  day: 'numeric',
  month: 'short',
  timeZone: TIME_ZONE,
});
const longDate = new Intl.DateTimeFormat('nb-NO', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: TIME_ZONE,
});
const weekdayDate = new Intl.DateTimeFormat('nb-NO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: TIME_ZONE,
});

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "2. okt" */
export function formatShort(value: string): string {
  const date = parseDate(value);
  return date ? shortDate.format(date).replace(/\.$/, '') : '';
}

/** "2. oktober 2026" */
export function formatLong(value: string): string {
  const date = parseDate(value);
  return date ? longDate.format(date) : '';
}

/** "Søndag 4. oktober 2026" — the dated line across the top of the masthead. */
export function formatMastheadDate(date: Date): string {
  const text = weekdayDate.format(date);
  return text.charAt(0).toLocaleUpperCase('nb') + text.slice(1);
}

/** Titles become file names: "Kjøttkaker i brun saus" → "kjottkaker-i-brun-saus". */
export function slugify(title: string): string {
  return title
    .toLocaleLowerCase('nb')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface Photo {
  src: string;
  width: number;
  height: number;
}

// The photos in public/img/recipes, matched to a recipe by its slugified title. As in v1, a new
// photo is a deploy: add the file and a line here.
const PHOTOS: ReadonlyMap<string, Photo> = new Map([
  ['farikal', { src: '/img/recipes/farikal.jpg', width: 1024, height: 683 }],
  ['fiskegrateng', { src: '/img/recipes/fiskegrateng.jpg', width: 1024, height: 683 }],
  [
    'kjottkaker-i-brun-saus',
    { src: '/img/recipes/kjottkaker-i-brun-saus.jpg', width: 731, height: 1100 },
  ],
  ['lapskaus', { src: '/img/recipes/lapskaus.jpg', width: 1024, height: 683 }],
  ['pinnekjott', { src: '/img/recipes/pinnekjott.jpg', width: 1024, height: 683 }],
  ['raspeballer', { src: '/img/recipes/raspeballer.jpg', width: 1024, height: 683 }],
  ['rommegrot', { src: '/img/recipes/rommegrot.jpg', width: 1024, height: 683 }],
  ['sveler', { src: '/img/recipes/sveler.jpg', width: 1024, height: 679 }],
]);

export function photoFor(title: string): Photo | null {
  return PHOTOS.get(slugify(title)) ?? null;
}

export function ingredientLines(ingredients: string): string[] {
  return ingredients
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
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

export interface Ingredient {
  amount: string;
  name: string;
}

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
 * Paragraphs are steps; if the cook wrote one paragraph, every line is a step. Numbers the cook
 * typed ("1. Rør deigen") are stripped so they are not doubled.
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

export function pluralise(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** Everything a card, a register row or the lead needs. */
export interface Card {
  id: number;
  title: string;
  photo: Photo | null;
  /** "9 ingredienser · 2. okt" */
  meta: string;
  ingredientCount: number;
  /** "2. okt" */
  date: string;
  /** "2. oktober 2026" */
  added: string;
}

export function toCard(recipe: Recipe): Card {
  const ingredientCount = ingredientLines(recipe.ingredients).length;
  const count = pluralise(ingredientCount, 'ingrediens', 'ingredienser');
  const date = formatShort(recipe.created_at);
  return {
    id: recipe.id,
    title: recipe.title,
    photo: photoFor(recipe.title),
    meta: date ? `${count} · ${date}` : count,
    ingredientCount,
    date,
    added: formatLong(recipe.created_at),
  };
}

const collator = new Intl.Collator('nb');

/** The alphabetical register: nb collation, so Æ Ø Å sort last. */
export function toIndex(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => collator.compare(a.title, b.title));
}
