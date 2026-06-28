/**
 * Phase 3 core editor: multiple boards + multiple views per board (spec §12).
 *
 * A React Flow canvas wired to the gateway + command layer. Every gesture goes
 * through the gateway: add a node (entity + placement), connect two nodes
 * (relationship + edge), drag to move (per-view positions, one undoable command
 * per drag end). The active board/view is reflected in the URL via React Router;
 * boards/views/palette switchers drive navigation and `updateView`. Undo/redo,
 * save-to-file and load-from-file hang off the same seam. The chrome stays
 * canvas-first and usable on a mobile baseline; the full touch model is Phase 5.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
import { BoardViewBar } from './panels/BoardViewBar'
import { EntityPanel } from './panels/EntityPanel'
import { PaletteSwitcher } from './panels/PaletteSwitcher'
import { PrototypePanel } from './panels/PrototypePanel'
import { QuickPicker } from './panels/QuickPicker'
import './editor.css'

/** Build the board/view URL the router reflects the active diagram into. */
function diagramPath(boardId: string, viewId: string): string {
  return `/board/${boardId}/view/${viewId}`
}

const POSITION_FLUSH_MS = 250

/** Stable node-type registry (defining this inline would remount every render). */
const nodeTypes = { nodge: NodgeNode }

function EditorCanvas() {
  const getGateway = useGateway()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const params = useParams<{ boardId?: string; viewId?: string }>()
  const routeBoardId = params.boardId ?? null
  const routeViewId = params.viewId ?? null

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
    queryKey: ['resolved', graphId, routeBoardId, routeViewId],
    queryFn: async () => {
      const gw = await getGateway()
      const ids = await reopen(gw, graphId!, routeBoardId, routeViewId)
      return ids ?? bootstrap.data ?? null
    },
    enabled: !!graphId,
    // Keep the resolved ids stable across the `/` → board/view redirect so the
    // canvas/toolbar never flicker back to a disabled (null-ids) state.
    placeholderData: keepPreviousData,
  })
  const ids = resolved.data ?? null

  // Keep the URL in sync with the resolved diagram (deep-link + redirect of `/`).
  useEffect(() => {
    if (!ids) return
    if (ids.boardId !== routeBoardId || ids.viewId !== routeViewId) {
      navigate(diagramPath(ids.boardId, ids.viewId), { replace: true })
    }
  }, [ids, routeBoardId, routeViewId, navigate])

  const diagram = useQuery({
    queryKey: ['diagram', ids?.graphId, ids?.boardId, ids?.viewId],
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

  // Drag-to-create quick-picker (§9.4) state, populated on connect-to-empty.
  const [pickerCtx, setPickerCtx] = useState<{
    sourceNodeId: string
    sourceHandle: string | null
    x: number
    y: number
    entities: Entity[]
    prototypes: Prototype[]
  } | null>(null)

  const { screenToFlowPosition, setViewport, getViewport } = useReactFlow()

  // Navigate to a board/view, persisting the current viewport first so each
  // view keeps its own pan/zoom (spec §7.2). The URL change re-resolves ids.
  const persistViewport = useCallback(async () => {
    if (!ids) return
    const vp = getViewport()
    const gw = await getGateway()
    await gw.updateView(ids.viewId, { viewport: { x: vp.x, y: vp.y, zoom: vp.zoom } })
  }, [ids, getGateway, getViewport])

  const navigateTo = useCallback(
    async (boardId: string, viewId: string) => {
      await persistViewport()
      navigate(diagramPath(boardId, viewId))
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
    if (!snap || snap.ids.viewId === restoredViewRef.current) return
    restoredViewRef.current = snap.ids.viewId
    if (snap.viewport) void setViewport(snap.viewport)
  }, [diagram.data, setViewport])

  const invalidateDiagram = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['diagram'] }),
    [queryClient],
  )

  const addNode = useMutation({
    mutationFn: async () => {
      const gw = await getGateway()
      const count = nodesRef.current.length
      // Spread placements clear of the top-left toolbar / edge chrome.
      const x = 250 + (count % 5) * 180
      const y = 200 + Math.floor(count / 5) * 120
      return gw.addNode(ids!.boardId, ids!.viewId, { name: `Node ${count + 1}`, x, y })
    },
    onSuccess: invalidateDiagram,
  })

  const connect = useMutation({
    mutationFn: async (connection: Connection) => {
      const gw = await getGateway()
      return gw.connectNodes(ids!.boardId, {
        sourceNodeId: connection.source,
        targetNodeId: connection.target,
        sourceHandle: connection.sourceHandle ?? null,
        targetHandle: connection.targetHandle ?? null,
      })
    },
    onSuccess: invalidateDiagram,
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

  const connectToExisting = useMutation({
    mutationFn: async (entityId: string) => {
      const gw = await getGateway()
      return gw.connectToExistingEntity(ids!.boardId, ids!.viewId, {
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
      return gw.connectToNewEntity(ids!.boardId, ids!.viewId, {
        sourceNodeId: pickerCtx!.sourceNodeId,
        name,
        x: pickerCtx!.x,
        y: pickerCtx!.y,
        prototypeId,
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
      return gw.addNode(ids!.boardId, ids!.viewId, {
        name: prototype.defaultLabel || prototype.name,
        x,
        y,
        prototypeId: prototype.id,
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
          .then((gw) => gw.bulkUpsertPositions(ids.viewId, toPersist))
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
        gw.updateView(ids.viewId, { viewport: { x: vp.x, y: vp.y, zoom: vp.zoom } }),
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
    const board = await gw.getBoard(ids.boardId)
    const positions = new Map(
      nodesRef.current.map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
    )
    const clipboard = buildClipboard(board, selectedNodeIdsRef.current, positions)
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
      return gw.pasteClipboard(ids.boardId, ids.viewId, { clipboard, x: 80, y: 80 })
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
  // targets a board id → open its first view; an `entity` link targets an entity
  // id → open a board/view where that entity is placed (via the cross-ref index).
  const drillTo = useCallback(
    async (kind: 'diagram' | 'entity', target: string) => {
      const gw = await getGateway()
      if (kind === 'diagram') {
        try {
          const board = await gw.getBoard(target)
          const view = board.views[0]
          if (view) await navigateTo(board.id, view.id)
        } catch {
          /* dangling board reference — ignore */
        }
        return
      }
      const usage = await gw.getEntityUsages(target)
      const placement = usage.placements[0]
      if (!placement) return
      const board = await gw.getBoard(placement.boardId)
      const view = board.views[0]
      if (view) await navigateTo(board.id, view.id)
    },
    [getGateway, navigateTo],
  )

  const busy = bootstrap.isLoading || resolved.isLoading || (!!ids && diagram.isLoading)

  return (
    <div className="editor" data-testid="editor">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onSelectionChange={onSelectionChange}
        onMoveEnd={onMoveEnd}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
        <Panel position="top-left">
          <div className="toolbar" role="toolbar" aria-label="Editor toolbar">
            <button onClick={() => addNode.mutate()} disabled={!ids || addNode.isPending}>
              Add node
            </button>
            <button onClick={() => undo.mutate()} disabled={!canUndo} aria-label="Undo">
              Undo
            </button>
            <button onClick={() => redo.mutate()} disabled={!canRedo} aria-label="Redo">
              Redo
            </button>
            <span className="toolbar-sep" />
            <button onClick={() => void copySelection()} disabled={!selectedNodeId} aria-label="Copy">
              Copy
            </button>
            <button
              onClick={() => pasteClipboard.mutate()}
              disabled={!ids}
              aria-label="Paste"
            >
              Paste
            </button>
            <span className="toolbar-sep" />
            <button onClick={() => save.mutate()} disabled={!ids}>
              Save
            </button>
            <button onClick={() => load.mutate()}>Load</button>
          </div>
        </Panel>
        {busy && (
          <Panel position="top-center">
            <span className="editor-status">Opening local store…</span>
          </Panel>
        )}
      </ReactFlow>

      {/* Side panels: boards/views + palette switchers, prototype library,
          entity properties / cross-reference + drill-down. */}
      {ids && (
        <aside className="side-panels" aria-label="Editor panels">
          <BoardViewBar
            graphId={ids.graphId}
            boardId={ids.boardId}
            viewId={ids.viewId}
            onNavigate={(b, v) => void navigateTo(b, v)}
            onChanged={() => {
              void queryClient.invalidateQueries({ queryKey: ['graph', ids.graphId] })
              void queryClient.invalidateQueries({ queryKey: ['board', ids.boardId] })
            }}
          />
          <PaletteSwitcher
            graphId={ids.graphId}
            viewId={ids.viewId}
            currentPaletteId={ids.paletteId}
            onChanged={() => {
              void queryClient.invalidateQueries({ queryKey: ['resolved'] })
              void invalidateDiagram()
            }}
          />
          <PrototypePanel
            graphId={ids.graphId}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            onStampPrototype={(p) => stampPrototype.mutate(p)}
            onChanged={() => void invalidateDiagram()}
          />
          {selectedEntityId && (
            <EntityPanel
              key={selectedEntityId}
              entityId={selectedEntityId}
              onChanged={() => void invalidateDiagram()}
              onNavigate={(kind, target) => void drillTo(kind, target)}
            />
          )}
        </aside>
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

      {/* Thumb-reach add control for narrow viewports (mobile baseline). */}
      <button
        className="fab"
        aria-label="Add node"
        onClick={() => addNode.mutate()}
        disabled={!ids || addNode.isPending}
      >
        +
      </button>
    </div>
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
