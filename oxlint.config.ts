import { defineConfig } from '@dakdevs/oxlint-plugin/config'

export default defineConfig({
  ignorePatterns: ['node_modules/**', 'dist/**', 'tests/artifacts/**'],
  env: { browser: true, node: true },
  globals: { chrome: 'readonly' },
})
