/**
 * Phase 6 — same-interface proof (spec §6.1, §12): the HttpGateway is driven
 * through the EXACT DataGateway call sites as the LocalGateway, so swapping one
 * for the other is a provider change, not a rewrite. The same scenario runs
 * against both gateways and must produce the same observable results.
 */
import { describe, it, expect } from 'vitest'
import { createMemoryGateway, createMemoryHttpGateway, type GatewayDeps } from './index'
import type { DataGateway } from './types'
import { MockServer } from '../sync'

function deterministicDeps(prefix: string): GatewayDeps {
  let n = 0
  let t = 0
  return {
    newId: () => `${prefix}-${String(++n).padStart(4, '0')}`,
    now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}.000Z`,
  }
}

/** A scenario written ONCE against the interface, run against either gateway. */
async function buildAndRead(gw: DataGateway) {
  const graph = await gw.createGraph({ name: 'Proof', description: 'same interface' })
  const board = await gw.createBoard(graph.id, { name: 'Board' })
  const view = await gw.createView(board.id, { name: 'View' })
  const a = await gw.addNode(board.id, view.id, { name: 'A', x: 0, y: 0 })
  const b = await gw.addNode(board.id, view.id, { name: 'B', x: 100, y: 0 })
  await gw.connectNodes(board.id, { sourceNodeId: a.node.id, targetNodeId: b.node.id, label: 'calls' })

  const detail = await gw.getBoard(board.id)
  return {
    graphName: graph.name,
    nodeCount: detail.nodes.length,
    edgeCount: detail.edges.length,
    labels: detail.nodes.map((n) => n.label).sort(),
  }
}

describe('Phase 6 — same-interface proof', () => {
  it('the same call sites drive LocalGateway and HttpGateway identically', async () => {
    const local = await createMemoryGateway(deterministicDeps('x'))
    const server = await MockServer.open()
    const http = await createMemoryHttpGateway(server, deterministicDeps('x'))

    const fromLocal = await buildAndRead(local)
    const fromHttp = await buildAndRead(http)

    expect(fromHttp).toEqual(fromLocal)
    expect(fromHttp.nodeCount).toBe(2)
    expect(fromHttp.edgeCount).toBe(1)
  })

  it('HttpGateway satisfies the DataGateway type (assignment is the seam proof)', async () => {
    const server = await MockServer.open()
    const gw: DataGateway = await createMemoryHttpGateway(server)
    const graph = await gw.createGraph({ name: 'G' })
    expect((await gw.getGraph(graph.id)).name).toBe('G')
  })
})
