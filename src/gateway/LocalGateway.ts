/**
 * LocalGateway — the {@link DataGateway} implementation backed by SQLite-WASM.
 *
 * Reads go straight to the repository; every mutation is routed through the
 * {@link CommandBus} so identity stamping (UUID + version + updatedAt) and
 * undo/redo are uniform and centralized. Swapping this for an `HttpGateway`
 * later is a one-line provider change (spec §6.1).
 */

import { v4 as uuidv4 } from 'uuid'
import { CommandBus, command } from '../commands/CommandBus'
import { OplogSink } from '../commands/oplog'
import { Repository } from '../db/repository'
import { LATEST_SQLITE_VERSION, runSqliteMigrations } from '../db/migrations'
import type { AsyncSqlite } from '../db/sqlite'
import { CURRENT_SCHEMA_VERSION, type NodgeDocument, validateDocument } from '../model/document'
import { createTableSql, dropTableSql } from '../model/ddl'
import {
  ALL_TABLES,
  type Diagram,
  type Edge,
  type Entity,
  type Graph,
  type Layout,
  type Node,
  type Palette,
  type Prototype,
  type Relationship,
  diagramTable,
  edgeTable,
  entityTable,
  graphTable,
  layoutTable,
  nodePositionTable,
  nodeTable,
  paletteTable,
  prototypeTable,
  relationshipTable,
} from '../model/schema'
import { migrateDocument } from '../io/jsonMigrations'
import { loadDocumentIntoRepository } from '../io/loadDocument'
import type {
  AddNodeInput,
  AddNodeResult,
  ConnectNodesInput,
  ConnectNodesResult,
  ConnectToEntityResult,
  ConnectToExistingEntityInput,
  ConnectToNewEntityInput,
  CreatePrototypeFromEdgeInput,
  CreatePrototypeFromNodeInput,
  DataGateway,
  DiagramDetail,
  DiagramInput,
  DiagramPatch,
  EdgeInput,
  EdgePatch,
  EntityInput,
  EntityPatch,
  EntityBacklink,
  EntityEdgePlacement,
  EntityPlacement,
  EntityRelationship,
  EntityUsage,
  GraphDetail,
  GraphInput,
  GraphPatch,
  LayoutDetail,
  LayoutInput,
  LayoutPatch,
  NodeInput,
  NodePatch,
  NodePositionInput,
  PaletteInput,
  PalettePatch,
  PasteClipboardInput,
  PasteClipboardResult,
  PlaceEntityInput,
  PlaceEntityResult,
  PrototypeInput,
  PrototypePatch,
  RefreshFromPrototypeInput,
  RefreshFromPrototypeResult,
  RelationshipInput,
  RelationshipPatch,
  Uuid,
} from './types'

export interface GatewayDeps {
  newId(): string
  now(): string
}

const defaultDeps: GatewayDeps = {
  newId: () => uuidv4(),
  now: () => new Date().toISOString(),
}

interface RecordMeta {
  id: string
  createdAt: string
  updatedAt: string
  version: number
}

function applyPatch<T extends object>(current: T, patch: Partial<T>): T {
  const out = { ...current }
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key]
    if (value !== undefined) out[key] = value
  }
  return out
}

export class LocalGateway implements DataGateway {
  private readonly repo: Repository
  readonly commands: CommandBus

  private constructor(
    private readonly db: AsyncSqlite,
    private readonly deps: GatewayDeps,
    oplog: OplogSink,
  ) {
    this.repo = new Repository(db)
    // Every mutation is journalled into the oplog at the Mutator write seam
    // (spec §6.3) — additive, so no call site changes. The sync layer reads it.
    this.commands = new CommandBus(this.repo, { oplog, now: deps.now })
  }

  /** Open a gateway over a database, running schema migrations first. */
  static async open(db: AsyncSqlite, deps: GatewayDeps = defaultDeps): Promise<LocalGateway> {
    await runSqliteMigrations(db)
    const oplog = await OplogSink.open(new Repository(db))
    return new LocalGateway(db, deps, oplog)
  }

  private stampNew(): RecordMeta {
    const ts = this.deps.now()
    return { id: this.deps.newId(), createdAt: ts, updatedAt: ts, version: 1 }
  }

  private bumpVersion<T extends { updatedAt: string; version: number }>(current: T): T {
    return { ...current, updatedAt: this.deps.now(), version: current.version + 1 }
  }

  private async require<T>(value: T | undefined, what: string, id: string): Promise<T> {
    if (value === undefined) throw new Error(`${what} not found: ${id}`)
    return value
  }

  // ── Graphs ──────────────────────────────────────────────────────────────
  async listGraphs(): Promise<Graph[]> {
    return this.repo.list(graphTable)
  }

  async getGraph(id: Uuid): Promise<GraphDetail> {
    const graph = await this.require(await this.repo.getById(graphTable, id), 'graph', id)
    return {
      ...graph,
      entities: await this.repo.list(entityTable, { graphId: id }),
      relationships: await this.repo.list(relationshipTable, { graphId: id }),
      prototypes: await this.repo.list(prototypeTable, { graphId: id }),
      diagrams: await this.repo.list(diagramTable, { graphId: id }),
      palettes: await this.repo.list(paletteTable, { graphId: id }),
    }
  }

  async createGraph(input: GraphInput): Promise<Graph> {
    const graph: Graph = {
      ...this.stampNew(),
      name: input.name,
      description: input.description ?? '',
      schemaVersion: CURRENT_SCHEMA_VERSION,
    }
    return this.commands.execute(command('createGraph', (m) => m.insert(graphTable, graph)))
  }

  async updateGraph(id: Uuid, patch: GraphPatch): Promise<Graph> {
    const current = await this.require(await this.repo.getById(graphTable, id), 'graph', id)
    const updated = this.bumpVersion(applyPatch(current, patch))
    return this.commands.execute(command('updateGraph', (m) => m.put(graphTable, updated)))
  }

  async deleteGraph(id: Uuid): Promise<void> {
    await this.commands.execute(command('deleteGraph', (m) => m.remove(graphTable, { id })))
  }

  // ── Entities / Relationships ─────────────────────────────────────────────
  async createEntity(graphId: Uuid, input: EntityInput): Promise<Entity> {
    const entity: Entity = {
      ...this.stampNew(),
      graphId,
      name: input.name,
      nodePrototypeId: input.nodePrototypeId ?? null,
      links: input.links ?? [],
      metadata: input.metadata ?? {},
    }
    return this.commands.execute(command('createEntity', (m) => m.insert(entityTable, entity)))
  }

  async updateEntity(id: Uuid, patch: EntityPatch): Promise<Entity> {
    const current = await this.require(await this.repo.getById(entityTable, id), 'entity', id)
    const updated = this.bumpVersion(applyPatch(current, patch))
    return this.commands.execute(command('updateEntity', (m) => m.put(entityTable, updated)))
  }

  async deleteEntity(id: Uuid): Promise<void> {
    await this.commands.execute(command('deleteEntity', (m) => m.remove(entityTable, { id })))
  }

  async createRelationship(graphId: Uuid, input: RelationshipInput): Promise<Relationship> {
    const relationship: Relationship = {
      ...this.stampNew(),
      graphId,
      sourceEntityId: input.sourceEntityId,
      targetEntityId: input.targetEntityId,
      edgePrototypeId: input.edgePrototypeId ?? null,
      directed: input.directed ?? true,
      label: input.label ?? '',
      metadata: input.metadata ?? {},
    }
    return this.commands.execute(
      command('createRelationship', (m) => m.insert(relationshipTable, relationship)),
    )
  }

  async updateRelationship(id: Uuid, patch: RelationshipPatch): Promise<Relationship> {
    const current = await this.require(
      await this.repo.getById(relationshipTable, id),
      'relationship',
      id,
    )
    const updated = this.bumpVersion(applyPatch(current, patch))
    return this.commands.execute(
      command('updateRelationship', (m) => m.put(relationshipTable, updated)),
    )
  }

  async deleteRelationship(id: Uuid): Promise<void> {
    await this.commands.execute(
      command('deleteRelationship', (m) => m.remove(relationshipTable, { id })),
    )
  }

  // ── Diagrams / Nodes / Edges / Layouts ───────────────────────────────────
  async createDiagram(graphId: Uuid, input: DiagramInput): Promise<Diagram> {
    const diagram: Diagram = {
      ...this.stampNew(),
      graphId,
      name: input.name,
      description: input.description ?? '',
    }
    return this.commands.execute(command('createDiagram', (m) => m.insert(diagramTable, diagram)))
  }

  async getDiagram(id: Uuid): Promise<DiagramDetail> {
    const diagram = await this.require(await this.repo.getById(diagramTable, id), 'diagram', id)
    const layouts = await this.repo.list(layoutTable, { diagramId: id })
    const layoutsDetail: LayoutDetail[] = []
    for (const layout of layouts) {
      const positions = await this.repo.list(nodePositionTable, { layoutId: layout.id })
      layoutsDetail.push({
        ...layout,
        positions: positions.map((p) => ({ nodeId: p.nodeId, x: p.x, y: p.y })),
      })
    }
    return {
      ...diagram,
      nodes: await this.repo.list(nodeTable, { diagramId: id }),
      edges: await this.repo.list(edgeTable, { diagramId: id }),
      layouts: layoutsDetail,
    }
  }

  async updateDiagram(id: Uuid, patch: DiagramPatch): Promise<Diagram> {
    const current = await this.require(await this.repo.getById(diagramTable, id), 'diagram', id)
    const updated = this.bumpVersion(applyPatch(current, patch))
    return this.commands.execute(command('updateDiagram', (m) => m.put(diagramTable, updated)))
  }

  /**
   * Delete a diagram and everything visual under it — its nodes, edges, layouts
   * and per-layout positions — as a single undoable command (spec §7.1: removing
   * a diagram never touches the base entities/relationships, only the placements).
   */
  async deleteDiagram(id: Uuid): Promise<void> {
    await this.require(await this.repo.getById(diagramTable, id), 'diagram', id)
    const nodes = await this.repo.list(nodeTable, { diagramId: id })
    const edges = await this.repo.list(edgeTable, { diagramId: id })
    const layouts = await this.repo.list(layoutTable, { diagramId: id })
    const positions: { layoutId: Uuid; nodeId: Uuid }[] = []
    for (const layout of layouts) {
      const ps = await this.repo.list(nodePositionTable, { layoutId: layout.id })
      for (const p of ps) positions.push({ layoutId: layout.id, nodeId: p.nodeId })
    }
    await this.commands.execute(
      command('deleteDiagram', async (m) => {
        for (const p of positions) await m.remove(nodePositionTable, p)
        for (const e of edges) await m.remove(edgeTable, { id: e.id })
        for (const n of nodes) await m.remove(nodeTable, { id: n.id })
        for (const l of layouts) await m.remove(layoutTable, { id: l.id })
        await m.remove(diagramTable, { id })
      }),
    )
  }

  async createNode(diagramId: Uuid, input: NodeInput): Promise<Node> {
    const node: Node = {
      ...this.stampNew(),
      diagramId,
      entityId: input.entityId,
      label: input.label ?? '',
      style: input.style ?? {},
    }
    return this.commands.execute(command('createNode', (m) => m.insert(nodeTable, node)))
  }

  async updateNode(id: Uuid, patch: NodePatch): Promise<Node> {
    const current = await this.require(await this.repo.getById(nodeTable, id), 'node', id)
    const updated = this.bumpVersion(applyPatch(current, patch))
    return this.commands.execute(command('updateNode', (m) => m.put(nodeTable, updated)))
  }

  async deleteNode(id: Uuid): Promise<void> {
    await this.commands.execute(command('deleteNode', (m) => m.remove(nodeTable, { id })))
  }

  async createEdge(diagramId: Uuid, input: EdgeInput): Promise<Edge> {
    const edge: Edge = {
      ...this.stampNew(),
      diagramId,
      relationshipId: input.relationshipId,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      sourceHandle: input.sourceHandle ?? null,
      targetHandle: input.targetHandle ?? null,
      label: input.label ?? '',
      style: input.style ?? {},
    }
    return this.commands.execute(command('createEdge', (m) => m.insert(edgeTable, edge)))
  }

  /**
   * Patch an edge placement (spec §8.3 — the edge-level link/unlink affordance).
   * Pinning an edge style key writes a raw literal into `Edge.style`; unlinking
   * removes the key so the value follows the palette again. Routed through the
   * command bus as one undoable command, exactly like `updateNode`.
   */
  async updateEdge(id: Uuid, patch: EdgePatch): Promise<Edge> {
    const current = await this.require(await this.repo.getById(edgeTable, id), 'edge', id)
    const updated = this.bumpVersion(applyPatch(current, patch))
    return this.commands.execute(command('updateEdge', (m) => m.put(edgeTable, updated)))
  }

  async deleteEdge(id: Uuid): Promise<void> {
    await this.commands.execute(command('deleteEdge', (m) => m.remove(edgeTable, { id })))
  }

  async createLayout(diagramId: Uuid, input: LayoutInput): Promise<Layout> {
    const layout: Layout = {
      ...this.stampNew(),
      diagramId,
      name: input.name,
      algorithm: input.algorithm ?? 'manual',
      viewport: input.viewport ?? null,
    }
    return this.commands.execute(command('createLayout', (m) => m.insert(layoutTable, layout)))
  }

  /**
   * Patch a layout (§D2): rename, switch algorithm, or persist pan/zoom. `null`
   * clears the viewport. One undoable command.
   */
  async updateLayout(id: Uuid, patch: LayoutPatch): Promise<Layout> {
    const current = await this.require(await this.repo.getById(layoutTable, id), 'layout', id)
    const updated = this.bumpVersion(applyPatch(current, patch))
    return this.commands.execute(command('updateLayout', (m) => m.put(layoutTable, updated)))
  }

  /**
   * Delete a layout and its per-layout positions as a single undoable command.
   * A diagram must always keep ≥1 layout (§D2), so deleting the diagram's last
   * remaining layout is rejected.
   */
  async deleteLayout(id: Uuid): Promise<void> {
    const layout = await this.require(await this.repo.getById(layoutTable, id), 'layout', id)
    const siblings = await this.repo.list(layoutTable, { diagramId: layout.diagramId })
    if (siblings.length <= 1) {
      throw new Error(`cannot delete the last layout of diagram ${layout.diagramId}`)
    }
    const positions = await this.repo.list(nodePositionTable, { layoutId: id })
    await this.commands.execute(
      command('deleteLayout', async (m) => {
        for (const p of positions)
          await m.remove(nodePositionTable, { layoutId: id, nodeId: p.nodeId })
        await m.remove(layoutTable, { id })
      }),
    )
  }

  /**
   * Place an EXISTING entity as a new node + per-layout position on a
   * diagram+layout (spec §7.1 — the same entity can appear on many diagrams).
   * One undoable command; the base entity is untouched so edits reflect on every
   * diagram.
   */
  async placeEntity(
    diagramId: Uuid,
    layoutId: Uuid,
    input: PlaceEntityInput,
  ): Promise<PlaceEntityResult> {
    await this.require(await this.repo.getById(diagramTable, diagramId), 'diagram', diagramId)
    const entity = await this.require(
      await this.repo.getById(entityTable, input.entityId),
      'entity',
      input.entityId,
    )
    // Snapshot the entity's linked NodePrototype style onto the new placement (§D3),
    // letting an explicit `input.style` override individual keys.
    const seed = await this.seedFromPrototype(entity.nodePrototypeId, input.style)
    const node: Node = {
      ...this.stampNew(),
      diagramId,
      entityId: entity.id,
      label: input.label ?? '',
      style: seed.style,
    }
    const position = { layoutId, nodeId: node.id, x: input.x, y: input.y }
    return this.commands.execute(
      command('placeEntity', async (m) => {
        await m.insert(nodeTable, node)
        await m.put(nodePositionTable, position)
        return { node, position: { nodeId: node.id, x: input.x, y: input.y } }
      }),
    )
  }

  async bulkUpsertPositions(
    layoutId: Uuid,
    positions: NodePositionInput[],
  ): Promise<NodePositionInput[]> {
    await this.commands.execute(
      command('bulkUpsertPositions', async (m) => {
        for (const p of positions) {
          await m.put(nodePositionTable, { layoutId, nodeId: p.nodeId, x: p.x, y: p.y })
        }
      }),
    )
    return positions
  }

  // ── Composite canvas gestures ────────────────────────────────────────────
  async addNode(diagramId: Uuid, layoutId: Uuid, input: AddNodeInput): Promise<AddNodeResult> {
    const diagram = await this.require(
      await this.repo.getById(diagramTable, diagramId),
      'diagram',
      diagramId,
    )
    // Seed the node's style snapshot from the linked NodePrototype on creation (§D3).
    const seed = await this.seedFromPrototype(input.nodePrototypeId, input.style)
    const entity: Entity = {
      ...this.stampNew(),
      graphId: diagram.graphId,
      name: input.name,
      nodePrototypeId: input.nodePrototypeId ?? null,
      links: [],
      metadata: seed.metadata,
    }
    const node: Node = {
      ...this.stampNew(),
      diagramId,
      entityId: entity.id,
      label: input.name,
      style: seed.style,
    }
    const position = { layoutId, nodeId: node.id, x: input.x, y: input.y }
    return this.commands.execute(
      command('addNode', async (m) => {
        await m.insert(entityTable, entity)
        await m.insert(nodeTable, node)
        await m.put(nodePositionTable, position)
        return { entity, node, position: { nodeId: node.id, x: input.x, y: input.y } }
      }),
    )
  }

  async connectNodes(diagramId: Uuid, input: ConnectNodesInput): Promise<ConnectNodesResult> {
    const diagram = await this.require(
      await this.repo.getById(diagramTable, diagramId),
      'diagram',
      diagramId,
    )
    const source = await this.require(
      await this.repo.getById(nodeTable, input.sourceNodeId),
      'node',
      input.sourceNodeId,
    )
    const target = await this.require(
      await this.repo.getById(nodeTable, input.targetNodeId),
      'node',
      input.targetNodeId,
    )
    const edgeSeed = await this.seedEdgeFromPrototype(input.edgePrototypeId)
    const relationship: Relationship = {
      ...this.stampNew(),
      graphId: diagram.graphId,
      sourceEntityId: source.entityId,
      targetEntityId: target.entityId,
      edgePrototypeId: input.edgePrototypeId ?? null,
      directed: input.directed ?? true,
      label: input.label ?? '',
      metadata: {},
    }
    const edge: Edge = {
      ...this.stampNew(),
      diagramId,
      relationshipId: relationship.id,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      sourceHandle: input.sourceHandle ?? null,
      targetHandle: input.targetHandle ?? null,
      label: input.label ?? '',
      style: edgeSeed,
    }
    return this.commands.execute(
      command('connectNodes', async (m) => {
        await m.insert(relationshipTable, relationship)
        await m.insert(edgeTable, edge)
        return { relationship, edge }
      }),
    )
  }

  /**
   * Snapshot a NodePrototype's style + metadata onto a created node (spec §D3:
   * creating a node copies its prototype's full `style`). The link persists via
   * `entity.nodePrototypeId`; later prototype edits never auto-propagate.
   */
  private async seedFromPrototype(
    prototypeId: Uuid | null | undefined,
    style: Record<string, unknown> | undefined,
  ): Promise<{
    style: Record<string, unknown>
    metadata: Record<string, unknown>
  }> {
    if (!prototypeId) return { style: style ?? {}, metadata: {} }
    const proto = await this.repo.getById(prototypeTable, prototypeId)
    if (!proto) return { style: style ?? {}, metadata: {} }
    return {
      style: { ...proto.style, ...(style ?? {}) },
      metadata: { ...proto.metadata },
    }
  }

  /** Snapshot an EdgePrototype's style onto a created edge (spec §D3). */
  private async seedEdgeFromPrototype(
    prototypeId: Uuid | null | undefined,
  ): Promise<Record<string, unknown>> {
    if (!prototypeId) return {}
    const proto = await this.repo.getById(prototypeTable, prototypeId)
    return proto ? { ...proto.style } : {}
  }

  async connectToExistingEntity(
    diagramId: Uuid,
    layoutId: Uuid,
    input: ConnectToExistingEntityInput,
  ): Promise<ConnectToEntityResult> {
    const diagram = await this.require(
      await this.repo.getById(diagramTable, diagramId),
      'diagram',
      diagramId,
    )
    const source = await this.require(
      await this.repo.getById(nodeTable, input.sourceNodeId),
      'node',
      input.sourceNodeId,
    )
    const entity = await this.require(
      await this.repo.getById(entityTable, input.entityId),
      'entity',
      input.entityId,
    )
    const nodeSeed = await this.seedFromPrototype(entity.nodePrototypeId, undefined)
    const edgeSeed = await this.seedEdgeFromPrototype(input.edgePrototypeId)
    const node: Node = {
      ...this.stampNew(),
      diagramId,
      entityId: entity.id,
      label: '',
      style: nodeSeed.style,
    }
    const position = { layoutId, nodeId: node.id, x: input.x, y: input.y }
    const relationship: Relationship = {
      ...this.stampNew(),
      graphId: diagram.graphId,
      sourceEntityId: source.entityId,
      targetEntityId: entity.id,
      edgePrototypeId: input.edgePrototypeId ?? null,
      directed: input.directed ?? true,
      label: input.label ?? '',
      metadata: {},
    }
    const edge: Edge = {
      ...this.stampNew(),
      diagramId,
      relationshipId: relationship.id,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: node.id,
      sourceHandle: input.sourceHandle ?? null,
      targetHandle: input.targetHandle ?? null,
      label: input.label ?? '',
      style: edgeSeed,
    }
    return this.commands.execute(
      command('connectToExistingEntity', async (m) => {
        await m.insert(nodeTable, node)
        await m.put(nodePositionTable, position)
        await m.insert(relationshipTable, relationship)
        await m.insert(edgeTable, edge)
        return {
          entity,
          node,
          position: { nodeId: node.id, x: input.x, y: input.y },
          relationship,
          edge,
        }
      }),
    )
  }

  async connectToNewEntity(
    diagramId: Uuid,
    layoutId: Uuid,
    input: ConnectToNewEntityInput,
  ): Promise<ConnectToEntityResult> {
    const diagram = await this.require(
      await this.repo.getById(diagramTable, diagramId),
      'diagram',
      diagramId,
    )
    const source = await this.require(
      await this.repo.getById(nodeTable, input.sourceNodeId),
      'node',
      input.sourceNodeId,
    )
    const seed = await this.seedFromPrototype(input.nodePrototypeId, undefined)
    const edgeSeed = await this.seedEdgeFromPrototype(input.edgePrototypeId)
    const entity: Entity = {
      ...this.stampNew(),
      graphId: diagram.graphId,
      name: input.name,
      nodePrototypeId: input.nodePrototypeId ?? null,
      links: [],
      metadata: seed.metadata,
    }
    const node: Node = {
      ...this.stampNew(),
      diagramId,
      entityId: entity.id,
      label: input.name,
      style: seed.style,
    }
    const position = { layoutId, nodeId: node.id, x: input.x, y: input.y }
    const relationship: Relationship = {
      ...this.stampNew(),
      graphId: diagram.graphId,
      sourceEntityId: source.entityId,
      targetEntityId: entity.id,
      edgePrototypeId: input.edgePrototypeId ?? null,
      directed: input.directed ?? true,
      label: input.label ?? '',
      metadata: {},
    }
    const edge: Edge = {
      ...this.stampNew(),
      diagramId,
      relationshipId: relationship.id,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: node.id,
      sourceHandle: input.sourceHandle ?? null,
      targetHandle: input.targetHandle ?? null,
      label: input.label ?? '',
      style: edgeSeed,
    }
    return this.commands.execute(
      command('connectToNewEntity', async (m) => {
        await m.insert(entityTable, entity)
        await m.insert(nodeTable, node)
        await m.put(nodePositionTable, position)
        await m.insert(relationshipTable, relationship)
        await m.insert(edgeTable, edge)
        return {
          entity,
          node,
          position: { nodeId: node.id, x: input.x, y: input.y },
          relationship,
          edge,
        }
      }),
    )
  }

  async pasteClipboard(
    diagramId: Uuid,
    layoutId: Uuid,
    input: PasteClipboardInput,
  ): Promise<PasteClipboardResult> {
    await this.require(await this.repo.getById(diagramTable, diagramId), 'diagram', diagramId)
    const { clipboard } = input
    // Map each clipboard node's refId → the freshly created placement.
    const nodes: Node[] = []
    const positions: NodePositionInput[] = []
    const refToNodeId = new Map<Uuid, Uuid>()
    const nodePositions: { layoutId: Uuid; nodeId: Uuid; x: number; y: number }[] = []
    for (const cn of clipboard.nodes) {
      const node: Node = {
        ...this.stampNew(),
        diagramId,
        entityId: cn.entityId, // SAME entity — never forks identity (§9.3)
        label: cn.label,
        style: { ...cn.style },
      }
      refToNodeId.set(cn.refId, node.id)
      nodes.push(node)
      const x = input.x + cn.dx
      const y = input.y + cn.dy
      positions.push({ nodeId: node.id, x, y })
      nodePositions.push({ layoutId, nodeId: node.id, x, y })
    }
    const edges: Edge[] = []
    for (const ce of clipboard.edges) {
      const sourceNodeId = refToNodeId.get(ce.sourceRefId)
      const targetNodeId = refToNodeId.get(ce.targetRefId)
      if (!sourceNodeId || !targetNodeId) continue // edge not fully internal to the selection
      edges.push({
        ...this.stampNew(),
        diagramId,
        relationshipId: ce.relationshipId, // SAME relationship
        sourceNodeId,
        targetNodeId,
        sourceHandle: ce.sourceHandle ?? null,
        targetHandle: ce.targetHandle ?? null,
        label: ce.label,
        style: { ...ce.style },
      })
    }
    return this.commands.execute(
      command('pasteClipboard', async (m) => {
        for (const node of nodes) await m.insert(nodeTable, node)
        for (const p of nodePositions) await m.put(nodePositionTable, p)
        for (const edge of edges) await m.insert(edgeTable, edge)
        return { nodes, edges, positions }
      }),
    )
  }

  // ── Cross-reference index (§7.4) ──────────────────────────────────────────
  async getEntityUsages(entityId: Uuid): Promise<EntityUsage> {
    const entity = await this.require(
      await this.repo.getById(entityTable, entityId),
      'entity',
      entityId,
    )
    const nodes = (await this.repo.list(nodeTable)).filter((n) => n.entityId === entityId)
    const diagramCache = new Map<Uuid, Diagram | undefined>()
    const diagramOf = async (id: Uuid): Promise<Diagram | undefined> => {
      if (!diagramCache.has(id)) diagramCache.set(id, await this.repo.getById(diagramTable, id))
      return diagramCache.get(id)
    }
    const placements: EntityPlacement[] = []
    for (const n of nodes) {
      const diagram = await diagramOf(n.diagramId)
      placements.push({
        nodeId: n.id,
        diagramId: n.diagramId,
        diagramName: diagram?.name ?? '',
        label: n.label || entity.name,
      })
    }
    const nodeIds = new Set(nodes.map((n) => n.id))
    const edges = (await this.repo.list(edgeTable)).filter(
      (e) => nodeIds.has(e.sourceNodeId) || nodeIds.has(e.targetNodeId),
    )
    const edgePlacements: EntityEdgePlacement[] = edges.map((e) => ({
      edgeId: e.id,
      diagramId: e.diagramId,
      relationshipId: e.relationshipId,
    }))
    const relationships = (
      await this.repo.list(relationshipTable, { graphId: entity.graphId })
    ).filter((r) => r.sourceEntityId === entityId || r.targetEntityId === entityId)
    const relationshipUsages: EntityRelationship[] = relationships.map((r) => ({
      relationshipId: r.id,
      role: r.sourceEntityId === entityId ? 'source' : 'target',
      otherEntityId: r.sourceEntityId === entityId ? r.targetEntityId : r.sourceEntityId,
      label: r.label,
      directed: r.directed,
    }))
    // Backlinks: other entities whose links point at this one (kind entity|diagram).
    const allEntities = await this.repo.list(entityTable, { graphId: entity.graphId })
    const backlinks: EntityBacklink[] = []
    for (const other of allEntities) {
      if (other.id === entityId) continue
      for (const link of other.links) {
        if ((link.kind === 'entity' || link.kind === 'diagram') && link.target === entityId) {
          backlinks.push({
            fromEntityId: other.id,
            linkId: link.id,
            kind: link.kind,
            label: link.label,
          })
        }
      }
    }
    return {
      entityId,
      placements,
      edgePlacements,
      relationships: relationshipUsages,
      backlinks,
    }
  }

  // ── Prototypes / Palettes ────────────────────────────────────────────────
  async listPrototypes(graphId: Uuid): Promise<Prototype[]> {
    return this.repo.list(prototypeTable, { graphId })
  }

  async createPrototype(graphId: Uuid, input: PrototypeInput): Promise<Prototype> {
    const prototype: Prototype = {
      ...this.stampNew(),
      graphId,
      kind: input.kind,
      name: input.name,
      shape: input.shape ?? null,
      defaultLabel: input.defaultLabel ?? '',
      style: input.style ?? {},
      metadata: input.metadata ?? {},
      linkScaffold: input.linkScaffold ?? [],
    }
    return this.commands.execute(
      command('createPrototype', (m) => m.insert(prototypeTable, prototype)),
    )
  }

  async updatePrototype(id: Uuid, patch: PrototypePatch): Promise<Prototype> {
    const current = await this.require(
      await this.repo.getById(prototypeTable, id),
      'prototype',
      id,
    )
    const updated = this.bumpVersion(applyPatch(current, patch))
    return this.commands.execute(command('updatePrototype', (m) => m.put(prototypeTable, updated)))
  }

  async createPrototypeFromNode(input: CreatePrototypeFromNodeInput): Promise<Prototype> {
    const node = await this.require(
      await this.repo.getById(nodeTable, input.nodeId),
      'node',
      input.nodeId,
    )
    const entity = await this.require(
      await this.repo.getById(entityTable, node.entityId),
      'entity',
      node.entityId,
    )
    // Snapshot the node's full style (§D3); do not relink the source entity (D9).
    const style: Record<string, unknown> = { ...node.style }
    const shape =
      input.shape !== undefined
        ? input.shape
        : typeof style.shape === 'string'
          ? style.shape
          : null
    const prototype: Prototype = {
      ...this.stampNew(),
      graphId: entity.graphId,
      kind: 'node',
      name: input.name,
      shape,
      defaultLabel: node.label || entity.name,
      style,
      metadata: { ...entity.metadata },
      linkScaffold: entity.links.map((l) => ({ ...l })),
    }
    return this.commands.execute(
      command('createPrototypeFromNode', (m) => m.insert(prototypeTable, prototype)),
    )
  }

  async createPrototypeFromEdge(input: CreatePrototypeFromEdgeInput): Promise<Prototype> {
    const edge = await this.require(
      await this.repo.getById(edgeTable, input.edgeId),
      'edge',
      input.edgeId,
    )
    const rel = await this.require(
      await this.repo.getById(relationshipTable, edge.relationshipId),
      'relationship',
      edge.relationshipId,
    )
    // Snapshot the edge's full style (§D3); do not relink the source relationship (D9).
    const style: Record<string, unknown> = { ...edge.style }
    const prototype: Prototype = {
      ...this.stampNew(),
      graphId: rel.graphId,
      kind: 'edge',
      name: input.name,
      shape: null,
      defaultLabel: edge.label || rel.label,
      style,
      metadata: { ...rel.metadata },
      linkScaffold: [],
    }
    return this.commands.execute(
      command('createPrototypeFromEdge', (m) => m.insert(prototypeTable, prototype)),
    )
  }

  async duplicatePrototype(prototypeId: Uuid, name?: string): Promise<Prototype> {
    const source = await this.require(
      await this.repo.getById(prototypeTable, prototypeId),
      'prototype',
      prototypeId,
    )
    const prototype: Prototype = {
      ...this.stampNew(),
      graphId: source.graphId,
      kind: source.kind,
      name: name ?? `${source.name} copy`,
      shape: source.shape,
      defaultLabel: source.defaultLabel,
      style: { ...source.style },
      metadata: { ...source.metadata },
      linkScaffold: source.linkScaffold.map((l) => ({ ...l })),
    }
    return this.commands.execute(
      command('duplicatePrototype', (m) => m.insert(prototypeTable, prototype)),
    )
  }

  /**
   * Re-copy a prototype's current `style` onto the nodes/edges linked to it
   * (§9.2 — opt-in, never automatic). A node is "linked" when its entity's
   * `nodePrototypeId` is this prototype; an edge when its relationship's
   * `edgePrototypeId` is.
   *
   * Two scopes:
   *  - `ids`: refresh exactly the named node/edge placements, regardless of diagram.
   *  - `all: true`: refresh every linked node/edge **within `diagramId`** (§7/D1 —
   *    the Diagram owns styling, so a batch refresh never reskins the same entity's
   *    placement in other diagrams). `diagramId` is required for this path.
   */
  async refreshFromPrototype(
    input: RefreshFromPrototypeInput,
  ): Promise<RefreshFromPrototypeResult> {
    const proto = await this.require(
      await this.repo.getById(prototypeTable, input.prototypeId),
      'prototype',
      input.prototypeId,
    )
    if (input.all && !input.diagramId) {
      throw new Error('refreshFromPrototype({ all: true }) requires a diagramId (§7/D1)')
    }
    // `all` is diagram-scoped (guarded above, so non-undefined here).
    const scopeDiagramId = input.diagramId as Uuid
    if (proto.kind === 'node') {
      const entities = (await this.repo.list(entityTable, { graphId: proto.graphId })).filter(
        (e) => e.nodePrototypeId === proto.id,
      )
      const entityIds = new Set(entities.map((e) => e.id))
      // `all` is diagram-scoped; `ids` operates on the named placements directly.
      const candidates = input.all
        ? await this.repo.list(nodeTable, { diagramId: scopeDiagramId })
        : await this.repo.list(nodeTable)
      const targets = input.all
        ? candidates.filter((n) => entityIds.has(n.entityId))
        : candidates.filter((n) => (input.ids ?? []).includes(n.id))
      const updated = targets.map((n) =>
        this.bumpVersion({ ...n, style: { ...proto.style } }),
      )
      await this.commands.execute(
        command('refreshFromPrototype', async (m) => {
          for (const n of updated) await m.put(nodeTable, n)
        }),
      )
      return { refreshed: updated.map((n) => n.id) }
    }
    // edge prototype
    const relationships = (
      await this.repo.list(relationshipTable, { graphId: proto.graphId })
    ).filter((r) => r.edgePrototypeId === proto.id)
    const relIds = new Set(relationships.map((r) => r.id))
    const candidates = input.all
      ? await this.repo.list(edgeTable, { diagramId: scopeDiagramId })
      : await this.repo.list(edgeTable)
    const targets = input.all
      ? candidates.filter((e) => relIds.has(e.relationshipId))
      : candidates.filter((e) => (input.ids ?? []).includes(e.id))
    const updated = targets.map((e) => this.bumpVersion({ ...e, style: { ...proto.style } }))
    await this.commands.execute(
      command('refreshFromPrototype', async (m) => {
        for (const e of updated) await m.put(edgeTable, e)
      }),
    )
    return { refreshed: updated.map((e) => e.id) }
  }

  async listPalettes(graphId: Uuid): Promise<Palette[]> {
    return this.repo.list(paletteTable, { graphId })
  }

  async createPalette(graphId: Uuid, input: PaletteInput): Promise<Palette> {
    const palette: Palette = {
      ...this.stampNew(),
      graphId,
      name: input.name,
      tokens: input.tokens ?? {},
      builtin: input.builtin ?? false,
    }
    return this.commands.execute(command('createPalette', (m) => m.insert(paletteTable, palette)))
  }

  /**
   * Edit a palette's name/tokens (spec §8.4 token-level authoring). One undoable
   * command. Editing a built-in's tokens clears the `builtin` flag so the user's
   * edits read as a user palette (the seeded library stays pristine until forked).
   */
  async updatePalette(id: Uuid, patch: PalettePatch): Promise<Palette> {
    const current = await this.require(await this.repo.getById(paletteTable, id), 'palette', id)
    const next: Palette = { ...current }
    if (patch.name !== undefined) next.name = patch.name
    if (patch.tokens !== undefined) next.tokens = patch.tokens
    if (patch.builtin !== undefined) next.builtin = patch.builtin
    else if (patch.tokens !== undefined) next.builtin = false
    const updated = this.bumpVersion(next)
    return this.commands.execute(command('updatePalette', (m) => m.put(paletteTable, updated)))
  }

  async deletePalette(id: Uuid): Promise<void> {
    await this.commands.execute(command('deletePalette', (m) => m.remove(paletteTable, { id })))
  }

  /** Fork a palette into a new editable (non-builtin) row (spec §8.4). */
  async duplicatePalette(id: Uuid, name?: string): Promise<Palette> {
    const source = await this.require(await this.repo.getById(paletteTable, id), 'palette', id)
    const palette: Palette = {
      ...this.stampNew(),
      graphId: source.graphId,
      name: name ?? `${source.name} copy`,
      tokens: { ...source.tokens },
      builtin: false,
    }
    return this.commands.execute(command('duplicatePalette', (m) => m.insert(paletteTable, palette)))
  }

  // ── Undo / redo ───────────────────────────────────────────────────────────
  undo(): Promise<boolean> {
    return this.commands.undo()
  }

  redo(): Promise<boolean> {
    return this.commands.redo()
  }

  canUndo(): boolean {
    return this.commands.canUndo
  }

  canRedo(): boolean {
    return this.commands.canRedo
  }

  // ── Project I/O ──────────────────────────────────────────────────────────
  async exportJson(graphId: Uuid): Promise<NodgeDocument> {
    const graph = await this.require(await this.repo.getById(graphTable, graphId), 'graph', graphId)
    const diagrams = await this.repo.list(diagramTable, { graphId })
    const documentDiagrams = []
    for (const diagram of diagrams) {
      const layouts = await this.repo.list(layoutTable, { diagramId: diagram.id })
      const documentLayouts = []
      for (const layout of layouts) {
        const positions = await this.repo.list(nodePositionTable, { layoutId: layout.id })
        documentLayouts.push({
          ...layout,
          positions: positions.map((p) => ({ nodeId: p.nodeId, x: p.x, y: p.y })),
        })
      }
      documentDiagrams.push({
        ...diagram,
        nodes: await this.repo.list(nodeTable, { diagramId: diagram.id }),
        edges: await this.repo.list(edgeTable, { diagramId: diagram.id }),
        layouts: documentLayouts,
      })
    }
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      graph,
      entities: await this.repo.list(entityTable, { graphId }),
      relationships: await this.repo.list(relationshipTable, { graphId }),
      prototypes: await this.repo.list(prototypeTable, { graphId }),
      diagrams: documentDiagrams,
      palettes: await this.repo.list(paletteTable, { graphId }),
    }
  }

  async exportSqlite(): Promise<Uint8Array> {
    return this.db.exportBytes()
  }

  /** Drop every domain table and rebuild the schema from the model definition. */
  private async resetSchema(): Promise<void> {
    for (const def of [...ALL_TABLES].reverse()) await this.db.exec(dropTableSql(def))
    for (const def of ALL_TABLES) await this.db.exec(createTableSql(def))
    await this.db.exec(`PRAGMA user_version = ${LATEST_SQLITE_VERSION}`)
  }

  async importJson(doc: NodgeDocument): Promise<Graph> {
    const validated = validateDocument(migrateDocument(doc))
    await this.resetSchema()
    await loadDocumentIntoRepository(this.repo, validated)
    return validated.graph
  }
}
