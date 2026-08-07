'use strict';
/*
 * Lint rules for the API.
 *
 * `npm run lint` existed as a script long before this file did, with neither
 * eslint nor a config installed, so a contributor's first command failed. The
 * rules here are deliberately close to what the code already does: a linter
 * that reports thousands of problems on a clean checkout teaches people to run
 * it with their eyes closed.
 *
 * Formatting is left to Prettier; eslint-config-prettier turns off the rules
 * that would otherwise argue with it.
 */
const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'uploads/**',
      'public/**',
      '**/*.min.js',
    ],
  },

  js.configs.recommended,
  prettier,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.es2021 },
    },
    rules: {
      // The codebase logs to the console in about 1,600 places. Making that an
      // error today would bury every real finding, so it is a warning and a
      // standing invitation to move to a real logger.
      'no-console': 'warn',

      /*
       * Cleanliness, not correctness - warnings, so they stay visible without
       * blocking a release.
       *
       * The split matters. Everything below under "real defects" is an error and
       * the count is zero: no undefined variables, no assignments to constants,
       * no duplicate object keys or class members, no branches that cannot run.
       * Those were fixed one at a time, and several were live faults - a
       * ReferenceError on every invalid login, a schema default silently
       * discarded, a Mongo filter that excluded the wrong thing.
       *
       * What is left is 73 unused locals, 12 catch blocks that only rethrow and
       * 10 empty blocks. None changes what the software does. Rewriting 99 sites
       * across code that calculates what a shop charges, to satisfy rules about
       * tidiness, is a poor trade: the risk is real and the benefit is
       * readability. They are recorded here rather than deleted from the report,
       * and the same reasoning already applies to no-console above.
       *
       * An unused argument is often a deliberate Express signature - above all
       * the four-argument error handler - so only unused variables are counted.
       */
      'no-unused-vars': ['warn', {
        args: 'none',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
      }],
      'no-useless-catch': 'warn',
      'no-empty': 'warn',

      // These catch real defects rather than style.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'no-throw-literal': 'error',
      'require-atomic-updates': 'off',

      /*
       * no-return-await is off, and this is a decision rather than an exemption.
       *
       * ESLint deprecated the rule in v8.46 - `rule.meta.deprecated` is true in
       * the version installed here. It was written when `return await` cost an
       * extra microtask for nothing; since Node 12 it is close to free, it gives
       * a usable stack trace when the promise rejects, and inside a try block it
       * is *required* - drop the await and the rejection escapes the try, so the
       * catch never runs.
       *
       * It reported 160 times in this codebase. Rewriting 160 return statements
       * in code that computes what a shop charges, to satisfy a rule its own
       * maintainers withdrew, is risk bought with no benefit. None of the 160 is
       * currently inside a try block, so the fixer would not have broken
       * anything today - but that is a property of the code as it stands now,
       * not a property anyone would maintain, and the next `return await` added
       * inside a try is the one that matters.
       */
      'no-return-await': 'off',
    },
  },

  {
    // Tests run under Jest and legitimately use its globals.
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: { 'no-console': 'off' },
  },
];
