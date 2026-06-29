/**
 * Phase 6 — the oplog table is created by a migration and stays OUT of the
 * portable document (spec §6.2 "Optional, Phase 6"). It is local sync plumbing.
 */
import { describe, it, expect } from 'vitest'
import { createMemorySqlite } from './wasm'
import { LATEST_SQLITE_VERSION, runSqliteMigrations } from './migrations'
import { ALL_TABLES, oplogTable } from '../model/schema'

describe('Phase 6 — oplog schema', () => {
  it('migration creates the oplog table and bumps user_version to >= 3', async () => {
    const db = await createMemorySqlite()
    const version = await runSqliteMigrations(db)
    expect(version).toBe(LATEST_SQLITE_VERSION)
    expect(LATEST_SQLITE_VERSION).toBeGreaterThanOrEqual(3)

    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'")
    expect(tables.map((t) => t.name)).toContain('oplog')
  })

  it('the oplog is NOT part of the portable document tables (ALL_TABLES)', () => {
    expect(ALL_TABLES.map((t) => t.name)).not.toContain('oplog')
    expect(oplogTable.name).toBe('oplog')
  })

  it('a legacy DB stamped at v2 gains the oplog table on open', async () => {
    const db = await createMemorySqlite()
    // Pretend an OPFS DB created before Phase 6 (no oplog) at user_version = 2.
    await db.exec('PRAGMA user_version = 2')
    const version = await runSqliteMigrations(db)
    expect(version).toBe(LATEST_SQLITE_VERSION)
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'")
    expect(tables.map((t) => t.name)).toContain('oplog')
    // v4 also lands on this path: no StyleProfile table survives.
    expect(tables.map((t) => t.name)).not.toContain('style_profile')
  })
})
