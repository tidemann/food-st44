const path = require('path');
const express = require('express');
const db = require('./db');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: false }));

const FLASH_MESSAGES = Object.freeze({
  created: 'Oppskriften ble lagret.',
  updated: 'Endringene ble lagret.',
  deleted: 'Oppskriften ble slettet.',
});

function flashFor(key) {
  if (typeof key !== 'string') return null;
  return FLASH_MESSAGES[key] || null;
}

app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

app.get('/', (req, res) => {
  const recipes = db
    .prepare('SELECT id, title, ingredients, instructions, created_at FROM recipes ORDER BY created_at DESC')
    .all();
  const q = String(req.query.q || '').trim();
  const needle = q.toLocaleLowerCase('nb');
  const filtered = needle
    ? recipes.filter((recipe) => recipe.title.toLocaleLowerCase('nb').includes(needle))
    : recipes;
  res.render('list', { recipes: filtered, q, flash: flashFor(req.query.flash) });
});

app.get('/recipes/new', (req, res) => {
  res.render('new', { error: null, values: {} });
});

app.get('/recipes/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(404).render('404');
  }

  const recipe = db
    .prepare('SELECT id, title, ingredients, instructions, created_at FROM recipes WHERE id = ?')
    .get(id);

  if (!recipe) {
    return res.status(404).render('404');
  }

  res.render('detail', { recipe, flash: flashFor(req.query.flash) });
});

app.post('/recipes', (req, res) => {
  const title = String(req.body.title || '').trim();
  const ingredients = String(req.body.ingredients || '').trim();
  const instructions = String(req.body.instructions || '').trim();

  if (!title || !ingredients) {
    return res.status(400).render('new', {
      error: 'Tittel og minst én ingrediens må fylles ut.',
      values: { title: req.body.title, ingredients: req.body.ingredients, instructions: req.body.instructions }
    });
  }

  const result = db.prepare('INSERT INTO recipes (title, ingredients, instructions) VALUES (?, ?, ?)').run(title, ingredients, instructions);
  res.redirect(`/recipes/${result.lastInsertRowid}?flash=created`);
});

app.post('/recipes/:id/delete', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(404).render('404');
  }

  const result = db.prepare('DELETE FROM recipes WHERE id = ?').run(id);
  if (result.changes === 0) {
    return res.status(404).render('404');
  }

  res.redirect('/?flash=deleted');
});

if (process.env.NODE_ENV === 'test') {
  app.get('/__test-boom', () => {
    throw new Error('intentional test error');
  });
}

app.use((req, res) => {
  res.status(404).render('404');
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('500');
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`food-st44 listening on port ${port}`);
  });
}

module.exports = app;
