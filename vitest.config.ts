import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Don't pick up tests from local-only fixtures or the benchmark suite.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.local/**', '**/benchmark/**'],
  },
});
