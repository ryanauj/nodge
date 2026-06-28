/**
 * Bootstrap / reopen tests (spec §12 Phase 1 acceptance: "reload restores
 * state"). The OPFS store is simulated by reusing the *same* gateway across two
 * bootstrap calls — the durable data is present, and the localStorage pointer
 * tells the second call which graph to reopen rather than seeding a new one.
 */

import { describe, it, expect } from 'vitest'
import { createMemoryGateway } from '../gateway'
import {
  ACTIVE_GRAPH_KEY,
  bootstrapOrOpen,
  createDefaultDiagram,
  type PointerStorage,
} from './bootstrap'

function memoryStorage(): PointerStorage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  }
}

describe('bootstrapOrOpen', () => {
  it('seeds a default graph/board/view/palette on first run and records the pointer', async () => {
    const gw = await createMemoryGateway()
    const storage = memoryStorage()

    const ids = await bootstrapOrOpen(gw, storage)
    expect(ids.graphId).toBeTruthy()
    expect(ids.boardId).toBeTruthy()
    expect(ids.viewId).toBeTruthy()
    expect(ids.paletteId).toBeTruthy()
    expect(storage.getItem(ACTIVE_GRAPH_KEY)).toBe(ids.graphId)

    const graph = await gw.getGraph(ids.graphId)
    expect(graph.palettes.some((p) => p.builtin)).toBe(true)
  })

  it('reopens the pointed-at graph on the next run instead of seeding a new one', async () => {
    const gw = await createMemoryGateway()
    const storage = memoryStorage()

    const first = await bootstrapOrOpen(gw, storage)
    // A second bootstrap against the same (durable) store + pointer.
    const second = await bootstrapOrOpen(gw, storage)

    expect(second.graphId).toBe(first.graphId)
    expect(second.boardId).toBe(first.boardId)
    expect(second.viewId).toBe(first.viewId)
    expect(await gw.listGraphs()).toHaveLength(1) // not duplicated
  })

  it('falls back to seeding when the pointer is stale', async () => {
    const gw = await createMemoryGateway()
    const storage = memoryStorage()
    storage.setItem(ACTIVE_GRAPH_KEY, 'does-not-exist')

    const ids = await bootstrapOrOpen(gw, storage)
    expect(ids.graphId).not.toBe('does-not-exist')
    expect(await gw.listGraphs()).toHaveLength(1)
  })
})

describe('createDefaultDiagram', () => {
  it('wires the view to the seeded palette', async () => {
    const gw = await createMemoryGateway()
    const ids = await createDefaultDiagram(gw)
    const board = await gw.getBoard(ids.boardId)
    expect(board.views[0].paletteId).toBe(ids.paletteId)
  })

  it('seeds built-in node and relationship prototypes (§9.1)', async () => {
    const gw = await createMemoryGateway()
    const ids = await createDefaultDiagram(gw)
    const protos = await gw.listPrototypes(ids.graphId)
    expect(protos.some((p) => p.kind === 'node')).toBe(true)
    expect(protos.some((p) => p.kind === 'relationship')).toBe(true)
    expect(protos.some((p) => p.name === 'Service')).toBe(true)
  })
})
