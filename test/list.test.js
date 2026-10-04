process.env.DB_PATH = ':memory:';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/server');
const db = require('../src/db');

const insert = db.prepare('INSERT INTO recipes (title, ingredients, instructions, created_at) VALUES (?, ?, ?, ?)');

function occurrences(text, needle) {
  return text.split(needle).length - 1;
}

test.beforeEach(() => {
  db.exec('DELETE FROM recipes');
});

test('S2: no recipes shows the empty state and a single add action', async () => {
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /<h1>Oppskrifter<\/h1>/);
  assert.match(res.text, /Ingen oppskrifter ennå/);
  assert.match(res.text, /Legg inn den første, så finner dere den igjen her\./);
  assert.match(res.text, /<a class="btn btn--primary" href="\/recipes\/new">\+ Legg til den første oppskriften<\/a>/);
  // Nothing to search, and the centred button is the only action.
  assert.doesNotMatch(res.text, /role="search"/);
  assert.doesNotMatch(res.text, /\+ Ny oppskrift/);
  assert.doesNotMatch(res.text, /class="action-bar"/);
});

test('S1: one add action in the header and one in the action bar, both to /recipes/new', async () => {
  insert.run('Fiskegrateng', '400 g torsk', 'Bak.', '2026-10-02 10:00:00');
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.equal(occurrences(res.text, '+ Ny oppskrift'), 2);
  assert.match(res.text, /<header class="app-header">[\s\S]*?<a class="btn btn--primary" href="\/recipes\/new">\+ Ny oppskrift<\/a>[\s\S]*?<\/header>/);
  assert.match(res.text, /<div class="action-bar">\s*<a class="btn btn--primary btn--block" href="\/recipes\/new">\+ Ny oppskrift<\/a>/);
});

test('S1: the CSS shows exactly one of the two add actions per viewport', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(css, /@media \(min-width: 48rem\) \{ \.action-bar \{ display:none; \} \}/);
  assert.match(css, /@media \(max-width: 47\.99rem\) \{ \.app-header \.btn--primary \{ display:none; \} \}/);
  assert.match(css, /\.recipe-card:hover, \.recipe-card:focus-visible \{\s*border-color: var\(--c-brand\); background: var\(--c-brand-tint\); \}/);
});

test('S1: cards are one link with title and meta only — no ingredients or instructions', async () => {
  insert.run('Fiskegrateng', '400 g torskefilet\n5 dl melk\n\n3 ss hvetemel\n', 'Kok opp melken.', '2026-10-02 10:00:00');
  insert.run('Havregrøt', '1 dl havregryn', 'Kok.', '2026-09-28 08:00:00');
  const res = await request(app).get('/');
  assert.match(res.text, /<a class="recipe-card" href="\/recipes\/\d+">\s*<h2 class="recipe-card__title">Fiskegrateng<\/h2>\s*<p class="recipe-card__meta">3 ingredienser · 2\. okt<\/p>\s*<\/a>/);
  assert.match(res.text, /<p class="recipe-card__meta">1 ingrediens · 28\. sep<\/p>/);
  for (const text of ['torskefilet', '5 dl melk', 'Kok opp melken', 'havregryn', 'Ingredienser', 'Fremgangsmåte']) {
    assert.ok(!res.text.includes(text), `list must not contain "${text}"`);
  }
  assert.equal(occurrences(res.text, '<button'), 1, 'only the search submit is a button');
});

test('S1: newest recipe first', async () => {
  insert.run('Eldst', 'a', '', '2026-09-01 10:00:00');
  insert.run('Nyest', 'a', '', '2026-10-01 10:00:00');
  const res = await request(app).get('/');
  assert.ok(res.text.indexOf('Nyest') < res.text.indexOf('Eldst'));
});

test('count line: singular at 1, plural at 12', async () => {
  insert.run('Én rett', 'a', '', '2026-10-01 10:00:00');
  let res = await request(app).get('/');
  assert.match(res.text, /<p class="result-count" role="status">1 oppskrift<\/p>/);

  for (let i = 2; i <= 12; i += 1) insert.run(`Rett ${i}`, 'a', '', '2026-10-01 10:00:00');
  res = await request(app).get('/');
  assert.match(res.text, /<p class="result-count" role="status">12 oppskrifter<\/p>/);
  assert.doesNotMatch(res.text, /Tøm søk/);
});

test('search form: labelled, hidden Søk submit, query echoed', async () => {
  insert.run('Fiskesuppe', 'a', '', '2026-10-01 10:00:00');
  const res = await request(app).get('/').query({ q: 'fiske' });
  assert.match(res.text, /<form class="search" method="get" action="\/" role="search">/);
  assert.match(res.text, /<label class="visually-hidden" for="q">Søk etter oppskrift<\/label>/);
  assert.match(res.text, /<input class="search-field" type="search" id="q" name="q"\s+placeholder="Søk etter oppskrift" value="fiske">/);
  assert.match(res.text, /<button class="visually-hidden-focusable" type="submit">Søk<\/button>/);
});

test('filtered count: «treff» is invariant at 1 and 3, with Tøm søk back to /', async () => {
  insert.run('Fiskesuppe', 'a', '', '2026-10-01 10:00:00');
  insert.run('Kjøttkaker', 'a', '', '2026-10-01 10:00:00');
  let res = await request(app).get('/').query({ q: 'fiske' });
  assert.match(res.text, /<p class="result-count" role="status">1 treff på «fiske» — <a href="\/">Tøm søk<\/a><\/p>/);

  insert.run('Fiskegrateng', 'a', '', '2026-10-01 10:00:00');
  insert.run('Fiskekaker', 'a', '', '2026-10-01 10:00:00');
  res = await request(app).get('/').query({ q: 'fiske' });
  assert.match(res.text, /3 treff på «fiske» — <a href="\/">Tøm søk<\/a>/);
  assert.ok(!res.text.includes('Kjøttkaker'));
});

test('filtered cards carry the search into the detail link', async () => {
  insert.run('Fiske og ris', 'a', '', '2026-10-01 10:00:00');
  const res = await request(app).get('/').query({ q: 'fiske og' });
  assert.match(res.text, /<a class="recipe-card" href="\/recipes\/\d+\?q=fiske%20og">/);
});

test('S3: no hits has its own copy and a Vis alle button, distinct from S2', async () => {
  insert.run('Kjøttkaker', 'a', '', '2026-10-01 10:00:00');
  const res = await request(app).get('/').query({ q: 'fiske' });
  assert.equal(res.status, 200);
  assert.match(res.text, /<h2 class="empty-state__title">Ingen treff på «fiske»<\/h2>/);
  assert.match(res.text, /Prøv et kortere søk, eller se alle oppskriftene\./);
  assert.match(res.text, /<a class="btn btn--secondary" href="\/">Vis alle oppskrifter<\/a>/);
  assert.match(res.text, /value="fiske"/);
  assert.match(res.text, /class="action-bar"/);
  assert.doesNotMatch(res.text, /Ingen oppskrifter ennå/);
  assert.doesNotMatch(res.text, /class="result-count"/);
  assert.doesNotMatch(res.text, /Ny oppskrift «/);
});

test('S3: the echoed query is HTML-escaped', async () => {
  insert.run('Kjøttkaker', 'a', '', '2026-10-01 10:00:00');
  const res = await request(app).get('/').query({ q: '<script>x</script>' });
  assert.ok(!res.text.includes('<script>x'));
  assert.match(res.text, /Ingen treff på «&lt;script&gt;x&lt;\/script&gt;»/);
});

test('S4: a failing list query renders in-page with 500, search, retry and add action', async (t) => {
  t.mock.method(db, 'prepare', () => { throw new Error('SQLITE_BUSY'); });
  t.mock.method(console, 'error', () => {});
  const res = await request(app).get('/').query({ q: 'fiske' });
  assert.equal(res.status, 500);
  assert.match(res.text, /<h1>Oppskrifter<\/h1>/);
  assert.match(res.text, /role="search"/);
  assert.match(res.text, /<div class="alert alert--error" role="alert">/);
  assert.match(res.text, /<p class="alert__title">Kunne ikke hente oppskriftene\.<\/p>/);
  assert.match(res.text, /Prøv igjen om litt\./);
  assert.match(res.text, /<a class="btn btn--secondary" href="\/\?q=fiske">Prøv på nytt<\/a>/);
  assert.match(res.text, /<div class="action-bar">/);
  assert.equal(occurrences(res.text, '+ Ny oppskrift'), 2);
  assert.ok(!res.text.includes('SQLITE_BUSY'));
  assert.doesNotMatch(res.text, /Ingen oppskrifter ennå|Ingen treff|class="result-count"/);
});

test('keyboard path: skip link → search → first card, in DOM order', async () => {
  insert.run('Fiskegrateng', 'a', '', '2026-10-01 10:00:00');
  const res = await request(app).get('/');
  const skip = res.text.indexOf('href="#main"');
  const main = res.text.indexOf('<main id="main" tabindex="-1">');
  const search = res.text.indexOf('id="q"');
  const card = res.text.indexOf('class="recipe-card"');
  const bar = res.text.indexOf('class="action-bar"');
  assert.ok(skip > -1 && skip < main && main < search && search < card && card < bar);
});
