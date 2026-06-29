/**
 * HttpGateway — the {@link DataGateway} implementation backed by a server
 * transport (spec §6.1, §6.6). It proves the seam: the app reads/writes through
 * the SAME interface as {@link LocalGateway}, so swapping `LocalGateway →
 * HttpGateway` is a provider/config change with zero call-site changes.
 *
 * Phase 6 is "readiness", not "build the server": there is no real backend, so a
 * local SQLite mirror (a {@link LocalGateway}) services reads/writes for instant,
 * offline-first UX, and a {@link SyncEngine} over a {@link SyncTransport} (the
 * in-process {@link MockServer}, or later a real `fetch` backend) push/pulls the
 * oplog to reconcile with other devices. Every method below is a straight
 * delegate to the mirror — that delegation IS the same-interface proof.
 */

import { LocalGateway, type GatewayDeps } from './LocalGateway'
import { SyncEngine, type SyncResult } from '../sync/SyncEngine'
import type { SyncTransport } from '../sync/transport'
import type { AsyncSqlite } from '../db/sqlite'
import type {
  Diagram,
  Edge,
  Entity,
  Graph,
  Layout,
  Node,
  Palette,
  Prototype,
  Relationship,
} from '../model'
import type { NodgeDocument } from '../model/document'
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
  EntityUsage,
  GraphDetail,
  GraphInput,
  GraphPatch,
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

export class HttpGateway implements DataGateway {
  private constructor(
    private readonly local: LocalGateway,
    private readonly engine: SyncEngine,
  ) {}

  /**
   * Open an HttpGateway over a database + a sync transport. The DB hosts the
   * offline-first local mirror; the transport is the (mock or real) server.
   */
  static async open(
    db: AsyncSqlite,
    transport: SyncTransport,
    deps?: GatewayDeps,
  ): Promise<HttpGateway> {
    // LocalGateway.open runs the (idempotent) migrations + opens the oplog sink.
    const local = await LocalGateway.open(db, deps)
    const engine = new SyncEngine(db, transport)
    return new HttpGateway(local, engine)
  }

  // ── Sync (the HttpGateway-specific surface; the rest is the shared seam) ──
  /** Push local changes then pull + apply remote ones (LWW reconcile). */
  sync(): Promise<SyncResult> {
    return this.engine.sync()
  }
  /** Send local changes to the server. */
  push(): Promise<number> {
    return this.engine.push()
  }
  /** Fetch + apply remote changes since the last checkpoint. */
  pull(): Promise<number> {
    return this.engine.pull()
  }

  // ── DataGateway: every method delegates to the local mirror ──────────────
  listGraphs(): Promise<Graph[]> {
    return this.local.listGraphs()
  }
  getGraph(id: Uuid): Promise<GraphDetail> {
    return this.local.getGraph(id)
  }
  createGraph(input: GraphInput): Promise<Graph> {
    return this.local.createGraph(input)
  }
  updateGraph(id: Uuid, patch: GraphPatch): Promise<Graph> {
    return this.local.updateGraph(id, patch)
  }
  deleteGraph(id: Uuid): Promise<void> {
    return this.local.deleteGraph(id)
  }

  createEntity(graphId: Uuid, input: EntityInput): Promise<Entity> {
    return this.local.createEntity(graphId, input)
  }
  updateEntity(id: Uuid, patch: EntityPatch): Promise<Entity> {
    return this.local.updateEntity(id, patch)
  }
  deleteEntity(id: Uuid): Promise<void> {
    return this.local.deleteEntity(id)
  }
  createRelationship(graphId: Uuid, input: RelationshipInput): Promise<Relationship> {
    return this.local.createRelationship(graphId, input)
  }
  updateRelationship(id: Uuid, patch: RelationshipPatch): Promise<Relationship> {
    return this.local.updateRelationship(id, patch)
  }
  deleteRelationship(id: Uuid): Promise<void> {
    return this.local.deleteRelationship(id)
  }

  createDiagram(graphId: Uuid, input: DiagramInput): Promise<Diagram> {
    return this.local.createDiagram(graphId, input)
  }
  getDiagram(id: Uuid): Promise<DiagramDetail> {
    return this.local.getDiagram(id)
  }
  updateDiagram(id: Uuid, patch: DiagramPatch): Promise<Diagram> {
    return this.local.updateDiagram(id, patch)
  }
  deleteDiagram(id: Uuid): Promise<void> {
    return this.local.deleteDiagram(id)
  }
  createNode(diagramId: Uuid, input: NodeInput): Promise<Node> {
    return this.local.createNode(diagramId, input)
  }
  updateNode(id: Uuid, patch: NodePatch): Promise<Node> {
    return this.local.updateNode(id, patch)
  }
  deleteNode(id: Uuid): Promise<void> {
    return this.local.deleteNode(id)
  }
  createEdge(diagramId: Uuid, input: EdgeInput): Promise<Edge> {
    return this.local.createEdge(diagramId, input)
  }
  updateEdge(id: Uuid, patch: EdgePatch): Promise<Edge> {
    return this.local.updateEdge(id, patch)
  }
  deleteEdge(id: Uuid): Promise<void> {
    return this.local.deleteEdge(id)
  }
  createLayout(diagramId: Uuid, input: LayoutInput): Promise<Layout> {
    return this.local.createLayout(diagramId, input)
  }
  updateLayout(id: Uuid, patch: LayoutPatch): Promise<Layout> {
    return this.local.updateLayout(id, patch)
  }
  deleteLayout(id: Uuid): Promise<void> {
    return this.local.deleteLayout(id)
  }
  bulkUpsertPositions(
    layoutId: Uuid,
    positions: NodePositionInput[],
  ): Promise<NodePositionInput[]> {
    return this.local.bulkUpsertPositions(layoutId, positions)
  }
  placeEntity(
    diagramId: Uuid,
    layoutId: Uuid,
    input: PlaceEntityInput,
  ): Promise<PlaceEntityResult> {
    return this.local.placeEntity(diagramId, layoutId, input)
  }

  addNode(diagramId: Uuid, layoutId: Uuid, input: AddNodeInput): Promise<AddNodeResult> {
    return this.local.addNode(diagramId, layoutId, input)
  }
  connectNodes(diagramId: Uuid, input: ConnectNodesInput): Promise<ConnectNodesResult> {
    return this.local.connectNodes(diagramId, input)
  }
  connectToExistingEntity(
    diagramId: Uuid,
    layoutId: Uuid,
    input: ConnectToExistingEntityInput,
  ): Promise<ConnectToEntityResult> {
    return this.local.connectToExistingEntity(diagramId, layoutId, input)
  }
  connectToNewEntity(
    diagramId: Uuid,
    layoutId: Uuid,
    input: ConnectToNewEntityInput,
  ): Promise<ConnectToEntityResult> {
    return this.local.connectToNewEntity(diagramId, layoutId, input)
  }
  pasteClipboard(
    diagramId: Uuid,
    layoutId: Uuid,
    input: PasteClipboardInput,
  ): Promise<PasteClipboardResult> {
    return this.local.pasteClipboard(diagramId, layoutId, input)
  }

  getEntityUsages(entityId: Uuid): Promise<EntityUsage> {
    return this.local.getEntityUsages(entityId)
  }

  listPrototypes(graphId: Uuid): Promise<Prototype[]> {
    return this.local.listPrototypes(graphId)
  }
  createPrototype(graphId: Uuid, input: PrototypeInput): Promise<Prototype> {
    return this.local.createPrototype(graphId, input)
  }
  updatePrototype(id: Uuid, patch: PrototypePatch): Promise<Prototype> {
    return this.local.updatePrototype(id, patch)
  }
  createPrototypeFromNode(input: CreatePrototypeFromNodeInput): Promise<Prototype> {
    return this.local.createPrototypeFromNode(input)
  }
  createPrototypeFromEdge(input: CreatePrototypeFromEdgeInput): Promise<Prototype> {
    return this.local.createPrototypeFromEdge(input)
  }
  duplicatePrototype(prototypeId: Uuid, name?: string): Promise<Prototype> {
    return this.local.duplicatePrototype(prototypeId, name)
  }
  refreshFromPrototype(input: RefreshFromPrototypeInput): Promise<RefreshFromPrototypeResult> {
    return this.local.refreshFromPrototype(input)
  }
  listPalettes(graphId: Uuid): Promise<Palette[]> {
    return this.local.listPalettes(graphId)
  }
  createPalette(graphId: Uuid, input: PaletteInput): Promise<Palette> {
    return this.local.createPalette(graphId, input)
  }
  updatePalette(id: Uuid, patch: PalettePatch): Promise<Palette> {
    return this.local.updatePalette(id, patch)
  }
  deletePalette(id: Uuid): Promise<void> {
    return this.local.deletePalette(id)
  }
  duplicatePalette(id: Uuid, name?: string): Promise<Palette> {
    return this.local.duplicatePalette(id, name)
  }

  undo(): Promise<boolean> {
    return this.local.undo()
  }
  redo(): Promise<boolean> {
    return this.local.redo()
  }
  canUndo(): boolean {
    return this.local.canUndo()
  }
  canRedo(): boolean {
    return this.local.canRedo()
  }

  exportJson(graphId: Uuid): Promise<NodgeDocument> {
    return this.local.exportJson(graphId)
  }
  exportSqlite(): Promise<Uint8Array> {
    return this.local.exportSqlite()
  }
  importJson(doc: NodgeDocument): Promise<Graph> {
    return this.local.importJson(doc)
  }
}
