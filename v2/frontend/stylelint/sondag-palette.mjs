// sondag/palette — the six Søndag colour tokens are the only colours allowed.
//
// A hex value or colour function (rgb(), hsl(), oklch(), color-mix() …) is an error everywhere
// except the token definitions themselves, in the global stylesheet, with their exact values.
// Named colours are rejected by stylelint's own `color-named: never`.
import stylelint from 'stylelint';

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'sondag/palette';

export const TOKENS = {
  '--paper': '#FBFAF7',
  '--ink': '#14110E',
  '--soft': '#5B544C',
  '--rule': '#DED8CE',
  '--red': '#A4142E',
  '--tint': '#F2EFE8',
};

const useTokens = Object.keys(TOKENS)
  .map((t) => `var(${t})`)
  .join(', ');

const messages = ruleMessages(ruleName, {
  rejected: (colour) => `"${colour}" is not a Søndag colour. Use one of ${useTokens}.`,
  redefined: (prop) => `${prop} is a Søndag token; it is defined once, in src/styles.css :root.`,
});

const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
const COLOUR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/gi;
const URL = /url\([^)]*\)/gi;

const isGlobalStylesheet = (file) => /[\\/]src[\\/]styles\.css$/.test(file ?? '');

const isTokenDefinition = (decl) =>
  isGlobalStylesheet(decl.source?.input.file) &&
  decl.parent?.type === 'rule' &&
  decl.parent.selector === ':root' &&
  TOKENS[decl.prop]?.toLowerCase() === decl.value.trim().toLowerCase();

/** @type {import('stylelint').Rule} */
const rule = (primary) => (root, result) => {
  if (!validateOptions(result, ruleName, { actual: primary, possible: [true] })) return;

  root.walkDecls((decl) => {
    if (isTokenDefinition(decl)) return;

    if (decl.prop in TOKENS) {
      report({
        ruleName,
        result,
        node: decl,
        message: messages.redefined(decl.prop),
        word: decl.prop,
      });
      return;
    }

    const value = decl.value.replace(URL, '');
    for (const match of [...value.matchAll(HEX), ...value.matchAll(COLOUR_FN)]) {
      const colour = match[0].endsWith('(') ? match[0].slice(0, -1) + '()' : match[0];
      report({ ruleName, result, node: decl, message: messages.rejected(colour), word: match[0] });
    }
  });
};

rule.ruleName = ruleName;
rule.messages = messages;
rule.meta = { url: 'https://github.com/tidemann/food-st44/blob/main/AGENTS.md#design-søndag' };

export default createPlugin(ruleName, rule);
