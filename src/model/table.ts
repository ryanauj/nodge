/**
 * Table definitions — group fields into a relational table and derive, from
 * that single object: the TypeScript row type ({@link RowOf}), the column-name
 * map (camelCase DTO key ↔ snake_case SQL column), and the metadata the DDL
 * generator and repository consume.
 */

import type { Field, SqlValue } from './fields'
import { ValidationError, expectRecord } from './validate'

/**
 * `Field<any>` (not `Field<unknown>`) is deliberate: a column declared
 * `Field<string>` is not assignable to `Field<unknown>` under contravariant
 * method params, which would make every concrete table reject the generic
 * constraint. `any` here is contained to the shape bound only.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyField = Field<any>
export type TableShape = Record<string, AnyField>

export interface TableDef<S extends TableShape = TableShape> {
  readonly name: string
  readonly fields: S
  /** DTO keys forming the primary key (defaults to `['id']`). */
  readonly primaryKey: readonly string[]
  /** DTO key → SQL column name (snake_case). */
  readonly columns: Readonly<Record<string, string>>
  /** Ordered DTO keys (stable; drives deterministic serialization). */
  readonly keys: readonly string[]
}

/** Infer the typed row (DTO) from a table definition. */
export type RowOf<D extends TableDef> = D extends TableDef<infer S>
  ? { [K in keyof S]: S[K] extends Field<infer T> ? T : never }
  : never

function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}

export function table<S extends TableShape>(
  name: string,
  fields: S,
  options: { primaryKey?: (keyof S & string)[] } = {},
): TableDef<S> {
  const keys = Object.keys(fields)
  const columns: Record<string, string> = {}
  for (const key of keys) columns[key] = toSnakeCase(key)
  return {
    name,
    fields,
    primaryKey: options.primaryKey ?? ['id'],
    columns,
    keys,
  }
}

/** Look up a field on a table definition by its (string) DTO key. */
function fieldOf(def: TableDef, key: string): Field<unknown> {
  return (def.fields as Record<string, Field<unknown>>)[key]
}

/**
 * Validate an unknown JSON value into a typed row for the given table.
 * Every field's `parse` runs; missing/extra-but-unknown keys surface as errors.
 */
export function parseRow<D extends TableDef>(def: D, value: unknown, path: string): RowOf<D> {
  const record = expectRecord(value, path)
  const out: Record<string, unknown> = {}
  for (const key of def.keys) {
    if (!(key in record)) {
      throw new ValidationError(`missing field "${key}"`, path)
    }
    out[key] = fieldOf(def, key).parse(record[key], `${path}.${key}`)
  }
  return out as RowOf<D>
}

/** Encode a typed row into an ordered list of SQL columns + bindable values. */
export function rowToSql<D extends TableDef>(
  def: D,
  row: RowOf<D>,
): { columns: string[]; values: SqlValue[] } {
  const columns: string[] = []
  const values: SqlValue[] = []
  const record = row as Record<string, unknown>
  for (const key of def.keys) {
    columns.push(def.columns[key])
    values.push(fieldOf(def, key).toSql(record[key]))
  }
  return { columns, values }
}

/** Decode a raw SQLite row (snake_case cells) into a typed DTO row. */
export function rowFromSql<D extends TableDef>(
  def: D,
  cells: Record<string, SqlValue>,
): RowOf<D> {
  const out: Record<string, unknown> = {}
  for (const key of def.keys) {
    out[key] = fieldOf(def, key).fromSql(cells[def.columns[key]] ?? null)
  }
  return out as RowOf<D>
}
