process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/server');
const db = require('../src/db');

function insertRecipe(title) {
  return db
    .prepare('INSERT INTO recipes (title, ingredients, instructions) VALUES (?, ?, ?)')
    .run(title, '2 egg\n5 dl melk', 'Stek.').lastInsertRowid;
}

function recipeExists(id) {
  return Boolean(db.prepare('SELECT id FROM recipes WHERE id = ?').get(id));
}

test('detail page links Slett to the confirm page and has no delete form', async () => {
  const id = insertRecipe('Vaffler');

  const res = await request(app).get(`/recipes/${id}`);

  assert.equal(res.status, 200);
  assert.match(res.text, new RegExp(`<a class="btn btn--danger-ghost" href="/recipes/${id}/delete">Slett</a>`));
  assert.doesNotMatch(res.text, /<form/);
});

test('GET /recipes/:id/delete names the recipe and deletes nothing', async () => {
  const id = insertRecipe('Fiskegrateng');

  const res = await request(app).get(`/recipes/${id}/delete`);

  assert.equal(res.status, 200);
  assert.match(res.text, /<h1>Slett «Fiskegrateng»\?<\/h1>/);
  assert.match(res.text, /Oppskriften blir borte for godt\. Dette kan ikke angres\./);
  assert.ok(recipeExists(id));
});

test('confirm page puts Avbryt (link back) before the Slett oppskriften submit', async () => {
  const id = insertRecipe('Lapskaus');

  const res = await request(app).get(`/recipes/${id}/delete`);

  const cancel = res.text.indexOf(`<a class="btn btn--secondary" href="/recipes/${id}">Avbryt</a>`);
  const submit = res.text.indexOf('<button class="btn btn--danger" type="submit">Slett oppskriften</button>');
  assert.ok(cancel > -1, 'Avbryt link missing');
  assert.ok(submit > -1, 'Slett oppskriften submit missing');
  assert.ok(cancel < submit, 'Avbryt must come before Slett oppskriften');
  assert.match(res.text, new RegExp(`<form action="/recipes/${id}/delete" method="POST"`));
});

test('confirm page escapes the recipe title', async () => {
  const id = insertRecipe('<script>x</script>');

  const res = await request(app).get(`/recipes/${id}/delete`);

  assert.doesNotMatch(res.text, /<script>x<\/script>/);
  assert.match(res.text, /&lt;script&gt;x&lt;\/script&gt;/);
});

test('GET /recipes/:id/delete renders the Norwegian 404 for unknown and invalid ids', async () => {
  for (const path of ['/recipes/999999/delete', '/recipes/not-a-number/delete']) {
    const res = await request(app).get(path);
    assert.equal(res.status, 404);
    assert.match(res.text, /Fant ikke oppskriften/);
  }
});

test('POST /recipes/:id/delete removes the recipe and 303-redirects to /?flash=deleted', async () => {
  const id = insertRecipe('Pannekaker');

  const res = await request(app).post(`/recipes/${id}/delete`);

  assert.equal(res.status, 303);
  assert.equal(res.headers.location, '/?flash=deleted');
  assert.ok(!recipeExists(id));

  const landing = await request(app).get('/?flash=deleted');
  assert.match(landing.text, /Oppskriften ble slettet\./);

  const getRes = await request(app).get(`/recipes/${id}`);
  assert.equal(getRes.status, 404);
});

test('POST /recipes/:id/delete renders the Norwegian 404 for missing and invalid ids', async () => {
  for (const path of ['/recipes/999999/delete', '/recipes/not-a-number/delete']) {
    const res = await request(app).post(path);
    assert.equal(res.status, 404);
    assert.match(res.text, /Fant ikke oppskriften/);
  }
});
