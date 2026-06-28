/**
 * Phase 6 — sync engine + mock server push/pull semantics (spec §6.6):
 * checkpoints advance, deletes propagate, and a tombstone wins a perfect tie.
 */
import { describe, it, expect } from 'vitest'
import { createMemoryHttpGateway, type GatewayDeps } from '../gateway'
import { MockServer } from './MockServer'
import type { Change } from './lww'

/** A complete graph row snapshot (real snapshots are always full rows). */
function graphRow(name: string, version: number, updatedAt: string) {
  return {
    id: 'g1',
    name,
    description: '',
    schemaVersion: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
    version,
  }
}

function deps(prefix: string): GatewayDeps {
  let n = 0
  let t = 0
  return {
    newId: () => `${prefix}-${String(++n).padStart(4, '0')}`,
    now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}.000Z`,
  }
}

describe('Phase 6 — MockServer transport', () => {
  it('pull(since) returns only changes past the cursor and advances the checkpoint', async () => {
    const server = await MockServer.open()
    const a = await createMemoryHttpGateway(server, deps('A'))
    const graph = await a.createGraph({ name: 'G' })
    await a.sync()
    const first = server.checkpoint
    expect(first).toBeGreaterThan(0)

    const fromZero = await server.pull(0)
    expect(fromZero.changes.length).toBe(first)
    expect(fromZero.checkpoint).toBe(first)

    await a.createEntity(graph.id, { name: 'E' })
    await a.sync()
    const delta = await server.pull(first)
    expect(delta.changes).toHaveLength(1)
    expect(delta.changes[0].tableName).toBe('entity')
  })

  it('rejects a stale push (lower version) and keeps the current winner', async () => {
    const server = await MockServer.open()
    // Seed the server with version 3 of a row.
    await server.push({
      changes: [
        {
          tableName: 'graph',
          rowId: 'g1',
          op: 'upsert',
          version: 3,
          updatedAt: '2026-01-01T00:00:03.000Z',
          snapshot: graphRow('v3', 3, '2026-01-01T00:00:03.000Z'),
        } satisfies Change,
      ],
    })
    const before = server.checkpoint
    const res = await server.push({
      changes: [
        {
          tableName: 'graph',
          rowId: 'g1',
          op: 'upsert',
          version: 2,
          updatedAt: '2030-01-01T00:00:00.000Z',
          snapshot: graphRow('stale', 2, '2030-01-01T00:00:00.000Z'),
        } satisfies Change,
      ],
    })
    expect(res.accepted).toBe(0)
    expect(server.checkpoint).toBe(before)
  })

  it('a delete wins a perfect tie (equal version + timestamp) — tombstone is sticky', async () => {
    const server = await MockServer.open()
    const tie = { tableName: 'graph', rowId: 'g1', version: 2, updatedAt: '2026-01-01T00:00:02.000Z' }
    await server.push({
      changes: [{ ...tie, op: 'upsert', snapshot: graphRow('x', 2, tie.updatedAt) }],
    })
    const res = await server.push({ changes: [{ ...tie, op: 'delete', snapshot: null }] })
    expect(res.accepted).toBe(1)
    const log = await server.pull(0)
    expect(log.changes.at(-1)?.op).toBe('delete')
  })
})
