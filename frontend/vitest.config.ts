import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Vitest reads this file instead of `vite.config.ts` when both exist, so the
// React plugin is repeated here - the build config stays about building.
export default defineConfig({
  plugins: [react()],
  test: {
    // Components and hooks render for real; the pure `src/lib` tests don't
    // need a DOM but are cheap enough not to warrant splitting environments.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // The real values live in `.env`; tests never reach a network, but the
    // Supabase client is constructed at import time and rejects empty input.
    env: {
      VITE_API_BASE_URL: 'http://api.test',
      VITE_SUPABASE_URL: 'http://supabase.test',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
    },
    coverage: {
      provider: 'v8',
      // `include` alone already counts every matching source file, tested
      // or not - Vitest dropped the separate `all` flag.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        // Test helpers, the app bootstrap, and type-only modules: nothing
        // with behaviour of its own to assert.
        'src/test/**',
        'src/main.tsx',
        'src/types/**',
        'src/vite-env.d.ts',
      ],
      reporter: ['text', 'html'],
      // Floors, not targets: they sit just under what the suite reaches
      // today (80.1 / 70.6 / 83.8 / 79.8), so coverage can't erode silently.
      // Raise them when the measured numbers move up; never lower one to
      // make a build pass. `src/pages` is still untested, which is what
      // keeps the overall figure at 80 rather than in the nineties.
      thresholds: {
        statements: 78,
        branches: 68,
        functions: 81,
        lines: 78,
      },
    },
  },
});
