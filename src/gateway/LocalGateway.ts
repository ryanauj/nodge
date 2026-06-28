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
  ConnectNodesInput,
  ConnectNodesResult,
  DataGateway,
  EdgeInput,
  EntityInput,
  EntityPatch,
  GraphDetail,
  GraphInput,
  GraphPatch,
  NodeInput,
  NodePatch,
  NodePositionInput,
  PaletteInput,
  PrototypeInput,
  RelationshipInput,
  RelationshipPatch,
  StyleProfileInput,
  Uuid,
  ViewDetail,
  ViewInput,
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
    const entity: Entity = {
      ...this.stampNew(),
      graphId: board.graphId,
      name: input.name,
      prototypeId: input.prototypeId ?? null,
      styleOverride: input.entityStyleOverride ?? {},
      links: [],
      metadata: {},
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
