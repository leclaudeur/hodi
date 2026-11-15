import comments from '@eslint-community/eslint-plugin-eslint-comments/configs'
import js from '@eslint/js'
import eslintReact from '@eslint-react/eslint-plugin'
import { createNodeResolver, importX } from 'eslint-plugin-import-x'
import reactHooks from 'eslint-plugin-react-hooks'
import sonarjs from 'eslint-plugin-sonarjs'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'plugin-sdk/dist/',
      'plugin-sdk/test/*/dist/',
      // Hostile plugins kept byte for byte as the security review wrote them.
      'server/test/fixtures/hostile-plugins/',
      'node_modules/',
      'test-results/',
      'playwright-report/'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  comments.recommended,
  {
    plugins: { 'import-x': importX, sonarjs },
    settings: { 'import-x/resolver-next': [createNodeResolver()] },
    rules: {
      // Express error handlers need all four parameters even when some are unused.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // docs/conventions.md: == null stays, as it covers null and undefined at once.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      '@eslint-community/eslint-comments/require-description': 'error',
      'import-x/no-cycle': 'error'
    }
  },
  {
    // docs/conventions.md sizes. The migrations only grow, and a test may hold a long journey.
    files: ['server/**/*.ts', 'web/src/**/*.{ts,tsx}', 'shared/**/*.ts', 'plugin-sdk/**/*.ts'],
    ignores: ['server/test/**', 'server/db/migrations.ts'],
    rules: {
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
      'sonarjs/cognitive-complexity': ['error', 15]
    }
  },
  {
    files: [
      'server/**/*.ts',
      'plugin-sdk/**/*.ts',
      'e2e/**/*.ts',
      'vite.config.ts',
      'vitest.config.ts',
      'playwright.config.ts',
      'eslint.config.js'
    ],
    languageOptions: {
      globals: globals.node
    }
  },
  {
    files: ['web/public/sw.js'],
    languageOptions: {
      globals: globals.serviceworker
    }
  },
  {
    files: ['web/public/theme.js', 'web/public/preload.js'],
    languageOptions: {
      sourceType: 'script',
      globals: globals.browser
    }
  },
  {
    // React's own rules (keys, effects, state, DOM): typescript-eslint's parser already reads the types.
    files: ['web/src/**/*.tsx'],
    ...eslintReact.configs['recommended-typescript'],
    rules: {
      // Every rule as an error: the code has no finding left, and it stays so.
      ...Object.fromEntries(
        Object.entries(eslintReact.configs['recommended-typescript'].rules ?? {}).map(([rule, level]) => [
          rule,
          level === 'off' ? 'off' : 'error'
        ])
      ),
      // react-hooks (below) already checks these, with refs and immutability besides.
      ...Object.fromEntries(
        [
          'error-boundaries',
          'exhaustive-deps',
          'purity',
          'rules-of-hooks',
          'set-state-in-effect',
          'set-state-in-render',
          'static-components',
          'unsupported-syntax',
          'use-memo'
        ].map(rule => [`@eslint-react/${rule}`, 'off'])
      ),
      // docs/conventions.md names refs after what they hold, not with a Ref suffix.
      '@eslint-react/naming-convention-ref-name': 'off'
    }
  },
  {
    files: ['web/src/**/*.{ts,tsx}', 'web/test/**/*.ts'],
    languageOptions: {
      globals: globals.browser
    },
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      ...reactHooks.configs.recommended.rules
    }
  }
)
