/**
 * Phase 1 core editor: one board, one view (spec §12).
 *
 * A React Flow canvas wired to the gateway + command layer. Every gesture goes
 * through the gateway: add a node (entity + placement), connect two nodes
 * (relationship + edge), drag to move (per-view positions, one undoable command
 * per drag end). Undo/redo, save-to-file and load-from-file hang off the same
 * seam. The chrome is canvas-first and edge-anchored so it stays usable on a
 * mobile baseline; the full touch model is Phase 5.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type NodeChange,
} from '@xyflow/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import '@xyflow/react/dist/style.css'
import { useGateway } from '../app/GatewayContext'
import { bootstrapOrOpen, type DiagramIds } from './bootstrap'
import { loadDiagram, type FlowEdge, type FlowNode } from './diagram'
import {
  downloadText,
  exportFileName,
  exportGraphText,
  importGraphText,
  pickTextFile,
} from './fileIo'
import { nodeTypes } from './NodgeNode'
import './editor.css'

const POSITION_FLUSH_MS = 250

function EditorCanvas() {
  const getGateway = useGateway()
  const queryClient = useQueryClient()

  const bootstrap = useQuery<DiagramIds>({
    queryKey: ['bootstrap'],
    queryFn: async () => bootstrapOrOpen(await getGateway()),
    staleTime: Infinity,
  })
  const ids = bootstrap.data ?? null

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

  // Keyboard shortcuts (desktop): Ctrl/Cmd+Z undo, +Shift / Ctrl+Y redo.
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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

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
        localStorage.setItem('nodge.activeGraphId', graphId)
      } catch {
        /* storage may be unavailable; the in-memory store still holds the graph */
      }
      await queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      await invalidateDiagram()
    },
  })

  const busy = bootstrap.isLoading || (!!ids && diagram.isLoading)

  return (
    <div className="editor" data-testid="editor">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
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
