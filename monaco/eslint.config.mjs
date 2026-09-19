import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['node_modules/**', 'packages/*/dist/**', '.work/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  { files: ['**/*.ts'], rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
);
