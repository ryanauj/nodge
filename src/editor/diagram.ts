/**
 * Translate the gateway's relational view of a board into the flat node/edge
 * arrays React Flow renders, resolving each placement's style through the
 * cascade (§8.3). Pure and framework-free so it can be unit-tested without a
 * canvas; the React layer just feeds these into `<ReactFlow>`.
 */

import type {
  Edge,
  Entity,
  Node,
  PaletteTokens,
  Prototype,
  Relationship,
  StyleProfile,
} from '../model'
import type { BoardDetail, DataGateway, Uuid } from '../gateway'
import { DEFAULT_PALETTE_TOKENS, resolveEdgeStyle, resolveNodeStyle } from './style'
import type { ResolvedEdgeStyle, ResolvedNodeStyle } from './style'
import { applyFilter } from './filter'
import type { DiagramIds } from './bootstrap'

/** Everything the transform needs, gathered from getGraph + getBoard. */
export interface DiagramSource {
  nodes: Node[]
  edges: Edge[]
  positions: Map<Uuid, { x: number; y: number }>
  entities: Map<Uuid, Entity>
  relationships: Map<Uuid, Relationship>
  prototypes: Map<Uuid, Prototype>
  /** Referenced StyleProfiles, keyed by id — layered into the cascade (§8.3). */
  styleProfiles: Map<Uuid, StyleProfile>
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
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  label?: string
  style: ResolvedEdgeStyle
}

/** A referenced StyleProfile's style delta, or undefined when there is no ref. */
function profileStyle(
  src: DiagramSource,
  styleProfileId: Uuid | null | undefined,
): Record<string, unknown> | undefined {
  return styleProfileId ? src.styleProfiles.get(styleProfileId)?.style : undefined
}

export function toFlowNodes(src: DiagramSource): FlowNode[] {
  return src.nodes.map((node) => {
    const entity = src.entities.get(node.entityId)
    const proto = entity?.prototypeId ? src.prototypes.get(entity.prototypeId) : undefined
    // Cascade (§8.3): palette → prototype → referenced StyleProfile(s) → entity
    // override → node override. The entity's then the node's profile sit above
    // the baseline but below the explicit pins, so a profile re-skins what it
    // covers while a pinned key still wins.
    const style = resolveNodeStyle(
      src.paletteTokens,
      proto?.style,
      profileStyle(src, entity?.styleProfileId),
      profileStyle(src, node.styleProfileId),
      entity?.styleOverride,
      node.styleOverride,
    )
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
    const proto = rel?.prototypeId ? src.prototypes.get(rel.prototypeId) : undefined
    // Cascade (§8.3): palette → relationship prototype → the prototype's default
    // StyleProfile → relationship override → edge override.
    const style = resolveEdgeStyle(
      src.paletteTokens,
      proto?.style,
      profileStyle(src, proto?.styleProfileId),
      rel?.styleOverride,
      edge.styleOverride,
    )
    const label = edge.label || rel?.label || undefined
    return { id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId, label, style }
  })
}

/** The fully-assembled snapshot the canvas renders for one view. */
export interface DiagramSnapshot {
  ids: DiagramIds
  flowNodes: FlowNode[]
  flowEdges: FlowEdge[]
  /** The view's saved pan/zoom (spec §7.2), restored on open; null if unset. */
  viewport: { x: number; y: number; zoom: number } | null
  /** The view palette's tokens — wrapped in a `PaletteRoot` around the canvas (§8.4). */
  paletteTokens: PaletteTokens
}

/** Gather a board's data through the gateway and build the render snapshot. */
export async function loadDiagram(gw: DataGateway, ids: DiagramIds): Promise<DiagramSnapshot> {
  const [graph, board] = await Promise.all([gw.getGraph(ids.graphId), gw.getBoard(ids.boardId)])
  const view = board.views.find((v) => v.id === ids.viewId) ?? board.views[0]
  const palette = graph.palettes.find((p) => p.id === (view?.paletteId ?? ids.paletteId))

  const entities = new Map(graph.entities.map((e) => [e.id, e]))
  const relationships = new Map(graph.relationships.map((r) => [r.id, r]))

  // Apply the view's filter/focus lens (§7.2): an ad-hoc subgraph WITHOUT
  // changing board membership. An empty/absent filter renders the whole board.
  const visible = applyFilter(
    { nodes: board.nodes, edges: board.edges, entities, relationships },
    view?.filter ?? null,
  )

  const src: DiagramSource = {
    nodes: visible.nodes,
    edges: visible.edges,
    positions: positionMap(board, view?.id ?? ids.viewId),
    entities,
    relationships,
    prototypes: new Map(graph.prototypes.map((p) => [p.id, p])),
    styleProfiles: new Map(graph.styleProfiles.map((p) => [p.id, p])),
    paletteTokens: palette?.tokens ?? DEFAULT_PALETTE_TOKENS,
  }

  return {
    ids,
    flowNodes: toFlowNodes(src),
    flowEdges: toFlowEdges(src),
    viewport: view?.viewport ?? null,
    paletteTokens: src.paletteTokens,
  }
}

function positionMap(board: BoardDetail, viewId: Uuid): Map<Uuid, { x: number; y: number }> {
  const view = board.views.find((v) => v.id === viewId)
  const map = new Map<Uuid, { x: number; y: number }>()
  for (const p of view?.positions ?? []) map.set(p.nodeId, { x: p.x, y: p.y })
  return map
}
