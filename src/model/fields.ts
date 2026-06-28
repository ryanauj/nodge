/**
 * Field DSL — the atom of the single model definition.
 *
 * Each `Field<T>` carries everything the three derived artifacts need:
 *   - `sqlType`            → SQLite DDL column type
 *   - `parse(value, path)` → JSON DTO validation (drives `importJson`)
 *   - `toSql` / `fromSql`  → marshaling between typed DTO values and SQLite cells
 *   - phantom `T`          → the TypeScript type, inferred via {@link RowOf}
 *
 * Because all three are projections of one object, a field can never describe
 * a column to SQLite differently than it describes it to TypeScript or JSON —
 * they cannot drift.
 */

import {
  ValidationError,
  expectBoolean,
  expectNumber,
  expectOneOf,
  expectRecord,
  expectString,
} from './validate'

/** A primitive value that SQLite can bind/return. JSON columns are stored as TEXT. */
export type SqlValue = string | number | null

export interface Field<T> {
  readonly sqlType: 'TEXT' | 'INTEGER' | 'REAL'
  readonly nullable: boolean
  /** Validate & narrow a raw JSON value into the typed DTO value. */
  parse(value: unknown, path: string): T
  /** Encode a typed value into a SQLite-bindable primitive. */
  toSql(value: T): SqlValue
  /** Decode a SQLite cell back into the typed value. */
  fromSql(cell: SqlValue): T
  /** Phantom carrier of the TypeScript type — never read at runtime. */
  readonly __t?: T
}

class FieldImpl<T> implements Field<T> {
  readonly __t?: T
  constructor(
    readonly sqlType: 'TEXT' | 'INTEGER' | 'REAL',
    readonly nullable: boolean,
    private readonly spec: {
      parse(value: unknown, path: string): T
      toSql(value: T): SqlValue
      fromSql(cell: SqlValue): T
    },
  ) {}

  parse(value: unknown, path: string): T {
    return this.spec.parse(value, path)
  }
  toSql(value: T): SqlValue {
    return this.spec.toSql(value)
  }
  fromSql(cell: SqlValue): T {
    return this.spec.fromSql(cell)
  }

  /** Return a nullable variant of this field (widens the TS type to `T | null`). */
  orNull(): Field<T | null> {
    return new FieldImpl<T | null>(this.sqlType, true, {
      parse: (value, path) => (value === null || value === undefined ? null : this.spec.parse(value, path)),
      // `undefined` (an omitted nullable column on a row literal) marshals to NULL
      // too, so a row built without the field still binds cleanly.
      toSql: (value) => (value === null || value === undefined ? null : this.spec.toSql(value)),
      fromSql: (cell) => (cell === null ? null : this.spec.fromSql(cell)),
    })
  }
}

/** TEXT column holding a plain string. */
export function text(): FieldImpl<string> {
  return new FieldImpl('TEXT', false, {
    parse: (value, path) => expectString(value, path),
    toSql: (value) => value,
    fromSql: (cell) => String(cell),
  })
}

/** INTEGER column holding a whole number. */
export function integer(): FieldImpl<number> {
  return new FieldImpl('INTEGER', false, {
    parse: (value, path) => expectNumber(value, path),
    toSql: (value) => value,
    fromSql: (cell) => Number(cell),
  })
}

/** REAL column holding a floating-point number. */
export function real(): FieldImpl<number> {
  return new FieldImpl('REAL', false, {
    parse: (value, path) => expectNumber(value, path),
    toSql: (value) => value,
    fromSql: (cell) => Number(cell),
  })
}

/** INTEGER column (0/1) presented as a boolean. */
export function boolean(): FieldImpl<boolean> {
  return new FieldImpl('INTEGER', false, {
    parse: (value, path) => expectBoolean(value, path),
    toSql: (value) => (value ? 1 : 0),
    fromSql: (cell) => Boolean(cell),
  })
}

/** TEXT column constrained to a fixed set of string literals. */
export function enumText<T extends string>(allowed: readonly T[]): FieldImpl<T> {
  return new FieldImpl('TEXT', false, {
    parse: (value, path) => expectOneOf(value, allowed, path),
    toSql: (value) => value,
    fromSql: (cell) => expectOneOf(cell, allowed, 'fromSql'),
  })
}

/**
 * TEXT column holding a JSON-encoded value. The DTO carries the parsed object;
 * SQLite stores the stringified form. `validate` runs on import to guard shape.
 */
export function json<T>(validate: (value: unknown, path: string) => T): FieldImpl<T> {
  return new FieldImpl('TEXT', false, {
    parse: (value, path) => validate(value, path),
    toSql: (value) => JSON.stringify(value),
    fromSql: (cell) => {
      if (typeof cell !== 'string') {
        throw new ValidationError('expected JSON text in column', 'fromSql')
      }
      return validate(JSON.parse(cell), 'fromSql') as T
    },
  })
}

/** Convenience validators for common JSON column shapes. */
export const asRecord = (value: unknown, path: string): Record<string, unknown> =>
  expectRecord(value, path)
