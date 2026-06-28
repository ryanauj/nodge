/**
 * JSON document migrations, keyed on `schemaVersion` (spec §6.5).
 *
 * `importJson` runs this chain *before* validation so older `.nodge.json` files
 * upgrade cleanly to the current shape. Each step transforms a document one
 * version forward; the runner applies steps until the document reaches
 * {@link CURRENT_SCHEMA_VERSION}.
 */

import { CURRENT_SCHEMA_VERSION } from '../model/document'

/** A migration step: transforms a raw doc from `version` to `version + 1`. */
export type JsonMigration = (doc: Record<string, unknown>) => Record<string, unknown>

/**
 * Steps keyed by the version they upgrade *from*. `MIGRATIONS[0]` turns a v0
 * document into a v1 document, and so on.
 *
 * v0 → v1: the earliest documents predate the top-level `boards`/`palettes`/
 * `styleProfiles` collections and the per-graph `description`. The step fills in
 * the now-required empty collections and defaults so the v1 validator accepts it.
 */
export const JSON_MIGRATIONS: Readonly<Record<number, JsonMigration>> = {
  0: (doc) => {
    const graph = { ...(doc.graph as Record<string, unknown> | undefined) }
    if (typeof graph.description !== 'string') graph.description = ''
    if (typeof graph.schemaVersion !== 'number') graph.schemaVersion = 1
    return {
      ...doc,
      schemaVersion: 1,
      graph,
      entities: doc.entities ?? [],
      relationships: doc.relationships ?? [],
      prototypes: doc.prototypes ?? [],
      boards: doc.boards ?? [],
      palettes: doc.palettes ?? [],
      styleProfiles: doc.styleProfiles ?? [],
    }
  },
}

/**
 * Apply the migration chain to an arbitrary parsed document. Returns a document
 * whose `schemaVersion` equals {@link CURRENT_SCHEMA_VERSION}.
 */
export function migrateDocument(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Cannot migrate: document is not an object')
  }
  let doc = input as Record<string, unknown>
  let version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 0

  while (version < CURRENT_SCHEMA_VERSION) {
    const step = JSON_MIGRATIONS[version]
    if (!step) {
      throw new Error(`No migration registered from schemaVersion ${version}`)
    }
    doc = step(doc)
    version += 1
  }

  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Document schemaVersion ${version} is newer than supported ${CURRENT_SCHEMA_VERSION}`,
    )
  }
  return doc
}
