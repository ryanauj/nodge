/**
 * Phase 3 core editor + Phase 5 touch model: multiple boards/views per board
 * (spec §12), with the full mobile interaction model layered on top.
 *
 * A React Flow canvas wired to the gateway + command layer. Every gesture goes
 * through the gateway: add a node (entity + placement), connect two nodes
 * (relationship + edge), drag to move (per-view positions, one undoable command
 * per drag end). The active board/view is reflected in the URL via React Router;
 * boards/views/palette switchers drive navigation and `updateView`. Undo/redo,
 * save-to-file and load-from-file hang off the same seam.
 *
 * Interaction is **mode-less** (spec §10.2) — no Select/Connect/Add tool modes.
 * Gestures disambiguate by what you touch and how:
 *   - **tap** a node/edge = select it (single); **double-tap** = add/remove it
 *     from the current selection (⌘/ctrl-click parity, {@link toggleSelection});
 *   - **drag a node** = move it; **drag from a handle** = connect (drag to empty
 *     opens the drag-to-create picker, §9.4);
 *   - **long-press then drag** on empty canvas = marquee multi-select (we own the
 *     gesture via pointer capture so it never fights the one-finger pan);
 *   - **one-finger drag** on empty canvas = pan; **pinch** = zoom.
 * Adding a node is the dock's **Add** button. On narrow viewports the side panels
 * surface as swipe-to-dismiss **bottom sheets**; sheet state is client UI state
 * (the Zustand store), not gateway data. Large-graph performance: visible-only
 * rendering + a memoized transform.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeMouseHandler,
  type FinalConnectionState,
  type NodeChange,
  type NodeMouseHandler,
} from '@xyflow/react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import '@xyflow/react/dist/style.css'
import { useGateway } from '../app/GatewayContext'
import { buildClipboard, parseClipboard, serializeClipboard } from '../gateway/clipboard'
import type { Clipboard } from '../gateway/types'
import type { Entity, Prototype } from '../model'
import {
  ACTIVE_GRAPH_KEY,
  bootstrapOrOpen,
  reopen,
  type DiagramIds,
} from './bootstrap'
import { loadDiagram, type FlowEdge, type FlowNode } from './diagram'
import {
  downloadText,
  exportFileName,
  exportGraphText,
  importGraphText,
  pickTextFile,
} from './fileIo'
import { NodgeNode } from './NodgeNode'
import { PaletteRoot } from './PaletteRoot'
import { DEFAULT_PALETTE_TOKENS } from './style'
import { setChromePaletteId, getCanvasPaletteId, setCanvasPaletteId } from './appSettings'
import { BoardViewBar } from './panels/BoardViewBar'
import { EntityPanel } from './panels/EntityPanel'
import { PaletteSwitcher } from './panels/PaletteSwitcher'
import { PaletteEditor } from './panels/PaletteEditor'
import { NodeStylePanel } from './panels/NodeStylePanel'
import { NodeTemplatesPanel } from './panels/NodeTemplatesPanel'
import { EdgeStylePanel } from './panels/EdgeStylePanel'
import { PrototypePanel } from './panels/PrototypePanel'
import { RelationshipsPanel } from './panels/RelationshipsPanel'
import { QuickPicker } from './panels/QuickPicker'
import { EntityPicker } from './panels/EntityPicker'
import { BottomSheet } from './panels/BottomSheet'
import { FloatingDock } from './panels/FloatingDock'
import { useSheets, SHEET_LABELS, type SheetKey } from './sheets'
import { marqueeRect, nodesInMarquee, toggleSelection, type NodeBox } from './selection'
import { useCanvasPrefs } from './canvasPrefs'
import './editor.css'

/** Build the diagram/layout URL the router reflects the active diagram into. */
function diagramPath(diagramId: string, layoutId: string): string {
  return `/diagram/${diagramId}/layout/${layoutId}`
}

/** Parse the active diagram/layout ids out of a `/diagram/:diagramId/layout/:layoutId` path. */
function parseDiagramPath(pathname: string): {
  diagramId: string | null
  layoutId: string | null
} {
  const m = pathname.match(/\/diagram\/([^/]+)\/layout\/([^/]+)/)
  return m ? { diagramId: m[1], layoutId: m[2] } : { diagramId: null, layoutId: null }
}

const POSITION_FLUSH_MS = 250

/** Stable node-type registry (defining this inline would remount every render). */
const nodeTypes = { nodge: NodgeNode }

function EditorCanvas() {
  const getGateway = useGateway()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { diagramId: routeDiagramId, layoutId: routeLayoutId } = parseDiagramPath(pathname)

  // Bootstrap resolves the *active graph* (from the localStorage pointer, or by
  // seeding a default graph on first run) and a fallback board/view.
  const bootstrap = useQuery<DiagramIds>({
    queryKey: ['bootstrap'],
    queryFn: async () => bootstrapOrOpen(await getGateway()),
    staleTime: Infinity,
  })
  const graphId = bootstrap.data?.graphId ?? null

  // Resolve the active board/view from the URL (or the bootstrap fallback),
  // tolerating stale ids. Re-runs whenever the route changes.
  const resolved = useQuery<DiagramIds | null>({
    queryKey: ['resolved', graphId, routeDiagramId, routeLayoutId],
    queryFn: async () => {
      const gw = await getGateway()
      const ids = await reopen(gw, graphId!, routeDiagramId, routeLayoutId)
      return ids ?? bootstrap.data ?? null
    },
    enabled: !!graphId,
    // Keep the resolved ids stable across the `/` → board/view redirect so the
    // canvas/toolbar never flicker back to a disabled (null-ids) state.
    placeholderData: keepPreviousData,
  })
  const ids = resolved.data ?? null

  // Redirect the bare `/` route to the resolved board/view URL so the active
  // diagram is always reflected in the URL (spec §11). Deep links (params
  // present) are trusted as-is — `reopen` already falls back to a valid
  // board/view when an id is stale — so this never fights user navigation.
  useEffect(() => {
    if (!ids) return
    if (!routeDiagramId || !routeLayoutId) {
      navigate(diagramPath(ids.diagramId, ids.layoutId), { replace: true })
    }
  }, [ids, routeDiagramId, routeLayoutId, navigate])

  // The canvas is "ready" once the URL reflects the resolved board/view (the
  // initial `/`→board/view redirect has settled). Gating interaction on this
  // means add/connect gestures never overlap the pending redirect/resolution.
  const ready =
    !!ids && ids.diagramId === routeDiagramId && ids.layoutId === routeLayoutId

  // The canvas palette is a client-side view preference (§8.4 / §D10): it themes
  // the canvas the diagram renders into (its background + any unpinned style
  // keys) without touching per-node style snapshots. Persisted in appSettings so
  // the choice survives a reload; `null` means "the graph's default palette",
  // which resolves from `ids.paletteId`.
  const [canvasPaletteId, setCanvasPaletteIdState] = useState<string | null>(() =>
    getCanvasPaletteId(),
  )
  const effectiveCanvasPaletteId = canvasPaletteId ?? ids?.paletteId ?? null

  const diagram = useQuery({
    queryKey: ['diagram', ids?.graphId, ids?.diagramId, ids?.layoutId, effectiveCanvasPaletteId],
    queryFn: async () => loadDiagram(await getGateway(), ids!, effectiveCanvasPaletteId),
    enabled: !!ids,
  })

  const [nodes, setNodes, onNodesChangeBase] = useNodesState<FlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([])
  const nodesRef = useRef<FlowNode[]>([])
  nodesRef.current = nodes

  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  // Selection (for the properties / save-as-prototype surfaces).
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const selectedNodeIdsRef = useRef<string[]>([])
  const selectedEdgeIdsRef = useRef<string[]>([])

  // Transient sheet state (client UI state, §10.1/§11). Interaction is mode-less
  // (§10.2): the React Flow interaction props are fixed and gestures disambiguate
  // by target (see the marquee + double-tap handlers below).
  const sheet = useSheets((s) => s.sheet)
  const closeSheet = useSheets((s) => s.closeSheet)

  // Canvas display prefs (persisted client UI state): the minimap and background
  // grid are toggleable from the floating settings panel (spec §10.1 chrome).
  const showMinimap = useCanvasPrefs((s) => s.showMinimap)
  const showBackground = useCanvasPrefs((s) => s.showBackground)

  // Drag-to-create quick-picker (§9.4) state, populated on connect-to-empty.
  const [pickerCtx, setPickerCtx] = useState<{
    sourceNodeId: string
    sourceHandle: string | null
    x: number
    y: number
    entities: Entity[]
    prototypes: Prototype[]
  } | null>(null)

  // Add-node entity-picker (§9 / D6) state. The dock's Add button opens this
  // picker to choose an existing entity (→ placeEntity) or create a new one
  // (→ addNode), instead of dropping an anonymous `Node N`.
  const [addPickerCtx, setAddPickerCtx] = useState<{
    x: number
    y: number
    entities: Entity[]
    nodePrototypes: Prototype[]
  } | null>(null)

  // Long-press marquee (spec §10.2): a rectangle in *screen* coords while the
  // gesture is live (null when idle). We own the gesture end-to-end via pointer
  // capture so it never fights the one-finger pan; see the effect below.
  const [marquee, setMarquee] = useState<{
    x0: number
    y0: number
    x1: number
    y1: number
  } | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  // Latest viewport-persist callback, read by the pane pointer effect (which is
  // attached once) so an owned pan persists the viewport like a React Flow pan.
  const onMoveEndRef = useRef<() => void>(() => {})

  const { screenToFlowPosition, setViewport, getViewport, fitView } = useReactFlow()

  // Navigate to a board/view, persisting the current viewport first so each
  // view keeps its own pan/zoom (spec §7.2). The URL change re-resolves ids.
  const persistViewport = useCallback(async () => {
    if (!ids) return
    const vp = getViewport()
    const gw = await getGateway()
    await gw.updateLayout(ids.layoutId, { viewport: { x: vp.x, y: vp.y, zoom: vp.zoom } })
  }, [ids, getGateway, getViewport])

  const navigateTo = useCallback(
    async (diagramId: string, layoutId: string) => {
      await persistViewport()
      navigate(diagramPath(diagramId, layoutId))
    },
    [persistViewport, navigate],
  )

  const refreshUndo = useCallback(async () => {
    const gw = await getGateway()
    setCanUndo(gw.canUndo())
    setCanRedo(gw.canRedo())
  }, [getGateway])

  // Sync local canvas state from the loaded snapshot whenever it changes.
  useEffect(() => {
    if (!diagram.data) return
    setNodes(diagram.data.flowNodes)
    setEdges(diagram.data.flowEdges)
    void refreshUndo()
  }, [diagram.data, setNodes, setEdges, refreshUndo])

  // Restore the view's saved pan/zoom on view switch (spec §7.2). Keyed on the
  // active view id so it fires only when the view changes, not on every edit.
  const restoredViewRef = useRef<string | null>(null)
  useEffect(() => {
    const snap = diagram.data
    if (!snap || snap.ids.layoutId === restoredViewRef.current) return
    restoredViewRef.current = snap.ids.layoutId
    if (snap.viewport) void setViewport(snap.viewport)
  }, [diagram.data, setViewport])

  const invalidateDiagram = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['diagram'] }),
    [queryClient],
  )

  // After "Auto-arrange" recomputes positions (§8), refresh the canvas from the
  // new layout and re-fit the view. Respect `prefers-reduced-motion`: animate the
  // fitView transition only when motion is welcome, snap instantly otherwise.
  const onLayoutGenerated = useCallback(async () => {
    await invalidateDiagram()
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    void fitView({ duration: prefersReducedMotion ? 0 : 400 })
    await refreshUndo()
  }, [invalidateDiagram, fitView, refreshUndo])

  // Apply a palette as the app-chrome theme (spec §8.4) — the second PaletteRoot
  // boundary. Persists the pointer (localStorage, mirroring activeGraphId) and
  // re-resolves the top-level chrome palette so toolbars/panels re-theme.
  const applyChromePalette = useCallback(
    (paletteId: string) => {
      setChromePaletteId(paletteId)
      void queryClient.invalidateQueries({ queryKey: ['chrome-palette'] })
    },
    [queryClient],
  )

  // Apply a palette as the canvas theme (spec §8.4) — the per-view PaletteRoot
  // boundary around the ReactFlow canvas. Persists the pointer (localStorage) and
  // updates the state so the `['diagram', …, canvasPaletteId]` query re-resolves
  // the canvas tokens immediately; the change is non-destructive (pinned per-node
  // styles keep their snapshots, §D10).
  const applyCanvasPalette = useCallback(
    (paletteId: string) => {
      setCanvasPaletteId(paletteId)
      setCanvasPaletteIdState(paletteId)
    },
    [],
  )

  // Open the add-node entity picker (§9 / D6) at a flow-space point. Loads the
  // graph's entities + node prototypes so the picker can offer "use existing" /
  // "create new". Driven by the dock's Add button.
  const openAddPicker = useCallback(
    (x: number, y: number) => {
      if (!ids) return
      void getGateway().then(async (gw) => {
        const graph = await gw.getGraph(ids.graphId)
        setAddPickerCtx({
          x,
          y,
          entities: graph.entities,
          nodePrototypes: graph.prototypes.filter((p) => p.kind === 'node'),
        })
      })
    },
    [ids, getGateway],
  )

  // Add-node button (dock FAB): open the picker near the CENTER of the current
  // viewport (converted screen→flow) so a new node always lands on-screen at any
  // pan/zoom, with a small cascade so repeated adds don't stack exactly.
  const onAddNodeButton = useCallback(() => {
    if (!ids) return
    const rect = wrapperRef.current?.getBoundingClientRect()
    const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
    const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
    // Spread new nodes across a small 3×3 grid around the viewport centre so
    // repeated adds stay on-screen without stacking on top of each other.
    const n = nodesRef.current.length
    const dx = ((n % 3) - 1) * 120
    const dy = ((Math.floor(n / 3) % 3) - 1) * 96
    const flow = screenToFlowPosition({ x: cx + dx, y: cy + dy })
    openAddPicker(flow.x, flow.y)
  }, [ids, screenToFlowPosition, openAddPicker])

  // Create a brand-new entity + node at the picker's point (§9 / D6 path b). The
  // prototype seeds a concrete style snapshot on the node (Phase 3 snapshot-on-create).
  const addNamedNode = useMutation({
    mutationFn: async ({
      name,
      nodePrototypeId,
    }: {
      name: string
      nodePrototypeId: string | null
    }) => {
      const gw = await getGateway()
      return gw.addNode(ids!.diagramId, ids!.layoutId, {
        name,
        x: addPickerCtx!.x,
        y: addPickerCtx!.y,
        nodePrototypeId,
      })
    },
    onSuccess: async () => {
      setAddPickerCtx(null)
      await invalidateDiagram()
      await refreshUndo()
    },
  })

  // Place an existing entity as a new node at the picker's point (§9 / D6 path a).
  const placeExisting = useMutation({
    mutationFn: async (entityId: string) => {
      const gw = await getGateway()
      return gw.placeEntity(ids!.diagramId, ids!.layoutId, {
        entityId,
        x: addPickerCtx!.x,
        y: addPickerCtx!.y,
      })
    },
    onSuccess: async () => {
      setAddPickerCtx(null)
      await invalidateDiagram()
      await refreshUndo()
    },
  })

  const connect = useMutation({
    mutationFn: async (connection: Connection) => {
      const gw = await getGateway()
      return gw.connectNodes(ids!.diagramId, {
        sourceNodeId: connection.source,
        targetNodeId: connection.target,
        sourceHandle: connection.sourceHandle ?? null,
        targetHandle: connection.targetHandle ?? null,
      })
    },
    onSuccess: async () => {
      await invalidateDiagram()
      await refreshUndo()
    },
  })

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) connect.mutate(connection)
    },
    [connect],
  )

  // Drag-to-create (§9.4): a connection that ends on empty canvas opens the
  // quick-picker so the user can connect to an existing or a new entity.
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode || !ids) return
      const point =
        'changedTouches' in event ? event.changedTouches[0] : (event as MouseEvent)
      const flowPos = screenToFlowPosition({ x: point.clientX, y: point.clientY })
      void getGateway().then(async (gw) => {
        const graph = await gw.getGraph(ids.graphId)
        setPickerCtx({
          sourceNodeId: state.fromNode!.id,
          sourceHandle: state.fromHandle?.id ?? null,
          x: flowPos.x,
          y: flowPos.y,
          entities: graph.entities,
          prototypes: graph.prototypes,
        })
      })
    },
    [ids, getGateway, screenToFlowPosition],
  )

  // Apply an explicit multi-selection to the canvas (marquee + double-tap toggle
  // both drive this). Setting each element's `selected` flag is how React Flow
  // reflects a programmatic selection; it then fires `onSelectionChange`, which
  // refreshes the panels. Selecting nodes clears edges and vice-versa is handled
  // by passing both target sets.
  const applySelection = useCallback(
    (nodeIds: readonly string[], edgeIds: readonly string[]) => {
      setNodes((nds) => nds.map((n) => ({ ...n, selected: nodeIds.includes(n.id) })))
      setEdges((eds) => eds.map((e) => ({ ...e, selected: edgeIds.includes(e.id) })))
    },
    [setNodes, setEdges],
  )

  // Double-tap = add/remove from the selection (§10.2, ⌘/ctrl-click parity). A
  // single tap is React Flow's default single-select; a second tap on the SAME
  // element within the window toggles it against the selection as it was BEFORE
  // the first tap (captured then, while the refs still hold the pre-tap set).
  const DOUBLE_TAP_MS = 300
  const lastTapRef = useRef<{
    id: string
    kind: 'node' | 'edge'
    t: number
    nodes: string[]
    edges: string[]
  } | null>(null)

  const onElementClick = useCallback(
    (kind: 'node' | 'edge', id: string) => {
      const now = Date.now()
      const prev = lastTapRef.current
      if (prev && prev.kind === kind && prev.id === id && now - prev.t < DOUBLE_TAP_MS) {
        lastTapRef.current = null
        const nextNodes = kind === 'node' ? toggleSelection(prev.nodes, id) : prev.nodes
        const nextEdges = kind === 'edge' ? toggleSelection(prev.edges, id) : prev.edges
        // Defer past React Flow's own single-select for this second click so our
        // additive selection lands on top and wins.
        setTimeout(() => applySelection(nextNodes, nextEdges), 0)
        return
      }
      // First tap: record the selection as it stands *before* React Flow's own
      // single-select commits (onSelectionChange lags a render, so the refs still
      // hold the pre-tap set here).
      lastTapRef.current = {
        id,
        kind,
        t: now,
        nodes: selectedNodeIdsRef.current.slice(),
        edges: selectedEdgeIdsRef.current.slice(),
      }
    },
    [applySelection],
  )

  const onNodeClick = useCallback<NodeMouseHandler<FlowNode>>(
    (_event, node) => onElementClick('node', node.id),
    [onElementClick],
  )
  const onEdgeClick = useCallback<EdgeMouseHandler<FlowEdge>>(
    (_event, edge) => onElementClick('edge', edge.id),
    [onElementClick],
  )

  // Finalize a marquee: select every node whose box overlaps the dragged rect
  // (converted screen→flow), replacing the current selection.
  const finishMarquee = useCallback(
    (rectScreen: { x0: number; y0: number; x1: number; y1: number }) => {
      const a = screenToFlowPosition({ x: rectScreen.x0, y: rectScreen.y0 })
      const b = screenToFlowPosition({ x: rectScreen.x1, y: rectScreen.y1 })
      const rect = marqueeRect({ x0: a.x, y0: a.y, x1: b.x, y1: b.y })
      const boxes: NodeBox[] = nodesRef.current.map((n) => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        width: n.measured?.width ?? n.width ?? 120,
        height: n.measured?.height ?? n.height ?? 40,
      }))
      applySelection(nodesInMarquee(boxes, rect), [])
    },
    [screenToFlowPosition, applySelection],
  )

  // Pane pointer gestures (spec §10.2): we own BOTH one-finger pan and the
  // long-press-then-drag marquee, because React Flow's pan can't be reliably
  // interrupted once its pointerdown has started it. So `panOnDrag` is off and:
  //   - press on empty pane → start a long-press timer;
  //   - move before it fires → it's a **pan**: we translate the viewport by the
  //     drag delta (`setViewport`) for the rest of the gesture;
  //   - the timer fires (held still) → **marquee**: subsequent moves grow the
  //     box; release resolves the covered nodes into the selection.
  // A press on a node/handle isn't a pane target, so node-drag and handle-connect
  // are untouched. Listeners attach once; latest callbacks come via refs.
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const LONG_PRESS_MS = 380
    const PAN_START_PX = 6
    let timer: ReturnType<typeof setTimeout> | null = null
    let pointerId = -1
    let phase: 'idle' | 'pan' | 'marquee' = 'idle'
    let start = { x: 0, y: 0 }
    let startVp = { x: 0, y: 0, zoom: 1 }
    let live = { x0: 0, y0: 0, x1: 0, y1: 0 }

    const clearTimer = () => {
      if (timer) clearTimeout(timer)
      timer = null
    }
    const reset = () => {
      clearTimer()
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      pointerId = -1
      phase = 'idle'
    }

    const fire = () => {
      timer = null
      if (phase !== 'idle') return
      phase = 'marquee'
      live = { x0: start.x, y0: start.y, x1: start.x, y1: start.y }
      setMarquee({ ...live })
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (phase === 'idle') {
        if (Math.hypot(dx, dy) <= PAN_START_PX) return
        // Moved before the hold completed → this is a pan, not a marquee.
        clearTimer()
        phase = 'pan'
      }
      if (phase === 'pan') {
        setViewport({ x: startVp.x + dx, y: startVp.y + dy, zoom: startVp.zoom })
        return
      }
      // marquee
      live = { ...live, x1: e.clientX, y1: e.clientY }
      setMarquee({ ...live })
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      if (phase === 'marquee') {
        const snapshot = live
        setMarquee(null)
        // Defer: this same pointerup makes React Flow treat the pane as clicked
        // and clear the selection. Apply our marquee selection on the next tick so
        // it lands on top of (and wins) that deselect.
        setTimeout(() => finishMarquee(snapshot), 0)
      } else if (phase === 'pan') {
        onMoveEndRef.current()
      }
      reset()
    }

    // Only the empty-canvas pane starts a pane gesture. Capture phase on the
    // always-present wrapper so we see the pointerdown regardless of React Flow.
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (pointerId !== -1) return
      const target = e.target as HTMLElement | null
      if (!target?.classList.contains('react-flow__pane')) return
      pointerId = e.pointerId
      phase = 'idle'
      start = { x: e.clientX, y: e.clientY }
      startVp = getViewport()
      clearTimer()
      timer = setTimeout(fire, LONG_PRESS_MS)
      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onUp, true)
    }

    wrapper.addEventListener('pointerdown', onDown, true)
    return () => {
      reset()
      wrapper.removeEventListener('pointerdown', onDown, true)
    }
  }, [finishMarquee, getViewport, setViewport])

  const connectToExisting = useMutation({
    mutationFn: async (entityId: string) => {
      const gw = await getGateway()
      return gw.connectToExistingEntity(ids!.diagramId, ids!.layoutId, {
        sourceNodeId: pickerCtx!.sourceNodeId,
        entityId,
        x: pickerCtx!.x,
        y: pickerCtx!.y,
        sourceHandle: pickerCtx!.sourceHandle,
      })
    },
    onSuccess: async () => {
      setPickerCtx(null)
      await invalidateDiagram()
      await refreshUndo()
    },
  })

  const connectToNew = useMutation({
    mutationFn: async ({ name, prototypeId }: { name: string; prototypeId: string | null }) => {
      const gw = await getGateway()
      return gw.connectToNewEntity(ids!.diagramId, ids!.layoutId, {
        sourceNodeId: pickerCtx!.sourceNodeId,
        name,
        x: pickerCtx!.x,
        y: pickerCtx!.y,
        nodePrototypeId: prototypeId,
        sourceHandle: pickerCtx!.sourceHandle,
      })
    },
    onSuccess: async () => {
      setPickerCtx(null)
      await invalidateDiagram()
      await refreshUndo()
    },
  })

  // Stamp a brand-new entity from a prototype, placed clear of the chrome (§9.1).
  const stampPrototype = useMutation({
    mutationFn: async (prototype: Prototype) => {
      const gw = await getGateway()
      const count = nodesRef.current.length
      const x = 250 + (count % 5) * 180
      const y = 200 + Math.floor(count / 5) * 120
      return gw.addNode(ids!.diagramId, ids!.layoutId, {
        name: prototype.defaultLabel || prototype.name,
        x,
        y,
        nodePrototypeId: prototype.id,
      })
    },
    onSuccess: invalidateDiagram,
  })

  // Persist positions one drag end at a time (one undoable command per drag).
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const movedIds = useRef<Set<string>>(new Set())
  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      onNodesChangeBase(changes)
      for (const change of changes) {
        if (change.type === 'position' && change.dragging === false) movedIds.current.add(change.id)
      }
      const ended = changes.some((c) => c.type === 'position' && c.dragging === false)
      if (!ended || !ids) return
      if (flushTimer.current) clearTimeout(flushTimer.current)
      flushTimer.current = setTimeout(() => {
        const toPersist = nodesRef.current
          .filter((n) => movedIds.current.has(n.id))
          .map((n) => ({ nodeId: n.id, x: n.position.x, y: n.position.y }))
        movedIds.current.clear()
        if (toPersist.length === 0) return
        void getGateway()
          .then((gw) => gw.bulkUpsertPositions(ids.layoutId, toPersist))
          .then(refreshUndo)
      }, POSITION_FLUSH_MS)
    },
    [onNodesChangeBase, ids, getGateway, refreshUndo],
  )

  // Persist the view's pan/zoom shortly after a move ends (spec §7.2). This is a
  // presentation update, not a structural one, so it is debounced and not pushed
  // onto the undo stack as a discrete user gesture.
  const viewportTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onMoveEnd = useCallback(() => {
    if (!ids) return
    if (viewportTimer.current) clearTimeout(viewportTimer.current)
    viewportTimer.current = setTimeout(() => {
      const vp = getViewport()
      void getGateway().then((gw) =>
        gw.updateLayout(ids.layoutId, { viewport: { x: vp.x, y: vp.y, zoom: vp.zoom } }),
      )
    }, POSITION_FLUSH_MS)
  }, [ids, getGateway, getViewport])
  // Expose the latest viewport-persist to the once-attached pane pointer effect.
  onMoveEndRef.current = onMoveEnd

  const undo = useMutation({
    mutationFn: async () => (await getGateway()).undo(),
    onSuccess: async () => {
      await invalidateDiagram()
      await refreshUndo()
    },
  })
  const redo = useMutation({
    mutationFn: async () => (await getGateway()).redo(),
    onSuccess: async () => {
      await invalidateDiagram()
      await refreshUndo()
    },
  })

  // Delete the current selection (nodes + edges) as one undoable command (§7.1).
  // Deleting a node also removes its incident edges (handled in the gateway), so
  // the canvas never keeps a dangling edge. Clears selection so the panels close.
  const deleteSelection = useMutation({
    mutationFn: async () => {
      if (!ids) return
      const nodeIds = selectedNodeIdsRef.current.slice()
      const edgeIds = selectedEdgeIdsRef.current.slice()
      if (nodeIds.length === 0 && edgeIds.length === 0) return
      const gw = await getGateway()
      await gw.deleteDiagramElements(ids.diagramId, { nodeIds, edgeIds })
    },
    onSuccess: async () => {
      selectedNodeIdsRef.current = []
      selectedEdgeIdsRef.current = []
      setSelectedNodeId(null)
      setSelectedEntityId(null)
      setSelectedEdgeId(null)
      await invalidateDiagram()
      await refreshUndo()
    },
  })

  // Track selection so the panels and copy/paste know what's active.
  const onSelectionChange = useCallback(
    ({ nodes: selNodes, edges: selEdges }: { nodes: FlowNode[]; edges: FlowEdge[] }) => {
      selectedNodeIdsRef.current = selNodes.map((n) => n.id)
      selectedEdgeIdsRef.current = selEdges.map((e) => e.id)
      const firstNode = selNodes[0]
      setSelectedNodeId(firstNode?.id ?? null)
      setSelectedEntityId(firstNode ? (firstNode.data.entityId ?? null) : null)
      setSelectedEdgeId(selEdges[0]?.id ?? null)
    },
    [],
  )

  // Copy/paste = placement (§9.3). Copy serializes the selected subgraph to a
  // clipboard JSON (system clipboard + an in-memory fallback for cross-document);
  // paste re-places the same entities/relationships as one undoable command.
  const clipboardRef = useRef<Clipboard | null>(null)

  const copySelection = useCallback(async () => {
    if (!ids || selectedNodeIdsRef.current.length === 0) return
    const gw = await getGateway()
    const diagram = await gw.getDiagram(ids.diagramId)
    const positions = new Map(
      nodesRef.current.map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
    )
    const clipboard = buildClipboard(diagram, selectedNodeIdsRef.current, positions)
    clipboardRef.current = clipboard
    try {
      await navigator.clipboard?.writeText(serializeClipboard(clipboard))
    } catch {
      /* system clipboard may be unavailable; the in-memory copy still works */
    }
  }, [ids, getGateway])

  const pasteClipboard = useMutation({
    mutationFn: async () => {
      if (!ids) return
      let clipboard = clipboardRef.current
      try {
        const text = await navigator.clipboard?.readText()
        const parsed = text ? parseClipboard(text) : null
        if (parsed) clipboard = parsed
      } catch {
        /* fall back to the in-memory clipboard */
      }
      if (!clipboard || clipboard.nodes.length === 0) return
      const gw = await getGateway()
      // Offset the paste so it doesn't land exactly on the originals.
      return gw.pasteClipboard(ids.diagramId, ids.layoutId, { clipboard, x: 80, y: 80 })
    },
    onSuccess: async () => {
      await invalidateDiagram()
      await refreshUndo()
    },
  })

  // Keyboard shortcuts (desktop): Ctrl/Cmd+Z undo, +Shift / Ctrl+Y redo, C copy,
  // V paste; Delete/Backspace deletes the selection. We own delete (React Flow's
  // built-in `deleteKeyCode` is disabled) so it routes through the gateway rather
  // than only mutating local canvas state.
  useEffect(() => {
    const isEditable = (el: EventTarget | null): boolean => {
      const node = el as HTMLElement | null
      if (!node) return false
      const tag = node.tagName
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        node.isContentEditable === true
      )
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditable(e.target)) {
        if (selectedNodeIdsRef.current.length === 0 && selectedEdgeIdsRef.current.length === 0) {
          return
        }
        e.preventDefault()
        deleteSelection.mutate()
        return
      }
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo.mutate()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        redo.mutate()
      } else if (key === 'c') {
        void copySelection()
      } else if (key === 'v') {
        pasteClipboard.mutate()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, copySelection, pasteClipboard, deleteSelection])

  const save = useMutation({
    mutationFn: async () => {
      const gw = await getGateway()
      const graph = (await gw.listGraphs()).find((g) => g.id === ids!.graphId)
      const text = await exportGraphText(gw, ids!.graphId)
      downloadText(exportFileName(graph?.name ?? 'diagram'), text)
    },
  })

  const load = useMutation({
    mutationFn: async () => {
      const text = await pickTextFile()
      if (text == null) return
      const gw = await getGateway()
      const graphId = await importGraphText(gw, text)
      try {
        localStorage.setItem(ACTIVE_GRAPH_KEY, graphId)
      } catch {
        /* storage may be unavailable; the in-memory store still holds the graph */
      }
      await queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      await invalidateDiagram()
    },
  })

  // Drill-down navigation from a typed link (spec §5.4, §7.4): a `diagram` link
  // targets a diagram id → open its first layout; an `entity` link targets an
  // entity id → open a diagram/layout where that entity is placed (via the index).
  const drillTo = useCallback(
    async (kind: 'diagram' | 'entity', target: string) => {
      const gw = await getGateway()
      if (kind === 'diagram') {
        try {
          const diagram = await gw.getDiagram(target)
          const layout = diagram.layouts[0]
          if (layout) await navigateTo(diagram.id, layout.id)
        } catch {
          /* dangling diagram reference — ignore */
        }
        return
      }
      const usage = await gw.getEntityUsages(target)
      const placement = usage.placements[0]
      if (!placement) return
      const diagram = await gw.getDiagram(placement.diagramId)
      const layout = diagram.layouts[0]
      if (layout) await navigateTo(diagram.id, layout.id)
    },
    [getGateway, navigateTo],
  )

  // Reveal a relationship's backing edge on the canvas (RelationshipsPanel
  // drill-down, §10/D7): mark that edge selected in React Flow state and reflect
  // it in selection so the edge-style panel picks it up. Only meaningful when the
  // edge is placed on the active diagram (the panel only offers it then).
  const revealEdge = useCallback(
    (edgeId: string) => {
      setEdges((eds) => eds.map((e) => ({ ...e, selected: e.id === edgeId })))
      setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)))
      setSelectedEdgeId(edgeId)
      setSelectedNodeId(null)
      setSelectedEntityId(null)
    },
    [setEdges, setNodes],
  )

  // Busy whenever the diagram is (re)fetching — not just the initial load — so
  // the "settling" indicator reflects background refetches after edits too.
  const busy = !ready || diagram.isFetching

  // The view palette's tokens wrap the canvas in a PaletteRoot (§8.4 boundary).
  const canvasTokens = diagram.data?.paletteTokens ?? DEFAULT_PALETTE_TOKENS
  // The resolved style of the selected node (for the link/unlink property panel).
  const selectedNodeStyle = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId)?.data.style ?? null
    : null
  // The resolved style of the selected edge (for the edge link/unlink panel).
  const selectedEdgeStyle = selectedEdgeId
    ? edges.find((e) => e.id === selectedEdgeId)?.style ?? null
    : null

  // Group the panels by sheet key (spec §10.1): each group renders once and is
  // placed either in the desktop side column or its mobile bottom sheet. The
  // `properties`/`crossref` groups are only present when something is selected,
  // which drives whether their bottom-sheet tab is enabled.
  const sheetGroups: Record<SheetKey, ReactNode> = ids
    ? {
        palette: (
          <>
            <BoardViewBar
              graphId={ids.graphId}
              diagramId={ids.diagramId}
              layoutId={ids.layoutId}
              onNavigate={(d, l) => void navigateTo(d, l)}
              onChanged={() => {
                void queryClient.invalidateQueries({ queryKey: ['graph', ids.graphId] })
                void queryClient.invalidateQueries({ queryKey: ['diagram-detail', ids.diagramId] })
              }}
              onLayoutGenerated={() => void onLayoutGenerated()}
            />
            <PaletteSwitcher
              graphId={ids.graphId}
              currentPaletteId={effectiveCanvasPaletteId}
              onSelect={(paletteId) => applyCanvasPalette(paletteId)}
            />
            <PaletteEditor
              graphId={ids.graphId}
              onAssignToChrome={(paletteId) => applyChromePalette(paletteId)}
              onChanged={() => {
                void queryClient.invalidateQueries({ queryKey: ['palettes', ids.graphId] })
                void queryClient.invalidateQueries({ queryKey: ['resolved'] })
                void queryClient.invalidateQueries({ queryKey: ['chrome-palette'] })
                void invalidateDiagram()
              }}
            />
          </>
        ),
        properties:
          (selectedNodeId && selectedNodeStyle) || (selectedEdgeId && selectedEdgeStyle) ? (
            <>
              {selectedNodeId && selectedNodeStyle && (
                <NodeTemplatesPanel
                  key={`templates-${selectedNodeId}`}
                  nodeId={selectedNodeId}
                  onChanged={() => void invalidateDiagram()}
                />
              )}
              {selectedNodeId && selectedNodeStyle && (
                <NodeStylePanel
                  key={selectedNodeId}
                  nodeId={selectedNodeId}
                  resolved={selectedNodeStyle}
                  graphId={ids.graphId}
                  onChanged={() => void invalidateDiagram()}
                />
              )}
              {selectedEdgeId && selectedEdgeStyle && (
                <EdgeStylePanel
                  key={selectedEdgeId}
                  edgeId={selectedEdgeId}
                  resolved={selectedEdgeStyle}
                  onChanged={() => void invalidateDiagram()}
                />
              )}
            </>
          ) : null,
        prototypes: (
          <PrototypePanel
            graphId={ids.graphId}
            diagramId={ids.diagramId}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            onStampPrototype={(p) => stampPrototype.mutate(p)}
            onChanged={() => void invalidateDiagram()}
          />
        ),
        crossref: selectedEntityId ? (
          <EntityPanel
            key={selectedEntityId}
            entityId={selectedEntityId}
            onChanged={() => void invalidateDiagram()}
            onNavigate={(kind, target) => void drillTo(kind, target)}
          />
        ) : null,
        relationships: (
          <RelationshipsPanel
            graphId={ids.graphId}
            diagramId={ids.diagramId}
            onNavigateEntity={(entityId) => void drillTo('entity', entityId)}
            onRevealEdge={(edgeId) => revealEdge(edgeId)}
          />
        ),
      }
    : {
        palette: null,
        properties: null,
        prototypes: null,
        crossref: null,
        relationships: null,
      }

  // Which sheet tabs are populated (drives the toolbar's enabled tabs).
  const availableSheets = new Set<SheetKey>(
    (Object.keys(sheetGroups) as SheetKey[]).filter((k) => sheetGroups[k] != null),
  )

  return (
    <PaletteRoot
      tokens={canvasTokens}
      className="editor"
      testId="canvas-palette-root"
      style={{ position: 'fixed', inset: 0, width: '100vw', height: '100dvh' }}
    >
      <div ref={wrapperRef} className="canvas-wrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onSelectionChange={onSelectionChange}
          onMoveEnd={onMoveEnd}
          fitView
          proOptions={{ hideAttribution: true }}
          // Mode-less interaction (§10.2): fixed props. Dragging a node moves it;
          // dragging a handle connects; tap selects, double-tap toggles; pinch
          // zooms. Pane panning AND the long-press marquee are owned by the
          // pointer effect below (`panOnDrag`/`selectionOnDrag` off) so the two
          // never fight — React Flow's own pan can't be interrupted mid-gesture,
          // so we drive the viewport ourselves. Double-click zoom is off so a
          // double-tap is free to toggle selection.
          panOnDrag={false}
          selectionOnDrag={false}
          nodesDraggable
          nodesConnectable
          elementsSelectable
          zoomOnPinch
          zoomOnDoubleClick={false}
          panOnScroll={false}
          // We own delete (keyboard handler → gateway) so React Flow can't strip a
          // node from local state without persisting it. `null` disables its key.
          deleteKeyCode={null}
          // Large-graph performance (§12 Phase 5): only mount nodes/edges inside the
          // viewport so a big board stays interactive; DB work stays in the worker.
          onlyRenderVisibleElements
        >
          {showBackground && <Background />}
          <Controls />
          {showMinimap && <MiniMap pannable zoomable />}
          {busy && (
            <Panel position="top-center">
              <span className="editor-status" data-testid="editor-busy">
                {ready ? 'Syncing…' : 'Opening local store…'}
              </span>
            </Panel>
          )}
        </ReactFlow>

        {/* Long-press marquee overlay (§10.2) — purely visual (pointer-events
            none); the pane pointer effect owns the gesture and just drives this
            box. Only present while a marquee is live. */}
        <div className="marquee-overlay" aria-hidden="true">
          {marquee && (
            <div
              className="marquee-box"
              style={{
                left: Math.min(marquee.x0, marquee.x1),
                top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0),
                height: Math.abs(marquee.y1 - marquee.y0),
              }}
            />
          )}
        </div>
      </div>

      {/* Bottom sheets host the panels on every viewport (the floating dock's
          Panels buttons open them). Open/close is client UI state in the sheet
          store; swipe or Esc dismisses (§10.1). */}
      {ids && sheet && availableSheets.has(sheet) && (
        <BottomSheet title={SHEET_LABELS[sheet]} open onClose={closeSheet}>
          {sheetGroups[sheet]}
        </BottomSheet>
      )}

      {/* Drag-to-create quick-picker (§9.4). */}
      {pickerCtx && (
        <QuickPicker
          entities={pickerCtx.entities}
          prototypes={pickerCtx.prototypes}
          onUseExisting={(entityId) => connectToExisting.mutate(entityId)}
          onCreateNew={(name, prototypeId) => connectToNew.mutate({ name, prototypeId })}
          onCancel={() => setPickerCtx(null)}
        />
      )}

      {/* Add-node entity picker (§9 / D6). Opened by the dock's Add button;
          existing → placeEntity, new → addNode(name + nodePrototypeId). */}
      {addPickerCtx && (
        <EntityPicker
          entities={addPickerCtx.entities}
          nodePrototypes={addPickerCtx.nodePrototypes}
          onUseExisting={(entityId) => placeExisting.mutate(entityId)}
          onCreateNew={(name, nodePrototypeId) => addNamedNode.mutate({ name, nodePrototypeId })}
          onCancel={() => setAddPickerCtx(null)}
          title="Add node"
          createLabel="Create node"
        />
      )}

      {/* Draggable floating dock — the single control surface on every viewport.
          A slim row (undo/redo/add/delete by default) plus an expandable,
          customisable panel for copy/paste, the panel openers, the display
          toggles, and Save/Load. Display state is client UI state; the
          editing/file actions call back into the gateway-backed mutations above. */}
      {ids && (
        <FloatingDock
          availableSheets={[...availableSheets]}
          canUndo={canUndo}
          canRedo={canRedo}
          canAct={ready}
          addBusy={!!addPickerCtx || placeExisting.isPending || addNamedNode.isPending}
          hasSelection={!!selectedNodeId}
          canDelete={!!selectedNodeId || !!selectedEdgeId}
          onAddNode={onAddNodeButton}
          onDelete={() => deleteSelection.mutate()}
          onUndo={() => undo.mutate()}
          onRedo={() => redo.mutate()}
          onCopy={() => void copySelection()}
          onPaste={() => pasteClipboard.mutate()}
          onSave={() => save.mutate()}
          onLoad={() => load.mutate()}
        />
      )}
    </PaletteRoot>
  )
}

export function Editor() {
  return (
    <ReactFlowProvider>
      <EditorCanvas />
    </ReactFlowProvider>
  )
}

export default Editor
