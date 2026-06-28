/**
 * The client-side sync engine (spec §6.3, §6.6).
 *
 * Drives push/pull against a {@link SyncTransport} on the existing identity model
 * (client UUIDs + per-row version + updatedAt). It reads the LOCAL oplog (the
 * journal the command bus appends to) to know what changed locally, and applies
 * remote changes straight into the local domain tables under the same LWW order.
 *
 * Two cursors are kept (in-memory; a real client would persist them):
 *   - `pushCursor`     — the highest local oplog `seq` already pushed.
 *   - `pullCheckpoint` — the server cursor up to which remote changes are applied.
 *
 * Because identity is global from birth, reconciliation never remaps ids: a
 * pulled row carries the same UUID the origin device created, so applying it is a
 * plain upsert/delete by primary key. No id collisions, no remap tables.
 *
 * Applied remote changes are materialized via the {@link Repository} directly
 * (NOT through the command bus), so they are not re-journalled and re-pushed —
 * the server is the authority for what it already holds.
 */

import { Repository } from '../db/repository'
import type { AsyncSqlite } from '../db/sqlite'
import { ALL_TABLES, oplogTable, type OplogEntry } from '../model/schema'
import type { TableDef } from '../model/table'
import { type Change } from './lww'
import type { SyncTransport } from './transport'

const tableByName = new Map<string, TableDef>(ALL_TABLES.map((t) => [t.name, t]))

export interface SyncResult {
  pushed: number
  pulled: number
}

export class SyncEngine {
  private pushCursor = 0
  private pullCheckpoint = 0
  private readonly repo: Repository

  constructor(
    db: AsyncSqlite,
    private readonly transport: SyncTransport,
  ) {
    this.repo = new Repository(db)
  }

  /** Push local changes, then pull + apply remote ones. Returns the counts. */
  async sync(): Promise<SyncResult> {
    const pushed = await this.push()
    const pulled = await this.pull()
    return { pushed, pulled }
  }

  /** Send every local oplog entry past the push cursor; advance the cursor. */
  async push(): Promise<number> {
    const pending = await this.pendingChanges()
    if (pending.entries.length === 0) return 0
    await this.transport.push({ changes: pending.entries.map(toChange) })
    this.pushCursor = pending.maxSeq
    return pending.entries.length
  }

  /** Pull remote changes since the checkpoint and apply each locally. */
  async pull(): Promise<number> {
    const res = await this.transport.pull(this.pullCheckpoint)
    for (const change of res.changes) await this.applyRemote(change)
    this.pullCheckpoint = res.checkpoint
    return res.changes.length
  }

  private async pendingChanges(): Promise<{ entries: OplogEntry[]; maxSeq: number }> {
    const all = await this.repo.list(oplogTable)
    const entries = all.filter((e) => e.seq > this.pushCursor)
    const maxSeq = entries.reduce((m, e) => Math.max(m, e.seq), this.pushCursor)
    return { entries, maxSeq }
  }

  /** Materialize a remote winner into the local domain tables (no re-journal). */
  private async applyRemote(change: Change): Promise<void> {
    const def = tableByName.get(change.tableName)
    if (!def) return
    if (change.op === 'delete') {
      await this.repo.deleteByKey(def, { id: change.rowId })
    } else if (change.snapshot) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.repo.upsert(def, change.snapshot as any)
    }
  }
}

function toChange(entry: OplogEntry): Change {
  const { tableName, rowId, op, version, updatedAt, snapshot } = entry
  return { tableName, rowId, op, version, updatedAt, snapshot }
}
