/**
 * The oplog sink (spec §6.3, §6.6) — the append-only journal tapped at the
 * {@link Mutator} write seam.
 *
 * Every domain write the {@link CommandBus} performs is also recorded here as a
 * single {@link OplogEntry}: an `upsert` (created/updated row, with its full
 * snapshot) or a `delete` (a tombstone carrying the row's id + a bumped version).
 * The entry's `version` + `updatedAt` are exactly what the sync layer reconciles
 * by (last-write-wins), and `seq` is the monotonic local cursor a puller
 * checkpoints against. This is the single place writes are journalled — no
 * domain call site changes (the spec's "additive oplog upgrade").
 */

import type { Repository } from '../db/repository'
import { oplogTable, type OplogEntry } from '../model/schema'
import type { RowOf, TableDef } from '../model/table'
import type { SqlValue } from '../db/sqlite'

/** The minimal identity every journalled domain row carries. */
interface VersionedRow {
  id: string
  version: number
  updatedAt: string
}

/**
 * Records domain writes into the oplog. The sink is given the already-typed
 * row (for upserts) or the prior row (for deletes); it derives the LWW fields.
 * `nextSeq` is the local monotonic cursor — strictly increasing across a DB.
 */
export class OplogSink {
  constructor(
    private readonly repo: Repository,
    private nextSeq: number,
  ) {}

  /** Open a sink whose cursor continues after the highest existing `seq`. */
  static async open(repo: Repository): Promise<OplogSink> {
    const row = await repo.maxSeq(oplogTable)
    return new OplogSink(repo, (row ?? 0) + 1)
  }

  private isVersioned(def: TableDef, row: Record<string, SqlValue> | RowOf<TableDef>): row is VersionedRow {
    // Only rows carrying id+version+updatedAt are journalled (every domain table
    // except node_position, which is keyed compositely and rides its node/view).
    const r = row as Record<string, unknown>
    return (
      def.primaryKey.length === 1 &&
      def.primaryKey[0] === 'id' &&
      typeof r.id === 'string' &&
      typeof r.version === 'number' &&
      typeof r.updatedAt === 'string'
    )
  }

  /** Journal an insert/put of a domain row as an `upsert` entry. */
  async recordUpsert(def: TableDef, row: RowOf<TableDef>): Promise<void> {
    if (!this.isVersioned(def, row)) return
    const r = row as unknown as VersionedRow
    await this.append({
      tableName: def.name,
      rowId: r.id,
      op: 'upsert',
      version: r.version,
      updatedAt: r.updatedAt,
      snapshot: { ...(row as unknown as Record<string, unknown>) },
    })
  }

  /**
   * Journal a delete as a `delete` tombstone. The tombstone's `version` is the
   * removed row's version + 1, so a delete strictly supersedes the last edit
   * under LWW and a stale row (lower version) cannot resurrect it.
   */
  async recordRemove(def: TableDef, before: RowOf<TableDef>, now: string): Promise<void> {
    if (!this.isVersioned(def, before)) return
    const r = before as unknown as VersionedRow
    await this.append({
      tableName: def.name,
      rowId: r.id,
      op: 'delete',
      version: r.version + 1,
      updatedAt: now,
      snapshot: null,
    })
  }

  private async append(entry: Omit<OplogEntry, 'seq'>): Promise<void> {
    const seq = this.nextSeq++
    await this.repo.insert(oplogTable, { seq, ...entry })
  }
}
