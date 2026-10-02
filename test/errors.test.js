process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/server');

test('GET /some/random/path returns 404 Norwegian page', async () => {
  const res = await request(app).get('/some/random/path');
  assert.equal(res.status, 404);
  assert.match(res.text, /Fant ikke oppskriften/);
  assert.match(res.text, /Den kan ha blitt slettet, eller lenken er feil\./);
  assert.match(res.text, /Til alle oppskrifter/);
  assert.doesNotMatch(res.text, /Not found/);
});

test('A thrown error returns 500 Norwegian page without stack trace or English', async () => {
  const res = await request(app).get('/__test-boom');
  assert.equal(res.status, 500);
  assert.match(res.text, /Noe gikk galt/);
  assert.match(res.text, /Prøv igjen om litt\./);
  assert.match(res.text, /Prøv på nytt/);
  assert.match(res.text, /Til alle oppskrifter/);
  assert.doesNotMatch(res.text, /intentional test error/);
  assert.doesNotMatch(res.text, /Error/);
  assert.doesNotMatch(res.text, /at /);
});
