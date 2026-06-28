/**
 * App-level settings persisted in localStorage (spec §8.4 — the app-chrome
 * palette is "stored in app settings"). Mirrors the `nodge.activeGraphId`
 * pointer convention in `bootstrap.ts`: a tiny, DOM-optional storage seam so the
 * chrome theme survives reloads and is testable without a real DOM.
 */

import type { PointerStorage } from './bootstrap'

export const CHROME_PALETTE_KEY = 'nodge.chromePaletteId'

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
