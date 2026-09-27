const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');

module.exports = [
    js.configs.recommended,
    {
        files: ['src/**/*.{js,ts}'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: globals.node,
        },
        rules: {
            'indent': ['error', 4],
            'linebreak-style': ['error', 'unix'],
            'quotes': ['error', 'single'],
            'semi': ['error', 'always'],
            'no-unused-vars': ['error', { caughtErrors: 'none' }],
        },
    },
    ...tseslint.configs.recommended.map(config => ({ ...config, files: ['src/**/*.ts'] })),
    {
        files: ['src/**/*.ts'],
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }],
            '@typescript-eslint/no-restricted-imports': ['error', {
                paths: [{ name: 'homebridge', message: 'homebridge is a dev dependency; use api.hap at runtime and import type only.', allowTypeImports: true }],
            }],
        },
    },
];
