process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/server');
const db = require('../src/db');

test('POST /recipes/:id/delete removes the recipe and redirects to /?flash=deleted', async () => {
  const insert = db.prepare('INSERT INTO recipes (title, ingredients, instructions) VALUES (?, ?, ?)');
  const result = insert.run('Pannekaker', '2 egg\n5 dl melk', 'Stek.');
  const id = result.lastInsertRowid;

  const before = db.prepare('SELECT COUNT(*) AS count FROM recipes').get().count;
  const res = await request(app).post(`/recipes/${id}/delete`);

  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/?flash=deleted');

  const after = db.prepare('SELECT COUNT(*) AS count FROM recipes').get().count;
  assert.equal(after, before - 1);

  const getRes = await request(app).get(`/recipes/${id}`);
  assert.equal(getRes.status, 404);
});

test('GET /recipes/:id includes a delete form', async () => {
  const insert = db.prepare('INSERT INTO recipes (title, ingredients, instructions) VALUES (?, ?, ?)');
  const result = insert.run('Vaffler', '2 egg', 'Stek.');
  const id = result.lastInsertRowid;

  const res = await request(app).get(`/recipes/${id}`);

  assert.equal(res.status, 200);
  assert.match(res.text, /Slett oppskrift/);
  assert.match(res.text, new RegExp(`action="/recipes/${id}/delete"`));
});

test('POST /recipes/:id/delete returns 404 for a missing id', async () => {
  const res = await request(app).post('/recipes/999999/delete');
  assert.equal(res.status, 404);
});

test('POST /recipes/:id/delete returns 404 for an invalid id', async () => {
  const res = await request(app).post('/recipes/not-a-number/delete');
  assert.equal(res.status, 404);
});
