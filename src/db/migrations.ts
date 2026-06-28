/**
 * SQLite schema migrations, gated on `PRAGMA user_version` (spec §6.5).
 *
 * On every DB open the runner applies, in order, each migration whose number is
 * greater than the stored `user_version`, then stamps the new version. v1 is the
 * full schema, generated from the single model definition — so the migration
 * runner and the DDL can never describe different tables.
 */

import { schemaDdl } from '../model/ddl'
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
]

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
