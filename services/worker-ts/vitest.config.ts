import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000, // 60 seconds for circuit breaker cooldown tests
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
  },
})
