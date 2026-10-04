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
  assert.match(res.text, /<h1 class="wordmark">/);
  assert.match(res.text, /Ingen oppskrifter ennå/);
  assert.match(res.text, /Legg inn den første, så finner dere den igjen her\./);
  assert.match(res.text, /<a class="btn btn--primary btn--lg" href="\/recipes\/new">Legg til den første oppskriften<\/a>/);
  // Nothing to search yet, so the masthead drops its search field and its count.
  assert.doesNotMatch(res.text, /role="search"/);
  assert.doesNotMatch(res.text, /i samlingen/);
  // The nav link is the only other way to add, and it is chrome, not a rival CTA.
  assert.equal(occurrences(res.text, 'href="/recipes/new"'), 2);
});

test('S1: adding is one nav link, reachable at every viewport', async () => {
  insert.run('Fiskegrateng', '400 g torsk', 'Bak.', '2026-10-02 10:00:00');
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.equal(occurrences(res.text, '>Ny oppskrift<'), 1);
  assert.match(res.text, /<nav class="mast__nav">[\s\S]*?<a href="\/recipes\/new">Ny oppskrift<\/a>[\s\S]*?<\/nav>/);
});

test('S1: the masthead nav stays put on small screens, so adding is always one tap away', async () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const mobile = css.slice(css.indexOf('@media (max-width:760px)'));
  assert.match(mobile, /\.mastbar\{[^}]*position:sticky;top:0/);

  // A sticky element only sticks inside its own parent, so the bar that sticks
  // must not be nested in the masthead's .wrap — there it would scroll away
  // with the masthead (QA found exactly that on ST-398).
  const res = await request(app).get('/');
  const markup = res.text.replace(/\s+/g, ' ');
  assert.match(markup, /<\/header> <div class="mastbar"> <div class="wrap"> <nav class="mast__nav">/);
  assert.doesNotMatch(markup.slice(0, markup.indexOf('</header>')), /mastbar/);
});

test('S1: the register shows title and meta only — no ingredients or instructions', async () => {
  insert.run('Fiskegrateng', '400 g torskefilet\n5 dl melk\n\n3 ss hvetemel\n', 'Kok opp melken.', '2026-10-02 10:00:00');
  insert.run('Havregrøt', '1 dl havregryn', 'Kok.', '2026-09-28 08:00:00');
  const res = await request(app).get('/');
  assert.match(res.text, /<h2><a href="\/recipes\/\d+">Fiskegrateng<\/a><\/h2>/);
  assert.match(res.text, /<p class="lead__dek">3\s+ingredienser,\s+lagt inn 2\. oktober 2026\.<\/p>/);
  assert.match(res.text, /<h3>Havregrøt<\/h3>\s*<p class="m">1 ingrediens · 28\. sep<\/p>/);
  for (const text of ['torskefilet', '5 dl melk', 'Kok opp melken', 'havregryn', 'Ingredienser', 'Fremgangsmåte']) {
    assert.ok(!res.text.includes(text), `list must not contain "${text}"`);
  }
  assert.equal(occurrences(res.text, '<button'), 1, 'only the search submit is a button');
});

test('S1: newest recipe leads', async () => {
  insert.run('Eldst', 'a', '', '2026-09-01 10:00:00');
  insert.run('Nyest', 'a', '', '2026-10-01 10:00:00');
  const res = await request(app).get('/');
  assert.match(res.text, /<p class="kicker">Sist lagt inn<\/p>\s*<h2><a href="\/recipes\/\d+">Nyest<\/a><\/h2>/);
});

test('S1: every recipe reaches the alphabetical register, however many there are', async () => {
  for (const title of ['Ørret', 'Fårikål', 'Aspargessuppe', 'Lapskaus', 'Sveler', 'Rømmegrøt']) {
    insert.run(title, 'a', '', '2026-10-01 10:00:00');
  }
  const res = await request(app).get('/');
  const register = res.text.slice(res.text.indexOf('Hele samlingen'));
  const order = ['Aspargessuppe', 'Fårikål', 'Lapskaus', 'Rømmegrøt', 'Sveler', 'Ørret']
    .map((title) => register.indexOf(`>${title}</a>`));
  assert.ok(order.every((at, i) => at > -1 && (i === 0 || at > order[i - 1])), 'nb-NO alphabetical');
  assert.match(res.text, /Alle 6 oppskriftene, i alfabetisk rekkefølge\./);
});

test('count line: the masthead counts the collection, singular at 1 and plural at 12', async () => {
  insert.run('Én rett', 'a', '', '2026-10-01 10:00:00');
  let res = await request(app).get('/');
  assert.match(res.text, /<span class="count">1 oppskrift i samlingen<\/span>/);

  for (let i = 2; i <= 12; i += 1) insert.run(`Rett ${i}`, 'a', '', '2026-10-01 10:00:00');
  res = await request(app).get('/');
  assert.match(res.text, /<span class="count">12 oppskrifter i samlingen<\/span>/);
  assert.doesNotMatch(res.text, /Tøm søk/);
  assert.doesNotMatch(res.text, /class="result-count"/);
});

test('search form: labelled, hidden Søk submit, query echoed', async () => {
  insert.run('Fiskesuppe', 'a', '', '2026-10-01 10:00:00');
  const res = await request(app).get('/').query({ q: 'fiske' });
  assert.match(res.text, /<form class="search" method="get" action="\/" role="search">/);
  assert.match(res.text, /<label for="q">Søk<\/label>/);
  assert.match(res.text, /<input class="search-field" type="search" id="q" name="q"\s+placeholder="brun saus, kål, torsk …" value="fiske">/);
  assert.match(res.text, /<button class="visually-hidden-focusable" type="submit">Søk<\/button>/);
});

test('filtered count: «treff» is invariant at 1 and 3, with Tøm søk back to /', async () => {
  insert.run('Fiskesuppe', 'a', '', '2026-10-01 10:00:00');
  insert.run('Kjøttkaker', 'a', '', '2026-10-01 10:00:00');
  let res = await request(app).get('/').query({ q: 'fiske' });
  assert.match(res.text, /<p class="result-count" role="status">1 treff på «fiske»<\/p>/);
  assert.match(res.text, /<a href="\/">Tøm søk<\/a>/);

  insert.run('Fiskegrateng', 'a', '', '2026-10-01 10:00:00');
  insert.run('Fiskekaker', 'a', '', '2026-10-01 10:00:00');
  res = await request(app).get('/').query({ q: 'fiske' });
  assert.match(res.text, /3 treff på «fiske»/);
  assert.ok(!res.text.includes('Kjøttkaker'));
});

test('a search answers with a register, not with a lead dish', async () => {
  insert.run('Fiskesuppe', 'a', '', '2026-10-01 10:00:00');
  const res = await request(app).get('/').query({ q: 'fiske' });
  assert.doesNotMatch(res.text, /Sist lagt inn|Hele samlingen|Nylig lagt inn/);
});

test('filtered hits carry the search into the detail link', async () => {
  insert.run('Fiske og ris', 'a', '', '2026-10-01 10:00:00');
  const res = await request(app).get('/').query({ q: 'fiske og' });
  assert.match(res.text, /<a class="sideitem" href="\/recipes\/\d+\?q=fiske%20og">/);
});

test('S3: no hits has its own copy and a Vis alle button, distinct from S2', async () => {
  insert.run('Kjøttkaker', 'a', '', '2026-10-01 10:00:00');
  const res = await request(app).get('/').query({ q: 'fiske' });
  assert.equal(res.status, 200);
  assert.match(res.text, /<h2>Ingen treff på «fiske»<\/h2>/);
  assert.match(res.text, /Prøv et kortere søk, eller se alle oppskriftene\./);
  assert.match(res.text, /<a class="btn btn--lg" href="\/">Vis alle oppskrifter<\/a>/);
  assert.match(res.text, /value="fiske"/);
  assert.doesNotMatch(res.text, /Ingen oppskrifter ennå/);
  assert.doesNotMatch(res.text, /class="result-count"/);
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
  assert.match(res.text, /<h1 class="wordmark">/);
  // The count is unknown when the database is down, but the search must survive.
  assert.match(res.text, /role="search"/);
  assert.doesNotMatch(res.text, /i samlingen/);
  assert.match(res.text, /<div class="alert" role="alert">/);
  assert.match(res.text, /<p class="alert__title">Kunne ikke hente oppskriftene\.<\/p>/);
  assert.match(res.text, /Prøv igjen om litt\./);
  assert.match(res.text, /<a class="btn" href="\/\?q=fiske">Prøv på nytt<\/a>/);
  assert.match(res.text, /<a href="\/recipes\/new">Ny oppskrift<\/a>/);
  assert.ok(!res.text.includes('SQLITE_BUSY'));
  assert.doesNotMatch(res.text, /Ingen oppskrifter ennå|Ingen treff|class="result-count"/);
});

test('keyboard path: skip link → search → nav → main → first recipe, in DOM order', async () => {
  insert.run('Fiskegrateng', 'a', '', '2026-10-01 10:00:00');
  const res = await request(app).get('/');
  const skip = res.text.indexOf('href="#main"');
  const search = res.text.indexOf('id="q"');
  const nav = res.text.indexOf('<nav class="mast__nav">');
  const main = res.text.indexOf('<main id="main" tabindex="-1">');
  const lead = res.text.indexOf('class="lead__fig"');
  assert.ok(skip > -1 && skip < search && search < nav && nav < main && main < lead);
});

test('S1: the register reads in the singular when the collection holds one recipe', async () => {
  insert.run('Én rett', 'a', '', '2026-10-01 10:00:00');
  const res = await request(app).get('/');
  assert.match(res.text, /<p class="band__sub">Den ene oppskriften i samlingen\.<\/p>/);
  assert.doesNotMatch(res.text, /Alle 1 oppskriftene/);
});

test('every button and the search field are at least one tap tall (style guide §7)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(css, /--tap:44px;/);
  // .btn covers Rediger, Slett and every Prøv på nytt; nothing narrower may lower it.
  assert.match(css, /\.btn\{[^}]*min-height:var\(--tap\)/);
  assert.match(css, /\.search-field\{[^}]*min-height:var\(--tap\)/);
  assert.doesNotMatch(css, /\.(btn|search-field)[^{]*\{[^}]*(?:max-height|min-height:(?!var\(--tap\)))/);
});
