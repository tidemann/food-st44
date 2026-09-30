const path = require('path');
const express = require('express');
const db = require('./db');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

app.get('/', (req, res) => {
  const recipes = db
    .prepare('SELECT id, title, ingredients, instructions, created_at FROM recipes ORDER BY created_at DESC')
    .all();
  res.render('list', { recipes });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`food-st44 listening on port ${port}`);
  });
}

module.exports = app;
