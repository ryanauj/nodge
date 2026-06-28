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

  it('v1 → v2 backfills styleProfileId: null on entities, prototypes and nodes (§8.3)', () => {
    const out = migrateDocument({
      schemaVersion: 1,
      graph: { id: 'g', name: 'G', description: '', schemaVersion: 1, createdAt: 't', updatedAt: 't', version: 1 },
      entities: [{ id: 'e', graphId: 'g', name: 'E', prototypeId: null, styleOverride: {}, links: [], metadata: {}, createdAt: 't', updatedAt: 't', version: 1 }],
      relationships: [],
      prototypes: [{ id: 'p', graphId: 'g', kind: 'node', name: 'P', shape: null, defaultLabel: '', style: {}, metadata: {}, linkScaffold: [], createdAt: 't', updatedAt: 't', version: 1 }],
      boards: [{ id: 'b', graphId: 'g', name: 'B', description: '', createdAt: 't', updatedAt: 't', version: 1, nodes: [{ id: 'n', boardId: 'b', entityId: 'e', label: 'N', styleOverride: {}, createdAt: 't', updatedAt: 't', version: 1 }], edges: [], views: [] }],
      palettes: [],
      styleProfiles: [],
    })
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect((out.entities as Record<string, unknown>[])[0].styleProfileId).toBeNull()
    expect((out.prototypes as Record<string, unknown>[])[0].styleProfileId).toBeNull()
    const board = (out.boards as Record<string, unknown>[])[0]
    expect((board.nodes as Record<string, unknown>[])[0].styleProfileId).toBeNull()
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
