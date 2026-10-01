process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/server');
const db = require('../src/db');

test('GET /recipes/:id returns 200 and shows the recipe title', async () => {
  const title = `Pannekaker ${Date.now()}`;
  const ingredients = '2 egg\n5 dl melk\n3 dl hvetemel';
  const instructions = 'Bland alt sammen. Stek på middels varme.';

  const result = db
    .prepare('INSERT INTO recipes (title, ingredients, instructions) VALUES (?, ?, ?)')
    .run(title, ingredients, instructions);

  const res = await request(app).get(`/recipes/${result.lastInsertRowid}`);
  assert.equal(res.status, 200);
  assert.match(res.text, new RegExp(title));
  assert.match(res.text, /Ingredienser/);
  assert.match(res.text, /Fremgangsmåte/);
});

test('GET /recipes/:id returns 404 for a missing id', async () => {
  const res = await request(app).get('/recipes/999999');
  assert.equal(res.status, 404);
});

test('GET /recipes/:id returns 404 for an invalid id', async () => {
  const res = await request(app).get('/recipes/not-a-number');
  assert.equal(res.status, 404);
});
