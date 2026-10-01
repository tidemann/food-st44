const path = require('path');
const express = require('express');
const db = require('./db');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: false }));

app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

app.get('/', (req, res) => {
  const recipes = db
    .prepare('SELECT id, title, ingredients, instructions, created_at FROM recipes ORDER BY created_at DESC')
    .all();
  res.render('list', { recipes });
});

app.get('/recipes/new', (req, res) => {
  res.render('new', { error: null, values: {} });
});

app.get('/recipes/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(404).send('Not found');
  }

  const recipe = db
    .prepare('SELECT id, title, ingredients, instructions, created_at FROM recipes WHERE id = ?')
    .get(id);

  if (!recipe) {
    return res.status(404).send('Not found');
  }

  res.render('detail', { recipe });
});

app.post('/recipes', (req, res) => {
  const title = String(req.body.title || '').trim();
  const ingredients = String(req.body.ingredients || '').trim();
  const instructions = String(req.body.instructions || '').trim();

  if (!title || !ingredients || !instructions) {
    return res.status(400).render('new', {
      error: 'Alle feltene må fylles ut.',
      values: { title: req.body.title, ingredients: req.body.ingredients, instructions: req.body.instructions }
    });
  }

  db.prepare('INSERT INTO recipes (title, ingredients, instructions) VALUES (?, ?, ?)').run(title, ingredients, instructions);
  res.redirect('/');
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`food-st44 listening on port ${port}`);
  });
}

module.exports = app;
