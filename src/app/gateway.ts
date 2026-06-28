/**
 * Lazy, code-split access to the LocalGateway for the running app.
 *
 * The SQLite WASM engine (~1 MB) and the gateway are dynamically imported only
 * on first use, so they never block first paint (spec §11). In the browser the
 * OPFS-backed Worker is used; if OPFS/Workers are unavailable we fall back to a
 * transient in-memory database so the app still runs.
 */

import type { LocalGateway } from '../gateway/LocalGateway'

let instance: Promise<LocalGateway> | undefined

export function getGateway(): Promise<LocalGateway> {
  instance ??= initGateway()
  return instance
}

async function initGateway(): Promise<LocalGateway> {
  const { LocalGateway } = await import('../gateway/LocalGateway')
  try {
    const { createWorkerSqlite } = await import('../db/workerClient')
    const db = await createWorkerSqlite()
    return await LocalGateway.open(db)
  } catch {
    const { createMemorySqlite } = await import('../db/wasm')
    return LocalGateway.open(await createMemorySqlite())
  }
}
