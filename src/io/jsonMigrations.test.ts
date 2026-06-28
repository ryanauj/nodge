import { describe, it, expect } from 'vitest'
import { migrateDocument } from './jsonMigrations'
import { CURRENT_SCHEMA_VERSION } from '../model/document'

describe('migrateDocument', () => {
  it('upgrades a v0 document to the current version', () => {
    const out = migrateDocument({
      schemaVersion: 0,
      graph: { id: 'g', name: 'G', createdAt: 't', updatedAt: 't', version: 1 },
    })
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect((out.graph as Record<string, unknown>).description).toBe('')
    expect(out.palettes).toEqual([])
    expect(out.styleProfiles).toEqual([])
  })

  it('leaves a current-version document unchanged', () => {
    const doc = { schemaVersion: CURRENT_SCHEMA_VERSION, graph: {}, boards: [] }
    expect(migrateDocument(doc).schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('throws on a document newer than supported', () => {
    expect(() => migrateDocument({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 })).toThrow(
      /newer than supported/,
    )
  })
})
