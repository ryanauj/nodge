/**
 * Artifact #2 (top level): the `NodgeDocument` JSON shape (§6.4) plus its
 * runtime validator, both derived from the single model definition so the file
 * format, the REST/sync DTOs and the stored rows cannot diverge.
 */

import {
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
  nodeTable,
  paletteTable,
  prototypeTable,
  relationshipTable,
} from './schema'
import { parseRow } from './table'
import { ValidationError, expectArray, expectNumber, expectRecord } from './validate'

/** The current document format version. The JSON migration chain targets this. */
export const CURRENT_SCHEMA_VERSION = 3

/** A node position as carried inside a layout (layoutId is implied by nesting). */
export interface DocumentNodePosition {
  nodeId: string
  x: number
  y: number
}

export interface DocumentLayout extends Layout {
  positions: DocumentNodePosition[]
}

export interface DocumentDiagram extends Diagram {
  nodes: Node[]
  edges: Edge[]
  layouts: DocumentLayout[]
}

/** The whole graph serialized as JSON — the `.nodge.json` payload. */
export interface NodgeDocument {
  schemaVersion: number
  graph: Graph
  entities: Entity[]
  relationships: Relationship[]
  prototypes: Prototype[]
  diagrams: DocumentDiagram[]
  palettes: Palette[]
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
  const diagrams = parseArray(root.diagrams, '$.diagrams', (diagramValue, diagramPath) => {
    const diagramRecord = expectRecord(diagramValue, diagramPath)
    const diagram = parseRow(diagramTable, diagramRecord, diagramPath)
    const nodes = parseArray(diagramRecord.nodes, `${diagramPath}.nodes`, (v, p) =>
      parseRow(nodeTable, v, p),
    )
    const edges = parseArray(diagramRecord.edges, `${diagramPath}.edges`, (v, p) =>
      parseRow(edgeTable, v, p),
    )
    const layouts = parseArray(
      diagramRecord.layouts,
      `${diagramPath}.layouts`,
      (layoutValue, layoutPath) => {
        const layoutRecord = expectRecord(layoutValue, layoutPath)
        const layout = parseRow(layoutTable, layoutRecord, layoutPath)
        const positions = parseArray(
          layoutRecord.positions,
          `${layoutPath}.positions`,
          parsePosition,
        )
        return { ...layout, positions }
      },
    )
    return { ...diagram, nodes, edges, layouts }
  })
  const palettes = parseArray(root.palettes, '$.palettes', (v, p) => parseRow(paletteTable, v, p))

  return {
    schemaVersion,
    graph,
    entities,
    relationships,
    prototypes,
    diagrams,
    palettes,
  }
}
