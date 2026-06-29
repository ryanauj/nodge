import { describe, it, expect } from 'vitest'
import { createMemorySqlite } from './wasm'
import { Repository } from './repository'
import { LATEST_SQLITE_VERSION, runSqliteMigrations } from './migrations'
import { graphTable, entityTable } from '../model/schema'
import { ALL_TABLES } from '../model/schema'

async function tableNames(db: Awaited<ReturnType<typeof createMemorySqlite>>): Promise<string[]> {
  const rows = await db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  return rows.map((t) => String(t.name))
}

async function columnNames(
  db: Awaited<ReturnType<typeof createMemorySqlite>>,
  table: string,
): Promise<string[]> {
  const rows = await db.all(`PRAGMA table_info(${table})`)
  return rows.map((r) => String(r.name))
}

async function pkColumns(
  db: Awaited<ReturnType<typeof createMemorySqlite>>,
  table: string,
): Promise<string[]> {
  const rows = await db.all(`PRAGMA table_info(${table})`)
  return rows
    .filter((r) => Number(r.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((r) => String(r.name))
}

describe('SQLite migration runner', () => {
  it('creates every table and stamps user_version', async () => {
    const db = await createMemorySqlite()
    const version = await runSqliteMigrations(db)
    expect(version).toBe(LATEST_SQLITE_VERSION)

    const names = await tableNames(db)
    for (const def of ALL_TABLES) expect(names).toContain(def.name)

    const pragma = await db.get('PRAGMA user_version')
    expect(Object.values(pragma!)[0]).toBe(LATEST_SQLITE_VERSION)
  })

  it('is idempotent', async () => {
    const db = await createMemorySqlite()
    await runSqliteMigrations(db)
    await expect(runSqliteMigrations(db)).resolves.toBe(LATEST_SQLITE_VERSION)
  })

  it('a fresh DB ends at v4 with the new diagram/layout shape', async () => {
    const db = await createMemorySqlite()
    await runSqliteMigrations(db)

    expect(LATEST_SQLITE_VERSION).toBe(4)
    expect(Object.values((await db.get('PRAGMA user_version'))!)[0]).toBe(4)

    const names = await tableNames(db)
    // Renamed tables present, StyleProfile gone.
    expect(names).toContain('diagram')
    expect(names).toContain('layout')
    expect(names).not.toContain('board')
    expect(names).not.toContain('view')
    expect(names).not.toContain('style_profile')

    // Styling lives on the node/edge rows; the removed columns are gone.
    expect(await columnNames(db, 'node')).toContain('style')
    expect(await columnNames(db, 'edge')).toContain('style')
    expect(await columnNames(db, 'node')).not.toContain('style_override')
    expect(await columnNames(db, 'edge')).not.toContain('style_override')

    // The v2-re-added style_profile_id columns are dropped by v4.
    for (const t of ['entity', 'node', 'prototype']) {
      expect(await columnNames(db, t)).not.toContain('style_profile_id')
    }

    // New FK column names and layout.algorithm.
    expect(await columnNames(db, 'entity')).toContain('node_prototype_id')
    expect(await columnNames(db, 'relationship')).toContain('edge_prototype_id')
    expect(await columnNames(db, 'node')).toContain('diagram_id')
    expect(await columnNames(db, 'edge')).toContain('diagram_id')
    expect(await columnNames(db, 'layout')).toContain('diagram_id')
    expect(await columnNames(db, 'layout')).toContain('algorithm')
    expect(await columnNames(db, 'node_position')).toContain('layout_id')
    expect(await pkColumns(db, 'node_position')).toEqual(['layout_id', 'node_id'])
  })

  it('brings a legacy pre-refactor DB forward to the new shape', async () => {
    const db = await createMemorySqlite()
    // Hand-build a slice of the pre-refactor schema (old table/column names,
    // style_override columns, a style_profile table) and stamp it as legacy v1.
    await db.exec('CREATE TABLE style_profile (id TEXT NOT NULL, PRIMARY KEY (id))')
    await db.exec(
      `CREATE TABLE entity (
        id TEXT NOT NULL, graph_id TEXT NOT NULL, prototype_id TEXT,
        style_profile_id TEXT, style_override TEXT NOT NULL, PRIMARY KEY (id)
      )`,
    )
    await db.exec(
      `CREATE TABLE relationship (
        id TEXT NOT NULL, graph_id TEXT NOT NULL, prototype_id TEXT,
        style_override TEXT NOT NULL, PRIMARY KEY (id)
      )`,
    )
    await db.exec(
      `CREATE TABLE prototype (id TEXT NOT NULL, style_profile_id TEXT, PRIMARY KEY (id))`,
    )
    await db.exec(`CREATE TABLE board (id TEXT NOT NULL, PRIMARY KEY (id))`)
    await db.exec(
      `CREATE TABLE node (
        id TEXT NOT NULL, board_id TEXT NOT NULL, style_profile_id TEXT,
        style_override TEXT NOT NULL, PRIMARY KEY (id)
      )`,
    )
    await db.exec(
      `CREATE TABLE edge (
        id TEXT NOT NULL, board_id TEXT NOT NULL, style_override TEXT NOT NULL,
        PRIMARY KEY (id)
      )`,
    )
    await db.exec(
      `CREATE TABLE view (
        id TEXT NOT NULL, board_id TEXT NOT NULL, palette_id TEXT, filter TEXT,
        PRIMARY KEY (id)
      )`,
    )
    await db.exec(
      `CREATE TABLE node_position (
        view_id TEXT NOT NULL, node_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
        PRIMARY KEY (view_id, node_id)
      )`,
    )
    // A row to prove the PK rebuild preserves data.
    await db.exec(
      "INSERT INTO node_position (view_id, node_id, x, y) VALUES ('v1', 'n1', 1.5, 2.5)",
    )
    await db.exec('PRAGMA user_version = 1')

    const version = await runSqliteMigrations(db)
    expect(version).toBe(LATEST_SQLITE_VERSION)

    const names = await tableNames(db)
    expect(names).toContain('diagram')
    expect(names).toContain('layout')
    expect(names).not.toContain('board')
    expect(names).not.toContain('view')
    expect(names).not.toContain('style_profile')

    expect(await columnNames(db, 'entity')).toContain('node_prototype_id')
    expect(await columnNames(db, 'entity')).not.toContain('prototype_id')
    expect(await columnNames(db, 'entity')).not.toContain('style_profile_id')
    expect(await columnNames(db, 'entity')).not.toContain('style_override')
    expect(await columnNames(db, 'relationship')).toContain('edge_prototype_id')
    expect(await columnNames(db, 'relationship')).not.toContain('style_override')
    expect(await columnNames(db, 'prototype')).not.toContain('style_profile_id')

    expect(await columnNames(db, 'node')).toContain('diagram_id')
    expect(await columnNames(db, 'node')).toContain('style')
    expect(await columnNames(db, 'node')).not.toContain('style_override')
    expect(await columnNames(db, 'node')).not.toContain('style_profile_id')
    expect(await columnNames(db, 'edge')).toContain('diagram_id')
    expect(await columnNames(db, 'edge')).toContain('style')

    expect(await columnNames(db, 'layout')).toContain('diagram_id')
    expect(await columnNames(db, 'layout')).toContain('algorithm')
    expect(await columnNames(db, 'layout')).not.toContain('palette_id')
    expect(await columnNames(db, 'layout')).not.toContain('filter')

    expect(await columnNames(db, 'node_position')).toContain('layout_id')
    expect(await columnNames(db, 'node_position')).not.toContain('view_id')
    expect(await pkColumns(db, 'node_position')).toEqual(['layout_id', 'node_id'])
    const pos = await db.get('SELECT layout_id, node_id, x, y FROM node_position')
    expect(pos).toMatchObject({ layout_id: 'v1', node_id: 'n1', x: 1.5, y: 2.5 })
  })

  it('runs the whole migration set twice idempotently from a legacy DB', async () => {
    const db = await createMemorySqlite()
    await db.exec('CREATE TABLE board (id TEXT NOT NULL, PRIMARY KEY (id))')
    await db.exec(
      `CREATE TABLE view (id TEXT NOT NULL, board_id TEXT NOT NULL, palette_id TEXT, PRIMARY KEY (id))`,
    )
    await db.exec('CREATE TABLE style_profile (id TEXT NOT NULL, PRIMARY KEY (id))')
    await db.exec('PRAGMA user_version = 1')

    await runSqliteMigrations(db)
    const firstNames = await tableNames(db)
    // Second pass must not throw and must leave the version + shape unchanged.
    await expect(runSqliteMigrations(db)).resolves.toBe(LATEST_SQLITE_VERSION)
    expect(await tableNames(db)).toEqual(firstNames)
    expect(Object.values((await db.get('PRAGMA user_version'))!)[0]).toBe(LATEST_SQLITE_VERSION)
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
      nodePrototypeId: null,
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
      nodePrototypeId: null,
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
