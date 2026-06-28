/** Project import/export surface. */
import { type NodgeDocument, validateDocument } from '../model/document'
import { migrateDocument } from './jsonMigrations'

export * from './jsonMigrations'
export * from './loadDocument'

/**
 * Parse an arbitrary (possibly older) parsed JSON value into a current,
 * validated {@link NodgeDocument}: migrate the `schemaVersion` chain forward,
 * then validate the shape. Throws on anything malformed.
 */
export function readDocument(raw: unknown): NodgeDocument {
  return validateDocument(migrateDocument(raw))
}

/** Deterministically serialize a document to the `.nodge.json` text payload. */
export function serializeDocument(doc: NodgeDocument): string {
  return JSON.stringify(doc, null, 2)
}
