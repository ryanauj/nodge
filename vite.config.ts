/// <reference types="vitest/config" />
import { copyFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages is a static file host with no SPA rewrite: refreshing a deep
// client-side route (e.g. `/nodge/diagram/<id>/layout/<id>`) asks the server for
// a file that doesn't exist, so Pages returns its own 404 and the app never
// boots. The standard fix is a `404.html` that is a byte copy of `index.html`:
// Pages serves it for any unknown path, the app boots, and the router reads the
// real URL — the diagram/layout data is already in the local OPFS DB. Build only.
function spaGithubPagesFallback(): Plugin {
  let outDir = 'dist'
  return {
    name: 'spa-github-pages-404',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const index = resolve(outDir, 'index.html')
      if (existsSync(index)) copyFileSync(index, resolve(outDir, '404.html'))
    },
  }
}

// Resolve where the SQLite-WASM package actually lives. With pnpm — and
// especially when running from a git worktree whose `node_modules` is hoisted to
// the parent checkout — the package (and its shipped `.wasm`) can sit outside
// the project root, which Vite's dev server refuses to serve by default. Adding
// its real directory to `server.fs.allow` keeps the dev server able to serve the
// worker's wasm in any layout (local install or hoisted worktree). Harmless for
// production builds, which don't use the dev file-serving allowlist.
const require = createRequire(import.meta.url)
let sqliteWasmDir: string | undefined
try {
  sqliteWasmDir = dirname(require.resolve('@sqlite.org/sqlite-wasm/package.json'))
} catch {
  sqliteWasmDir = undefined
}

export default defineConfig({
  plugins: [react(), spaGithubPagesFallback()],
  // Must match the GitHub Pages path (repo name) so asset URLs resolve.
  base: '/nodge/',
  // The SQLite-WASM package ships its own `.wasm`; pre-bundling it into
  // `.vite/deps` breaks the wasm URL in dev (served as HTML → MIME error).
  // Excluding it keeps the package's own asset resolution intact.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  server: sqliteWasmDir ? { fs: { allow: ['.', sqliteWasmDir] } } : undefined,
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
    // Vitest owns unit/integration specs under src/. Playwright specs live in
    // e2e/ and must not be collected by Vitest.
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
