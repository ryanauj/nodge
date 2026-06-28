/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Must match the GitHub Pages path (repo name) so asset URLs resolve.
  base: '/nodge/',
  // The SQLite-WASM package ships its own `.wasm`; pre-bundling it into
  // `.vite/deps` breaks the wasm URL in dev (served as HTML → MIME error).
  // Excluding it keeps the package's own asset resolution intact.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
    // Vitest owns unit/integration specs under src/. Playwright specs live in
    // e2e/ and must not be collected by Vitest.
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
