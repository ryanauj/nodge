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
  PROTOTYPE_KINDS,
  STYLE_PROFILE_TARGETS,
  parseExternalLinks,
  parseMetadata,
  parsePaletteTokens,
  parseStyleDelta,
  parseViewFilter,
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
  prototypeId: text().orNull(),
  /** A referenced StyleProfile (§8.3) whose `style` layers into the cascade. */
  styleProfileId: text().orNull(),
  styleOverride: styleDelta(),
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
  prototypeId: text().orNull(),
  directed: boolean(),
  label: text(),
  styleOverride: styleDelta(),
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
  /** A default referenced StyleProfile (§9.1 "default StyleProfile/look"). */
  styleProfileId: text().orNull(),
  style: styleDelta(),
  metadata: metadata(),
  linkScaffold: json(parseExternalLinks),
  createdAt: text(),
  updatedAt: text(),
  version: integer(),
})

export const boardTable = table('board', {
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
  boardId: text(),
  entityId: text(),
  label: text(),
  /** A referenced StyleProfile (§8.3) whose `style` layers into the cascade. */
  styleProfileId: text().orNull(),
  styleOverride: styleDelta(),
  createdAt: text(),
  updatedAt: text(),
  version: integer(),
})

export const edgeTable = table('edge', {
  id: text(),
  boardId: text(),
  relationshipId: text(),
  sourceNodeId: text(),
  targetNodeId: text(),
  sourceHandle: text().orNull(),
  targetHandle: text().orNull(),
  label: text(),
  styleOverride: styleDelta(),
  createdAt: text(),
  updatedAt: text(),
  version: integer(),
})

export const viewTable = table('view', {
  id: text(),
  boardId: text(),
  name: text(),
  paletteId: text().orNull(),
  filter: json(parseViewFilter).orNull(),
  viewport: json(parseViewport).orNull(),
  createdAt: text(),
  updatedAt: text(),
  version: integer(),
})

export const nodePositionTable = table(
  'node_position',
  {
    viewId: text(),
    nodeId: text(),
    x: real(),
    y: real(),
  },
  { primaryKey: ['viewId', 'nodeId'] },
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

export const styleProfileTable = table('style_profile', {
  id: text(),
  graphId: text(),
  name: text(),
  target: enumText(STYLE_PROFILE_TARGETS),
  style: styleDelta(),
  createdAt: text(),
  updatedAt: text(),
  version: integer(),
})

/** Every table, in dependency order (creation order is FK-safe). */
export const ALL_TABLES: readonly TableDef[] = [
  graphTable,
  entityTable,
  relationshipTable,
  prototypeTable,
  boardTable,
  nodeTable,
  edgeTable,
  viewTable,
  nodePositionTable,
  paletteTable,
  styleProfileTable,
]

// ── Artifact #3: the TypeScript types, inferred from the definition above ──
export type Graph = RowOf<typeof graphTable>
export type Entity = RowOf<typeof entityTable>
export type Relationship = RowOf<typeof relationshipTable>
export type Prototype = RowOf<typeof prototypeTable>
export type Board = RowOf<typeof boardTable>
export type Node = RowOf<typeof nodeTable>
export type Edge = RowOf<typeof edgeTable>
export type View = RowOf<typeof viewTable>
export type NodePosition = RowOf<typeof nodePositionTable>
export type Palette = RowOf<typeof paletteTable>
export type StyleProfile = RowOf<typeof styleProfileTable>
