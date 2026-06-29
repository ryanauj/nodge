/**
 * Unit tests for the pure Dagre auto-layout engine (§8, §11).
 *
 * Deterministic by construction: the same input always yields the same output.
 * Position assertions are structural (relative ordering / monotonic ranks) rather
 * than brittle absolute pixels, so they survive Dagre patch-version drift.
 */

import { describe, it, expect } from 'vitest'
import { autoLayout, type LayoutEdge, type LayoutNode } from './autoLayout'

// A fixed small graph: one root (a) over two children (b, c); c has a child d.
//   a → b
//   a → c → d
const NODES: LayoutNode[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
const EDGES: LayoutEdge[] = [
  { sourceNodeId: 'a', targetNodeId: 'b' },
  { sourceNodeId: 'a', targetNodeId: 'c' },
  { sourceNodeId: 'c', targetNodeId: 'd' },
]

function byId(positions: { nodeId: string; x: number; y: number }[]) {
  return new Map(positions.map((p) => [p.nodeId, p]))
}

describe('autoLayout', () => {
  it('returns a position for every node', async () => {
    const positions = await autoLayout(NODES, EDGES)
    expect(positions.map((p) => p.nodeId).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('is deterministic — identical input yields identical output', async () => {
    const first = await autoLayout(NODES, EDGES)
    const second = await autoLayout(NODES, EDGES)
    expect(second).toEqual(first)
  })

  it('TB (default): parents rank above their children (smaller y)', async () => {
    const pos = byId(await autoLayout(NODES, EDGES))
    // a is above its children b and c
    expect(pos.get('a')!.y).toBeLessThan(pos.get('b')!.y)
    expect(pos.get('a')!.y).toBeLessThan(pos.get('c')!.y)
    // c is above its child d
    expect(pos.get('c')!.y).toBeLessThan(pos.get('d')!.y)
    // siblings b and c share a rank (same y)
    expect(pos.get('b')!.y).toBe(pos.get('c')!.y)
  })

  it('LR: parents rank left of their children (smaller x)', async () => {
    const pos = byId(await autoLayout(NODES, EDGES, { direction: 'LR' }))
    expect(pos.get('a')!.x).toBeLessThan(pos.get('b')!.x)
    expect(pos.get('a')!.x).toBeLessThan(pos.get('c')!.x)
    expect(pos.get('c')!.x).toBeLessThan(pos.get('d')!.x)
    // siblings share a column (same x)
    expect(pos.get('b')!.x).toBe(pos.get('c')!.x)
  })

  it('honors per-node size hints (wider node spreads its rank further)', async () => {
    const narrow = byId(await autoLayout(NODES, EDGES))
    const wide = byId(
      await autoLayout(
        NODES.map((n) => (n.id === 'b' || n.id === 'c' ? { ...n, width: 400 } : n)),
        EDGES,
      ),
    )
    const narrowGap = Math.abs(narrow.get('b')!.x - narrow.get('c')!.x)
    const wideGap = Math.abs(wide.get('b')!.x - wide.get('c')!.x)
    expect(wideGap).toBeGreaterThan(narrowGap)
  })

  it('empty graph returns no positions', async () => {
    expect(await autoLayout([], [])).toEqual([])
  })

  it('ignores edges referencing unknown nodes', async () => {
    const positions = await autoLayout(NODES, [
      ...EDGES,
      { sourceNodeId: 'a', targetNodeId: 'ghost' },
    ])
    expect(positions.map((p) => p.nodeId).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('lays out disconnected nodes without edges', async () => {
    const positions = await autoLayout([{ id: 'x' }, { id: 'y' }], [])
    expect(positions).toHaveLength(2)
    for (const p of positions) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
  })
})
