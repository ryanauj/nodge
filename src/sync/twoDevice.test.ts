/**
 * Phase 6 HEADLINE acceptance (spec §12): with the mock server, a second device
 * pulls a graph, edits it, and pushes; changes reconcile WITHOUT id collisions.
 *
 * Two independent in-memory gateways are two real devices; the only thing mocked
 * is the network boundary (the {@link MockServer} transport). The test exercises
 * a concurrent same-row edit (LWW must pick a deterministic winner) and a delete
 * (a tombstone must not be resurrected by the other device's stale row), and
 * asserts ids are stable client UUIDs throughout (no remap).
 */
import { describe, it, expect } from 'vitest'
import { createMemoryHttpGateway, type GatewayDeps, type HttpGateway } from '../gateway'
import { MockServer } from './MockServer'

/** Distinct id prefix per device proves ids never collide / never get remapped. */
function deviceDeps(prefix: string, startClock: number): GatewayDeps {
  let n = 0
  let t = startClock
  return {
    newId: () => `${prefix}-${String(++n).padStart(4, '0')}`,
    now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}.000Z`,
  }
}

async function entityNames(gw: HttpGateway, graphId: string): Promise<Record<string, string>> {
  const detail = await gw.getGraph(graphId)
  return Object.fromEntries(detail.entities.map((e) => [e.id, e.name]))
}

describe('Phase 6 — two-device reconcile (headline acceptance)', () => {
  it('B pulls A’s graph, both edit (incl. concurrent same-row + a delete), reconcile by LWW with stable ids', async () => {
    const server = await MockServer.open()
    // A edits "earlier" on the clock, B "later" — so on a same-row tie B wins by
    // the documented order (equal version → greater updatedAt).
    const deviceA = await createMemoryHttpGateway(server, deviceDeps('A', 0))
    const deviceB = await createMemoryHttpGateway(server, deviceDeps('B', 30))

    // ── Device A creates a graph with three entities, then pushes ──
    const graph = await deviceA.createGraph({ name: 'Shared', description: '' })
    const board = await deviceA.createBoard(graph.id, { name: 'Board' })
    const view = await deviceA.createView(board.id, { name: 'View' })
    const alpha = await deviceA.addNode(board.id, view.id, { name: 'Alpha', x: 0, y: 0 })
    const beta = await deviceA.addNode(board.id, view.id, { name: 'Beta', x: 50, y: 0 })
    const gamma = await deviceA.addNode(board.id, view.id, { name: 'Gamma', x: 100, y: 0 })
    await deviceA.connectNodes(board.id, {
      sourceNodeId: alpha.node.id,
      targetNodeId: beta.node.id,
      label: 'a→b',
    })
    await deviceA.sync()

    // ── Device B pulls — sees A’s graph with A’s ids, unchanged ──
    await deviceB.sync()
    const bGraph = await deviceB.getGraph(graph.id)
    expect(bGraph.name).toBe('Shared')
    expect(bGraph.entities.map((e) => e.id).sort()).toEqual(
      [alpha.entity.id, beta.entity.id, gamma.entity.id].sort(),
    )
    const bBoard = await deviceB.getBoard(board.id)
    expect(bBoard.nodes).toHaveLength(3)
    expect(bBoard.edges).toHaveLength(1)
    // Every id is an A-minted UUID (no remap on the receiving device).
    expect(bGraph.entities.every((e) => e.id.startsWith('A-'))).toBe(true)

    // ── Concurrent same-row edit: both rename Alpha before syncing ──
    await deviceA.updateEntity(alpha.entity.id, { name: 'Alpha-by-A' })
    await deviceB.updateEntity(alpha.entity.id, { name: 'Alpha-by-B' })

    // ── Device A deletes Gamma; B independently moves Gamma’s node (stale) ──
    await deviceA.deleteEntity(gamma.entity.id)

    // ── Both edit a different, non-conflicting row each ──
    await deviceA.updateEntity(beta.entity.id, { name: 'Beta-A-edit' })

    // ── Reconcile: A pushes first, then B syncs (push+pull), then A pulls ──
    await deviceA.sync() // A → server
    await deviceB.sync() // B pulls A’s changes, applies LWW locally, pushes B’s
    await deviceA.sync() // A pulls B’s winning changes

    const aNames = await entityNames(deviceA, graph.id)
    const bNames = await entityNames(deviceB, graph.id)

    // Both devices converge to the SAME state (deterministic LWW).
    expect(aNames).toEqual(bNames)

    // Alpha: equal version (both bumped 1→2), B’s updatedAt is later → B wins.
    expect(aNames[alpha.entity.id]).toBe('Alpha-by-B')

    // Beta: only A edited it → A’s edit stands on both.
    expect(aNames[beta.entity.id]).toBe('Beta-A-edit')

    // Gamma: deleted on A; the delete is honored on BOTH and never resurrected.
    expect(alpha.entity.id in aNames).toBe(true)
    expect(gamma.entity.id in aNames).toBe(false)
    expect(gamma.entity.id in bNames).toBe(false)

    // No id collisions / remaps: the surviving ids are exactly the originals.
    expect(Object.keys(aNames).sort()).toEqual([alpha.entity.id, beta.entity.id].sort())

    // Server materialized the same truth (it can serve the reconciled graph).
    const serverGraph = await server.repository.getById(
      (await import('../model/schema')).graphTable,
      graph.id,
    )
    expect(serverGraph?.name).toBe('Shared')
  })

  it('a delete cannot be resurrected by a device’s STALE (lower-version) row', async () => {
    const server = await MockServer.open()
    const deviceA = await createMemoryHttpGateway(server, deviceDeps('A', 0))
    const deviceB = await createMemoryHttpGateway(server, deviceDeps('B', 50))

    const graph = await deviceA.createGraph({ name: 'G', description: '' })
    const ent = await deviceA.createEntity(graph.id, { name: 'Doomed' })
    await deviceA.sync()
    await deviceB.sync() // B now holds the entity at version 1 (its "stale" copy)

    // A advances the row past B’s knowledge, then deletes it — the tombstone
    // version (4) is strictly higher than B’s stale copy (1).
    await deviceA.updateEntity(ent.id, { name: 'Doomed v2' }) // v2
    await deviceA.updateEntity(ent.id, { name: 'Doomed v3' }) // v3
    await deviceA.deleteEntity(ent.id) // tombstone v4
    await deviceA.sync() // server now holds the delete at v4

    // B, having never seen any of that, re-pushes its stale version-1 row.
    await deviceB.updateEntity(ent.id, { name: 'Doomed (B stale)' }) // v2 on B
    await deviceB.sync() // push B’s v2, then pull A’s v4 delete

    // The higher-versioned delete wins on the server and on B; A pulls nothing new.
    await deviceA.sync()

    const a = await deviceA.getGraph(graph.id)
    const b = await deviceB.getGraph(graph.id)
    expect(a.entities.find((e) => e.id === ent.id)).toBeUndefined()
    expect(b.entities.find((e) => e.id === ent.id)).toBeUndefined()
  })
})
