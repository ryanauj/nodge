/**
 * Translate the gateway's relational view of a diagram into the flat node/edge
 * arrays React Flow renders, reading each placement's full style snapshot
 * (§D3) over the palette fallback. Pure and framework-free so it can be
 * unit-tested without a canvas; the React layer just feeds these into
 * `<ReactFlow>`.
 */

import type { Edge, Entity, Node, PaletteTokens, Relationship } from '../model'
import type { DiagramDetail, DataGateway, Uuid } from '../gateway'
import { DEFAULT_PALETTE_TOKENS, resolveEdgeStyle, resolveNodeStyle } from './style'
import type { ResolvedEdgeStyle, ResolvedNodeStyle } from './style'
import type { DiagramIds } from './bootstrap'

/** Everything the transform needs, gathered from getGraph + getDiagram. */
export interface DiagramSource {
  nodes: Node[]
  edges: Edge[]
  positions: Map<Uuid, { x: number; y: number }>
  entities: Map<Uuid, Entity>
  relationships: Map<Uuid, Relationship>
  paletteTokens: PaletteTokens
}

export interface FlowNodeData {
  label: string
  style: ResolvedNodeStyle
  /** The base entity this placement draws (spec §5.2) — powers selection → properties. */
  entityId: Uuid
  [key: string]: unknown
}

export interface FlowNode {
  id: string
  type: 'nodge'
  position: { x: number; y: number }
  data: FlowNodeData
  /** React Flow selection flag — set programmatically to reveal/deselect a node. */
  selected?: boolean
  /** Measured render size, populated by React Flow after layout (read-only for
   *  us; used by marquee hit-testing to size a node's box, §10.2). */
  measured?: { width?: number; height?: number }
  width?: number
  height?: number
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  label?: string
  style: ResolvedEdgeStyle
  /** React Flow selection flag — set programmatically to reveal an edge (§10/D7). */
  selected?: boolean
}

export function toFlowNodes(src: DiagramSource): FlowNode[] {
  return src.nodes.map((node) => {
    const entity = src.entities.get(node.entityId)
    // Resolution (§D3): paletteFallback → node.style. The style is a full
    // snapshot on the row; the prototype is not consulted at render time.
    const style = resolveNodeStyle(src.paletteTokens, node.style)
    const pos = src.positions.get(node.id) ?? { x: 0, y: 0 }
    return {
      id: node.id,
      type: 'nodge',
      position: { x: pos.x, y: pos.y },
      data: { label: node.label || entity?.name || 'Node', style, entityId: node.entityId },
    }
  })
}

export function toFlowEdges(src: DiagramSource): FlowEdge[] {
  return src.edges.map((edge) => {
    const rel = src.relationships.get(edge.relationshipId)
    // Resolution (§D3): paletteFallback → edge.style.
    const style = resolveEdgeStyle(src.paletteTokens, edge.style)
    const label = edge.label || rel?.label || undefined
    return { id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId, label, style }
  })
}

/** The fully-assembled snapshot the canvas renders for one layout. */
export interface DiagramSnapshot {
  ids: DiagramIds
  flowNodes: FlowNode[]
  flowEdges: FlowEdge[]
  /** The layout's saved pan/zoom (spec §7.2), restored on open; null if unset. */
  viewport: { x: number; y: number; zoom: number } | null
  /** The palette's tokens — wrapped in a `PaletteRoot` around the canvas (§8.4). */
  paletteTokens: PaletteTokens
}

/**
 * Gather a diagram's data through the gateway and build the render snapshot.
 *
 * `canvasPaletteId` is the client-side canvas-theme selection (§8.4 / §D10 — a
 * view preference, not graph data). When it names one of the graph's palettes we
 * theme the canvas with it; otherwise we fall back to the graph's default palette
 * (`ids.paletteId`) and then to the built-in defaults, so resolution stays total
 * even when the persisted selection points at a palette from another graph.
 */
export async function loadDiagram(
  gw: DataGateway,
  ids: DiagramIds,
  canvasPaletteId?: string | null,
): Promise<DiagramSnapshot> {
  const [graph, diagram] = await Promise.all([
    gw.getGraph(ids.graphId),
    gw.getDiagram(ids.diagramId),
  ])
  const layout = diagram.layouts.find((l) => l.id === ids.layoutId) ?? diagram.layouts[0]
  const palette =
    (canvasPaletteId && graph.palettes.find((p) => p.id === canvasPaletteId)) ||
    graph.palettes.find((p) => p.id === ids.paletteId)

  const entities = new Map(graph.entities.map((e) => [e.id, e]))
  const relationships = new Map(graph.relationships.map((r) => [r.id, r]))

  const src: DiagramSource = {
    nodes: diagram.nodes,
    edges: diagram.edges,
    positions: positionMap(diagram, layout?.id ?? ids.layoutId),
    entities,
    relationships,
    paletteTokens: palette?.tokens ?? DEFAULT_PALETTE_TOKENS,
  }

  return {
    ids,
    flowNodes: toFlowNodes(src),
    flowEdges: toFlowEdges(src),
    viewport: layout?.viewport ?? null,
    paletteTokens: src.paletteTokens,
  }
}

function positionMap(diagram: DiagramDetail, layoutId: Uuid): Map<Uuid, { x: number; y: number }> {
  const layout = diagram.layouts.find((l) => l.id === layoutId)
  const map = new Map<Uuid, { x: number; y: number }>()
  for (const p of layout?.positions ?? []) map.set(p.nodeId, { x: p.x, y: p.y })
  return map
}
