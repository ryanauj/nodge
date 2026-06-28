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
import { Repository } from '../db/repository'
import { LATEST_SQLITE_VERSION, runSqliteMigrations } from '../db/migrations'
import type { AsyncSqlite } from '../db/sqlite'
import { CURRENT_SCHEMA_VERSION, type NodgeDocument, validateDocument } from '../model/document'
import { createTableSql, dropTableSql } from '../model/ddl'
import {
  ALL_TABLES,
  type Board,
  type Edge,
  type Entity,
  type Graph,
  type Node,
  type Palette,
  type Prototype,
  type Relationship,
  type StyleProfile,
  type View,
  boardTable,
  edgeTable,
  entityTable,
  graphTable,
  nodePositionTable,
  nodeTable,
  paletteTable,
  prototypeTable,
  relationshipTable,
  styleProfileTable,
  viewTable,
} from '../model/schema'
import { migrateDocument } from '../io/jsonMigrations'
import { loadDocumentIntoRepository } from '../io/loadDocument'
import type {
  AddNodeInput,
  AddNodeResult,
  BoardDetail,
  BoardInput,
  BoardPatch,
  ConnectNodesInput,
  ConnectNodesResult,
  ConnectToEntityResult,
  ConnectToExistingEntityInput,
  ConnectToNewEntityInput,
  CreatePrototypeFromEdgeInput,
  CreatePrototypeFromNodeInput,
  DataGateway,
  EdgeInput,
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
  StyleProfileInput,
  StyleProfilePatch,
  Uuid,
  ViewDetail,
  ViewInput,
  ViewPatch,
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
  ) {
    this.repo = new Repository(db)
    this.commands = new CommandBus(this.repo)
  }

  /** Open a gateway over a database, running schema migrations first. */
  static async open(db: AsyncSqlite, deps: GatewayDeps = defaultDeps): Promise<LocalGateway> {
    await runSqliteMigrations(db)
    return new LocalGateway(db, deps)
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
      boards: await this.repo.list(boardTable, { graphId: id }),
      palettes: await this.repo.list(paletteTable, { graphId: id }),
      styleProfiles: await this.repo.list(styleProfileTable, { graphId: id }),
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
      prototypeId: input.prototypeId ?? null,
      styleOverride: input.styleOverride ?? {},
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
      prototypeId: input.prototypeId ?? null,
      directed: input.directed ?? true,
      label: input.label ?? '',
      styleOverride: input.styleOverride ?? {},
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

  // ── Boards / Nodes / Edges / Views ───────────────────────────────────────
  async createBoard(graphId: Uuid, input: BoardInput): Promise<Board> {
    const board: Board = {
      ...this.stampNew(),
      graphId,
      name: input.name,
      description: input.description ?? '',
    }
    return this.commands.execute(command('createBoard', (m) => m.insert(boardTable, board)))
  }

  async getBoard(id: Uuid): Promise<BoardDetail> {
    const board = await this.require(await this.repo.getById(boardTable, id), 'board', id)
    const views = await this.repo.list(viewTable, { boardId: id })
    const viewsDetail: ViewDetail[] = []
    for (const view of views) {
      const positions = await this.repo.list(nodePositionTable, { viewId: view.id })
      viewsDetail.push({
        ...view,
        positions: positions.map((p) => ({ nodeId: p.nodeId, x: p.x, y: p.y })),
      })
    }
    return {
      ...board,
      nodes: await this.repo.list(nodeTable, { boardId: id }),
      edges: await this.repo.list(edgeTable, { boardId: id }),
      views: viewsDetail,
    }
  }

  async updateBoard(id: Uuid, patch: BoardPatch): Promise<Board> {
    const current = await this.require(await this.repo.getById(boardTable, id), 'board', id)
    const updated = this.bumpVersion(applyPatch(current, patch))
    return this.commands.execute(command('updateBoard', (m) => m.put(boardTable, updated)))
  }

  /**
   * Delete a board and everything visual under it — its nodes, edges, views and
   * per-view positions — as a single undoable command (spec §7.1: removing a
   * board never touches the base entities/relationships, only the placements).
   */
  async deleteBoard(id: Uuid): Promise<void> {
    await this.require(await this.repo.getById(boardTable, id), 'board', id)
    const nodes = await this.repo.list(nodeTable, { boardId: id })
    const edges = await this.repo.list(edgeTable, { boardId: id })
    const views = await this.repo.list(viewTable, { boardId: id })
    const positions: { viewId: Uuid; nodeId: Uuid }[] = []
    for (const view of views) {
      const ps = await this.repo.list(nodePositionTable, { viewId: view.id })
      for (const p of ps) positions.push({ viewId: view.id, nodeId: p.nodeId })
    }
    await this.commands.execute(
      command('deleteBoard', async (m) => {
        for (const p of positions) await m.remove(nodePositionTable, p)
        for (const e of edges) await m.remove(edgeTable, { id: e.id })
        for (const n of nodes) await m.remove(nodeTable, { id: n.id })
        for (const v of views) await m.remove(viewTable, { id: v.id })
        await m.remove(boardTable, { id })
      }),
    )
  }

  async createNode(boardId: Uuid, input: NodeInput): Promise<Node> {
    const node: Node = {
      ...this.stampNew(),
      boardId,
      entityId: input.entityId,
      label: input.label ?? '',
      styleOverride: input.styleOverride ?? {},
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

  async createEdge(boardId: Uuid, input: EdgeInput): Promise<Edge> {
    const edge: Edge = {
      ...this.stampNew(),
      boardId,
      relationshipId: input.relationshipId,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      sourceHandle: input.sourceHandle ?? null,
      targetHandle: input.targetHandle ?? null,
      label: input.label ?? '',
      styleOverride: input.styleOverride ?? {},
    }
    return this.commands.execute(command('createEdge', (m) => m.insert(edgeTable, edge)))
  }

  async deleteEdge(id: Uuid): Promise<void> {
    await this.commands.execute(command('deleteEdge', (m) => m.remove(edgeTable, { id })))
  }

  async createView(boardId: Uuid, input: ViewInput): Promise<View> {
    const view: View = {
      ...this.stampNew(),
      boardId,
      name: input.name,
      paletteId: input.paletteId ?? null,
      filter: input.filter ?? null,
      viewport: input.viewport ?? null,
    }
    return this.commands.execute(command('createView', (m) => m.insert(viewTable, view)))
  }

  /**
   * Patch a view's presentation (spec §7.2): rename, switch palette, set the
   * filter/focus lens, or persist pan/zoom. `null` clears filter/viewport.
   * Switching `paletteId` is how a palette swap re-skins a view — `diagram.ts`
   * resolves tokens from the view's palette, so token-referenced styles follow.
   */
  async updateView(id: Uuid, patch: ViewPatch): Promise<View> {
    const current = await this.require(await this.repo.getById(viewTable, id), 'view', id)
    const updated = this.bumpVersion(applyPatch(current, patch))
    return this.commands.execute(command('updateView', (m) => m.put(viewTable, updated)))
  }

  /** Delete a view and its per-view positions as a single undoable command. */
  async deleteView(id: Uuid): Promise<void> {
    await this.require(await this.repo.getById(viewTable, id), 'view', id)
    const positions = await this.repo.list(nodePositionTable, { viewId: id })
    await this.commands.execute(
      command('deleteView', async (m) => {
        for (const p of positions) await m.remove(nodePositionTable, { viewId: id, nodeId: p.nodeId })
        await m.remove(viewTable, { id })
      }),
    )
  }

  /**
   * Place an EXISTING entity as a new node + per-view position on a board+view
   * (spec §7.1 — the same entity can appear on many boards). One undoable
   * command; the base entity is untouched so edits reflect on every board.
   */
  async placeEntity(
    boardId: Uuid,
    viewId: Uuid,
    input: PlaceEntityInput,
  ): Promise<PlaceEntityResult> {
    await this.require(await this.repo.getById(boardTable, boardId), 'board', boardId)
    const entity = await this.require(
      await this.repo.getById(entityTable, input.entityId),
      'entity',
      input.entityId,
    )
    const node: Node = {
      ...this.stampNew(),
      boardId,
      entityId: entity.id,
      label: input.label ?? '',
      styleOverride: input.styleOverride ?? {},
    }
    const position = { viewId, nodeId: node.id, x: input.x, y: input.y }
    return this.commands.execute(
      command('placeEntity', async (m) => {
        await m.insert(nodeTable, node)
        await m.put(nodePositionTable, position)
        return { node, position: { nodeId: node.id, x: input.x, y: input.y } }
      }),
    )
  }

  async bulkUpsertPositions(
    viewId: Uuid,
    positions: NodePositionInput[],
  ): Promise<NodePositionInput[]> {
    await this.commands.execute(
      command('bulkUpsertPositions', async (m) => {
        for (const p of positions) {
          await m.put(nodePositionTable, { viewId, nodeId: p.nodeId, x: p.x, y: p.y })
        }
      }),
    )
    return positions
  }

  // ── Composite canvas gestures ────────────────────────────────────────────
  async addNode(boardId: Uuid, viewId: Uuid, input: AddNodeInput): Promise<AddNodeResult> {
    const board = await this.require(await this.repo.getById(boardTable, boardId), 'board', boardId)
    // Seed style + metadata from the linked prototype on creation (spec §9.2).
    const seed = await this.seedFromPrototype(input.prototypeId, input.entityStyleOverride)
    const entity: Entity = {
      ...this.stampNew(),
      graphId: board.graphId,
      name: input.name,
      prototypeId: input.prototypeId ?? null,
      styleOverride: seed.styleOverride,
      links: [],
      metadata: seed.metadata,
    }
    const node: Node = {
      ...this.stampNew(),
      boardId,
      entityId: entity.id,
      label: input.name,
      styleOverride: input.styleOverride ?? {},
    }
    const position = { viewId, nodeId: node.id, x: input.x, y: input.y }
    return this.commands.execute(
      command('addNode', async (m) => {
        await m.insert(entityTable, entity)
        await m.insert(nodeTable, node)
        await m.put(nodePositionTable, position)
        return { entity, node, position: { nodeId: node.id, x: input.x, y: input.y } }
      }),
    )
  }

  async connectNodes(boardId: Uuid, input: ConnectNodesInput): Promise<ConnectNodesResult> {
    const board = await this.require(await this.repo.getById(boardTable, boardId), 'board', boardId)
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
    const relationship: Relationship = {
      ...this.stampNew(),
      graphId: board.graphId,
      sourceEntityId: source.entityId,
      targetEntityId: target.entityId,
      prototypeId: input.prototypeId ?? null,
      directed: input.directed ?? true,
      label: input.label ?? '',
      styleOverride: {},
      metadata: {},
    }
    const edge: Edge = {
      ...this.stampNew(),
      boardId,
      relationshipId: relationship.id,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      sourceHandle: input.sourceHandle ?? null,
      targetHandle: input.targetHandle ?? null,
      label: input.label ?? '',
      styleOverride: {},
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
   * Seed an entity's style + metadata from a prototype on creation (spec §9.2:
   * "On creation, the prototype seeds the entity's style + metadata"). The link
   * persists via `prototypeId`; later prototype edits never auto-propagate.
   */
  private async seedFromPrototype(
    prototypeId: Uuid | null | undefined,
    entityStyleOverride: Record<string, unknown> | undefined,
  ): Promise<{ styleOverride: Record<string, unknown>; metadata: Record<string, unknown> }> {
    if (!prototypeId) return { styleOverride: entityStyleOverride ?? {}, metadata: {} }
    const proto = await this.repo.getById(prototypeTable, prototypeId)
    if (!proto) return { styleOverride: entityStyleOverride ?? {}, metadata: {} }
    return {
      styleOverride: { ...proto.style, ...(entityStyleOverride ?? {}) },
      metadata: { ...proto.metadata },
    }
  }

  async connectToExistingEntity(
    boardId: Uuid,
    viewId: Uuid,
    input: ConnectToExistingEntityInput,
  ): Promise<ConnectToEntityResult> {
    const board = await this.require(await this.repo.getById(boardTable, boardId), 'board', boardId)
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
    const node: Node = {
      ...this.stampNew(),
      boardId,
      entityId: entity.id,
      label: '',
      styleOverride: {},
    }
    const position = { viewId, nodeId: node.id, x: input.x, y: input.y }
    const relationship: Relationship = {
      ...this.stampNew(),
      graphId: board.graphId,
      sourceEntityId: source.entityId,
      targetEntityId: entity.id,
      prototypeId: input.relationshipPrototypeId ?? null,
      directed: input.directed ?? true,
      label: input.label ?? '',
      styleOverride: {},
      metadata: {},
    }
    const edge: Edge = {
      ...this.stampNew(),
      boardId,
      relationshipId: relationship.id,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: node.id,
      sourceHandle: input.sourceHandle ?? null,
      targetHandle: input.targetHandle ?? null,
      label: input.label ?? '',
      styleOverride: {},
    }
    return this.commands.execute(
      command('connectToExistingEntity', async (m) => {
        await m.insert(nodeTable, node)
        await m.put(nodePositionTable, position)
        await m.insert(relationshipTable, relationship)
        await m.insert(edgeTable, edge)
        return { entity, node, position: { nodeId: node.id, x: input.x, y: input.y }, relationship, edge }
      }),
    )
  }

  async connectToNewEntity(
    boardId: Uuid,
    viewId: Uuid,
    input: ConnectToNewEntityInput,
  ): Promise<ConnectToEntityResult> {
    const board = await this.require(await this.repo.getById(boardTable, boardId), 'board', boardId)
    const source = await this.require(
      await this.repo.getById(nodeTable, input.sourceNodeId),
      'node',
      input.sourceNodeId,
    )
    const seed = await this.seedFromPrototype(input.prototypeId, undefined)
    const entity: Entity = {
      ...this.stampNew(),
      graphId: board.graphId,
      name: input.name,
      prototypeId: input.prototypeId ?? null,
      styleOverride: seed.styleOverride,
      links: [],
      metadata: seed.metadata,
    }
    const node: Node = {
      ...this.stampNew(),
      boardId,
      entityId: entity.id,
      label: input.name,
      styleOverride: {},
    }
    const position = { viewId, nodeId: node.id, x: input.x, y: input.y }
    const relationship: Relationship = {
      ...this.stampNew(),
      graphId: board.graphId,
      sourceEntityId: source.entityId,
      targetEntityId: entity.id,
      prototypeId: input.relationshipPrototypeId ?? null,
      directed: input.directed ?? true,
      label: input.label ?? '',
      styleOverride: {},
      metadata: {},
    }
    const edge: Edge = {
      ...this.stampNew(),
      boardId,
      relationshipId: relationship.id,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: node.id,
      sourceHandle: input.sourceHandle ?? null,
      targetHandle: input.targetHandle ?? null,
      label: input.label ?? '',
      styleOverride: {},
    }
    return this.commands.execute(
      command('connectToNewEntity', async (m) => {
        await m.insert(entityTable, entity)
        await m.insert(nodeTable, node)
        await m.put(nodePositionTable, position)
        await m.insert(relationshipTable, relationship)
        await m.insert(edgeTable, edge)
        return { entity, node, position: { nodeId: node.id, x: input.x, y: input.y }, relationship, edge }
      }),
    )
  }

  async pasteClipboard(
    boardId: Uuid,
    viewId: Uuid,
    input: PasteClipboardInput,
  ): Promise<PasteClipboardResult> {
    await this.require(await this.repo.getById(boardTable, boardId), 'board', boardId)
    const { clipboard } = input
    // Map each clipboard node's refId → the freshly created placement.
    const nodes: Node[] = []
    const positions: NodePositionInput[] = []
    const refToNodeId = new Map<Uuid, Uuid>()
    const nodePositions: { viewId: Uuid; nodeId: Uuid; x: number; y: number }[] = []
    for (const cn of clipboard.nodes) {
      const node: Node = {
        ...this.stampNew(),
        boardId,
        entityId: cn.entityId, // SAME entity — never forks identity (§9.3)
        label: cn.label,
        styleOverride: { ...cn.styleOverride },
      }
      refToNodeId.set(cn.refId, node.id)
      nodes.push(node)
      const x = input.x + cn.dx
      const y = input.y + cn.dy
      positions.push({ nodeId: node.id, x, y })
      nodePositions.push({ viewId, nodeId: node.id, x, y })
    }
    const edges: Edge[] = []
    for (const ce of clipboard.edges) {
      const sourceNodeId = refToNodeId.get(ce.sourceRefId)
      const targetNodeId = refToNodeId.get(ce.targetRefId)
      if (!sourceNodeId || !targetNodeId) continue // edge not fully internal to the selection
      edges.push({
        ...this.stampNew(),
        boardId,
        relationshipId: ce.relationshipId, // SAME relationship
        sourceNodeId,
        targetNodeId,
        sourceHandle: ce.sourceHandle ?? null,
        targetHandle: ce.targetHandle ?? null,
        label: ce.label,
        styleOverride: { ...ce.styleOverride },
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
    const boardCache = new Map<Uuid, Board | undefined>()
    const boardOf = async (id: Uuid): Promise<Board | undefined> => {
      if (!boardCache.has(id)) boardCache.set(id, await this.repo.getById(boardTable, id))
      return boardCache.get(id)
    }
    const placements: EntityPlacement[] = []
    for (const n of nodes) {
      const board = await boardOf(n.boardId)
      placements.push({
        nodeId: n.id,
        boardId: n.boardId,
        boardName: board?.name ?? '',
        label: n.label || entity.name,
      })
    }
    const nodeIds = new Set(nodes.map((n) => n.id))
    const edges = (await this.repo.list(edgeTable)).filter(
      (e) => nodeIds.has(e.sourceNodeId) || nodeIds.has(e.targetNodeId),
    )
    const edgePlacements: EntityEdgePlacement[] = edges.map((e) => ({
      edgeId: e.id,
      boardId: e.boardId,
      relationshipId: e.relationshipId,
    }))
    const relationships = (await this.repo.list(relationshipTable, { graphId: entity.graphId })).filter(
      (r) => r.sourceEntityId === entityId || r.targetEntityId === entityId,
    )
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

  // ── Prototypes / Palettes / StyleProfiles ────────────────────────────────
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
    const node = await this.require(await this.repo.getById(nodeTable, input.nodeId), 'node', input.nodeId)
    const entity = await this.require(
      await this.repo.getById(entityTable, node.entityId),
      'entity',
      node.entityId,
    )
    const proto = entity.prototypeId
      ? await this.repo.getById(prototypeTable, entity.prototypeId)
      : undefined
    // Snapshot the resolved style: the prototype's seed merged with entity + node overrides.
    const style: Record<string, unknown> = {
      ...(proto?.style ?? {}),
      ...entity.styleOverride,
      ...node.styleOverride,
    }
    const shape =
      input.shape !== undefined
        ? input.shape
        : (typeof style.shape === 'string' ? style.shape : proto?.shape ?? null)
    const prototype: Prototype = {
      ...this.stampNew(),
      graphId: entity.graphId,
      kind: 'node',
      name: input.name,
      shape,
      defaultLabel: node.label || entity.name,
      style,
      metadata: { ...(proto?.metadata ?? {}), ...entity.metadata },
      linkScaffold: entity.links.map((l) => ({ ...l })),
    }
    return this.commands.execute(
      command('createPrototypeFromNode', (m) => m.insert(prototypeTable, prototype)),
    )
  }

  async createPrototypeFromEdge(input: CreatePrototypeFromEdgeInput): Promise<Prototype> {
    const edge = await this.require(await this.repo.getById(edgeTable, input.edgeId), 'edge', input.edgeId)
    const rel = await this.require(
      await this.repo.getById(relationshipTable, edge.relationshipId),
      'relationship',
      edge.relationshipId,
    )
    const proto = rel.prototypeId
      ? await this.repo.getById(prototypeTable, rel.prototypeId)
      : undefined
    const style: Record<string, unknown> = {
      ...(proto?.style ?? {}),
      ...rel.styleOverride,
      ...edge.styleOverride,
    }
    const prototype: Prototype = {
      ...this.stampNew(),
      graphId: rel.graphId,
      kind: 'relationship',
      name: input.name,
      shape: null,
      defaultLabel: edge.label || rel.label,
      style,
      metadata: { ...(proto?.metadata ?? {}), ...rel.metadata },
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

  async refreshFromPrototype(
    input: RefreshFromPrototypeInput,
  ): Promise<RefreshFromPrototypeResult> {
    const proto = await this.require(
      await this.repo.getById(prototypeTable, input.prototypeId),
      'prototype',
      input.prototypeId,
    )
    if (proto.kind === 'node') {
      const all = await this.repo.list(entityTable, { graphId: proto.graphId })
      const linked = all.filter((e) => e.prototypeId === proto.id)
      const targets = input.all
        ? linked
        : linked.filter((e) => (input.ids ?? []).includes(e.id))
      const updated = targets.map((e) =>
        this.bumpVersion({
          ...e,
          styleOverride: { ...proto.style },
          metadata: { ...proto.metadata },
        }),
      )
      await this.commands.execute(
        command('refreshFromPrototype', async (m) => {
          for (const e of updated) await m.put(entityTable, e)
        }),
      )
      return { refreshed: updated.map((e) => e.id) }
    }
    // relationship prototype
    const all = await this.repo.list(relationshipTable, { graphId: proto.graphId })
    const linked = all.filter((r) => r.prototypeId === proto.id)
    const targets = input.all ? linked : linked.filter((r) => (input.ids ?? []).includes(r.id))
    const updated = targets.map((r) =>
      this.bumpVersion({
        ...r,
        styleOverride: { ...proto.style },
        metadata: { ...proto.metadata },
      }),
    )
    await this.commands.execute(
      command('refreshFromPrototype', async (m) => {
        for (const r of updated) await m.put(relationshipTable, r)
      }),
    )
    return { refreshed: updated.map((r) => r.id) }
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

  async listStyleProfiles(graphId: Uuid): Promise<StyleProfile[]> {
    return this.repo.list(styleProfileTable, { graphId })
  }

  async createStyleProfile(graphId: Uuid, input: StyleProfileInput): Promise<StyleProfile> {
    const styleProfile: StyleProfile = {
      ...this.stampNew(),
      graphId,
      name: input.name,
      target: input.target,
      style: input.style ?? {},
    }
    return this.commands.execute(
      command('createStyleProfile', (m) => m.insert(styleProfileTable, styleProfile)),
    )
  }

  async updateStyleProfile(id: Uuid, patch: StyleProfilePatch): Promise<StyleProfile> {
    const current = await this.require(
      await this.repo.getById(styleProfileTable, id),
      'styleProfile',
      id,
    )
    const updated = this.bumpVersion(applyPatch(current, patch))
    return this.commands.execute(
      command('updateStyleProfile', (m) => m.put(styleProfileTable, updated)),
    )
  }

  async deleteStyleProfile(id: Uuid): Promise<void> {
    await this.commands.execute(
      command('deleteStyleProfile', (m) => m.remove(styleProfileTable, { id })),
    )
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
    const boards = await this.repo.list(boardTable, { graphId })
    const documentBoards = []
    for (const board of boards) {
      const views = await this.repo.list(viewTable, { boardId: board.id })
      const documentViews = []
      for (const view of views) {
        const positions = await this.repo.list(nodePositionTable, { viewId: view.id })
        documentViews.push({
          ...view,
          positions: positions.map((p) => ({ nodeId: p.nodeId, x: p.x, y: p.y })),
        })
      }
      documentBoards.push({
        ...board,
        nodes: await this.repo.list(nodeTable, { boardId: board.id }),
        edges: await this.repo.list(edgeTable, { boardId: board.id }),
        views: documentViews,
      })
    }
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      graph,
      entities: await this.repo.list(entityTable, { graphId }),
      relationships: await this.repo.list(relationshipTable, { graphId }),
      prototypes: await this.repo.list(prototypeTable, { graphId }),
      boards: documentBoards,
      palettes: await this.repo.list(paletteTable, { graphId }),
      styleProfiles: await this.repo.list(styleProfileTable, { graphId }),
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
