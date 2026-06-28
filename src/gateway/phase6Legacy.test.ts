/**
 * Phase 6 — backward compatibility (spec §12 acceptance). The oplog is additive
 * plumbing: the portable document shape (and CURRENT_SCHEMA_VERSION) is UNCHANGED,
 * and a pre-Phase-6 OPFS database (no oplog table, user_version = 2) still opens,
 * reads, writes, and round-trips after the migration adds the oplog.
 */
import { describe, it, expect } from 'vitest'
import { createMemoryGateway, type GatewayDeps } from './index'
import { LocalGateway } from './LocalGateway'
import { createMemorySqlite } from '../db/wasm'
import { schemaDdl } from '../model/ddl'
import { CURRENT_SCHEMA_VERSION } from '../model/document'
import { readDocument, serializeDocument } from '../io'

function deterministicDeps(): GatewayDeps {
  let n = 0
  let t = 0
  return {
    newId: () => `id-${String(++n).padStart(4, '0')}`,
    now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}.000Z`,
  }
}

describe('Phase 6 — backward compatibility', () => {
  it('the document schemaVersion is unchanged by Phase 6 (oplog is not in the doc)', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(2)
  })

  it('a legacy OPFS DB (v2, no oplog table) opens, gains the oplog, and still works', async () => {
    const db = await createMemorySqlite()
    // Build the v2 schema by hand (the current domain DDL, but NO oplog table),
    // seed a row, and stamp user_version = 2 — a real pre-Phase-6 database.
    for (const stmt of schemaDdl()) await db.exec(stmt)
    await db.exec(
      "INSERT INTO graph VALUES ('g1','Legacy','',2,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',1)",
    )
    await db.exec('PRAGMA user_version = 2')

    // Opening runs the v3 migration (CREATE oplog) + opens the sink.
    const gw = await LocalGateway.open(db, deterministicDeps())
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'")
    expect(tables.map((t) => t.name)).toContain('oplog')

    // The pre-existing row reads back intact, and new writes still journal fine.
    const graph = await gw.getGraph('g1')
    expect(graph.name).toBe('Legacy')
    const entity = await gw.createEntity('g1', { name: 'New' })
    expect(entity.id).toBe('id-0001')

    // It still exports a current-version, round-trippable document.
    const doc = await gw.exportJson('g1')
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    const round = readDocument(JSON.parse(serializeDocument(doc)))
    expect(round.entities.map((e) => e.name)).toContain('New')
  })

  it('a legacy .nodge.json still imports, round-trips and renders into a fresh (Phase-6) DB', async () => {
    // A document authored before Phase 6 — identical shape, no oplog anywhere.
    const legacyJson = {
      schemaVersion: 2,
      graph: {
        id: 'g',
        name: 'Old Project',
        description: '',
        schemaVersion: 2,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        version: 1,
      },
      entities: [
        {
          id: 'e1',
          graphId: 'g',
          name: 'Thing',
          prototypeId: null,
          styleProfileId: null,
          styleOverride: {},
          links: [],
          metadata: {},
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          version: 1,
        },
      ],
      relationships: [],
      prototypes: [],
      boards: [],
      palettes: [],
      styleProfiles: [],
    }

    const gw = await createMemoryGateway()
    const imported = await gw.importJson(readDocument(legacyJson))
    expect(imported.name).toBe('Old Project')
    const detail = await gw.getGraph(imported.id)
    expect(detail.entities.map((e) => e.name)).toEqual(['Thing'])

    // Round-trips out unchanged at the current version.
    const out = await gw.exportJson(imported.id)
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(out.entities[0].id).toBe('e1')
  })
})
