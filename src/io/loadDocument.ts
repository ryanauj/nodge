/**
 * Load a validated {@link NodgeDocument} into a repository, flattening the
 * nested board/view structure back into relational rows. Used by `importJson`
 * after the document has been migrated and validated.
 */

import type { Repository } from '../db/repository'
import type { NodgeDocument } from '../model/document'
import {
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

export async function loadDocumentIntoRepository(
  repo: Repository,
  doc: NodgeDocument,
): Promise<void> {
  await repo.insert(graphTable, doc.graph)
  for (const entity of doc.entities) await repo.insert(entityTable, entity)
  for (const relationship of doc.relationships) await repo.insert(relationshipTable, relationship)
  for (const prototype of doc.prototypes) await repo.insert(prototypeTable, prototype)
  for (const palette of doc.palettes) await repo.insert(paletteTable, palette)
  for (const styleProfile of doc.styleProfiles) await repo.insert(styleProfileTable, styleProfile)

  for (const board of doc.boards) {
    const { nodes, edges, views, ...boardRow } = board
    await repo.insert(boardTable, boardRow)
    for (const node of nodes) await repo.insert(nodeTable, node)
    for (const edge of edges) await repo.insert(edgeTable, edge)
    for (const view of views) {
      const { positions, ...viewRow } = view
      await repo.insert(viewTable, viewRow)
      for (const position of positions) {
        await repo.insert(nodePositionTable, {
          viewId: view.id,
          nodeId: position.nodeId,
          x: position.x,
          y: position.y,
        })
      }
    }
  }
}
