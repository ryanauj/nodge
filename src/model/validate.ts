/**
 * Tiny runtime validation primitives shared by the model definition.
 *
 * These power the JSON DTO validator that guards `importJson`. They are
 * deliberately dependency-free so the same helpers can validate nested JSON
 * column shapes (links, metadata, style deltas) and top-level documents.
 */

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'ValidationError'
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ValidationError('expected an object', path)
  return value
}

export function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new ValidationError('expected a string', path)
  return value
}

export function expectNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ValidationError('expected a number', path)
  }
  return value
}

export function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new ValidationError('expected a boolean', path)
  return value
}

export function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new ValidationError('expected an array', path)
  return value
}

export function expectOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  const str = expectString(value, path)
  if (!allowed.includes(str as T)) {
    throw new ValidationError(`expected one of ${allowed.join(', ')}`, path)
  }
  return str as T
}
