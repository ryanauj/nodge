/**
 * Load a validated {@link NodgeDocument} into a repository, flattening the
 * nested diagram/layout structure back into relational rows. Used by `importJson`
 * after the document has been migrated and validated.
 */

import type { Repository } from '../db/repository'
import type { NodgeDocument } from '../model/document'
import {
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

export async function loadDocumentIntoRepository(
  repo: Repository,
  doc: NodgeDocument,
): Promise<void> {
  await repo.insert(graphTable, doc.graph)
  for (const entity of doc.entities) await repo.insert(entityTable, entity)
  for (const relationship of doc.relationships) await repo.insert(relationshipTable, relationship)
  for (const prototype of doc.prototypes) await repo.insert(prototypeTable, prototype)
  for (const palette of doc.palettes) await repo.insert(paletteTable, palette)

  for (const diagram of doc.diagrams) {
    const { nodes, edges, layouts, ...diagramRow } = diagram
    await repo.insert(diagramTable, diagramRow)
    for (const node of nodes) await repo.insert(nodeTable, node)
    for (const edge of edges) await repo.insert(edgeTable, edge)
    for (const layout of layouts) {
      const { positions, ...layoutRow } = layout
      await repo.insert(layoutTable, layoutRow)
      for (const position of positions) {
        await repo.insert(nodePositionTable, {
          layoutId: layout.id,
          nodeId: position.nodeId,
          x: position.x,
          y: position.y,
        })
      }
    }
  }
}
