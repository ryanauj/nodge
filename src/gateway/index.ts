/** Gateway surface + convenience factories for the in-process gateways. */
import { createMemorySqlite } from '../db/wasm'
import type { SyncTransport } from '../sync/transport'
import { LocalGateway, type GatewayDeps } from './LocalGateway'
import { HttpGateway } from './HttpGateway'

export * from './types'
export { buildClipboard, parseClipboard, serializeClipboard } from './clipboard'
export { LocalGateway, type GatewayDeps } from './LocalGateway'
export { HttpGateway } from './HttpGateway'

/**
 * Create a LocalGateway over a fresh in-memory SQLite database. This is the
 * engine used in tests and as the transient fallback; the OPFS-persisted
 * variant lives behind the Worker client (see ../db/workerClient).
 */
export async function createMemoryGateway(deps?: GatewayDeps): Promise<LocalGateway> {
  const db = await createMemorySqlite()
  return LocalGateway.open(db, deps)
}

/**
 * Create an HttpGateway over a fresh in-memory SQLite mirror + a sync transport
 * (the in-process {@link MockServer}, or later a real `fetch` backend). Used in
 * tests to simulate a device talking to the mock server through the SAME
 * {@link DataGateway} interface as {@link createMemoryGateway}.
 */
export async function createMemoryHttpGateway(
  transport: SyncTransport,
  deps?: GatewayDeps,
): Promise<HttpGateway> {
  const db = await createMemorySqlite()
  return HttpGateway.open(db, transport, deps)
}
