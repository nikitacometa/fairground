// ESLint 9.39.0 flat config -- replaces legacy .eslintrc.cjs (deleted)
// DELETE NOTE: .eslintrc.cjs must be removed from the repo. It targets ESLint 8 legacy
// config and is ignored by ESLint 9. This flat config is the authoritative config.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      prettier,
    ],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // Async correctness -- catches the most common keeper/API bugs
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      // Type safety
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Warn (not error) for deep unsafe-* in non-test files
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
    },
  },
  {
    // Test files: relaxed rules
    files: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  {
    // Ignored paths
    ignores: [
      'dist/**',
      '.next/**',
      'out/**',
      'coverage/**',
      'node_modules/**',
      // ARC-56 generated TS clients -- never edit directly
      'packages/sdk/src/clients/**',
      // Drizzle migration output
      'packages/db/drizzle/**',
      // Puya contracts (Python only, not linted by ESLint)
      'packages/contracts/**',
    ],
  },
);
