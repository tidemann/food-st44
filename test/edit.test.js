process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/server');
const db = require('../src/db');

function insertRecipe() {
  return db
    .prepare('INSERT INTO recipes (title, ingredients, instructions) VALUES (?, ?, ?)')
    .run('Fiskegrateng', '400 g torskefilet\n5 dl melk', 'Kok opp melken.')
    .lastInsertRowid;
}

test('detail page links to the edit form', async () => {
  const id = insertRecipe();
  const res = await request(app).get(`/recipes/${id}`);
  assert.match(res.text, new RegExp(`<a class="btn" href="/recipes/${id}/edit">Rediger</a>`));
});

test('GET /recipes/:id/edit renders the shared form prefilled', async () => {
  const id = insertRecipe();
  const res = await request(app).get(`/recipes/${id}/edit`);
  assert.equal(res.status, 200);
  assert.match(res.text, /<h1>Rediger oppskrift<\/h1>/);
  assert.match(res.text, new RegExp(`action="/recipes/${id}/edit" method="post"`));
  assert.match(res.text, /value="Fiskegrateng"/);
  assert.match(res.text, /400 g torskefilet\n5 dl melk<\/textarea>/);
  assert.match(res.text, /Kok opp melken.<\/textarea>/);
  assert.match(res.text, /Lagre endringer/);
  assert.match(res.text, new RegExp(`<a class="btn btn--lg" href="/recipes/${id}">Avbryt</a>`));
  assert.match(res.text, /Fremgangsmåte \(valgfritt\)/);
  assert.doesNotMatch(res.text, /aria-invalid/);
});

test('POST /recipes/:id/edit saves and 303-redirects to the detail page with flash=updated', async () => {
  const id = insertRecipe();
  const res = await request(app)
    .post(`/recipes/${id}/edit`)
    .type('form')
    .send({ title: 'Fiskegrateng med bacon', ingredients: '400 g torsk\n100 g bacon', instructions: '' });

  assert.equal(res.status, 303);
  assert.equal(res.headers.location, `/recipes/${id}?flash=updated`);

  const detail = await request(app).get(`/recipes/${id}`);
  assert.match(detail.text, /Fiskegrateng med bacon/);
  // The detail page sets the amount in its own column, so the line is split.
  assert.match(detail.text, /<b>100 g<\/b>\s*<span>bacon<\/span>/);
});

test('POST /recipes/:id/edit with empty fields returns 400, marks both fields and keeps input', async () => {
  const id = insertRecipe();
  const res = await request(app)
    .post(`/recipes/${id}/edit`)
    .type('form')
    .send({ title: '   ', ingredients: '', instructions: 'Mine nye notater' });

  assert.equal(res.status, 400);
  assert.match(res.text, /<title>Feil — Rediger oppskrift<\/title>/);
  assert.match(res.text, /Mine nye notater<\/textarea>/);
  assert.match(res.text, /id="title-error"/);
  assert.match(res.text, /id="ingredients-error"/);

  const row = db.prepare('SELECT title FROM recipes WHERE id = ?').get(id);
  assert.equal(row.title, 'Fiskegrateng');
});

test('POST /recipes with empty title and ingredients shows summary and per-field errors', async () => {
  const res = await request(app)
    .post('/recipes')
    .type('form')
    .send({ title: '', ingredients: '  ', instructions: 'Kok opp melken og rør inn melet.' });

  assert.equal(res.status, 400);
  assert.match(res.text, /<title>Feil — Ny oppskrift<\/title>/);
  assert.match(res.text, /class="alert" id="error-summary" role="alert" tabindex="-1" autofocus/);
  assert.match(res.text, /Oppskriften ble ikke lagret/);
  assert.match(res.text, /<p class="field__error" id="title-error">.*Tittelen må fylles ut\.<\/p>/);
  assert.match(res.text, /<p class="field__error" id="ingredients-error">.*Skriv inn minst én ingrediens\.<\/p>/);
  assert.match(res.text, /aria-invalid="true" aria-describedby="title-error"/);
  assert.match(res.text, /aria-describedby="ingredients-hint ingredients-error"\s+aria-invalid="true"/);
  assert.match(res.text, /Kok opp melken og rør inn melet.<\/textarea>/);
});

test('only the failing field is marked', async () => {
  const res = await request(app)
    .post('/recipes')
    .type('form')
    .send({ title: 'Lapskaus', ingredients: '', instructions: '' });

  assert.equal(res.status, 400);
  assert.match(res.text, /value="Lapskaus"/);
  assert.doesNotMatch(res.text, /id="title-error"/);
  assert.match(res.text, /id="ingredients-error"/);
});

test('saving with empty Fremgangsmåte succeeds', async () => {
  const res = await request(app)
    .post('/recipes')
    .type('form')
    .send({ title: 'Brødskive', ingredients: '1 skive brød', instructions: '' });
  assert.equal(res.status, 303);
});

test('new and edit render from the same form partial', async () => {
  const id = insertRecipe();
  const fresh = await request(app).get('/recipes/new');
  const edit = await request(app).get(`/recipes/${id}/edit`);
  for (const res of [fresh, edit]) {
    assert.match(res.text, /<label for="ingredients">Ingredienser<\/label>/);
    assert.match(res.text, /<p class="field__hint" id="ingredients-hint">Én ingrediens per linje\./);
    assert.match(res.text, /<label for="instructions">Fremgangsmåte \(valgfritt\)<\/label>/);
  }
  assert.match(fresh.text, /Lagre oppskrift/);
  assert.match(fresh.text, /<a class="btn btn--lg" href="\/">Avbryt<\/a>/);
});

test('unknown or invalid id on edit renders the Norwegian 404 for GET and POST', async () => {
  for (const path of ['/recipes/999999/edit', '/recipes/not-a-number/edit']) {
    const get = await request(app).get(path);
    assert.equal(get.status, 404);
    assert.match(get.text, /Fant ikke oppskriften/);

    const post = await request(app).post(path).type('form').send({ title: 'x', ingredients: 'y' });
    assert.equal(post.status, 404);
    assert.match(post.text, /Fant ikke oppskriften/);
  }
});
