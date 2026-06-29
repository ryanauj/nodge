/**
 * THE SINGLE MODEL DEFINITION.
 *
 * Every table is authored once, here. From these objects we derive — with no
 * possibility of drift — all three artifacts required by the spec (§3):
 *   1. the SQLite DDL          (see ./ddl.ts)
 *   2. the JSON DTO validator  (see ./table.ts `parseRow`, ./document.ts)
 *   3. the TypeScript types    (the `export type` aliases below, via `RowOf`)
 *
 * Touch a field here and all three update together — that is the invariant.
 */

import { boolean, enumText, integer, json, real, text } from './fields'
import {
  LAYOUT_ALGORITHMS,
  OPLOG_OPS,
  PROTOTYPE_KINDS,
  parseExternalLinks,
  parseMetadata,
  parseOplogSnapshot,
  parsePaletteTokens,
  parseStyleDelta,
  parseViewport,
} from './nested'
import { type RowOf, type TableDef, table } from './table'

const styleDelta = () => json(parseStyleDelta)
const metadata = () => json(parseMetadata)

export const graphTable = table('graph', {
  id: text(),
  name: text(),
  description: text(),
  schemaVersion: integer(),
  createdAt: text(),
  updatedAt: text(),
  version: integer(),
})

export const entityTable = table('entity', {
  id: text(),
  graphId: text(),
  name: text(),
  nodePrototypeId: text().orNull(),
  links: json(parseExternalLinks),
  metadata: metadata(),
  createdAt: text(),
  updatedAt: text(),
  version: integer(),
})

export const relationshipTable = table('relationship', {
  id: text(),
  graphId: text(),
  sourceEntityId: text(),
  targetEntityId: text(),
  edgePrototypeId: text().orNull(),
  directed: boolean(),
  label: text(),
  metadata: metadata(),
  createdAt: text(),
  updatedAt: text(),
  version: integer(),
})

export const prototypeTable = table('prototype', {
  id: text(),
  graphId: text(),
  kind: enumText(PROTOTYPE_KINDS),
  name: text(),
  shape: text().orNull(),
  defaultLabel: text(),
  /** The full default style snapshotted onto a created node/edge (§D3). */
  style: styleDelta(),
  metadata: metadata(),
  linkScaffold: json(parseExternalLinks),
  createdAt: text(),
  updatedAt: text(),
  version: integer(),
})

export const diagramTable = table('diagram', {
  id: text(),
  graphId: text(),
  name: text(),
  description: text(),
  createdAt: text(),
  updatedAt: text(),
  version: integer(),
})

export const nodeTable = table('node', {
  id: text(),
  diagramId: text(),
  entityId: text(),
  label: text(),
  /** The node's full style snapshot (§D3); seeded from its NodePrototype. */
  style: styleDelta(),
  createdAt: text(),
  updatedAt: text(),
  version: integer(),
})

export const edgeTable = table('edge', {
  id: text(),
  diagramId: text(),
  relationshipId: text(),
  sourceNodeId: text(),
  targetNodeId: text(),
  sourceHandle: text().orNull(),
  targetHandle: text().orNull(),
  label: text(),
  /** The edge's full style snapshot (§D3); seeded from its EdgePrototype. */
  style: styleDelta(),
  createdAt: text(),
  updatedAt: text(),
  version: integer(),
})

export const layoutTable = table('layout', {
  id: text(),
  diagramId: text(),
  name: text(),
  algorithm: enumText(LAYOUT_ALGORITHMS),
  viewport: json(parseViewport).orNull(),
  createdAt: text(),
  updatedAt: text(),
  version: integer(),
})

export const nodePositionTable = table(
  'node_position',
  {
    layoutId: text(),
    nodeId: text(),
    x: real(),
    y: real(),
  },
  { primaryKey: ['layoutId', 'nodeId'] },
)

export const paletteTable = table('palette', {
  id: text(),
  graphId: text(),
  name: text(),
  tokens: json(parsePaletteTokens),
  builtin: boolean(),
  createdAt: text(),
  updatedAt: text(),
  version: integer(),
})

/**
 * The append-only oplog (spec §6.2 "Optional, Phase 6", §6.3, §6.6).
 *
 * Every domain mutation is journalled here as one entry at the {@link Mutator}
 * write seam — `op` is `upsert` (a created/updated row) or `delete` (a tombstone).
 * The entry carries the row's `version` + `updatedAt`, which is exactly what the
 * sync layer reconciles by (LWW). `seq` is the monotonic local cursor a puller
 * checkpoints against; `snapshot` is the full row JSON for an upsert (so a pull
 * can apply it) and `null` for a delete.
 *
 * It is intentionally OUTSIDE {@link ALL_TABLES}: the oplog is local journal /
 * sync plumbing, never part of the portable `NodgeDocument` (so the file format
 * and its `schemaVersion` are unchanged). A dedicated SQLite migration creates it.
 */
export const oplogTable = table(
  'oplog',
  {
    seq: integer(),
    /** The domain table this entry mutated (e.g. `entity`, `node`). */
    tableName: text(),
    /** The mutated row's primary-key value (its client UUID). */
    rowId: text(),
    op: enumText(OPLOG_OPS),
    /** The mutated row's `version` (LWW primary key). */
    version: integer(),
    /** The mutated row's `updatedAt` ISO timestamp (LWW tiebreaker). */
    updatedAt: text(),
    /** Full row JSON for `upsert`; `null` for a `delete` tombstone. */
    snapshot: json(parseOplogSnapshot).orNull(),
  },
  { primaryKey: ['seq'] },
)

/** Every table, in dependency order (creation order is FK-safe). */
export const ALL_TABLES: readonly TableDef[] = [
  graphTable,
  entityTable,
  relationshipTable,
  prototypeTable,
  diagramTable,
  nodeTable,
  edgeTable,
  layoutTable,
  nodePositionTable,
  paletteTable,
]

// ── Artifact #3: the TypeScript types, inferred from the definition above ──
export type Graph = RowOf<typeof graphTable>
export type Entity = RowOf<typeof entityTable>
export type Relationship = RowOf<typeof relationshipTable>
export type Prototype = RowOf<typeof prototypeTable>
/** A prototype with `kind: 'node'` — the default node style library entry. */
export type NodePrototype = Prototype & { kind: 'node' }
/** A prototype with `kind: 'edge'` — the default edge style library entry. */
export type EdgePrototype = Prototype & { kind: 'edge' }
export type Diagram = RowOf<typeof diagramTable>
export type Node = RowOf<typeof nodeTable>
export type Edge = RowOf<typeof edgeTable>
export type Layout = RowOf<typeof layoutTable>
export type NodePosition = RowOf<typeof nodePositionTable>
export type Palette = RowOf<typeof paletteTable>
export type OplogEntry = RowOf<typeof oplogTable>
