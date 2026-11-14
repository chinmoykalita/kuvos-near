// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const brandText = {
  name: 'react-native',
  importNames: ['Text', 'TextInput'],
  message: 'Import Text and TextInput from @kuvos/mobile-core/components/text so the brand font is applied.',
  allowTypeImports: true,
};

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', 'packages/*'] },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: { '@typescript-eslint/no-restricted-imports': ['error', { paths: [brandText] }] },
  },
]);
