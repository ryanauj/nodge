/**
 * App-level settings persisted in localStorage (spec §8.4 — the app-chrome
 * palette is "stored in app settings"). Mirrors the `nodge.activeGraphId`
 * pointer convention in `bootstrap.ts`: a tiny, DOM-optional storage seam so the
 * chrome theme survives reloads and is testable without a real DOM.
 *
 * Two independent palette pointers live here, one per `PaletteRoot` boundary:
 * `nodge.chromePaletteId` themes the app chrome (toolbars/panels) and
 * `nodge.canvasPaletteId` themes the canvas the diagram renders into. Both are
 * client-side view preferences — never graph data — so switching them re-skins
 * the canvas background and any unpinned style keys without touching the
 * concrete per-node style snapshots (§D10).
 */

import type { PointerStorage } from './bootstrap'

export const CHROME_PALETTE_KEY = 'nodge.chromePaletteId'
export const CANVAS_PALETTE_KEY = 'nodge.canvasPaletteId'

function defaultStorage(): PointerStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

/** Read the persisted app-chrome palette id (or null when unset). */
export function getChromePaletteId(
  storage: PointerStorage | null = defaultStorage(),
): string | null {
  return storage?.getItem(CHROME_PALETTE_KEY) ?? null
}

/** Persist the app-chrome palette id so the chrome theme survives a reload. */
export function setChromePaletteId(
  id: string,
  storage: PointerStorage | null = defaultStorage(),
): void {
  storage?.setItem(CHROME_PALETTE_KEY, id)
}

/**
 * Read the persisted canvas palette id (or null when unset). Null means "use the
 * graph's default palette", which `Editor` resolves from `ids.paletteId`.
 */
export function getCanvasPaletteId(
  storage: PointerStorage | null = defaultStorage(),
): string | null {
  return storage?.getItem(CANVAS_PALETTE_KEY) ?? null
}

/** Persist the canvas palette id so the chosen canvas theme survives a reload. */
export function setCanvasPaletteId(
  id: string,
  storage: PointerStorage | null = defaultStorage(),
): void {
  storage?.setItem(CANVAS_PALETTE_KEY, id)
}
