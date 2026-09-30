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

test('GET / shows title, ingredients and instructions for saved recipes', async () => {
  const title = `Grønnsakssuppe ${Date.now()}`;
  const ingredients = '1 løk\n2 gulrøtter\n1/2 kålrot';
  const instructions = 'Hakk grønnsakene.\nKok i en liter vann i 20 minutter.';

  await request(app)
    .post('/recipes')
    .type('form')
    .send({ title, ingredients, instructions });

  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, new RegExp(title));
  assert.match(res.text, /Ingredienser/);
  assert.match(res.text, /Fremgangsmåte/);
  assert.match(res.text, /2 gulrøtter/);
  assert.match(res.text, /Kok i en liter vann/);
});

test('GET / preserves line breaks in ingredients and instructions', async () => {
  const title = `Pannekaker ${Date.now()}`;
  const ingredients = '2 egg\n5 dl melk\n3 dl hvetemel';
  const instructions = 'Bland alt sammen.\nStek på middels varme.';

  await request(app)
    .post('/recipes')
    .type('form')
    .send({ title, ingredients, instructions });

  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /<pre[\s\S]*?2 egg[\s\S]*?5 dl melk[\s\S]*?3 dl hvetemel[\s\S]*?<\/pre>/);
  assert.match(res.text, /<pre[\s\S]*?Bland alt sammen\.[\s\S]*?Stek på middels varme\.[\s\S]*?<\/pre>/);
});
