const path = require('path');
const express = require('express');
const db = require('./db');
const view = require('./view-model');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: false }));

// The masthead and the footer carry the size of the collection and the date it
// was last added to. Every page shows them, so they are read once per request
// and never allowed to break a page — including the 500 page, which is exactly
// the page that renders when the database is the thing that failed.
app.use((req, res, next) => {
  res.locals.site = { known: false, total: 0, updated: '', today: view.formatMastheadDate() };
  try {
    const row = db.prepare('SELECT COUNT(*) AS total, MAX(created_at) AS updated FROM recipes').get();
    res.locals.site.known = true;
    res.locals.site.total = row.total;
    res.locals.site.updated = row.updated ? view.formatLong(row.updated) : '';
  } catch (err) {
    console.error('site summary failed', err);
  }
  next();
});

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

// A missing recipe and a wrong address are the same status but not the same
// sentence: "Fant ikke oppskriften" is a lie on /nonsens/bla.
const NOT_FOUND = Object.freeze({
  recipe: {
    heading: 'Fant ikke oppskriften',
    dek: 'Den kan ha blitt slettet, eller lenken er feil.'
  },
  page: {
    heading: 'Siden finnes ikke',
    dek: 'Lenken kan være skrevet feil. Alle oppskriftene ligger samlet på forsiden.'
  }
});

function notFound(res, kind = 'recipe') {
  res.status(404).render('404', NOT_FOUND[kind]);
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

function countLabel(count, q) {
  if (q) return `${count} treff på «${q}»`;
  return view.pluralise(count, 'oppskrift', 'oppskrifter');
}

const SIDE_SUB = [
  '',
  'Den nest siste oppskriften i samlingen.',
  'De to siste oppskriftene i samlingen.',
  'De tre siste oppskriftene i samlingen.'
];

// The front page is laid out like the opening spread of a magazine: one dish
// large, the newest few beside it, the whole archive as an alphabetical
// register, then whatever is left as a row of plates. Each band disappears on
// its own when the collection is too small to fill it.
function frontPage(cards) {
  const side = cards.slice(1, 4);
  return {
    lead: cards[0],
    side,
    sideSub: SIDE_SUB[side.length] || '',
    index: view.toIndex(cards),
    rest: cards.slice(4)
  };
}

// The search a page was reached from, as a query string to hand on. Cards carry
// it to the detail page, and Rediger and Slett carry it on from there, so every
// way back — the crumb, Avbryt — lands on the search, not the top (flows §5).
function searchQueryFor(req) {
  const q = String(req.query.q || '').trim();
  return q ? `?q=${encodeURIComponent(q)}` : '';
}

app.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  // Carried into card links and into the S4 retry link.
  const searchQuery = searchQueryFor(req);

  let recipes;
  try {
    recipes = db
      .prepare('SELECT id, title, ingredients, created_at FROM recipes ORDER BY created_at DESC')
      .all();
  } catch (err) {
    console.error('list query failed', err);
    return res.status(500).render('list', {
      state: 'error', q, count: '', searchQuery, recipes: [], front: null, flash: null
    });
  }

  const needle = q.toLocaleLowerCase('nb');
  const filtered = needle
    ? recipes.filter((recipe) => recipe.title.toLocaleLowerCase('nb').includes(needle))
    : recipes;

  let state = 'list';
  if (recipes.length === 0) state = 'empty';
  else if (filtered.length === 0) state = 'no-hits';

  const cards = filtered.map(view.toCard);

  res.render('list', {
    state,
    q,
    count: countLabel(filtered.length, q),
    searchQuery,
    recipes: cards,
    // The magazine opening is the unsearched front page. A search answers with
    // a plain register of hits instead — a lead dish would be a guess there.
    front: state === 'list' && !q ? frontPage(cards) : null,
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

  const searchQuery = searchQueryFor(req);

  res.render('detail', {
    recipe,
    photo: view.photoFor(recipe.title),
    ingredients: view.ingredientsFor(recipe.ingredients),
    steps: view.stepsFor(recipe.instructions),
    added: view.formatLong(recipe.created_at),
    backHref: `/${searchQuery}`,
    searchQuery,
    flash: flashFor(req.query.flash)
  });
});

app.get('/recipes/:id/edit', (req, res) => {
  const recipe = findRecipe(req.params.id);
  if (!recipe) {
    return notFound(res);
  }

  res.render('edit', {
    id: recipe.id, values: recipe, errors: {}, hasErrors: false, searchQuery: searchQueryFor(req)
  });
});

app.post('/recipes/:id/edit', (req, res) => {
  const existing = findRecipe(req.params.id);
  if (!existing) {
    return notFound(res);
  }

  const searchQuery = searchQueryFor(req);
  const { values, recipe, errors, hasErrors } = validateRecipe(req.body);
  if (hasErrors) {
    return res.status(400).render('edit', { id: existing.id, values, errors, hasErrors, searchQuery });
  }

  db.prepare('UPDATE recipes SET title = ?, ingredients = ?, instructions = ? WHERE id = ?')
    .run(recipe.title, recipe.ingredients, recipe.instructions, existing.id);
  const back = searchQuery ? `&${searchQuery.slice(1)}` : '';
  res.redirect(303, `/recipes/${existing.id}?flash=updated${back}`);
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

app.get('/recipes/:id/delete', (req, res) => {
  const recipe = findRecipe(req.params.id);
  if (!recipe) {
    return notFound(res);
  }

  res.render('delete', { recipe, searchQuery: searchQueryFor(req) });
});

app.post('/recipes/:id/delete', (req, res) => {
  const existing = findRecipe(req.params.id);
  if (!existing) {
    return notFound(res);
  }

  db.prepare('DELETE FROM recipes WHERE id = ?').run(existing.id);
  res.redirect(303, '/?flash=deleted');
});

if (process.env.NODE_ENV === 'test') {
  app.all('/__test-boom', () => {
    throw new Error('intentional test error');
  });
}

app.use((req, res) => {
  notFound(res, 'page');
});

// S11 "Prøv på nytt" is a plain link, so it works without JS. A failed GET
// retries its own address; a failed form post goes back to the page the form
// was on rather than re-sending it. Only a same-site path is ever linked.
function retryHrefFor(req) {
  if (req.method === 'GET') return `/${req.originalUrl.replace(/^\/+/, '')}`;
  try {
    const from = new URL(req.get('referer') || '/', `http://${req.get('host')}`);
    if (from.host === req.get('host')) return `/${from.pathname.replace(/^\/+/, '')}${from.search}`;
  } catch (err) {
    // an unparseable Referer falls through to the front page
  }
  return '/';
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('500', { retryHref: retryHrefFor(req) });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`food-st44 listening on port ${port}`);
  });
}

module.exports = app;
