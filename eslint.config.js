import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },
  {
    files: ['tests/**', '*.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
