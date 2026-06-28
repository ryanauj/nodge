import { describe, it, expect } from 'vitest'
import { createMemorySqlite } from './wasm'
import { Repository } from './repository'
import { LATEST_SQLITE_VERSION, runSqliteMigrations } from './migrations'
import { graphTable, entityTable } from '../model/schema'
import { ALL_TABLES } from '../model/schema'

describe('SQLite migration runner', () => {
  it('creates every table and stamps user_version', async () => {
    const db = await createMemorySqlite()
    const version = await runSqliteMigrations(db)
    expect(version).toBe(LATEST_SQLITE_VERSION)

    const tables = await db.all(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    const names = tables.map((t) => t.name)
    for (const def of ALL_TABLES) expect(names).toContain(def.name)

    const pragma = await db.get('PRAGMA user_version')
    expect(Object.values(pragma!)[0]).toBe(LATEST_SQLITE_VERSION)
  })

  it('is idempotent', async () => {
    const db = await createMemorySqlite()
    await runSqliteMigrations(db)
    await expect(runSqliteMigrations(db)).resolves.toBe(LATEST_SQLITE_VERSION)
  })
})

describe('Repository', () => {
  it('inserts, reads, lists, updates and deletes rows', async () => {
    const db = await createMemorySqlite()
    await runSqliteMigrations(db)
    const repo = new Repository(db)

    const now = '2026-01-01T00:00:00.000Z'
    await repo.insert(graphTable, {
      id: 'g1',
      name: 'G1',
      description: '',
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    })
    await repo.insert(entityTable, {
      id: 'e2',
      graphId: 'g1',
      name: 'Second',
      prototypeId: null,
      styleProfileId: null,
      styleOverride: {},
      links: [],
      metadata: {},
      createdAt: now,
      updatedAt: now,
      version: 1,
    })
    await repo.insert(entityTable, {
      id: 'e1',
      graphId: 'g1',
      name: 'First',
      prototypeId: null,
      styleProfileId: null,
      styleOverride: {},
      links: [],
      metadata: {},
      createdAt: now,
      updatedAt: now,
      version: 1,
    })

    const fetched = await repo.getById(graphTable, 'g1')
    expect(fetched?.name).toBe('G1')

    // list orders by primary key — deterministic for round-trips.
    const entities = await repo.list(entityTable, { graphId: 'g1' })
    expect(entities.map((e) => e.id)).toEqual(['e1', 'e2'])

    await repo.update(entityTable, { ...entities[0], name: 'Renamed', version: 2 })
    expect((await repo.getById(entityTable, 'e1'))?.name).toBe('Renamed')

    await repo.deleteById(entityTable, 'e1')
    expect(await repo.getById(entityTable, 'e1')).toBeUndefined()
    expect(await repo.list(entityTable, { graphId: 'g1' })).toHaveLength(1)
  })
})
