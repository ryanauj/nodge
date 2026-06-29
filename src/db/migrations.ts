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
  {
    // v4 (design §5, D11 clean break): the diagram-model refactor. Drops
    // StyleProfile, renames Board→Diagram / View→Layout, moves styling onto the
    // node/edge rows, and rebuilds node_position's PK. It must run cleanly and be
    // idempotent for BOTH starting states a local OPFS DB can be in:
    //
    //   (a) FRESH: v1's `schemaDdl()` already created the NEW model (diagram,
    //       layout, node.style, no style_profile table), then v2 spuriously
    //       re-added `style_profile_id` columns. Here every RENAME is a no-op
    //       (the new names already exist) — the guards skip them — and the DROPs
    //       do the real work (removing the v2-re-added `style_profile_id`).
    //   (b) LEGACY pre-refactor: old `board`/`view` tables, `style_override`
    //       columns, a `style_profile` table, and old FK column names. Here the
    //       renames + drops both fire.
    //
    // Every step is guarded by table-/column-presence checks so re-running the
    // whole set is a no-op.
    version: 4,
    up: async (db) => {
      // 1. Drop the StyleProfile table outright (§D5 — removed entirely).
      await db.exec('DROP TABLE IF EXISTS style_profile')

      // 2. Bring a LEGACY DB's table names forward. No-op on a fresh DB where the
      //    new tables already exist (guarded so the rename never errors).
      await renameTableIfNeeded(db, 'board', 'diagram')
      await renameTableIfNeeded(db, 'view', 'layout')

      // 3. Rename legacy FK / style columns to their new names. Each is guarded by
      //    column presence, so a fresh DB (already on the new names) skips them.
      await renameColumnIfNeeded(db, 'node', 'board_id', 'diagram_id')
      await renameColumnIfNeeded(db, 'edge', 'board_id', 'diagram_id')
      // The legacy `view.boardId` rode along when `view`→`layout` was renamed.
      await renameColumnIfNeeded(db, 'layout', 'board_id', 'diagram_id')
      await renameColumnIfNeeded(db, 'node_position', 'view_id', 'layout_id')
      await renameColumnIfNeeded(db, 'entity', 'prototype_id', 'node_prototype_id')
      await renameColumnIfNeeded(db, 'relationship', 'prototype_id', 'edge_prototype_id')
      await renameColumnIfNeeded(db, 'node', 'style_override', 'style')
      await renameColumnIfNeeded(db, 'edge', 'style_override', 'style')

      // 4. The new `layout` carries `algorithm` (default 'manual'); a legacy
      //    `view`→`layout` has no such column. Add it where missing.
      await addColumnIfMissing(db, 'layout', 'algorithm', "TEXT NOT NULL DEFAULT 'manual'")

      // 5. Drop columns the new model removed (§3 "Deleted"). On a fresh DB the
      //    `style_profile_id` columns were spuriously re-added by v2 — this is
      //    where they actually go away. The rest only exist on a legacy DB.
      await dropColumnIfPresent(db, 'entity', 'style_profile_id')
      await dropColumnIfPresent(db, 'entity', 'style_override')
      await dropColumnIfPresent(db, 'node', 'style_profile_id')
      await dropColumnIfPresent(db, 'prototype', 'style_profile_id')
      await dropColumnIfPresent(db, 'relationship', 'style_override')
      await dropColumnIfPresent(db, 'layout', 'palette_id')
      await dropColumnIfPresent(db, 'layout', 'filter')

      // 6. Rebuild node_position's primary key to ['layout_id','node_id'] if a
      //    legacy DB still keys it on the old (view_id,node_id). SQLite can't ALTER
      //    a PK in place, so create-new / copy / drop / rename.
      await rebuildNodePositionPkIfNeeded(db)
    },
  },
]

/** True when a table exists in the database. */
async function tableExists(db: AsyncSqlite, tableName: string): Promise<boolean> {
  const row = await db.get(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
    [tableName],
  )
  return row !== undefined
}

/** True when `tableName` exists and has a column named `columnName`. */
async function columnExists(
  db: AsyncSqlite,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  if (!(await tableExists(db, tableName))) return false
  const info = await db.all(`PRAGMA table_info(${tableName})`)
  return info.some((row) => row.name === columnName)
}

/** ALTER TABLE … ADD COLUMN only when the column is not already present. */
async function addColumnIfMissing(
  db: AsyncSqlite,
  tableName: string,
  columnName: string,
  columnType: string,
): Promise<void> {
  if (!(await tableExists(db, tableName))) return
  if (!(await columnExists(db, tableName, columnName))) {
    await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`)
  }
}

/**
 * ALTER TABLE … DROP COLUMN only when the column is present (mirror of
 * {@link addColumnIfMissing}). Relies on SQLite ≥3.35 `DROP COLUMN`.
 */
async function dropColumnIfPresent(
  db: AsyncSqlite,
  tableName: string,
  columnName: string,
): Promise<void> {
  if (await columnExists(db, tableName, columnName)) {
    await db.exec(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`)
  }
}

/**
 * ALTER TABLE … RENAME TO only when the source table exists and the destination
 * does not — so a fresh DB (already on the new name) is left untouched and a
 * re-run never errors.
 */
async function renameTableIfNeeded(
  db: AsyncSqlite,
  from: string,
  to: string,
): Promise<void> {
  if ((await tableExists(db, from)) && !(await tableExists(db, to))) {
    await db.exec(`ALTER TABLE ${from} RENAME TO ${to}`)
  }
}

/**
 * ALTER TABLE … RENAME COLUMN only when the table has the old column and not the
 * new one. SQLite rewrites references (incl. PK definitions) to the new name.
 */
async function renameColumnIfNeeded(
  db: AsyncSqlite,
  tableName: string,
  from: string,
  to: string,
): Promise<void> {
  if ((await columnExists(db, tableName, from)) && !(await columnExists(db, tableName, to))) {
    await db.exec(`ALTER TABLE ${tableName} RENAME COLUMN ${from} TO ${to}`)
  }
}

/**
 * Ensure `node_position`'s primary key is exactly (`layout_id`, `node_id`).
 * SQLite cannot ALTER a primary key in place, so when a legacy table is still
 * keyed otherwise we create the correctly-keyed table, copy rows, drop the old
 * one and rename. A no-op once the PK already matches (so re-runs are safe).
 */
async function rebuildNodePositionPkIfNeeded(db: AsyncSqlite): Promise<void> {
  if (!(await tableExists(db, 'node_position'))) return
  const info = await db.all('PRAGMA table_info(node_position)')
  const pkCols = info
    .filter((row) => Number(row.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((row) => String(row.name))
  const desired = ['layout_id', 'node_id']
  const alreadyCorrect = pkCols.length === desired.length && desired.every((c, i) => pkCols[i] === c)
  if (alreadyCorrect) return
  // Only rebuild when the columns we'd key on actually exist.
  if (!(await columnExists(db, 'node_position', 'layout_id'))) return
  if (!(await columnExists(db, 'node_position', 'node_id'))) return

  await db.exec(
    `CREATE TABLE node_position__new (
  layout_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  PRIMARY KEY (layout_id, node_id)
)`,
  )
  await db.exec(
    'INSERT INTO node_position__new (layout_id, node_id, x, y) SELECT layout_id, node_id, x, y FROM node_position',
  )
  await db.exec('DROP TABLE node_position')
  await db.exec('ALTER TABLE node_position__new RENAME TO node_position')
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
