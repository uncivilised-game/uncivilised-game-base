import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
  },
  resolve: {
    alias: {
      '@game': path.resolve(__dirname, 'src'),
    },
  },
});
