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

export interface PrototypePatch {
  name?: string
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
export interface BoardPatch {
  name?: string
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

/**
 * Patch a view's presentation (spec §7.2): rename it, switch its palette
 * (`paletteId`), set its filter/focus lens (`filter`) or persist pan/zoom
 * (`viewport`). `null` clears the filter/viewport; omitted fields are unchanged.
 * Applied as one undoable command.
 */
export interface ViewPatch {
  name?: string
  paletteId?: Uuid | null
  filter?: ViewFilter | null
  viewport?: Viewport | null
}

/**
 * Place an EXISTING base entity as a NEW node on a board + view (spec §7.1 —
 * "the same entity can be placed on many boards"). Creates the {@link Node}
 * placement plus its per-view position as a single undoable command; the base
 * entity is untouched, so editing it reflects on every board placing it.
 */
export interface PlaceEntityInput {
  entityId: Uuid
  x: number
  y: number
  label?: string
  styleOverride?: StyleDelta
}

export interface PlaceEntityResult {
  node: Node
  position: NodePositionInput
}

export interface NodePositionInput {
  nodeId: Uuid
  x: number
  y: number
}

/**
 * Add a node to a board: create the base {@link Entity} and its {@link Node}
 * placement plus the per-view position, as a single undoable command (spec §12
 * Phase 1 — "creating on the canvas creates the right base + visual rows").
 */
export interface AddNodeInput {
  name: string
  x: number
  y: number
  prototypeId?: Uuid | null
  /** Pinned overrides on the placement (Node.styleOverride). */
  styleOverride?: StyleDelta
  /** Pinned overrides on the base thing (Entity.styleOverride). */
  entityStyleOverride?: StyleDelta
}

export interface AddNodeResult {
  entity: Entity
  node: Node
  position: NodePositionInput
}

/**
 * Connect two existing nodes: create the base {@link Relationship} between the
 * entities they place and its {@link Edge} placement, as a single undoable
 * command. Entity ids are resolved from the node placements.
 */
export interface ConnectNodesInput {
  sourceNodeId: Uuid
  targetNodeId: Uuid
  directed?: boolean
  label?: string
  prototypeId?: Uuid | null
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface ConnectNodesResult {
  relationship: Relationship
  edge: Edge
}

/**
 * Snapshot a selected node (and its base entity/prototype) into a new node
 * prototype (spec §9.1 "Save as prototype"). The new prototype captures the
 * node's resolved shape + label + the entity's style override + metadata.
 */
export interface CreatePrototypeFromNodeInput {
  nodeId: Uuid
  name: string
  /** Override the snapshotted shape; otherwise inherit the source's. */
  shape?: string | null
}

/** Snapshot a selected edge (and its base relationship) into a new relationship prototype. */
export interface CreatePrototypeFromEdgeInput {
  edgeId: Uuid
  name: string
}

/**
 * Refresh a prototype's current style + metadata onto entities/relationships
 * linked to it (spec §9.2 — opt-in, never automatic). Supply explicit ids, or
 * `all: true` to batch every linked entity/relationship of the prototype.
 */
export interface RefreshFromPrototypeInput {
  prototypeId: Uuid
  /** Apply to these entity ids (node prototype) / relationship ids (rel prototype). */
  ids?: Uuid[]
  /** Apply to every entity/relationship currently linked to the prototype. */
  all?: boolean
}

export interface RefreshFromPrototypeResult {
  /** Ids of the entities (node prototype) or relationships (rel prototype) refreshed. */
  refreshed: Uuid[]
}

/**
 * Drag-to-create into empty canvas, placing a NEW node for an EXISTING entity
 * and connecting it to the source node (spec §9.4 path a). One undoable command.
 */
export interface ConnectToExistingEntityInput {
  sourceNodeId: Uuid
  entityId: Uuid
  x: number
  y: number
  directed?: boolean
  label?: string
  relationshipPrototypeId?: Uuid | null
  sourceHandle?: string | null
  targetHandle?: string | null
}

/**
 * Drag-to-create into empty canvas, creating a NEW entity (seeded from a
 * prototype) + node and connecting it to the source node (spec §9.4 path b).
 */
export interface ConnectToNewEntityInput {
  sourceNodeId: Uuid
  name: string
  x: number
  y: number
  prototypeId?: Uuid | null
  directed?: boolean
  label?: string
  relationshipPrototypeId?: Uuid | null
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface ConnectToEntityResult {
  entity: Entity
  node: Node
  position: NodePositionInput
  relationship: Relationship
  edge: Edge
}

/**
 * Clipboard payload for copy/paste = placement (spec §9.3, Decision 10). Captures
 * the selected nodes (referencing their *same* entities) and the edges internal
 * to the selection (referencing their *same* relationships). Serializable as JSON
 * for cross-document paste.
 */
export interface ClipboardNode {
  /** Source node id, used only to wire up internal edges within the clipboard. */
  refId: Uuid
  entityId: Uuid
  label: string
  styleOverride: StyleDelta
  /** Position relative to the selection's top-left anchor. */
  dx: number
  dy: number
}

export interface ClipboardEdge {
  relationshipId: Uuid
  sourceRefId: Uuid
  targetRefId: Uuid
  sourceHandle?: string | null
  targetHandle?: string | null
  label: string
  styleOverride: StyleDelta
}

export interface Clipboard {
  kind: 'nodge/clipboard'
  version: 1
  nodes: ClipboardNode[]
  edges: ClipboardEdge[]
}

/** Where to drop a pasted clipboard (the new selection's top-left anchor). */
export interface PasteClipboardInput {
  clipboard: Clipboard
  x: number
  y: number
}

export interface PasteClipboardResult {
  nodes: Node[]
  edges: Edge[]
  positions: NodePositionInput[]
}

// ── Cross-reference index (spec §7.4) ──

export interface EntityPlacement {
  nodeId: Uuid
  boardId: Uuid
  boardName: string
  label: string
}

export interface EntityEdgePlacement {
  edgeId: Uuid
  boardId: Uuid
  relationshipId: Uuid
}

export interface EntityRelationship {
  relationshipId: Uuid
  role: 'source' | 'target'
  otherEntityId: Uuid
  label: string
  directed: boolean
}

export interface EntityBacklink {
  fromEntityId: Uuid
  linkId: Uuid
  kind: 'entity' | 'diagram'
  label: string
}

/** Everything that references an entity: its placements, edges, relationships, backlinks. */
export interface EntityUsage {
  entityId: Uuid
  placements: EntityPlacement[]
  edgePlacements: EntityEdgePlacement[]
  relationships: EntityRelationship[]
  backlinks: EntityBacklink[]
}

export interface PaletteInput {
  name: string
  tokens?: PaletteTokens
  builtin?: boolean
}

/**
 * Patch a palette (spec §8.4 — token-level authoring). Rename it or replace its
 * `tokens`; `builtin` can be cleared when a user forks/edits a seeded palette.
 * Applied as one undoable command.
 */
export interface PalettePatch {
  name?: string
  tokens?: PaletteTokens
  builtin?: boolean
}

export interface StyleProfileInput {
  name: string
  target: StyleProfileTarget
  style?: StyleDelta
}

/** Patch a named style bundle (spec §8.3): rename it or replace its `style`. */
export interface StyleProfilePatch {
  name?: string
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
  updateBoard(id: Uuid, patch: BoardPatch): Promise<Board>
  /** Delete a board and everything visual under it (nodes/edges/views/positions), one command. */
  deleteBoard(id: Uuid): Promise<void>
  createNode(boardId: Uuid, input: NodeInput): Promise<Node>
  updateNode(id: Uuid, patch: NodePatch): Promise<Node>
  deleteNode(id: Uuid): Promise<void>
  createEdge(boardId: Uuid, input: EdgeInput): Promise<Edge>
  deleteEdge(id: Uuid): Promise<void>
  createView(boardId: Uuid, input: ViewInput): Promise<View>
  updateView(id: Uuid, patch: ViewPatch): Promise<View>
  /** Delete a view and its per-view positions, one command. */
  deleteView(id: Uuid): Promise<void>
  bulkUpsertPositions(viewId: Uuid, positions: NodePositionInput[]): Promise<NodePositionInput[]>
  /** Place an existing entity as a new node + position on a board+view (§7.1), one command. */
  placeEntity(boardId: Uuid, viewId: Uuid, input: PlaceEntityInput): Promise<PlaceEntityResult>

  // Composite canvas gestures (single undoable command each)
  addNode(boardId: Uuid, viewId: Uuid, input: AddNodeInput): Promise<AddNodeResult>
  connectNodes(boardId: Uuid, input: ConnectNodesInput): Promise<ConnectNodesResult>
  /** Drag-to-create: place a new node for an existing entity + connect it (§9.4 path a). */
  connectToExistingEntity(
    boardId: Uuid,
    viewId: Uuid,
    input: ConnectToExistingEntityInput,
  ): Promise<ConnectToEntityResult>
  /** Drag-to-create: create a new prototype-seeded entity + node + connect it (§9.4 path b). */
  connectToNewEntity(
    boardId: Uuid,
    viewId: Uuid,
    input: ConnectToNewEntityInput,
  ): Promise<ConnectToEntityResult>
  /** Paste a clipboard as new placements of the same entities/relationships (§9.3). */
  pasteClipboard(
    boardId: Uuid,
    viewId: Uuid,
    input: PasteClipboardInput,
  ): Promise<PasteClipboardResult>

  // Cross-reference index (derived, §7.4)
  getEntityUsages(entityId: Uuid): Promise<EntityUsage>

  // Prototypes / Palettes / StyleProfiles
  listPrototypes(graphId: Uuid): Promise<Prototype[]>
  createPrototype(graphId: Uuid, input: PrototypeInput): Promise<Prototype>
  updatePrototype(id: Uuid, patch: PrototypePatch): Promise<Prototype>
  /** Snapshot a node's style/shape/label/metadata into a new node prototype (§9.1). */
  createPrototypeFromNode(input: CreatePrototypeFromNodeInput): Promise<Prototype>
  /** Snapshot an edge's relationship style/label into a new relationship prototype (§9.1). */
  createPrototypeFromEdge(input: CreatePrototypeFromEdgeInput): Promise<Prototype>
  /** Fork an existing prototype into a new row (§9.1 "Prototypes can be duplicated"). */
  duplicatePrototype(prototypeId: Uuid, name?: string): Promise<Prototype>
  /** Re-apply a prototype's current style+metadata to linked entities/relationships (§9.2). */
  refreshFromPrototype(input: RefreshFromPrototypeInput): Promise<RefreshFromPrototypeResult>
  listPalettes(graphId: Uuid): Promise<Palette[]>
  createPalette(graphId: Uuid, input: PaletteInput): Promise<Palette>
  /** Edit a palette's name/tokens (§8.4 token-level authoring), one command. */
  updatePalette(id: Uuid, patch: PalettePatch): Promise<Palette>
  /** Delete a palette, one command. */
  deletePalette(id: Uuid): Promise<void>
  /** Fork a palette into a new editable row (§8.4 "duplicate a palette"). */
  duplicatePalette(id: Uuid, name?: string): Promise<Palette>
  listStyleProfiles(graphId: Uuid): Promise<StyleProfile[]>
  createStyleProfile(graphId: Uuid, input: StyleProfileInput): Promise<StyleProfile>
  /** Edit a style profile's name/style (§8.3), one command. */
  updateStyleProfile(id: Uuid, patch: StyleProfilePatch): Promise<StyleProfile>
  /** Delete a style profile, one command. */
  deleteStyleProfile(id: Uuid): Promise<void>

  // Undo / redo (command layer; an HttpGateway would back these with the oplog)
  undo(): Promise<boolean>
  redo(): Promise<boolean>
  canUndo(): boolean
  canRedo(): boolean

  // Project I/O
  exportJson(graphId: Uuid): Promise<NodgeDocument>
  exportSqlite(): Promise<Uint8Array>
  importJson(doc: NodgeDocument): Promise<Graph>
}
