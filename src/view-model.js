// Presentation helpers for the Søndag front end (ST-286).
//
// The database stores four things per recipe: title, a newline list of
// ingredients, a block of instructions and created_at. Everything the design
// shows — the amount column, the numbered steps, the photograph, the meta
// line — is derived from those four here, so the views stay free of logic and
// the derivation is testable on its own.
const fs = require('fs');
const path = require('path');

const PHOTO_DIR = path.join(__dirname, '..', 'public', 'img', 'recipes');
const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

const shortDate = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', timeZone: 'Europe/Oslo' });
const longDate = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' });
const weekdayDate = new Intl.DateTimeFormat('nb-NO', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo'
});

// created_at is SQLite CURRENT_TIMESTAMP: UTC, "YYYY-MM-DD HH:MM:SS".
function parseCreatedAt(value) {
  const date = new Date(`${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatShort(value) {
  const date = parseCreatedAt(value);
  return date ? shortDate.format(date).replace(/\.$/, '') : '';
}

function formatLong(value) {
  const date = parseCreatedAt(value);
  return date ? longDate.format(date) : '';
}

// "Lørdag 3. oktober 2026" — the dated line across the top of the masthead.
function formatMastheadDate(date = new Date()) {
  const text = weekdayDate.format(date);
  return text.charAt(0).toLocaleUpperCase('nb') + text.slice(1);
}

// Titles become file names, so "Kjøttkaker i brun saus" finds
// public/img/recipes/kjottkaker-i-brun-saus.jpg.
function slugify(title) {
  return String(title)
    .toLocaleLowerCase('nb')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Which slugs have a photograph on disk. Read once per process; a new photo is
// a deploy, not a request. Returns an empty set when the directory is absent.
let photoIndex = null;

function readPhotoIndex() {
  const index = new Map();
  let entries;
  try {
    entries = fs.readdirSync(PHOTO_DIR);
  } catch (err) {
    return index;
  }
  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    if (!PHOTO_EXTENSIONS.includes(ext)) continue;
    const slug = path.basename(entry, path.extname(entry));
    if (!index.has(slug)) index.set(slug, `/img/recipes/${entry}`);
  }
  return index;
}

function photoFor(title) {
  if (!photoIndex) photoIndex = readPhotoIndex();
  return photoIndex.get(slugify(title)) || null;
}

function ingredientLines(ingredients) {
  return String(ingredients || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const UNITS = 'g|kg|hg|dl|cl|ml|l|ts|ss|stk|pk|pakke|boks|bokser|glass|pose|poser|neve|never|cm|mm|porsjon|porsjoner';
const NUMBER = '(?:\\d+(?:[.,]\\d+)?|[¼½¾⅓⅔⅛])';
// "600 g kjøttdeig av storfe" → amount "600 g", name "kjøttdeig av storfe".
// "1 liten løk, finrevet" → amount "1". "salt og pepper" → no amount.
const AMOUNT = new RegExp(
  `^(${NUMBER}(?:\\s*[-–/]\\s*${NUMBER})?(?:\\s+${NUMBER})?)\\s*(${UNITS})?\\.?(?=\\s)\\s+(.+)$`,
  'i'
);

function splitIngredient(line) {
  const match = AMOUNT.exec(line);
  if (!match) return { amount: '', name: line };
  const amount = match[2] ? `${match[1]} ${match[2]}` : match[1];
  return { amount, name: match[3].trim() };
}

function ingredientsFor(ingredients) {
  return ingredientLines(ingredients).map(splitIngredient);
}

// Instructions are free text. Paragraphs are steps; if the cook wrote one
// paragraph per line, single newlines are steps instead. Numbers the cook
// typed in ("1. Rør deigen") are stripped so they are not doubled.
function stepsFor(instructions) {
  const text = String(instructions || '').trim();
  if (!text) return [];
  let parts = text.split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1) {
    parts = text.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  }
  return parts.map((part) => part.replace(/^\(?\d+[.):]\s+/, '').replace(/\s*\n\s*/g, ' '));
}

function pluralise(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

// "9 ingredienser · 2. okt" — the meta line under a title in the register.
function recipeMeta(recipe) {
  const count = pluralise(ingredientLines(recipe.ingredients).length, 'ingrediens', 'ingredienser');
  const date = formatShort(recipe.created_at);
  return date ? `${count} · ${date}` : count;
}

// Everything a card, a register row or the lead needs.
function toCard(recipe) {
  return {
    id: recipe.id,
    title: recipe.title,
    photo: photoFor(recipe.title),
    meta: recipeMeta(recipe),
    ingredientCount: ingredientLines(recipe.ingredients).length,
    date: formatShort(recipe.created_at),
    added: formatLong(recipe.created_at)
  };
}

// The alphabetical register down the right-hand side of the front page.
const collator = new Intl.Collator('nb');

function toIndex(cards) {
  return [...cards].sort((a, b) => collator.compare(a.title, b.title));
}

module.exports = {
  formatShort,
  formatLong,
  formatMastheadDate,
  slugify,
  photoFor,
  ingredientLines,
  splitIngredient,
  ingredientsFor,
  stepsFor,
  pluralise,
  recipeMeta,
  toCard,
  toIndex
};
