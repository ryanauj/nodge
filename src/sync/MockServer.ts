/**
 * In-process mock sync server (spec §6.6 — "a Service Worker that intercepts
 * fetch('/api/...') and serves from SQLite ... then flipping to a real one by
 * changing the base URL"). This is the in-process variant of that boundary: it
 * implements {@link SyncTransport} over a real, server-side SQLite store and a
 * server-side oplog. It is the only "network" in the tests; flipping it for a
 * real `fetch` backend is a transport swap, nothing above it changes.
 *
 * Reconciliation is last-write-wins by the documented total order in `./lww.ts`.
 * The server keeps, per row, the current winning {@link Change}; a pushed change
 * is accepted only if it `wins` over the current winner, and accepted changes are
 * re-journalled under a fresh, monotonic SERVER `seq` so pullers can checkpoint
 * against a single linear cursor. Accepted upserts/deletes are also applied to
 * the server's materialized domain tables, so the server can serve a full graph.
 */

import { Repository } from '../db/repository'
import { runSqliteMigrations } from '../db/migrations'
import { createMemorySqlite } from '../db/wasm'
import { ALL_TABLES, oplogTable } from '../model/schema'
import type { TableDef } from '../model/table'
import { reconcile, wins, rowKey, type Change } from './lww'
import type { PullResponse, PushRequest, PushResponse, SyncTransport } from './transport'

const tableByName = new Map<string, TableDef>(ALL_TABLES.map((t) => [t.name, t]))

export class MockServer implements SyncTransport {
  private seq = 0
  /** Current LWW winner per row key, for fast acceptance decisions. */
  private readonly current = new Map<string, Change>()
  /** The server log in cursor order: each accepted change with its server seq. */
  private readonly log: { seq: number; change: Change }[] = []

  private constructor(private readonly repo: Repository) {}

  /** Open a server over a fresh, migrated in-memory database. */
  static async open(): Promise<MockServer> {
    const db = await createMemorySqlite()
    await runSqliteMigrations(db)
    return new MockServer(new Repository(db))
  }

  /** The server's high-water cursor. */
  get checkpoint(): number {
    return this.seq
  }

  async pull(since: number): Promise<PullResponse> {
    const changes = this.log.filter((e) => e.seq > since).map((e) => e.change)
    return { changes, checkpoint: this.seq }
  }

  async push(req: PushRequest): Promise<PushResponse> {
    // Reconcile the incoming batch first (a single push may contain several edits
    // to one row); then apply each per-row winner under LWW against server state.
    let accepted = 0
    for (const change of reconcile(req.changes).values()) {
      if (await this.apply(change)) accepted++
    }
    return { accepted, checkpoint: this.seq }
  }

  /** Apply one change if it wins over the current server state. */
  private async apply(change: Change): Promise<boolean> {
    const key = rowKey(change)
    if (!wins(change, this.current.get(key))) return false
    this.current.set(key, change)
    this.seq += 1
    this.log.push({ seq: this.seq, change })
    await this.materialize(change)
    return true
  }

  /** Reflect a winning change into the server's domain tables + its oplog row. */
  private async materialize(change: Change): Promise<void> {
    const def = tableByName.get(change.tableName)
    if (def) {
      if (change.op === 'delete') {
        await this.repo.deleteByKey(def, { id: change.rowId })
      } else if (change.snapshot) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.repo.upsert(def, change.snapshot as any)
      }
    }
    await this.repo.insert(oplogTable, {
      seq: this.seq,
      tableName: change.tableName,
      rowId: change.rowId,
      op: change.op,
      version: change.version,
      updatedAt: change.updatedAt,
      snapshot: change.snapshot,
    })
  }

  /** Test/diagnostic helper: the server's materialized repository. */
  get repository(): Repository {
    return this.repo
  }
}
