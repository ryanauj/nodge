/**
 * Dock control registry + placement preferences (client UI state, persisted).
 *
 * The floating dock ({@link ./panels/FloatingDock}) is data-driven: every
 * configurable control — the editing actions (undo/redo/add/copy/paste),
 * the panel openers, the file actions, and the display toggles — is a registry
 * entry here, and the user decides **where** each one lives via a per-control
 * *placement*: `slim` (the always-visible thumb row), `expanded` (revealed by
 * the dock's expand toggle), or `hidden`. The Select/Connect/Add tool modes are
 * a registry entry too (`id: 'modes'`, a segmented group) so their placement is
 * configurable like everything else; they default to the slim row.
 *
 * Placements live in the {@link useDockPrefs} Zustand store and persist to
 * localStorage (one JSON blob), so a user's customised layout survives reloads,
 * mirroring the `appSettings`/`canvasPrefs` storage convention.
 */

import { create } from 'zustand'
import { SHEET_KEYS, SHEET_LABELS, type SheetKey } from './toolMode'

/** Where a control is surfaced in the dock. */
export const PLACEMENTS = ['slim', 'expanded', 'hidden'] as const
export type Placement = (typeof PLACEMENTS)[number]

export const PLACEMENT_LABELS: Record<Placement, string> = {
  slim: 'Slim',
  expanded: 'Expanded',
  hidden: 'Hidden',
}

/**
 * The kind of a control drives how the dock renders it:
 *  - `modes`    — the Select/Connect/Add segmented tool-mode group.
 *  - `action`   — a one-shot button (undo, save, …), possibly disable-able.
 *  - `panel`    — opens/toggles a bottom sheet; reflects open state.
 *  - `toggle`   — an on/off switch bound to a canvas display pref.
 */
export type DockControlKind = 'modes' | 'action' | 'panel' | 'toggle'

/** The category a control is grouped under in the expanded panel. */
export type DockCategory = 'Modes' | 'Edit' | 'Panels' | 'Display' | 'File'

/** A static descriptor for one configurable dock control. */
export interface DockControlDef {
  id: string
  /** Short visible label (e.g. on the button / customize row). */
  label: string
  /** Verbose accessible name (e.g. "Add node", "Properties panel"). */
  ariaLabel: string
  /** Decorative glyph paired with the label. */
  icon: string
  kind: DockControlKind
  category: DockCategory
  /** For `panel` controls, the bottom-sheet key this opens. */
  sheet?: SheetKey
}

/** Icons for the panel openers, keyed by sheet. */
const SHEET_ICONS: Record<SheetKey, string> = {
  properties: 'ⓘ',
  prototypes: '◇',
  palette: '◐',
  crossref: '⇆',
}

/** Short visible labels for the panel openers (the full name is the ariaLabel). */
const SHEET_SHORT_LABELS: Record<SheetKey, string> = {
  properties: 'Props',
  prototypes: 'Protos',
  palette: 'Palette',
  crossref: 'Refs',
}

/**
 * The full control registry, in display order. The panel openers are derived
 * from {@link SHEET_KEYS} so adding a sheet automatically surfaces a control.
 */
export const DOCK_CONTROLS: DockControlDef[] = [
  {
    id: 'modes',
    label: 'Tool modes',
    ariaLabel: 'Tool mode',
    icon: '⬚',
    kind: 'modes',
    category: 'Modes',
  },
  { id: 'undo', label: 'Undo', ariaLabel: 'Undo', icon: '↶', kind: 'action', category: 'Edit' },
  { id: 'redo', label: 'Redo', ariaLabel: 'Redo', icon: '↷', kind: 'action', category: 'Edit' },
  { id: 'add', label: 'Add', ariaLabel: 'Add node', icon: '＋', kind: 'action', category: 'Edit' },
  { id: 'copy', label: 'Copy', ariaLabel: 'Copy', icon: '⧉', kind: 'action', category: 'Edit' },
  { id: 'paste', label: 'Paste', ariaLabel: 'Paste', icon: '⎘', kind: 'action', category: 'Edit' },
  ...SHEET_KEYS.map(
    (key): DockControlDef => ({
      id: `panel:${key}`,
      label: SHEET_SHORT_LABELS[key],
      ariaLabel: `${SHEET_LABELS[key]} panel`,
      icon: SHEET_ICONS[key],
      kind: 'panel',
      category: 'Panels',
      sheet: key,
    }),
  ),
  {
    id: 'toggle:minimap',
    label: 'Minimap',
    ariaLabel: 'Minimap',
    icon: '▦',
    kind: 'toggle',
    category: 'Display',
  },
  {
    id: 'toggle:background',
    label: 'Background grid',
    ariaLabel: 'Background grid',
    icon: '⋯',
    kind: 'toggle',
    category: 'Display',
  },
  { id: 'save', label: 'Save', ariaLabel: 'Save', icon: '⭳', kind: 'action', category: 'File' },
  { id: 'load', label: 'Load', ariaLabel: 'Load', icon: '⭱', kind: 'action', category: 'File' },
]

/** The order categories appear in the expanded panel. */
export const DOCK_CATEGORIES: DockCategory[] = ['Modes', 'Panels', 'Edit', 'Display', 'File']

/**
 * Default placement for each control: the tool modes and the high-frequency
 * editing actions sit in the slim row; everything occasional is one expand-tap
 * away; nothing is hidden out of the box.
 */
const DEFAULT_PLACEMENTS: Record<string, Placement> = {
  modes: 'slim',
  undo: 'slim',
  redo: 'slim',
  add: 'slim',
  copy: 'expanded',
  paste: 'expanded',
  'panel:properties': 'expanded',
  'panel:prototypes': 'expanded',
  'panel:palette': 'expanded',
  'panel:crossref': 'expanded',
  'toggle:minimap': 'expanded',
  'toggle:background': 'expanded',
  save: 'expanded',
  load: 'expanded',
}

export const DOCK_PLACEMENT_KEY = 'nodge.dockPlacement'

const isPlacement = (v: unknown): v is Placement =>
  typeof v === 'string' && (PLACEMENTS as readonly string[]).includes(v)

/** Read saved placements, merged over the defaults (so new controls get a sane
 *  default and a corrupt/partial blob never drops a control). */
function loadPlacements(): Record<string, Placement> {
  const merged: Record<string, Placement> = { ...DEFAULT_PLACEMENTS }
  try {
    const raw = localStorage.getItem(DOCK_PLACEMENT_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      for (const def of DOCK_CONTROLS) {
        if (isPlacement(parsed[def.id])) merged[def.id] = parsed[def.id] as Placement
      }
    }
  } catch {
    /* storage/JSON unavailable — fall back to defaults */
  }
  return merged
}

interface DockPrefsState {
  /** Per-control placement, keyed by control id. */
  placements: Record<string, Placement>
  setPlacement: (id: string, placement: Placement) => void
  /** Restore every control to its default placement. */
  resetPlacements: () => void
}

export const useDockPrefs = create<DockPrefsState>((set) => ({
  placements: loadPlacements(),
  setPlacement: (id, placement) =>
    set((s) => {
      const placements = { ...s.placements, [id]: placement }
      try {
        localStorage.setItem(DOCK_PLACEMENT_KEY, JSON.stringify(placements))
      } catch {
        /* ignore */
      }
      return { placements }
    }),
  resetPlacements: () =>
    set(() => {
      const placements = { ...DEFAULT_PLACEMENTS }
      try {
        localStorage.setItem(DOCK_PLACEMENT_KEY, JSON.stringify(placements))
      } catch {
        /* ignore */
      }
      return { placements }
    }),
}))

/** The default placement for a control id (used by tests and reset). */
export function defaultPlacement(id: string): Placement {
  return DEFAULT_PLACEMENTS[id] ?? 'expanded'
}
