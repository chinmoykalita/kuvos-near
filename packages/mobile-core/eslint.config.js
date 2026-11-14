const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
module.exports = defineConfig([expoConfig, {
  files: ['src/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': ['error', { patterns: [{ group: ['@solana/*', '@solana-mobile/*', '@privy-io/*', '@ethersproject/*', '**/apps/*'], message: 'Distribution-specific code belongs in the app shell.' }] }],
  },
}]);
