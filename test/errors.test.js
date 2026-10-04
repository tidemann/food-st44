process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/server');

test('GET /some/random/path returns 404 Norwegian page', async () => {
  const res = await request(app).get('/some/random/path');
  assert.equal(res.status, 404);
  // A path that was never a page is not a missing recipe, and must not claim to be.
  assert.match(res.text, /<h1>Siden finnes ikke<\/h1>/);
  assert.match(res.text, /Lenken kan være skrevet feil\. Alle oppskriftene ligger samlet på forsiden\./);
  assert.match(res.text, /Til alle oppskrifter/);
  assert.doesNotMatch(res.text, /Fant ikke oppskriften/);
  assert.doesNotMatch(res.text, /Not found/);
});

test('A recipe that is gone keeps the sentence about the recipe', async () => {
  const res = await request(app).get('/recipes/999999');
  assert.equal(res.status, 404);
  assert.match(res.text, /<h1>Fant ikke oppskriften<\/h1>/);
  assert.match(res.text, /Den kan ha blitt slettet, eller lenken er feil\./);
});

test('the favicon is served, so no page load ends in a 404 for it', async () => {
  const svg = await request(app).get('/favicon.svg');
  assert.equal(svg.status, 200);
  assert.match(svg.headers['content-type'], /image\/svg\+xml/);

  // Browsers ask for /favicon.ico whatever the markup says.
  const ico = await request(app).get('/favicon.ico');
  assert.equal(ico.status, 200);
  assert.deepEqual(ico.body.subarray(0, 4), Buffer.from([0, 0, 1, 0]), 'ICO header');

  const page = await request(app).get('/');
  assert.match(page.text, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/);
  assert.match(page.text, /<link rel="alternate icon" href="\/favicon\.ico"/);
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
