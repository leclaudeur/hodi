import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'test-results/', 'playwright-report/']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Express error handlers need all four parameters even when some are unused.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    files: [
      'server/**/*.ts',
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
