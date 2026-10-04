// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

// Modern Angular only. Each rule below turns "the agent wrote it the old way" into a red CI.
const legacyImports = {
  paths: [
    {
      name: '@angular/common',
      importNames: [
        'CommonModule',
        'NgIf',
        'NgFor',
        'NgForOf',
        'NgSwitch',
        'NgSwitchCase',
        'NgSwitchDefault',
      ],
      message: 'Use built-in control flow (@if, @for, @switch).',
    },
    {
      name: '@angular/common/http',
      importNames: ['HttpClientModule'],
      message: 'Use provideHttpClient() in app.config.ts.',
    },
    {
      name: '@angular/platform-browser',
      importNames: ['BrowserModule'],
      message: 'No NgModules: bootstrapApplication() with standalone components.',
    },
    {
      name: '@angular/core',
      importNames: [
        'Input',
        'Output',
        'EventEmitter',
        'ViewChild',
        'ViewChildren',
        'ContentChild',
        'ContentChildren',
        'HostBinding',
        'HostListener',
      ],
      message:
        'Use input(), output(), model(), viewChild(), contentChild() and the host: {} metadata.',
    },
    { name: 'zone.js', message: 'The app is zoneless.' },
  ],
};

module.exports = defineConfig([
  {
    ignores: ['src/app/api/schema.d.ts'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      angular.configs.tsRecommended,
    ],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@angular-eslint/prefer-standalone': 'error',
      '@angular-eslint/prefer-signals': 'error',
      '@angular-eslint/prefer-signal-model': 'error',
      '@angular-eslint/prefer-output-emitter-ref': 'error',
      '@angular-eslint/prefer-inject': 'error',
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@angular-eslint/prefer-host-metadata-property': 'error',
      '@angular-eslint/no-experimental': 'error',
      '@angular-eslint/no-developer-preview': 'error',
      '@angular-eslint/no-uncalled-signals': 'error',
      'no-restricted-imports': ['error', legacyImports],
      'no-restricted-syntax': [
        'error',
        {
          selector: "Decorator[expression.callee.name='NgModule']",
          message: 'No NgModules: standalone components only.',
        },
        {
          selector: "Property[key.name='standalone'][value.value=false]",
          message: 'Components are standalone; do not set standalone: false.',
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/prefer-control-flow': 'error',
      '@angular-eslint/template/prefer-self-closing-tags': 'error',
      '@angular-eslint/template/prefer-ngsrc': 'error',
      '@angular-eslint/template/no-inline-styles': 'error',
      '@angular-eslint/template/button-has-type': 'error',
      '@angular-eslint/template/no-any': 'error',
    },
  },
]);
