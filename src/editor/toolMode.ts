/**
 * Tool-mode + transient canvas UI state (spec §10.2, §11).
 *
 * Phase 5 introduces lightweight **tool modes** — Select / Connect / Add — that
 * live in client UI state (Zustand), NOT the gateway: switching modes and
 * opening sheets are never data mutations. The active mode drives how React Flow
 * is configured so the touch gestures never fight each other (pan vs. move vs.
 * draw-an-edge), and which transient sheet (if any) is open on narrow viewports.
 *
 * Everything that maps a mode to React Flow props is a **pure function**
 * ({@link toolModeFlowProps}) so it can be unit-tested without a canvas and is
 * the single source of truth for the "no gesture conflicts" guarantee.
 */

import { create } from 'zustand'

/** The three lightweight tool modes surfaced in the thumb-reach toolbar. */
export const TOOL_MODES = ['select', 'connect', 'add'] as const
export type ToolMode = (typeof TOOL_MODES)[number]

/** Human labels for the mode buttons (and their ARIA names). */
export const TOOL_MODE_LABELS: Record<ToolMode, string> = {
  select: 'Select',
  connect: 'Connect',
  add: 'Add',
}

/**
 * The transient bottom-sheet panels (spec §10.1): on a narrow viewport the side
 * panels become sheets, only one of which is open at a time. `null` = closed.
 */
export const SHEET_KEYS = ['properties', 'prototypes', 'palette', 'crossref'] as const
export type SheetKey = (typeof SHEET_KEYS)[number]

export const SHEET_LABELS: Record<SheetKey, string> = {
  properties: 'Properties',
  prototypes: 'Prototypes',
  palette: 'Palette',
  crossref: 'Cross-reference',
}

interface ToolModeState {
  mode: ToolMode
  /** The open bottom sheet on narrow viewports, or null when none is open. */
  sheet: SheetKey | null
  /** The pending connect-mode source node (tap source → tap target = edge). */
  connectSourceId: string | null
  setMode: (mode: ToolMode) => void
  openSheet: (sheet: SheetKey) => void
  closeSheet: () => void
  toggleSheet: (sheet: SheetKey) => void
  setConnectSource: (id: string | null) => void
}

/**
 * The Zustand store. Switching modes clears any pending connect source so a
 * half-started edge never leaks across a mode change.
 */
export const useToolMode = create<ToolModeState>((set) => ({
  mode: 'select',
  sheet: null,
  connectSourceId: null,
  setMode: (mode) => set({ mode, connectSourceId: null }),
  openSheet: (sheet) => set({ sheet }),
  closeSheet: () => set({ sheet: null }),
  toggleSheet: (sheet) => set((s) => ({ sheet: s.sheet === sheet ? null : sheet })),
  setConnectSource: (connectSourceId) => set({ connectSourceId }),
}))

/**
 * The subset of React Flow interaction props a tool mode controls. Kept as a
 * plain shape (not React-Flow's full props type) so the mapping is pure and the
 * test can assert exact values without pulling the canvas in.
 */
export interface ToolModeFlowProps {
  /** Pan the canvas on a one-finger / left-button drag (empty canvas = pan). */
  panOnDrag: boolean
  /** Marquee/box select on drag — off so a drag never fights pan/connect. */
  selectionOnDrag: boolean
  /** Nodes are draggable to move (only meaningful in Select mode). */
  nodesDraggable: boolean
  /** Nodes are connectable by dragging their handles. */
  nodesConnectable: boolean
  /** Elements are selectable by tap/click. */
  elementsSelectable: boolean
  /** Pinch-to-zoom (always on — pinch is unambiguous, spec §10.2). */
  zoomOnPinch: boolean
  /** Two-finger / wheel pan-on-scroll (kept off so one-finger drag owns pan). */
  panOnScroll: boolean
}

/**
 * Map a tool mode to the React Flow interaction props (spec §10.2 gesture
 * disambiguation). This is the heart of "draw an edge never fights pan":
 *
 *   - **select** — one-finger drag on empty canvas pans; drag on a selected node
 *     moves it; tap selects; pinch zooms. Connecting still works via handles.
 *   - **connect** — nodes are NOT draggable (so a drag can't be a move) and
 *     panning is OFF (so tapping the canvas can't be swallowed by a pan): tap a
 *     source node then a target node to make an edge; a handle drag to empty
 *     still opens the quick-picker.
 *   - **add** — panning ON, nodes not draggable, selection off: a tap on empty
 *     canvas adds a node at that point without disturbing existing placements.
 */
export function toolModeFlowProps(mode: ToolMode): ToolModeFlowProps {
  const base: ToolModeFlowProps = {
    panOnDrag: true,
    selectionOnDrag: false,
    nodesDraggable: true,
    nodesConnectable: true,
    elementsSelectable: true,
    zoomOnPinch: true,
    panOnScroll: false,
  }
  switch (mode) {
    case 'connect':
      // Drawing-first: pan off, nodes pinned in place so tap-source→tap-target
      // can never be mistaken for a pan or a move.
      return { ...base, panOnDrag: false, nodesDraggable: false }
    case 'add':
      // Tap empty canvas = add; keep panning available but pin existing nodes so
      // an add-tap never accidentally drags a node.
      return { ...base, nodesDraggable: false, elementsSelectable: false }
    case 'select':
    default:
      return base
  }
}
