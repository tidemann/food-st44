process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/server');

test('GET /recipes/new returns 200 and shows the form', async () => {
  const res = await request(app).get('/recipes/new');
  assert.equal(res.status, 200);
  assert.match(res.text, /Tittel/);
  assert.match(res.text, /Ingredienser/);
  assert.match(res.text, /Fremgangsmåte/);
  assert.match(res.text, /Lagre oppskrift/);
});

test('POST /recipes with valid data creates a recipe and redirects to /', async () => {
  const res = await request(app)
    .post('/recipes')
    .type('form')
    .send({
      title: 'Pannekaker',
      ingredients: '2 egg\n5 dl melk\n3 dl hvetemel',
      instructions: 'Bland alt sammen. Stek på middels varme.'
    });

  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/');
});

test('POST /recipes with missing fields returns 400', async () => {
  const res = await request(app)
    .post('/recipes')
    .type('form')
    .send({ title: '', ingredients: '  ', instructions: undefined });

  assert.equal(res.status, 400);
});

test('After a successful POST, GET / lists the new recipe title', async () => {
  const title = `Vaffler ${Date.now()}`;
  await request(app)
    .post('/recipes')
    .type('form')
    .send({
      title,
      ingredients: '2 egg\n5 dl melk\n3 dl hvetemel',
      instructions: 'Bland og stek i vaffeljern.'
    });

  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, new RegExp(title));
});
