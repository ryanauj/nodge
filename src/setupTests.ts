import '@testing-library/jest-dom/vitest'

// React Flow relies on ResizeObserver, which jsdom does not implement. A no-op
// polyfill is enough for component tests that don't assert on measured layout.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
