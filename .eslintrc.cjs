module.exports = {
  root: true,
  env: { es2022: true, node: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  extends: [
    'eslint:recommended',
    'plugin:promise/recommended',
    'plugin:n/recommended',
    'plugin:import/recommended',
    'prettier',
  ],
  plugins: ['import', 'promise', 'n'],
  ignorePatterns: ['dist', 'node_modules'],
  rules: {
    'no-console': 'off',
    'import/no-unresolved': 'off',
  },
};


