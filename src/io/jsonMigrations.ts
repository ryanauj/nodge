/**
 * JSON document migrations, keyed on `schemaVersion` (spec §6.5).
 *
 * `importJson` runs this chain *before* validation so older `.nodge.json` files
 * upgrade cleanly to the current shape. Each step transforms a document one
 * version forward; the runner applies steps until the document reaches
 * {@link CURRENT_SCHEMA_VERSION}.
 *
 * The v3 model refactor (Diagram/Layout, dropped StyleProfiles) is a **clean
 * break** (§D11): no migration is written from the pre-v3 shape, so documents
 * authored before v3 have no registered step and are rejected — first here (no
 * migration registered) or, if hand-bumped, by `validateDocument`.
 */

import { CURRENT_SCHEMA_VERSION } from '../model/document'

/** A migration step: transforms a raw doc from `version` to `version + 1`. */
export type JsonMigration = (doc: Record<string, unknown>) => Record<string, unknown>

/**
 * Steps keyed by the version they upgrade *from*. There are no pre-v3 steps
 * (clean break, §D11): pre-v3 documents are intentionally not upgradeable.
 */
export const JSON_MIGRATIONS: Readonly<Record<number, JsonMigration>> = {}

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
