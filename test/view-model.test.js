process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const view = require('../src/view-model');

test('the amount is split off an ingredient line so it can sit in its own column', () => {
  const cases = [
    ['600 g kjøttdeig av storfe', '600 g', 'kjøttdeig av storfe'],
    ['1 ts salt', '1 ts', 'salt'],
    ['3 dl helmelk', '3 dl', 'helmelk'],
    ['½ ts nykvernet pepper', '½ ts', 'nykvernet pepper'],
    ['1 liten løk, finrevet', '1', 'liten løk, finrevet'],
    ['1,5 dl rømme', '1,5 dl', 'rømme'],
    ['2-3 ss smør', '2-3 ss', 'smør']
  ];
  for (const [line, amount, name] of cases) {
    assert.deepEqual(view.splitIngredient(line), { amount, name }, line);
  }
});

test('a line with no amount keeps its whole text', () => {
  for (const line of ['salt og pepper', 'tyttebærsyltetøy', 'kokte mandelpoteter']) {
    assert.deepEqual(view.splitIngredient(line), { amount: '', name: line });
  }
});

test('blank lines never become ingredients', () => {
  const items = view.ingredientsFor('2 egg\n\n   \n5 dl melk\n');
  assert.equal(items.length, 2);
  assert.deepEqual(items[1], { amount: '5 dl', name: 'melk' });
});

test('paragraphs become steps, and a one-paragraph method falls back to lines', () => {
  assert.deepEqual(view.stepsFor('Rør deigen.\n\nStek kakene.'), ['Rør deigen.', 'Stek kakene.']);
  assert.deepEqual(view.stepsFor('Rør deigen.\nStek kakene.'), ['Rør deigen.', 'Stek kakene.']);
  assert.deepEqual(view.stepsFor('Rør deigen.'), ['Rør deigen.']);
  assert.deepEqual(view.stepsFor('   '), []);
  assert.deepEqual(view.stepsFor(null), []);
});

test('numbers the cook typed in are not doubled by the numbered steps', () => {
  assert.deepEqual(view.stepsFor('1. Rør deigen.\n2) Stek kakene.'), ['Rør deigen.', 'Stek kakene.']);
});

test('a title becomes the file name its photograph is stored under', () => {
  assert.equal(view.slugify('Kjøttkaker i brun saus'), 'kjottkaker-i-brun-saus');
  assert.equal(view.slugify('Fårikål'), 'farikal');
  assert.equal(view.slugify('Rømmegrøt'), 'rommegrot');
  assert.equal(view.slugify('Smørbrød med reker!'), 'smorbrod-med-reker');
  assert.equal(view.slugify('Æblekake'), 'aeblekake');
});

test('a recipe with a photograph on disk gets it; one without gets nothing', () => {
  assert.equal(view.photoFor('Fårikål'), '/img/recipes/farikal.jpg');
  assert.equal(view.photoFor('Kjøttkaker i brun saus'), '/img/recipes/kjottkaker-i-brun-saus.jpg');
  assert.equal(view.photoFor('En rett ingen har tatt bilde av'), null);
});

test('the meta line counts ingredients and dates the entry', () => {
  assert.equal(
    view.recipeMeta({ ingredients: '2 egg\n5 dl melk', created_at: '2026-10-02 10:00:00' }),
    '2 ingredienser · 2. okt'
  );
  assert.equal(
    view.recipeMeta({ ingredients: '2 egg', created_at: 'ikke en dato' }),
    '1 ingrediens'
  );
});

test('the register sorts the way Norwegian sorts', () => {
  const titles = view.toIndex([
    { title: 'Ørret' }, { title: 'Aspargessuppe' }, { title: 'Ådalsbrød' }, { title: 'Sveler' }
  ]).map((card) => card.title);
  assert.deepEqual(titles, ['Aspargessuppe', 'Sveler', 'Ørret', 'Ådalsbrød']);
});
