/**
 * Phase 6 — the oplog is tapped at the Mutator write seam (spec §6.3): every
 * gateway mutation appends exactly one journal entry, deletes become tombstones.
 */
import { describe, it, expect } from 'vitest'
import { createMemoryGateway, type GatewayDeps } from '../gateway'
import { Repository } from '../db/repository'
import { oplogTable } from '../model/schema'

function deterministicDeps(): GatewayDeps {
  let n = 0
  let t = 0
  return {
    newId: () => `id-${String(++n).padStart(4, '0')}`,
    now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}.000Z`,
  }
}

describe('Phase 6 — oplog write seam', () => {
  it('journals one upsert entry per create and a delete tombstone per remove', async () => {
    const gw = await createMemoryGateway(deterministicDeps())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = new Repository((gw as any).db)

    const graph = await gw.createGraph({ name: 'G' })
    const entity = await gw.createEntity(graph.id, { name: 'E' })
    await gw.updateEntity(entity.id, { name: 'E2' })

    let log = await repo.list(oplogTable)
    expect(log.map((e) => [e.tableName, e.op])).toEqual([
      ['graph', 'upsert'],
      ['entity', 'upsert'],
      ['entity', 'upsert'],
    ])
    // seq is strictly increasing.
    expect(log.map((e) => e.seq)).toEqual([1, 2, 3])
    // The update entry carries the bumped version + a snapshot.
    expect(log[2].version).toBe(2)
    expect(log[2].snapshot).toMatchObject({ id: entity.id, name: 'E2', version: 2 })

    await gw.deleteEntity(entity.id)
    log = await repo.list(oplogTable)
    const tomb = log.at(-1)!
    expect(tomb.op).toBe('delete')
    expect(tomb.rowId).toBe(entity.id)
    expect(tomb.snapshot).toBeNull()
    // The tombstone's version strictly supersedes the last edit (2 → 3).
    expect(tomb.version).toBe(3)
  })

  it('does not journal node_position writes (composite key, no version)', async () => {
    const gw = await createMemoryGateway(deterministicDeps())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = new Repository((gw as any).db)
    const graph = await gw.createGraph({ name: 'G' })
    const diagram = await gw.createDiagram(graph.id, { name: 'B' })
    const layout = await gw.createLayout(diagram.id, { name: 'V' })
    const entity = await gw.createEntity(graph.id, { name: 'E' })
    const node = await gw.createNode(diagram.id, { entityId: entity.id })
    await gw.bulkUpsertPositions(layout.id, [{ nodeId: node.id, x: 1, y: 2 }])

    const log = await repo.list(oplogTable)
    expect(log.some((e) => e.tableName === 'node_position')).toBe(false)
    expect(log.some((e) => e.tableName === 'node')).toBe(true)
  })
})
