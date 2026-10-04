/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard'],
  plugins: ['./stylelint/sondag-palette.mjs'],
  rules: {
    'sondag/palette': true,
    'color-named': 'never',
  },
};
