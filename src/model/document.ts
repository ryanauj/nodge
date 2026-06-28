/**
 * Artifact #2 (top level): the `NodgeDocument` JSON shape (§6.4) plus its
 * runtime validator, both derived from the single model definition so the file
 * format, the REST/sync DTOs and the stored rows cannot diverge.
 */

import {
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
  nodeTable,
  paletteTable,
  prototypeTable,
  relationshipTable,
  styleProfileTable,
  viewTable,
} from './schema'
import { parseRow } from './table'
import { ValidationError, expectArray, expectNumber, expectRecord } from './validate'

/** The current document format version. The JSON migration chain targets this. */
export const CURRENT_SCHEMA_VERSION = 1

/** A node position as carried inside a view (viewId is implied by nesting). */
export interface DocumentNodePosition {
  nodeId: string
  x: number
  y: number
}

export interface DocumentView extends View {
  positions: DocumentNodePosition[]
}

export interface DocumentBoard extends Board {
  nodes: Node[]
  edges: Edge[]
  views: DocumentView[]
}

/** The whole graph serialized as JSON — the `.nodge.json` payload. */
export interface NodgeDocument {
  schemaVersion: number
  graph: Graph
  entities: Entity[]
  relationships: Relationship[]
  prototypes: Prototype[]
  boards: DocumentBoard[]
  palettes: Palette[]
  styleProfiles: StyleProfile[]
}

function parseArray<T>(
  value: unknown,
  path: string,
  parseItem: (item: unknown, path: string) => T,
): T[] {
  return expectArray(value, path).map((item, i) => parseItem(item, `${path}[${i}]`))
}

function parsePosition(value: unknown, path: string): DocumentNodePosition {
  const record = expectRecord(value, path)
  if (typeof record.nodeId !== 'string') {
    throw new ValidationError('expected a string', `${path}.nodeId`)
  }
  return {
    nodeId: record.nodeId,
    x: expectNumber(record.x, `${path}.x`),
    y: expectNumber(record.y, `${path}.y`),
  }
}

/**
 * Validate an unknown value into a `NodgeDocument`. Every row is checked through
 * its table's field validators, so a malformed import fails loudly and early.
 */
export function validateDocument(value: unknown): NodgeDocument {
  const root = expectRecord(value, '$')
  const schemaVersion = expectNumber(root.schemaVersion, '$.schemaVersion')
  const graph = parseRow(graphTable, root.graph, '$.graph')
  const entities = parseArray(root.entities, '$.entities', (v, p) => parseRow(entityTable, v, p))
  const relationships = parseArray(root.relationships, '$.relationships', (v, p) =>
    parseRow(relationshipTable, v, p),
  )
  const prototypes = parseArray(root.prototypes, '$.prototypes', (v, p) =>
    parseRow(prototypeTable, v, p),
  )
  const boards = parseArray(root.boards, '$.boards', (boardValue, boardPath) => {
    const boardRecord = expectRecord(boardValue, boardPath)
    const board = parseRow(boardTable, boardRecord, boardPath)
    const nodes = parseArray(boardRecord.nodes, `${boardPath}.nodes`, (v, p) =>
      parseRow(nodeTable, v, p),
    )
    const edges = parseArray(boardRecord.edges, `${boardPath}.edges`, (v, p) =>
      parseRow(edgeTable, v, p),
    )
    const views = parseArray(boardRecord.views, `${boardPath}.views`, (viewValue, viewPath) => {
      const viewRecord = expectRecord(viewValue, viewPath)
      const view = parseRow(viewTable, viewRecord, viewPath)
      const positions = parseArray(viewRecord.positions, `${viewPath}.positions`, parsePosition)
      return { ...view, positions }
    })
    return { ...board, nodes, edges, views }
  })
  const palettes = parseArray(root.palettes, '$.palettes', (v, p) => parseRow(paletteTable, v, p))
  const styleProfiles = parseArray(root.styleProfiles, '$.styleProfiles', (v, p) =>
    parseRow(styleProfileTable, v, p),
  )

  return {
    schemaVersion,
    graph,
    entities,
    relationships,
    prototypes,
    boards,
    palettes,
    styleProfiles,
  }
}

