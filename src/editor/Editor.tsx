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
 * Phase 5 (§10.2): lightweight **tool modes** (Select / Connect / Add) in a
 * thumb-reach bottom toolbar configure React Flow per mode so gestures never
 * fight (pan vs. move vs. draw-an-edge). In Connect mode tap-source→tap-target
 * makes an edge; in Add mode a tap on empty canvas adds a node there. On narrow
 * viewports the side panels surface as swipe-to-dismiss **bottom sheets**. Tool
 * mode + sheet state is client UI state (the Zustand store), not gateway data.
 * Large-graph performance: visible-only rendering + a memoized transform.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
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
import { setChromePaletteId } from './appSettings'
import { BoardViewBar } from './panels/BoardViewBar'
import { EntityPanel } from './panels/EntityPanel'
import { PaletteSwitcher } from './panels/PaletteSwitcher'
import { PaletteEditor } from './panels/PaletteEditor'
import { NodeStylePanel } from './panels/NodeStylePanel'
import { EdgeStylePanel } from './panels/EdgeStylePanel'
import { PrototypePanel } from './panels/PrototypePanel'
import { QuickPicker } from './panels/QuickPicker'
import { EntityPicker } from './panels/EntityPicker'
import { BottomSheet } from './panels/BottomSheet'
import { FloatingDock } from './panels/FloatingDock'
import { toolModeFlowProps, useToolMode, SHEET_LABELS, type SheetKey } from './toolMode'
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

  const diagram = useQuery({
    queryKey: ['diagram', ids?.graphId, ids?.diagramId, ids?.layoutId],
    queryFn: async () => loadDiagram(await getGateway(), ids!),
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

  // Phase 5 tool mode + transient sheet state (client UI state, §10.2/§11). The
  // mode drives the React Flow interaction props so gestures never fight.
  const mode = useToolMode((s) => s.mode)
  const sheet = useToolMode((s) => s.sheet)
  const closeSheet = useToolMode((s) => s.closeSheet)
  const connectSourceId = useToolMode((s) => s.connectSourceId)
  const setConnectSource = useToolMode((s) => s.setConnectSource)
  const flowProps = useMemo(() => toolModeFlowProps(mode), [mode])

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

  // Add-node entity-picker (§9 / D6) state. Adding a node — via the Add-mode pane
  // tap or the dock's Add button — opens this picker AT THE TARGET POINT to choose
  // an existing entity (→ placeEntity) or create a new one (→ addNode), instead of
  // dropping an anonymous `Node N`.
  const [addPickerCtx, setAddPickerCtx] = useState<{
    x: number
    y: number
    entities: Entity[]
    nodePrototypes: Prototype[]
  } | null>(null)

  const { screenToFlowPosition, setViewport, getViewport } = useReactFlow()

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

  // Open the add-node entity picker (§9 / D6) at a flow-space point. Loads the
  // graph's entities + node prototypes so the picker can offer "use existing" /
  // "create new". Used by both the Add-mode pane tap and the dock's Add button.
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

  // Add-node button (dock FAB): open the picker at a placement clear of the
  // top-left toolbar / edge chrome, spread by the current node count.
  const onAddNodeButton = useCallback(() => {
    if (!ids) return
    const count = nodesRef.current.length
    const x = 250 + (count % 5) * 180
    const y = 200 + Math.floor(count / 5) * 120
    openAddPicker(x, y)
  }, [ids, openAddPicker])

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

  // Connect mode (§10.2): tap a source node, then tap a target node → an edge.
  // No dragging required, so it works cleanly on touch where a precise handle
  // drag is awkward. The pending source is transient client UI state.
  const onNodeClick = useCallback<NodeMouseHandler<FlowNode>>(
    (_event, node) => {
      if (mode !== 'connect' || !ids) return
      if (!connectSourceId) {
        setConnectSource(node.id)
        return
      }
      if (connectSourceId === node.id) {
        setConnectSource(null)
        return
      }
      connect.mutate({
        source: connectSourceId,
        target: node.id,
        sourceHandle: null,
        targetHandle: null,
      })
      setConnectSource(null)
    },
    [mode, ids, connectSourceId, setConnectSource, connect],
  )

  // Add mode (§10.2): a tap on empty canvas opens the entity picker at that point
  // (§9 / D6) so the user chooses an existing entity or creates a new one — no
  // anonymous `Node N`. In other modes a pane tap just clears any pending connect
  // source. React Flow delivers a React mouse event for pane clicks (a tap maps to
  // a click on touch). Opening the picker doesn't fight pan/zoom: the tap has
  // already ended, and the picker is an overlay/sheet outside the canvas (§10.2).
  const onPaneClick = useCallback(
    (event: ReactMouseEvent) => {
      if (mode !== 'add' || !ids || !ready) {
        if (connectSourceId) setConnectSource(null)
        return
      }
      const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      openAddPicker(flowPos.x, flowPos.y)
    },
    [mode, ids, ready, connectSourceId, setConnectSource, screenToFlowPosition, openAddPicker],
  )

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

  // Track selection so the panels and copy/paste know what's active.
  const onSelectionChange = useCallback(
    ({ nodes: selNodes, edges: selEdges }: { nodes: FlowNode[]; edges: FlowEdge[] }) => {
      selectedNodeIdsRef.current = selNodes.map((n) => n.id)
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

  // Keyboard shortcuts (desktop): Ctrl/Cmd+Z undo, +Shift / Ctrl+Y redo, C copy, V paste.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
  }, [undo, redo, copySelection, pasteClipboard])

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
            />
            <PaletteSwitcher
              graphId={ids.graphId}
              currentPaletteId={ids.paletteId}
              onSelect={(paletteId) => applyChromePalette(paletteId)}
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
      }
    : { palette: null, properties: null, prototypes: null, crossref: null }

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
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onSelectionChange={onSelectionChange}
        onMoveEnd={onMoveEnd}
        fitView
        proOptions={{ hideAttribution: true }}
        // Phase 5 (§10.2): tool-mode-driven interaction props so pan vs. move vs.
        // connect never fight. The mapping is the pure `toolModeFlowProps`.
        panOnDrag={flowProps.panOnDrag}
        selectionOnDrag={flowProps.selectionOnDrag}
        nodesDraggable={flowProps.nodesDraggable}
        nodesConnectable={flowProps.nodesConnectable}
        elementsSelectable={flowProps.elementsSelectable}
        zoomOnPinch={flowProps.zoomOnPinch}
        panOnScroll={flowProps.panOnScroll}
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

      {/* Bottom sheets host the panels on every viewport (the floating dock's
          Panels buttons open them). Open/close is client UI state in the
          tool-mode store; swipe or Esc dismisses (§10.1). */}
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

      {/* Add-node entity picker (§9 / D6). Opened at the target point by the
          Add-mode pane tap or the dock's Add button; existing → placeEntity,
          new → addNode(name + nodePrototypeId). */}
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
          A slim row (the Select/Connect/Add modes by default + undo/redo/add)
          plus an expandable, customisable panel for copy/paste, the panel
          openers, the display toggles, and Save/Load. Tool/display state is
          client UI state; the editing/file actions call back into the
          gateway-backed mutations above. */}
      {ids && (
        <FloatingDock
          availableSheets={[...availableSheets]}
          canUndo={canUndo}
          canRedo={canRedo}
          canAct={ready}
          addBusy={!!addPickerCtx || placeExisting.isPending || addNamedNode.isPending}
          hasSelection={!!selectedNodeId}
          onAddNode={onAddNodeButton}
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
