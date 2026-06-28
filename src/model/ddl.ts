/**
 * Artifact #1: the SQLite DDL, generated from the single model definition.
 * Re-generated deterministically from {@link ALL_TABLES}; never hand-written.
 */

import { ALL_TABLES } from './schema'
import type { TableDef } from './table'

export function createTableSql(def: TableDef): string {
  const columnDefs = def.keys.map((key) => {
    const field = def.fields[key]
    const parts = [def.columns[key], field.sqlType]
    if (!field.nullable) parts.push('NOT NULL')
    return `  ${parts.join(' ')}`
  })
  const pkColumns = def.primaryKey.map((key) => def.columns[key])
  columnDefs.push(`  PRIMARY KEY (${pkColumns.join(', ')})`)
  return `CREATE TABLE IF NOT EXISTS ${def.name} (\n${columnDefs.join(',\n')}\n)`
}

export function dropTableSql(def: TableDef): string {
  return `DROP TABLE IF EXISTS ${def.name}`
}

/** Full schema DDL, in dependency order. */
export function schemaDdl(): string[] {
  return ALL_TABLES.map(createTableSql)
}
