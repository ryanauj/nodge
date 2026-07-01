/**
 * Transient bottom-sheet UI state (spec §10.1).
 *
 * The canvas interaction model is **mode-less** (spec §10.2): there is no
 * Select / Connect / Add tool mode. Gestures disambiguate by *what you touch and
 * how* — tap to select, double-tap to add/remove from the selection, drag a node
 * to move it, drag from a handle to connect, long-press-then-drag on empty canvas
 * to marquee, one-finger drag to pan, pinch to zoom. So the only client UI state
 * left here is which bottom **sheet** is open on a narrow viewport.
 *
 * This is pure client UI state (Zustand), never gateway data: opening or closing
 * a sheet is never a data mutation.
 */

import { create } from 'zustand'

/**
 * The transient bottom-sheet panels (spec §10.1): on a narrow viewport the side
 * panels become sheets, only one of which is open at a time. `null` = closed.
 */
export const SHEET_KEYS = [
  'properties',
  'prototypes',
  'palette',
  'crossref',
  'relationships',
] as const
export type SheetKey = (typeof SHEET_KEYS)[number]

export const SHEET_LABELS: Record<SheetKey, string> = {
  properties: 'Properties',
  prototypes: 'Prototypes',
  palette: 'Palette',
  crossref: 'Cross-reference',
  relationships: 'Relationships',
}

interface SheetState {
  /** The open bottom sheet on narrow viewports, or null when none is open. */
  sheet: SheetKey | null
  openSheet: (sheet: SheetKey) => void
  closeSheet: () => void
  toggleSheet: (sheet: SheetKey) => void
}

/** The Zustand store for the single open bottom sheet. */
export const useSheets = create<SheetState>((set) => ({
  sheet: null,
  openSheet: (sheet) => set({ sheet }),
  closeSheet: () => set({ sheet: null }),
  toggleSheet: (sheet) => set((s) => ({ sheet: s.sheet === sheet ? null : sheet })),
}))
