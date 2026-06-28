import { describe, it, expect } from 'vitest'
import { createMemoryGateway } from '../gateway'
import { bootstrapOrOpen, type PointerStorage } from './bootstrap'
import { loadDiagram } from './diagram'

function memoryStorage(): PointerStorage {
  const map = new Map<string, string>()
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }
}

describe('loadDiagram', () => {
  it('builds React Flow nodes/edges with resolved styles and positions', async () => {
    const gw = await createMemoryGateway()
    const ids = await bootstrapOrOpen(gw, memoryStorage())

    const a = await gw.addNode(ids.boardId, ids.viewId, { name: 'A', x: 10, y: 20 })
    const b = await gw.addNode(ids.boardId, ids.viewId, { name: 'B', x: 200, y: 20 })
    await gw.connectNodes(ids.boardId, {
      sourceNodeId: a.node.id,
      targetNodeId: b.node.id,
      label: 'calls',
    })

    const snap = await loadDiagram(gw, ids)
    expect(snap.flowNodes).toHaveLength(2)
    expect(snap.flowEdges).toHaveLength(1)

    const nodeA = snap.flowNodes.find((n) => n.id === a.node.id)!
    expect(nodeA.position).toEqual({ x: 10, y: 20 })
    expect(nodeA.data.label).toBe('A')
    expect(nodeA.data.style.surface).toBe('#ffffff') // follows the seeded palette
    expect(nodeA.type).toBe('nodge')

    const edge = snap.flowEdges[0]
    expect(edge.source).toBe(a.node.id)
    expect(edge.target).toBe(b.node.id)
    expect(edge.label).toBe('calls')
    expect(edge.style.stroke).toBe('#4361ee')
  })

  it('reflects a per-node pinned override over the palette', async () => {
    const gw = await createMemoryGateway()
    const ids = await bootstrapOrOpen(gw, memoryStorage())
    const a = await gw.addNode(ids.boardId, ids.viewId, {
      name: 'Pinned',
      x: 0,
      y: 0,
      styleOverride: { surface: '#ff0000' },
    })

    const snap = await loadDiagram(gw, ids)
    const node = snap.flowNodes.find((n) => n.id === a.node.id)!
    expect(node.data.style.surface).toBe('#ff0000')
  })
})
