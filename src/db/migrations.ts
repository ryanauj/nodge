/**
 * SQLite schema migrations, gated on `PRAGMA user_version` (spec §6.5).
 *
 * On every DB open the runner applies, in order, each migration whose number is
 * greater than the stored `user_version`, then stamps the new version. v1 is the
 * full schema, generated from the single model definition — so the migration
 * runner and the DDL can never describe different tables.
 */

import { createTableSql, schemaDdl } from '../model/ddl'
import { oplogTable } from '../model/schema'
import type { AsyncSqlite } from './sqlite'

export interface SqliteMigration {
  readonly version: number
  readonly up: (db: AsyncSqlite) => Promise<void>
}

/** The ordered migration set. Append new versions; never edit shipped ones. */
export const SQLITE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    up: async (db) => {
      for (const stmt of schemaDdl()) await db.exec(stmt)
    },
  },
  {
    // v2 (spec §8.3): nodes/entities/prototypes can reference a StyleProfile.
    // Existing OPFS databases predate the column, so add it nullably — old rows
    // read back `styleProfileId: null` and keep rendering exactly as before.
    //
    // The add is guarded: `schemaDdl()` (run by v1) always reflects the *current*
    // model, so a brand-new database already has the column at v1. We only ALTER
    // when it is genuinely absent (a real legacy v1 DB), which keeps the runner
    // safe for both fresh and migrated databases.
    version: 2,
    up: async (db) => {
      for (const tableName of ['entity', 'node', 'prototype']) {
        await addColumnIfMissing(db, tableName, 'style_profile_id', 'TEXT')
      }
    },
  },
  {
    // v3 (spec §6.2 "Optional, Phase 6", §6.6): the append-only sync oplog. It is
    // local journal / sync plumbing — NOT part of the portable document — so it
    // lives outside ALL_TABLES and is created by this dedicated migration. The
    // `CREATE TABLE IF NOT EXISTS` is idempotent for both fresh and legacy DBs;
    // an old OPFS database that predates the oplog simply gains an empty table.
    version: 3,
    up: async (db) => {
      await db.exec(createTableSql(oplogTable))
    },
  },
]

/** ALTER TABLE … ADD COLUMN only when the column is not already present. */
async function addColumnIfMissing(
  db: AsyncSqlite,
  tableName: string,
  columnName: string,
  columnType: string,
): Promise<void> {
  const info = await db.all(`PRAGMA table_info(${tableName})`)
  const exists = info.some((row) => row.name === columnName)
  if (!exists) {
    await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`)
  }
}

export const LATEST_SQLITE_VERSION = SQLITE_MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  0,
)

async function getUserVersion(db: AsyncSqlite): Promise<number> {
  const row = await db.get('PRAGMA user_version')
  const value = row ? Object.values(row)[0] : 0
  return typeof value === 'number' ? value : Number(value ?? 0)
}

/** Bring a database up to the latest schema version. Idempotent. */
export async function runSqliteMigrations(db: AsyncSqlite): Promise<number> {
  let current = await getUserVersion(db)
  for (const migration of [...SQLITE_MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (migration.version > current) {
      await migration.up(db)
      // PRAGMA does not accept bound params; the value is an integer we control.
      await db.exec(`PRAGMA user_version = ${migration.version}`)
      current = migration.version
    }
  }
  return current
}
