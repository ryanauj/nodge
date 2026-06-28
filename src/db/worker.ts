/// <reference lib="webworker" />
/**
 * SQLite Web Worker (spec §6.2).
 *
 * Hosts the SQLite engine off the main thread and persists to OPFS via the
 * synchronous SAH-pool VFS (which works in a Worker without COOP/COEP). If OPFS
 * is unavailable it transparently falls back to a transient in-memory database.
 * The worker is a dumb SQL executor; migrations and all domain logic run on the
 * main thread through the {@link AsyncSqlite} RPC defined in ./workerClient.
 */

import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { SqlValue } from './sqlite'

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>
type OoDb = InstanceType<Sqlite3['oo1']['DB']>

export type WorkerRequest =
  | { id: number; method: 'open'; filename?: string }
  | { id: number; method: 'exec'; sql: string; params?: SqlValue[] }
  | { id: number; method: 'all'; sql: string; params?: SqlValue[] }
  | { id: number; method: 'get'; sql: string; params?: SqlValue[] }
  | { id: number; method: 'export' }
  | { id: number; method: 'close' }

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }

let sqlite3: Sqlite3 | undefined
let db: OoDb | undefined
let persistent = false

async function open(filename: string): Promise<{ persistent: boolean }> {
  sqlite3 = await sqlite3InitModule()
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({})
    db = new pool.OpfsSAHPoolDb(`/${filename}`)
    persistent = true
  } catch {
    // OPFS not available (e.g. some browsers / contexts) — degrade gracefully.
    db = new sqlite3.oo1.DB(':memory:', 'c')
    persistent = false
  }
  return { persistent }
}

function requireDb(): OoDb {
  if (!db) throw new Error('Worker database is not open')
  return db
}

function bind(params?: SqlValue[]): SqlValue[] | undefined {
  return params && params.length ? params : undefined
}

async function handle(req: WorkerRequest): Promise<unknown> {
  switch (req.method) {
    case 'open':
      return open(req.filename ?? 'nodge.sqlite')
    case 'exec':
      requireDb().exec({ sql: req.sql, bind: bind(req.params) })
      return null
    case 'all':
      return requireDb().selectObjects(req.sql, bind(req.params))
    case 'get':
      return requireDb().selectObject(req.sql, bind(req.params)) ?? undefined
    case 'export':
      return sqlite3!.capi.sqlite3_js_db_export(requireDb())
    case 'close':
      requireDb().close()
      db = undefined
      return null
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data
  try {
    const result = await handle(req)
    const response: WorkerResponse = { id: req.id, ok: true, result }
    self.postMessage(response)
  } catch (error) {
    const response: WorkerResponse = {
      id: req.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(response)
  }
}
