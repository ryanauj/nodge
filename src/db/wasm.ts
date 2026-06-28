/**
 * In-process WASM SQLite engine.
 *
 * Wraps the synchronous `@sqlite.org/sqlite-wasm` oo1 API behind the async
 * {@link AsyncSqlite} contract. This implementation runs anywhere WASM runs —
 * Node (so Vitest exercises the *real* engine) and the browser main thread or
 * a Worker. The module is initialized lazily and memoized so first paint is
 * never blocked by the ~1 MB WASM download (spec §11 bundle note).
 */

import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { AsyncSqlite, Row, SqlValue } from './sqlite'

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>
type OoDb = InstanceType<Sqlite3['oo1']['DB']>

let modulePromise: Promise<Sqlite3> | undefined

/** Lazily load and memoize the WASM module. */
export async function loadSqliteModule(): Promise<Sqlite3> {
  modulePromise ??= sqlite3InitModule()
  return modulePromise
}

function wrap(sqlite3: Sqlite3, db: OoDb): AsyncSqlite {
  const bind = (params?: readonly SqlValue[]) =>
    params && params.length ? (params as SqlValue[]) : undefined
  return {
    async exec(sql, params) {
      db.exec({ sql, bind: bind(params) })
    },
    async all(sql, params) {
      return db.selectObjects(sql, bind(params)) as Row[]
    },
    async get(sql, params) {
      return db.selectObject(sql, bind(params)) as Row | undefined
    },
    async exportBytes() {
      return sqlite3.capi.sqlite3_js_db_export(db)
    },
    async close() {
      db.close()
    },
  }
}

/**
 * Create a transient, in-memory database. Used by tests and as the engine the
 * Worker hosts when OPFS is unavailable.
 */
export async function createMemorySqlite(): Promise<AsyncSqlite> {
  const sqlite3 = await loadSqliteModule()
  const db = new sqlite3.oo1.DB(':memory:', 'c')
  return wrap(sqlite3, db)
}

/**
 * Load a database from previously exported `.sqlite` bytes into a fresh
 * in-memory database (the `.sqlite` import path).
 */
export async function createMemorySqliteFromBytes(bytes: Uint8Array): Promise<AsyncSqlite> {
  const sqlite3 = await loadSqliteModule()
  const p = sqlite3.wasm.allocFromTypedArray(bytes)
  const db = new sqlite3.oo1.DB()
  const rc = sqlite3.capi.sqlite3_deserialize(
    db.pointer!,
    'main',
    p,
    bytes.length,
    bytes.length,
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
  )
  db.checkRc(rc)
  return wrap(sqlite3, db)
}
