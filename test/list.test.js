process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/server');

test('GET / renders the recipe list page', async () => {
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /Oppskrifter/);
});

test('GET / shows an empty-state message when there are no recipes', async () => {
  const res = await request(app).get('/');
  assert.match(res.text, /Ingen oppskrifter/);
});
