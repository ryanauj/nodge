/**
 * The DataGateway seam (spec §6.1).
 *
 * A single typed, async interface — the only way the app reads or writes data.
 * Methods are shaped 1:1 on REST endpoints and return serializable DTOs (the
 * model types), never ORM rows, so an `HttpGateway` can later drop in behind
 * the same interface with zero call-site changes.
 */

import type {
  Diagram,
  Edge,
  Entity,
  ExternalLink,
  Graph,
  LayoutAlgorithm,
  Layout,
  Metadata,
  Node,
  Palette,
  PaletteTokens,
  Prototype,
  PrototypeKind,
  Relationship,
  StyleDelta,
  Viewport,
} from '../model'
import type { NodgeDocument } from '../model/document'

export type Uuid = string

/** A layout enriched with its per-layout node positions. */
export interface LayoutDetail extends Layout {
  positions: { nodeId: Uuid; x: number; y: number }[]
}

/** A diagram with its placements and layouts (nested fetch). */
export interface DiagramDetail extends Diagram {
  nodes: Node[]
  edges: Edge[]
  layouts: LayoutDetail[]
}

/** A graph with its base-layer collections (nested fetch). */
export interface GraphDetail extends Graph {
  entities: Entity[]
  relationships: Relationship[]
  prototypes: Prototype[]
  diagrams: Diagram[]
  palettes: Palette[]
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
  nodePrototypeId?: Uuid | null
  links?: ExternalLink[]
  metadata?: Metadata
}
export interface EntityPatch {
  name?: string
  nodePrototypeId?: Uuid | null
  links?: ExternalLink[]
  metadata?: Metadata
}

export interface RelationshipInput {
  sourceEntityId: Uuid
  targetEntityId: Uuid
  edgePrototypeId?: Uuid | null
  directed?: boolean
  label?: string
  metadata?: Metadata
}
export interface RelationshipPatch {
  edgePrototypeId?: Uuid | null
  directed?: boolean
  label?: string
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

export interface DiagramInput {
  name: string
  description?: string
}
export interface DiagramPatch {
  name?: string
  description?: string
}

export interface NodeInput {
  entityId: Uuid
  label?: string
  style?: StyleDelta
}
export interface NodePatch {
  label?: string
  style?: StyleDelta
}

export interface EdgeInput {
  relationshipId: Uuid
  sourceNodeId: Uuid
  targetNodeId: Uuid
  sourceHandle?: string | null
  targetHandle?: string | null
  label?: string
  style?: StyleDelta
}

/**
 * Patch an edge placement (spec §8.3 — the edge-level link/unlink affordance).
 * Pinning an edge style key writes a raw literal into `style`; unlinking removes
 * the key so the value follows the palette again. One undoable command.
 */
export interface EdgePatch {
  label?: string
  style?: StyleDelta
}

export interface LayoutInput {
  name: string
  algorithm?: LayoutAlgorithm
  viewport?: Viewport | null
}

/**
 * Patch a layout (§D2): rename it, switch its `algorithm` (manual/dagre) or
 * persist pan/zoom (`viewport`). `null` clears the viewport; omitted fields are
 * unchanged. Applied as one undoable command.
 */
export interface LayoutPatch {
  name?: string
  algorithm?: LayoutAlgorithm
  viewport?: Viewport | null
}

/**
 * Place an EXISTING base entity as a NEW node on a diagram + layout (spec §7.1 —
 * "the same entity can be placed on many diagrams"). Creates the {@link Node}
 * placement plus its per-layout position as a single undoable command; the base
 * entity is untouched, so editing it reflects on every diagram placing it.
 */
export interface PlaceEntityInput {
  entityId: Uuid
  x: number
  y: number
  label?: string
  style?: StyleDelta
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
 * Add a node to a diagram: create the base {@link Entity} and its {@link Node}
 * placement plus the per-layout position, as a single undoable command (spec §12
 * Phase 1 — "creating on the canvas creates the right base + visual rows").
 */
export interface AddNodeInput {
  name: string
  x: number
  y: number
  nodePrototypeId?: Uuid | null
  /** Pinned overrides on the placement (Node.style). */
  style?: StyleDelta
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
  edgePrototypeId?: Uuid | null
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
 * node's resolved shape + label + the node's style + metadata.
 */
export interface CreatePrototypeFromNodeInput {
  nodeId: Uuid
  name: string
  /** Override the snapshotted shape; otherwise inherit the source's. */
  shape?: string | null
}

/** Snapshot a selected edge (and its base relationship) into a new edge prototype. */
export interface CreatePrototypeFromEdgeInput {
  edgeId: Uuid
  name: string
}

/**
 * Refresh a prototype's current style onto nodes/edges linked to it (spec §9.2 —
 * opt-in, never automatic). Supply explicit `ids`, or `all: true` to batch every
 * linked node/edge of the prototype **within a single diagram** (§7/D1: the
 * Diagram owns styling, so `all` is diagram-scoped — it never reskins the same
 * entity's placement in other diagrams the user isn't looking at).
 */
export interface RefreshFromPrototypeInput {
  prototypeId: Uuid
  /**
   * Apply to these node ids (node prototype) / edge ids (edge prototype). Operates
   * on exactly the given ids regardless of diagram.
   */
  ids?: Uuid[]
  /** Apply to every node/edge linked to the prototype within `diagramId`. */
  all?: boolean
  /** Required with `all: true`: the diagram to scope the batch refresh to. */
  diagramId?: Uuid
}

export interface RefreshFromPrototypeResult {
  /** Ids of the nodes (node prototype) or edges (edge prototype) refreshed. */
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
  edgePrototypeId?: Uuid | null
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
  nodePrototypeId?: Uuid | null
  directed?: boolean
  label?: string
  edgePrototypeId?: Uuid | null
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
  style: StyleDelta
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
  style: StyleDelta
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
  diagramId: Uuid
  diagramName: string
  label: string
}

export interface EntityEdgePlacement {
  edgeId: Uuid
  diagramId: Uuid
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

  // Diagrams / Nodes / Edges / Layouts
  createDiagram(graphId: Uuid, input: DiagramInput): Promise<Diagram>
  getDiagram(id: Uuid): Promise<DiagramDetail>
  updateDiagram(id: Uuid, patch: DiagramPatch): Promise<Diagram>
  /** Delete a diagram and everything visual under it (nodes/edges/layouts/positions), one command. */
  deleteDiagram(id: Uuid): Promise<void>
  createNode(diagramId: Uuid, input: NodeInput): Promise<Node>
  updateNode(id: Uuid, patch: NodePatch): Promise<Node>
  deleteNode(id: Uuid): Promise<void>
  createEdge(diagramId: Uuid, input: EdgeInput): Promise<Edge>
  /** Patch an edge placement's label / pinned style (§8.3), one command. */
  updateEdge(id: Uuid, patch: EdgePatch): Promise<Edge>
  deleteEdge(id: Uuid): Promise<void>
  createLayout(diagramId: Uuid, input: LayoutInput): Promise<Layout>
  updateLayout(id: Uuid, patch: LayoutPatch): Promise<Layout>
  /** Delete a layout and its per-layout positions, one command. */
  deleteLayout(id: Uuid): Promise<void>
  bulkUpsertPositions(layoutId: Uuid, positions: NodePositionInput[]): Promise<NodePositionInput[]>
  /** Place an existing entity as a new node + position on a diagram+layout (§7.1), one command. */
  placeEntity(
    diagramId: Uuid,
    layoutId: Uuid,
    input: PlaceEntityInput,
  ): Promise<PlaceEntityResult>

  // Composite canvas gestures (single undoable command each)
  addNode(diagramId: Uuid, layoutId: Uuid, input: AddNodeInput): Promise<AddNodeResult>
  connectNodes(diagramId: Uuid, input: ConnectNodesInput): Promise<ConnectNodesResult>
  /** Drag-to-create: place a new node for an existing entity + connect it (§9.4 path a). */
  connectToExistingEntity(
    diagramId: Uuid,
    layoutId: Uuid,
    input: ConnectToExistingEntityInput,
  ): Promise<ConnectToEntityResult>
  /** Drag-to-create: create a new prototype-seeded entity + node + connect it (§9.4 path b). */
  connectToNewEntity(
    diagramId: Uuid,
    layoutId: Uuid,
    input: ConnectToNewEntityInput,
  ): Promise<ConnectToEntityResult>
  /** Paste a clipboard as new placements of the same entities/relationships (§9.3). */
  pasteClipboard(
    diagramId: Uuid,
    layoutId: Uuid,
    input: PasteClipboardInput,
  ): Promise<PasteClipboardResult>

  // Cross-reference index (derived, §7.4)
  getEntityUsages(entityId: Uuid): Promise<EntityUsage>

  // Prototypes / Palettes
  listPrototypes(graphId: Uuid): Promise<Prototype[]>
  createPrototype(graphId: Uuid, input: PrototypeInput): Promise<Prototype>
  updatePrototype(id: Uuid, patch: PrototypePatch): Promise<Prototype>
  /** Snapshot a node's style/shape/label/metadata into a new node prototype (§9.1). */
  createPrototypeFromNode(input: CreatePrototypeFromNodeInput): Promise<Prototype>
  /** Snapshot an edge's style/label into a new edge prototype (§9.1). */
  createPrototypeFromEdge(input: CreatePrototypeFromEdgeInput): Promise<Prototype>
  /** Fork an existing prototype into a new row (§9.1 "Prototypes can be duplicated"). */
  duplicatePrototype(prototypeId: Uuid, name?: string): Promise<Prototype>
  /** Re-apply a prototype's current style to linked nodes/edges (§9.2). */
  refreshFromPrototype(input: RefreshFromPrototypeInput): Promise<RefreshFromPrototypeResult>
  listPalettes(graphId: Uuid): Promise<Palette[]>
  createPalette(graphId: Uuid, input: PaletteInput): Promise<Palette>
  /** Edit a palette's name/tokens (§8.4 token-level authoring), one command. */
  updatePalette(id: Uuid, patch: PalettePatch): Promise<Palette>
  /** Delete a palette, one command. */
  deletePalette(id: Uuid): Promise<void>
  /** Fork a palette into a new editable row (§8.4 "duplicate a palette"). */
  duplicatePalette(id: Uuid, name?: string): Promise<Palette>

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
