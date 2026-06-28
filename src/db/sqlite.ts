/**
 * The async SQLite contract the rest of the app depends on. It is intentionally
 * narrow and Promise-based so the same calling code works against either the
 * in-process WASM engine (tests / SSR-less node) or the OPFS-backed Web Worker
 * (browser), which is genuinely async over postMessage.
 */

export type SqlValue = string | number | null
export type Row = Record<string, SqlValue>

export interface AsyncSqlite {
  /** Run a statement for its side effects. */
  exec(sql: string, params?: readonly SqlValue[]): Promise<void>
  /** Run a query and return every row as a plain object. */
  all(sql: string, params?: readonly SqlValue[]): Promise<Row[]>
  /** Run a query and return the first row, or undefined. */
  get(sql: string, params?: readonly SqlValue[]): Promise<Row | undefined>
  /** Serialize the whole database to raw bytes (the `.sqlite` export). */
  exportBytes(): Promise<Uint8Array>
  /** Release underlying resources. */
  close(): Promise<void>
}
