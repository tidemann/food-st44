process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/server');
const db = require('../src/db');

test('GET /?flash=deleted shows the deleted message', async () => {
  const res = await request(app).get('/?flash=deleted');
  assert.equal(res.status, 200);
  assert.match(res.text, /Oppskriften ble slettet\./);
  assert.match(res.text, /<p class="flash" role="status">/);
});

test('GET /recipes/:id?flash=created shows the created message', async () => {
  const result = db
    .prepare('INSERT INTO recipes (title, ingredients, instructions) VALUES (?, ?, ?)')
    .run('Pannekaker', '2 egg\n5 dl melk', 'Stek.');

  const res = await request(app).get(`/recipes/${result.lastInsertRowid}?flash=created`);
  assert.equal(res.status, 200);
  assert.match(res.text, /Oppskriften ble lagret\./);
  assert.match(res.text, /role="status"/);
});

test('GET /recipes/:id?flash=updated shows the updated message', async () => {
  const result = db
    .prepare('INSERT INTO recipes (title, ingredients, instructions) VALUES (?, ?, ?)')
    .run('Vaffler', '2 egg', 'Stek.');

  const res = await request(app).get(`/recipes/${result.lastInsertRowid}?flash=updated`);
  assert.equal(res.status, 200);
  assert.match(res.text, /Endringene ble lagret\./);
});

test('Unknown or empty flash keys render nothing', async () => {
  const bogus = await request(app).get('/?flash=bogus');
  assert.equal(bogus.status, 200);
  assert.doesNotMatch(bogus.text, /Oppskriften ble/);
  assert.doesNotMatch(bogus.text, /Endringene ble/);

  const empty = await request(app).get('/?flash=');
  assert.equal(empty.status, 200);
  assert.doesNotMatch(empty.text, /class="flash"/);
});

test('Malicious flash key renders no message and no injected markup', async () => {
  const res = await request(app)
    .get('/recipes/1')
    .query({ flash: '<script>alert(1)</script>' });

  assert.equal(res.status, 200);
  assert.doesNotMatch(res.text, /<script[\s\S]*?>alert\(1\)<\/script>/);
  assert.doesNotMatch(res.text, /class="flash"/);
});
