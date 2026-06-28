/**
 * Generic, schema-driven row repository.
 *
 * Every CRUD operation is derived from a {@link TableDef}, so adding a column to
 * the single model definition automatically flows through insert/update/select
 * with no bespoke SQL per table. This is the only place that builds SQL for the
 * domain tables; the gateway and command layer compose these primitives.
 */

import { type RowOf, type TableDef, rowFromSql, rowToSql } from '../model/table'
import type { AsyncSqlite, Row, SqlValue } from './sqlite'

export type KeyValues = Record<string, SqlValue>

export class Repository {
  constructor(private readonly db: AsyncSqlite) {}

  private whereForKey(def: TableDef, key: KeyValues): { clause: string; values: SqlValue[] } {
    const parts: string[] = []
    const values: SqlValue[] = []
    for (const dtoKey of def.primaryKey) {
      parts.push(`${def.columns[dtoKey]} = ?`)
      values.push(key[dtoKey])
    }
    return { clause: parts.join(' AND '), values }
  }

  async insert<D extends TableDef>(def: D, row: RowOf<D>): Promise<RowOf<D>> {
    const { columns, values } = rowToSql(def, row)
    const placeholders = columns.map(() => '?').join(', ')
    await this.db.exec(
      `INSERT INTO ${def.name} (${columns.join(', ')}) VALUES (${placeholders})`,
      values,
    )
    return row
  }

  async update<D extends TableDef>(def: D, row: RowOf<D>): Promise<RowOf<D>> {
    const { columns, values } = rowToSql(def, row)
    const assignments = columns.map((c) => `${c} = ?`).join(', ')
    const record = row as Record<string, SqlValue>
    const key: KeyValues = {}
    for (const dtoKey of def.primaryKey) key[dtoKey] = record[dtoKey]
    const where = this.whereForKey(def, key)
    await this.db.exec(
      `UPDATE ${def.name} SET ${assignments} WHERE ${where.clause}`,
      [...values, ...where.values],
    )
    return row
  }

  /** Insert or replace a row by its primary key. */
  async upsert<D extends TableDef>(def: D, row: RowOf<D>): Promise<RowOf<D>> {
    const { columns, values } = rowToSql(def, row)
    const placeholders = columns.map(() => '?').join(', ')
    await this.db.exec(
      `INSERT OR REPLACE INTO ${def.name} (${columns.join(', ')}) VALUES (${placeholders})`,
      values,
    )
    return row
  }

  async getByKey<D extends TableDef>(def: D, key: KeyValues): Promise<RowOf<D> | undefined> {
    const where = this.whereForKey(def, key)
    const row = await this.db.get(`SELECT * FROM ${def.name} WHERE ${where.clause}`, where.values)
    return row ? rowFromSql(def, row) : undefined
  }

  async getById<D extends TableDef>(def: D, id: string): Promise<RowOf<D> | undefined> {
    return this.getByKey(def, { id })
  }

  async list<D extends TableDef>(
    def: D,
    where: Record<string, SqlValue> = {},
  ): Promise<RowOf<D>[]> {
    const keys = Object.keys(where)
    const clause = keys.length
      ? ` WHERE ${keys.map((k) => `${def.columns[k]} = ?`).join(' AND ')}`
      : ''
    const orderBy = ` ORDER BY ${def.primaryKey.map((k) => def.columns[k]).join(', ')}`
    const rows: Row[] = await this.db.all(
      `SELECT * FROM ${def.name}${clause}${orderBy}`,
      keys.map((k) => where[k]),
    )
    return rows.map((row) => rowFromSql(def, row))
  }

  async deleteByKey(def: TableDef, key: KeyValues): Promise<void> {
    const where = this.whereForKey(def, key)
    await this.db.exec(`DELETE FROM ${def.name} WHERE ${where.clause}`, where.values)
  }

  async deleteById(def: TableDef, id: string): Promise<void> {
    return this.deleteByKey(def, { id })
  }
}
