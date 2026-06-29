import { describe, it, expect } from 'vitest'
import { migrateDocument } from './jsonMigrations'
import { CURRENT_SCHEMA_VERSION } from '../model/document'

describe('migrateDocument', () => {
  it('leaves a current-version document unchanged', () => {
    const doc = { schemaVersion: CURRENT_SCHEMA_VERSION, graph: {}, diagrams: [] }
    expect(migrateDocument(doc).schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('rejects a pre-v3 document (clean break, §D11 — no migration registered)', () => {
    // The v3 model refactor is a clean break: there is no migration from any
    // pre-v3 shape, so an older document has no registered step and is rejected.
    expect(() => migrateDocument({ schemaVersion: 0, graph: {} })).toThrow(
      /No migration registered/,
    )
    expect(() => migrateDocument({ schemaVersion: 2, graph: {} })).toThrow(
      /No migration registered/,
    )
  })

  it('throws on a document newer than supported', () => {
    expect(() => migrateDocument({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 })).toThrow(
      /newer than supported/,
    )
  })
})
