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

function findRecipe(idParam) {
  const id = parseInt(idParam, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return db
    .prepare('SELECT id, title, ingredients, instructions, created_at FROM recipes WHERE id = ?')
    .get(id) || null;
}

function notFound(res) {
  res.status(404).render('404');
}

// One rule set for create and edit. Whitespace-only counts as empty.
function validateRecipe(body) {
  const values = {
    title: String(body.title || ''),
    ingredients: String(body.ingredients || ''),
    instructions: String(body.instructions || '')
  };
  const recipe = {
    title: values.title.trim(),
    ingredients: values.ingredients.trim(),
    instructions: values.instructions.trim()
  };
  const errors = {};
  if (!recipe.title) errors.title = 'Tittelen må fylles ut.';
  if (!recipe.ingredients) errors.ingredients = 'Skriv inn minst én ingrediens.';
  return { values, recipe, errors, hasErrors: Object.keys(errors).length > 0 };
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
  res.render('new', { values: {}, errors: {}, hasErrors: false });
});

app.get('/recipes/:id', (req, res) => {
  const recipe = findRecipe(req.params.id);
  if (!recipe) {
    return notFound(res);
  }

  res.render('detail', { recipe, flash: flashFor(req.query.flash) });
});

app.get('/recipes/:id/edit', (req, res) => {
  const recipe = findRecipe(req.params.id);
  if (!recipe) {
    return notFound(res);
  }

  res.render('edit', { id: recipe.id, values: recipe, errors: {}, hasErrors: false });
});

app.post('/recipes/:id/edit', (req, res) => {
  const existing = findRecipe(req.params.id);
  if (!existing) {
    return notFound(res);
  }

  const { values, recipe, errors, hasErrors } = validateRecipe(req.body);
  if (hasErrors) {
    return res.status(400).render('edit', { id: existing.id, values, errors, hasErrors });
  }

  db.prepare('UPDATE recipes SET title = ?, ingredients = ?, instructions = ? WHERE id = ?')
    .run(recipe.title, recipe.ingredients, recipe.instructions, existing.id);
  res.redirect(303, `/recipes/${existing.id}?flash=updated`);
});

app.post('/recipes', (req, res) => {
  const { values, recipe, errors, hasErrors } = validateRecipe(req.body);
  if (hasErrors) {
    return res.status(400).render('new', { values, errors, hasErrors });
  }

  const result = db
    .prepare('INSERT INTO recipes (title, ingredients, instructions) VALUES (?, ?, ?)')
    .run(recipe.title, recipe.ingredients, recipe.instructions);
  res.redirect(303, `/recipes/${result.lastInsertRowid}?flash=created`);
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
