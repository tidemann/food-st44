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

const cardDate = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', timeZone: 'Europe/Oslo' });

// Meta line for a card: "9 ingredienser · 2. okt" (style guide §6).
function recipeMeta(recipe) {
  const count = recipe.ingredients.split('\n').filter((line) => line.trim()).length;
  const noun = count === 1 ? 'ingrediens' : 'ingredienser';
  // created_at is SQLite CURRENT_TIMESTAMP: UTC, "YYYY-MM-DD HH:MM:SS".
  const created = new Date(`${String(recipe.created_at).replace(' ', 'T')}Z`);
  if (Number.isNaN(created.getTime())) return `${count} ${noun}`;
  return `${count} ${noun} · ${cardDate.format(created).replace(/\.$/, '')}`;
}

function countLabel(count, q) {
  if (q) return `${count} treff på «${q}»`;
  return `${count} ${count === 1 ? 'oppskrift' : 'oppskrifter'}`;
}

app.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  // Carried into card links (so the detail back link can return to the search,
  // flows §5) and into the S4 retry link.
  const searchQuery = q ? `?q=${encodeURIComponent(q)}` : '';

  let recipes;
  try {
    recipes = db
      .prepare('SELECT id, title, ingredients, created_at FROM recipes ORDER BY created_at DESC')
      .all();
  } catch (err) {
    console.error('list query failed', err);
    return res.status(500).render('list', { state: 'error', q, count: '', searchQuery, recipes: [], flash: null });
  }

  const needle = q.toLocaleLowerCase('nb');
  const filtered = needle
    ? recipes.filter((recipe) => recipe.title.toLocaleLowerCase('nb').includes(needle))
    : recipes;

  let state = 'list';
  if (recipes.length === 0) state = 'empty';
  else if (filtered.length === 0) state = 'no-hits';

  res.render('list', {
    state,
    q,
    count: countLabel(filtered.length, q),
    searchQuery,
    recipes: filtered.map((recipe) => ({ id: recipe.id, title: recipe.title, meta: recipeMeta(recipe) })),
    flash: flashFor(req.query.flash)
  });
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
