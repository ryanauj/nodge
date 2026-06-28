/**
 * Command layer (spec §6.3).
 *
 * Every mutation runs as a {@link Command} through the {@link CommandBus}. A
 * command performs its work via a {@link Mutator}, which records an inverse for
 * each row-level change — giving generic, composable undo/redo without any
 * per-command bookkeeping. The `run(mutator)` seam is also exactly where an
 * append-only oplog would later tap every write (Phase 6) without touching a
 * single call site.
 */

import type { Repository } from '../db/repository'
import type { RowOf, TableDef } from '../model/table'
import type { SqlValue } from '../db/sqlite'
import type { OplogSink } from './oplog'

/** A single reversible row change. */
interface ReversibleOp {
  undo(): Promise<void>
  redo(): Promise<void>
}

/** The write surface a command is given. All writes are recorded for undo. */
export interface Mutator {
  /** Insert a brand-new row. Undo deletes it. */
  insert<D extends TableDef>(def: D, row: RowOf<D>): Promise<RowOf<D>>
  /** Insert-or-replace a row, snapshotting any prior value for undo. */
  put<D extends TableDef>(def: D, row: RowOf<D>): Promise<RowOf<D>>
  /** Delete a row by primary key, snapshotting it for undo. */
  remove(def: TableDef, key: Record<string, SqlValue>): Promise<void>
}

export interface Command<T> {
  readonly label: string
  run(mutator: Mutator): Promise<T>
}

/** Build a command from a label and a run function. */
export function command<T>(label: string, run: (mutator: Mutator) => Promise<T>): Command<T> {
  return { label, run }
}

function keyOf<D extends TableDef>(def: D, row: RowOf<D>): Record<string, SqlValue> {
  const record = row as Record<string, SqlValue>
  const key: Record<string, SqlValue> = {}
  for (const dtoKey of def.primaryKey) key[dtoKey] = record[dtoKey]
  return key
}

/**
 * Side-channel a command's run can tap to journal its writes (Phase 6). Kept
 * optional + additive so existing call sites and the undo machinery are
 * untouched: when present, the {@link RecordingMutator} mirrors every write into
 * the oplog after it lands. `now()` timestamps delete tombstones.
 */
export interface CommandBusOptions {
  oplog?: OplogSink
  now?: () => string
}

class RecordingMutator implements Mutator {
  readonly ops: ReversibleOp[] = []
  constructor(
    private readonly repo: Repository,
    private readonly opts: CommandBusOptions,
  ) {}

  async insert<D extends TableDef>(def: D, row: RowOf<D>): Promise<RowOf<D>> {
    await this.repo.insert(def, row)
    await this.opts.oplog?.recordUpsert(def, row)
    const key = keyOf(def, row)
    this.ops.push({
      undo: () => this.repo.deleteByKey(def, key),
      redo: () => this.repo.insert(def, row).then(() => undefined),
    })
    return row
  }

  async put<D extends TableDef>(def: D, row: RowOf<D>): Promise<RowOf<D>> {
    const key = keyOf(def, row)
    const before = await this.repo.getByKey(def, key)
    await this.repo.upsert(def, row)
    await this.opts.oplog?.recordUpsert(def, row)
    this.ops.push({
      undo: () =>
        before
          ? this.repo.upsert(def, before).then(() => undefined)
          : this.repo.deleteByKey(def, key),
      redo: () => this.repo.upsert(def, row).then(() => undefined),
    })
    return row
  }

  async remove(def: TableDef, key: Record<string, SqlValue>): Promise<void> {
    const before = await this.repo.getByKey(def, key)
    await this.repo.deleteByKey(def, key)
    if (before) {
      await this.opts.oplog?.recordRemove(def, before, this.opts.now?.() ?? new Date().toISOString())
      this.ops.push({
        undo: () => this.repo.upsert(def, before).then(() => undefined),
        redo: () => this.repo.deleteByKey(def, key),
      })
    }
  }
}

export class CommandBus {
  private readonly undoStack: ReversibleOp[][] = []
  private readonly redoStack: ReversibleOp[][] = []

  constructor(
    private readonly repo: Repository,
    private readonly opts: CommandBusOptions = {},
  ) {}

  async execute<T>(cmd: Command<T>): Promise<T> {
    const mutator = new RecordingMutator(this.repo, this.opts)
    const result = await cmd.run(mutator)
    if (mutator.ops.length > 0) {
      this.undoStack.push(mutator.ops)
      this.redoStack.length = 0
    }
    return result
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  async undo(): Promise<boolean> {
    const ops = this.undoStack.pop()
    if (!ops) return false
    for (let i = ops.length - 1; i >= 0; i--) await ops[i].undo()
    this.redoStack.push(ops)
    return true
  }

  async redo(): Promise<boolean> {
    const ops = this.redoStack.pop()
    if (!ops) return false
    for (const op of ops) await op.redo()
    this.undoStack.push(ops)
    return true
  }
}
