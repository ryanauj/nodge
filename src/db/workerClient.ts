/**
 * Main-thread client for the SQLite Web Worker. Presents the {@link AsyncSqlite}
 * contract by marshaling calls over `postMessage` with id-correlated replies, so
 * the gateway is identical whether it talks to the in-process engine or the
 * OPFS-backed worker.
 */

import type { AsyncSqlite, Row } from './sqlite'
import type { WorkerRequest, WorkerResponse } from './worker'

type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void }

/** Omit `id` from each member of the request union (distributive, preserves the union). */
type RequestBody = WorkerRequest extends infer T
  ? T extends { id: number }
    ? Omit<T, 'id'>
    : never
  : never

export interface WorkerSqlite extends AsyncSqlite {
  /** Whether the worker persists to OPFS (false → transient in-memory fallback). */
  readonly persistent: boolean
}

export async function createWorkerSqlite(filename = 'nodge.sqlite'): Promise<WorkerSqlite> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  const pending = new Map<number, Pending>()
  let nextId = 1

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const { id } = event.data
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    if (event.data.ok) entry.resolve(event.data.result)
    else entry.reject(new Error(event.data.error))
  }

  function call<T>(req: RequestBody): Promise<T> {
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      worker.postMessage({ ...req, id } as WorkerRequest)
    })
  }

  const opened = await call<{ persistent: boolean }>({ method: 'open', filename })

  return {
    persistent: opened.persistent,
    async exec(sql, params) {
      await call<null>({ method: 'exec', sql, params: params ? [...params] : undefined })
    },
    async all(sql, params) {
      return call<Row[]>({ method: 'all', sql, params: params ? [...params] : undefined })
    },
    async get(sql, params) {
      return call<Row | undefined>({ method: 'get', sql, params: params ? [...params] : undefined })
    },
    async exportBytes() {
      return call<Uint8Array>({ method: 'export' })
    },
    async close() {
      await call<null>({ method: 'close' })
      worker.terminate()
    },
  } satisfies WorkerSqlite
}
