/** Gateway surface + a convenience factory for the in-process Local gateway. */
import { createMemorySqlite } from '../db/wasm'
import { LocalGateway, type GatewayDeps } from './LocalGateway'

export * from './types'
export { LocalGateway, type GatewayDeps } from './LocalGateway'

/**
 * Create a LocalGateway over a fresh in-memory SQLite database. This is the
 * engine used in tests and as the transient fallback; the OPFS-persisted
 * variant lives behind the Worker client (see ../db/workerClient).
 */
export async function createMemoryGateway(deps?: GatewayDeps): Promise<LocalGateway> {
  const db = await createMemorySqlite()
  return LocalGateway.open(db, deps)
}
