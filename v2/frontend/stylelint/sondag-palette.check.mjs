// Run with `npm run test:stylelint`. Guards the rule itself, so a config change cannot quietly
// turn the palette rail off.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import stylelint from 'stylelint';
import config from '../stylelint.config.mjs';

const lint = async (code, codeFilename = '/app/src/app/x.css') => {
  const { results } = await stylelint.lint({
    code,
    codeFilename,
    config,
    configBasedir: import.meta.dirname + '/..',
  });
  return results[0].warnings.map((w) => w.rule);
};

test('token use passes', async () => {
  assert.deepEqual(await lint('a {\n  color: var(--ink);\n  background: transparent;\n}\n'), []);
});

for (const colour of [
  '#123456',
  '#fff',
  'rgb(0 0 0)',
  'hsl(0 0% 0%)',
  'oklch(50% 0.1 20)',
  'color-mix(in srgb, var(--ink), var(--paper))',
]) {
  test(`rejects ${colour}`, async () => {
    assert.ok((await lint(`a { color: ${colour}; }\n`)).includes('sondag/palette'));
  });
}

test('rejects named colours', async () => {
  assert.ok((await lint('a { color: red; }\n')).includes('color-named'));
});

test('rejects a new colour custom property', async () => {
  assert.ok(
    (await lint(':root { --brand: #00ff00; }\n', '/app/src/styles.css')).includes('sondag/palette'),
  );
});

test('token definitions pass only in src/styles.css with their exact value', async () => {
  assert.deepEqual(await lint(':root { --red: #A4142E; }\n', '/app/src/styles.css'), []);
  assert.ok(
    (await lint(':root { --red: #FF0000; }\n', '/app/src/styles.css')).includes('sondag/palette'),
  );
  assert.ok((await lint(':root { --red: #A4142E; }\n')).includes('sondag/palette'));
});

test('ignores url() fragments', async () => {
  assert.deepEqual(await lint('a { mask: url("/i.svg#abc"); }\n'), []);
});
