/**
 * The DataGateway seam (spec §6.1).
 *
 * A single typed, async interface — the only way the app reads or writes data.
 * Methods are shaped 1:1 on REST endpoints and return serializable DTOs (the
 * model types), never ORM rows, so an `HttpGateway` can later drop in behind
 * the same interface with zero call-site changes.
 */

import type {
  Board,
  Edge,
  Entity,
  ExternalLink,
  Graph,
  Metadata,
  Node,
  Palette,
  PaletteTokens,
  Prototype,
  PrototypeKind,
  Relationship,
  StyleDelta,
  StyleProfile,
  StyleProfileTarget,
  View,
  ViewFilter,
  Viewport,
} from '../model'
import type { NodgeDocument } from '../model/document'

export type Uuid = string

/** A view enriched with its per-view node positions. */
export interface ViewDetail extends View {
  positions: { nodeId: Uuid; x: number; y: number }[]
}

/** A board with its placements and views (nested fetch). */
export interface BoardDetail extends Board {
  nodes: Node[]
  edges: Edge[]
  views: ViewDetail[]
}

/** A graph with its base-layer collections (nested fetch). */
export interface GraphDetail extends Graph {
  entities: Entity[]
  relationships: Relationship[]
  prototypes: Prototype[]
  boards: Board[]
  palettes: Palette[]
  styleProfiles: StyleProfile[]
}

// ── Inputs & patches (creation omits server/command-stamped identity) ──

export interface GraphInput {
  name: string
  description?: string
}
export interface GraphPatch {
  name?: string
  description?: string
}

export interface EntityInput {
  name: string
  prototypeId?: Uuid | null
  styleOverride?: StyleDelta
  links?: ExternalLink[]
  metadata?: Metadata
}
export interface EntityPatch {
  name?: string
  prototypeId?: Uuid | null
  styleOverride?: StyleDelta
  links?: ExternalLink[]
  metadata?: Metadata
}

export interface RelationshipInput {
  sourceEntityId: Uuid
  targetEntityId: Uuid
  prototypeId?: Uuid | null
  directed?: boolean
  label?: string
  styleOverride?: StyleDelta
  metadata?: Metadata
}
export interface RelationshipPatch {
  prototypeId?: Uuid | null
  directed?: boolean
  label?: string
  styleOverride?: StyleDelta
  metadata?: Metadata
}

export interface PrototypeInput {
  kind: PrototypeKind
  name: string
  shape?: string | null
  defaultLabel?: string
  style?: StyleDelta
  metadata?: Metadata
  linkScaffold?: ExternalLink[]
}

export interface BoardInput {
  name: string
  description?: string
}

export interface NodeInput {
  entityId: Uuid
  label?: string
  styleOverride?: StyleDelta
}
export interface NodePatch {
  label?: string
  styleOverride?: StyleDelta
}

export interface EdgeInput {
  relationshipId: Uuid
  sourceNodeId: Uuid
  targetNodeId: Uuid
  sourceHandle?: string | null
  targetHandle?: string | null
  label?: string
  styleOverride?: StyleDelta
}

export interface ViewInput {
  name: string
  paletteId?: Uuid | null
  filter?: ViewFilter | null
  viewport?: Viewport | null
}

export interface NodePositionInput {
  nodeId: Uuid
  x: number
  y: number
}

export interface PaletteInput {
  name: string
  tokens?: PaletteTokens
  builtin?: boolean
}

export interface StyleProfileInput {
  name: string
  target: StyleProfileTarget
  style?: StyleDelta
}

export interface DataGateway {
  // Graphs
  listGraphs(): Promise<Graph[]>
  getGraph(id: Uuid): Promise<GraphDetail>
  createGraph(input: GraphInput): Promise<Graph>
  updateGraph(id: Uuid, patch: GraphPatch): Promise<Graph>
  deleteGraph(id: Uuid): Promise<void>

  // Entities / Relationships
  createEntity(graphId: Uuid, input: EntityInput): Promise<Entity>
  updateEntity(id: Uuid, patch: EntityPatch): Promise<Entity>
  deleteEntity(id: Uuid): Promise<void>
  createRelationship(graphId: Uuid, input: RelationshipInput): Promise<Relationship>
  updateRelationship(id: Uuid, patch: RelationshipPatch): Promise<Relationship>
  deleteRelationship(id: Uuid): Promise<void>

  // Boards / Nodes / Edges / Views
  createBoard(graphId: Uuid, input: BoardInput): Promise<Board>
  getBoard(id: Uuid): Promise<BoardDetail>
  createNode(boardId: Uuid, input: NodeInput): Promise<Node>
  updateNode(id: Uuid, patch: NodePatch): Promise<Node>
  deleteNode(id: Uuid): Promise<void>
  createEdge(boardId: Uuid, input: EdgeInput): Promise<Edge>
  deleteEdge(id: Uuid): Promise<void>
  createView(boardId: Uuid, input: ViewInput): Promise<View>
  bulkUpsertPositions(viewId: Uuid, positions: NodePositionInput[]): Promise<NodePositionInput[]>

  // Prototypes / Palettes / StyleProfiles
  listPrototypes(graphId: Uuid): Promise<Prototype[]>
  createPrototype(graphId: Uuid, input: PrototypeInput): Promise<Prototype>
  listPalettes(graphId: Uuid): Promise<Palette[]>
  createPalette(graphId: Uuid, input: PaletteInput): Promise<Palette>
  listStyleProfiles(graphId: Uuid): Promise<StyleProfile[]>
  createStyleProfile(graphId: Uuid, input: StyleProfileInput): Promise<StyleProfile>

  // Project I/O
  exportJson(graphId: Uuid): Promise<NodgeDocument>
  exportSqlite(): Promise<Uint8Array>
  importJson(doc: NodgeDocument): Promise<Graph>
}
