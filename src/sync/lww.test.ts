/**
 * Phase 6 — the LWW conflict order is total and deterministic (spec §6.3/§6.6).
 */
import { describe, it, expect } from 'vitest'
import { compareChanges, reconcile, rowKey, wins, type Change } from './lww'

const upsert = (over: Partial<Change> = {}): Change => ({
  tableName: 'entity',
  rowId: 'e1',
  op: 'upsert',
  version: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  snapshot: { id: 'e1', name: 'A', version: 1 },
  ...over,
})

describe('Phase 6 — LWW order', () => {
  it('higher version wins regardless of timestamp', () => {
    const a = upsert({ version: 2, updatedAt: '2026-01-01T00:00:00.000Z' })
    const b = upsert({ version: 1, updatedAt: '2030-01-01T00:00:00.000Z' })
    expect(compareChanges(a, b)).toBeGreaterThan(0)
    expect(wins(a, b)).toBe(true)
    expect(wins(b, a)).toBe(false)
  })

  it('on equal version, the later updatedAt wins', () => {
    const a = upsert({ version: 1, updatedAt: '2026-01-02T00:00:00.000Z' })
    const b = upsert({ version: 1, updatedAt: '2026-01-01T00:00:00.000Z' })
    expect(compareChanges(a, b)).toBeGreaterThan(0)
  })

  it('on equal version + timestamp, a delete wins over an upsert (no resurrection)', () => {
    const del = upsert({ op: 'delete', snapshot: null })
    const up = upsert()
    expect(compareChanges(del, up)).toBeGreaterThan(0)
    expect(wins(del, up)).toBe(true)
  })

  it('is a strict total order (antisymmetric, identical only when equal)', () => {
    const a = upsert({ version: 2 })
    const b = upsert({ version: 1 })
    expect(Math.sign(compareChanges(a, b))).toBe(-Math.sign(compareChanges(b, a)))
    expect(compareChanges(a, { ...a })).toBe(0)
  })

  it('reconcile picks one winner per row, independent of input order', () => {
    const v1 = upsert({ version: 1, updatedAt: '2026-01-01T00:00:01.000Z' })
    const v2 = upsert({ version: 2, updatedAt: '2026-01-01T00:00:02.000Z' })
    const other = upsert({ rowId: 'e2', version: 5 })
    const forward = reconcile([v1, v2, other])
    const backward = reconcile([other, v2, v1])
    expect(forward.get(rowKey(v1))).toEqual(v2)
    expect(backward.get(rowKey(v1))).toEqual(v2)
    expect(forward.get(rowKey(other))?.version).toBe(5)
    expect(forward.size).toBe(2)
  })
})
