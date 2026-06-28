/**
 * The sync transport — the single TRUE network boundary (spec §6.6).
 *
 * A `SyncTransport` is everything that would, against a real backend, become an
 * HTTP round-trip: `pull` (GET changes since a checkpoint) and `push` (POST local
 * changes). Tests mock ONLY this boundary (an in-process {@link MockServer});
 * everything above it — the gateway, the command bus, SQLite — runs for real.
 *
 * The wire payloads are plain JSON ({@link Change} is the serializable oplog
 * entry minus its local `seq`), so flipping the {@link MockServer} for a real
 * `fetch('/api/sync/...')` implementation is a transport swap with no other code
 * change — exactly the "config change, not a rewrite" the spec promises.
 */

import type { Change } from './lww'

/** GET /api/sync/pull?since=<checkpoint> */
export interface PullResponse {
  /** Changes the server holds with a server cursor strictly greater than `since`. */
  changes: Change[]
  /** The puller's new checkpoint (the server's high-water cursor). */
  checkpoint: number
}

/** POST /api/sync/push */
export interface PushRequest {
  changes: Change[]
}

export interface PushResponse {
  /** How many pushed changes the server accepted as new LWW winners. */
  accepted: number
  /** The server's high-water cursor after applying the push. */
  checkpoint: number
}

export interface SyncTransport {
  pull(since: number): Promise<PullResponse>
  push(req: PushRequest): Promise<PushResponse>
}
