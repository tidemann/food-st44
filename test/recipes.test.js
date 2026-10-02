process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/server');
const db = require('../src/db');

test('GET /recipes/new returns 200 and shows the form', async () => {
  const res = await request(app).get('/recipes/new');
  assert.equal(res.status, 200);
  assert.match(res.text, /Tittel/);
  assert.match(res.text, /Ingredienser/);
  assert.match(res.text, /Fremgangsmåte/);
  assert.match(res.text, /Lagre oppskrift/);
});

test('POST /recipes with valid data creates a recipe and redirects to detail with flash=created', async () => {
  const res = await request(app)
    .post('/recipes')
    .type('form')
    .send({
      title: 'Pannekaker',
      ingredients: '2 egg\n5 dl melk\n3 dl hvetemel',
      instructions: 'Bland alt sammen. Stek på middels varme.'
    });

  assert.equal(res.status, 302);
  assert.match(res.headers.location, /^\/recipes\/\d+\?flash=created$/);
});

test('POST /recipes with missing title re-renders the form and does not create a row', async () => {
  const before = db.prepare('SELECT COUNT(*) AS count FROM recipes').get().count;
  const res = await request(app)
    .post('/recipes')
    .type('form')
    .send({ title: '', ingredients: '2 egg\n5 dl melk', instructions: 'Bland sammen.' });

  assert.equal(res.status, 400);
  assert.match(res.text, /Tittel/);
  assert.match(res.text, /2 egg/);
  assert.match(res.text, /Bland sammen/);

  const after = db.prepare('SELECT COUNT(*) AS count FROM recipes').get().count;
  assert.equal(after, before);
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
