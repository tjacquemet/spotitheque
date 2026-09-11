import { defineConfig } from 'vitest/config'

// Config de test séparée : sans le plugin Cloudflare, les tests portent sur la logique pure.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'shared/**/*.test.ts', 'worker/**/*.test.ts'],
    environment: 'node',
  },
})
