/**
 * File round-trip (spec §12 Phase 1 acceptance): export a `.nodge.json` then
 * import it into a fresh DB and render the same diagram.
 */

import { describe, it, expect } from 'vitest'
import { createMemoryGateway } from '../gateway'
import { bootstrapOrOpen, type PointerStorage } from './bootstrap'
import { loadDiagram } from './diagram'
import { exportFileName, exportGraphText, importGraphText } from './fileIo'

function memoryStorage(): PointerStorage {
  const map = new Map<string, string>()
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }
}

describe('file round-trip', () => {
  it('exports a diagram and re-imports it into a fresh DB, rendering the same thing', async () => {
    const gw = await createMemoryGateway()
    const ids = await bootstrapOrOpen(gw, memoryStorage())
    const a = await gw.addNode(ids.boardId, ids.viewId, { name: 'A', x: 10, y: 20 })
    const b = await gw.addNode(ids.boardId, ids.viewId, { name: 'B', x: 200, y: 40 })
    await gw.connectNodes(ids.boardId, { sourceNodeId: a.node.id, targetNodeId: b.node.id })

    const before = await loadDiagram(gw, ids)
    const text = await exportGraphText(gw, ids.graphId)

    // Fresh, independent database + gateway — the "import it elsewhere" case.
    const gw2 = await createMemoryGateway()
    const graphId = await importGraphText(gw2, text)
    const reopened = await bootstrapOrOpen(gw2, (() => {
      const s = memoryStorage()
      s.setItem('nodge.activeGraphId', graphId)
      return s
    })())

    const after = await loadDiagram(gw2, reopened)
    expect(after.flowNodes).toHaveLength(before.flowNodes.length)
    expect(after.flowEdges).toHaveLength(before.flowEdges.length)
    // Same ids, labels and positions survive the round-trip.
    expect(after.flowNodes.map((n) => [n.id, n.data.label, n.position]).sort()).toEqual(
      before.flowNodes.map((n) => [n.id, n.data.label, n.position]).sort(),
    )
  })
})

describe('exportFileName', () => {
  it('slugifies the graph name into a .nodge.json filename', () => {
    expect(exportFileName('My Cool Diagram')).toBe('my-cool-diagram.nodge.json')
    expect(exportFileName('  ')).toBe('diagram.nodge.json')
  })
})
