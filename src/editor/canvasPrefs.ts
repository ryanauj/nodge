/**
 * Canvas display preferences — client UI state, persisted to localStorage.
 *
 * Presentation toggles for the canvas chrome: whether the minimap and the
 * dotted background grid are shown. They are surfaced as Display toggles in the
 * floating dock ({@link ../panels/FloatingDock}). Like the tool-mode store these
 * are client UI state, never gateway data; unlike it they persist across reloads
 * via localStorage, mirroring the `appSettings` chrome-palette pointer convention.
 *
 * The minimap defaults **off on phone-sized viewports** (≤640px, the same
 * breakpoint the mobile chrome uses): on a phone it overlaps the thumb-reach
 * add button and the tool bar and is the control users most often want out of
 * the way. On wider viewports it defaults on, preserving the desktop default.
 */

import { create } from 'zustand'

export const MINIMAP_KEY = 'nodge.showMinimap'
export const BACKGROUND_KEY = 'nodge.showBackground'

/** True on phone-sized viewports — the default-off threshold for the minimap. */
function isPhoneViewport(): boolean {
  try {
    return typeof window !== 'undefined' && window.innerWidth <= 640
  } catch {
    return false
  }
}

/** Read a persisted boolean pref, falling back when unset or storage is absent. */
function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw === 'true') return true
    if (raw === 'false') return false
  } catch {
    /* storage may be unavailable (private mode / SSR) — use the fallback */
  }
  return fallback
}

/** Persist a boolean pref; a storage failure is non-fatal (in-memory still works). */
function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    /* ignore */
  }
}

interface CanvasPrefsState {
  /** Whether the React Flow minimap is rendered. */
  showMinimap: boolean
  /** Whether the dotted background grid is rendered. */
  showBackground: boolean
  setShowMinimap: (value: boolean) => void
  setShowBackground: (value: boolean) => void
}

/**
 * The Zustand store backing the display toggles. Each setter writes through to
 * localStorage so the choice survives a reload, then updates the store so the
 * canvas re-renders with/without the chrome immediately.
 */
export const useCanvasPrefs = create<CanvasPrefsState>((set) => ({
  showMinimap: readBool(MINIMAP_KEY, !isPhoneViewport()),
  showBackground: readBool(BACKGROUND_KEY, true),
  setShowMinimap: (showMinimap) => {
    writeBool(MINIMAP_KEY, showMinimap)
    set({ showMinimap })
  },
  setShowBackground: (showBackground) => {
    writeBool(BACKGROUND_KEY, showBackground)
    set({ showBackground })
  },
}))
