import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120000,
    hookTimeout: 180000,
    // Ativado só com `npm run test:coverage`; o relatório HTML fica em coverage/index.html.
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts', 'bin/**/*.ts'],
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
});
