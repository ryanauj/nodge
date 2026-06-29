import { describe, it, expect } from 'vitest'
import { createMemoryGateway } from '../gateway'
import { bootstrapOrOpen, type PointerStorage } from './bootstrap'
import { loadDiagram, toFlowEdges, toFlowNodes, type DiagramSource } from './diagram'
import { DEFAULT_PALETTE_TOKENS } from './style'
import type { Edge, Node, PaletteTokens } from '../model'
import type { Uuid } from '../gateway'

function memoryStorage(): PointerStorage {
  const map = new Map<string, string>()
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }
}

/** Build a minimal DiagramSource around a single styled node + edge. */
function sourceWith(
  palette: PaletteTokens,
  nodeStyle: Node['style'],
  edgeStyle: Edge['style'],
): DiagramSource {
  const node = {
    id: 'n1' as Uuid,
    entityId: 'e1' as Uuid,
    label: 'N',
    style: nodeStyle,
  } as unknown as Node
  const edge = {
    id: 'd1' as Uuid,
    relationshipId: 'r1' as Uuid,
    sourceNodeId: 'n1' as Uuid,
    targetNodeId: 'n1' as Uuid,
    label: 'L',
    style: edgeStyle,
  } as unknown as Edge
  return {
    nodes: [node],
    edges: [edge],
    positions: new Map([['n1' as Uuid, { x: 5, y: 6 }]]),
    entities: new Map(),
    relationships: new Map(),
    paletteTokens: palette,
  }
}

describe('loadDiagram', () => {
  it('builds React Flow nodes/edges with resolved styles and positions', async () => {
    const gw = await createMemoryGateway()
    const ids = await bootstrapOrOpen(gw, memoryStorage())

    const a = await gw.addNode(ids.diagramId, ids.layoutId, { name: 'A', x: 10, y: 20 })
    const b = await gw.addNode(ids.diagramId, ids.layoutId, { name: 'B', x: 200, y: 20 })
    await gw.connectNodes(ids.diagramId, {
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
    const a = await gw.addNode(ids.diagramId, ids.layoutId, {
      name: 'Pinned',
      x: 0,
      y: 0,
      style: { surface: '#ff0000' },
    })

    const snap = await loadDiagram(gw, ids)
    const node = snap.flowNodes.find((n) => n.id === a.node.id)!
    expect(node.data.style.surface).toBe('#ff0000')
  })
})

describe('toFlowNodes / toFlowEdges — §D3 / §D10 resolution', () => {
  it('renders a concrete snapshot; a palette swap does NOT change it', () => {
    const snapshot = { surface: '#ff0000' }
    const edgeSnap = { stroke: '#ff0000' }
    const onDefault = toFlowNodes(sourceWith(DEFAULT_PALETTE_TOKENS, snapshot, edgeSnap))
    const altPalette: PaletteTokens = {
      node: { surface: '#000000' },
      edge: { stroke: '#000000' },
    }
    const onAlt = toFlowNodes(sourceWith(altPalette, snapshot, edgeSnap))
    expect(onDefault[0].data.style.surface).toBe('#ff0000')
    expect(onAlt[0].data.style.surface).toBe('#ff0000') // snapshot survives swap

    const edgeDefault = toFlowEdges(sourceWith(DEFAULT_PALETTE_TOKENS, snapshot, edgeSnap))
    const edgeAlt = toFlowEdges(sourceWith(altPalette, snapshot, edgeSnap))
    expect(edgeDefault[0].style.stroke).toBe('#ff0000')
    expect(edgeAlt[0].style.stroke).toBe('#ff0000')
  })

  it('falls back to the palette for a key the snapshot omits (totality)', () => {
    const altPalette: PaletteTokens = {
      node: { surface: '#000000', border: '#00ff00' },
      edge: { stroke: '#000000', strokeWidth: 9 },
    }
    // Node snapshot pins only surface; edge snapshot pins only stroke.
    const [node] = toFlowNodes(sourceWith(altPalette, { surface: '#ff0000' }, { stroke: '#ff0000' }))
    expect(node.data.style.surface).toBe('#ff0000') // from the snapshot
    expect(node.data.style.border).toBe('#00ff00') // omitted → palette fallback

    const [edge] = toFlowEdges(sourceWith(altPalette, { surface: '#ff0000' }, { stroke: '#ff0000' }))
    expect(edge.style.stroke).toBe('#ff0000')
    expect(edge.style.strokeWidth).toBe(9) // omitted → palette fallback
  })

  it('consults neither a prototype nor a StyleProfile during render', () => {
    // The DiagramSource carries no prototype/styleProfile fields at all — the
    // render path only reads `node.style` / `edge.style` over the palette. We
    // attach decoy fields the resolver must ignore.
    const node = {
      id: 'n1',
      entityId: 'e1',
      label: 'N',
      style: { surface: '#ff0000' },
      // decoys that must NOT influence the resolved style:
      nodePrototypeId: 'proto-should-be-ignored',
      styleProfileId: 'profile-should-be-ignored',
    } as unknown as Node
    const src: DiagramSource = {
      nodes: [node],
      edges: [],
      positions: new Map([['n1' as Uuid, { x: 0, y: 0 }]]),
      entities: new Map(),
      relationships: new Map(),
      // palette would re-skin surface if the resolver wrongly preferred it
      paletteTokens: { node: { surface: '#000000' } },
    }
    const [flow] = toFlowNodes(src)
    expect(flow.data.style.surface).toBe('#ff0000') // snapshot, not prototype/profile/palette
  })
})

describe('loadDiagram — positions come from the active layout', () => {
  it('switching the active layout changes positions but not styles', async () => {
    const gw = await createMemoryGateway()
    const ids = await bootstrapOrOpen(gw, memoryStorage())

    const a = await gw.addNode(ids.diagramId, ids.layoutId, {
      name: 'A',
      x: 10,
      y: 20,
      style: { surface: '#ff0000' },
    })

    // A second layout with a different position for the same node.
    const layout2 = await gw.createLayout(ids.diagramId, { name: 'Alt' })
    await gw.bulkUpsertPositions(layout2.id, [{ nodeId: a.node.id, x: 999, y: 888 }])

    const onLayout1 = await loadDiagram(gw, ids)
    const onLayout2 = await loadDiagram(gw, { ...ids, layoutId: layout2.id })

    const n1 = onLayout1.flowNodes.find((n) => n.id === a.node.id)!
    const n2 = onLayout2.flowNodes.find((n) => n.id === a.node.id)!

    // Positions differ per active layout…
    expect(n1.position).toEqual({ x: 10, y: 20 })
    expect(n2.position).toEqual({ x: 999, y: 888 })
    // …but the style snapshot is identical across layouts.
    expect(n1.data.style).toEqual(n2.data.style)
    expect(n2.data.style.surface).toBe('#ff0000')
  })
})
