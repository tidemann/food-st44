process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/server');
const db = require('../src/db');

const suffix = Date.now();
const soup = `Tomatsuppe ${suffix}`;
const bread = `Grovbrød ${suffix}`;

test.before(() => {
  const insert = db.prepare('INSERT INTO recipes (title, ingredients, instructions) VALUES (?, ?, ?)');
  insert.run(soup, 'tomater', 'Kok.');
  insert.run(bread, 'mel', 'Bak.');
});

test('GET /?q= returns only recipes whose title matches, case-insensitive', async () => {
  const res = await request(app).get('/').query({ q: 'TOMATSUPPE' });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes(soup));
  assert.ok(!res.text.includes(bread));
});

test('GET / with empty or absent q returns all recipes', async () => {
  for (const path of ['/', '/?q=']) {
    const res = await request(app).get(path);
    assert.equal(res.status, 200);
    assert.ok(res.text.includes(soup));
    assert.ok(res.text.includes(bread));
  }
});

test('GET /?q= with no match shows the no-match message', async () => {
  const res = await request(app).get('/').query({ q: `finnesikke${suffix}` });
  assert.equal(res.status, 200);
  assert.match(res.text, /Ingen oppskrifter passer søket/);
});
