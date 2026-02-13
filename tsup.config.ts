import { defineConfig } from 'tsup';

export default defineConfig([
  // Library entry point
  {
    entry: { blink: 'src/blink.ts' },
    format: ['esm'],
    target: 'es2020',
    clean: true,
    splitting: false,
    dts: true,
    external: ['better-sqlite3', 'llamaindex', '@llamaindex/readers', 'pg'],
  },
  // CLI entry point
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'es2020',
    clean: false,
    splitting: false,
    external: ['better-sqlite3', 'llamaindex', '@llamaindex/readers', 'pg'],
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);
