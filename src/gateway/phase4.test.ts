/**
 * Phase 4 — Styling depth & palettes (spec §12) gateway integration tests.
 *
 * Real in-memory SQLite through the gateway + command bus. Proves the Phase 4
 * acceptance criteria at the data seam:
 *   - duplicate/create/update a palette, load a diagram under it, and read the
 *     custom tokens back through the diagram transform (custom palette);
 *   - pin one node's color via updateNode({ style }); it survives a palette swap
 *     while unpinned nodes re-skin;
 *   - edge pin/unlink via updateEdge is a single undoable command.
 * Each new mutation reverts as a single undo.
 */

import { describe, it, expect } from 'vitest'
import { createMemoryGateway, type GatewayDeps } from './index'
import type { LocalGateway } from './LocalGateway'
import { loadDiagram } from '../editor/diagram'
import { BUILTIN_PALETTES, DEFAULT_PALETTE_TOKENS } from '../editor/style'
import { DEFAULT_FULL_TOKENS, fullTokens, toPaletteTokens } from '../editor/tokens'

function deterministicDeps(): GatewayDeps {
  let n = 0
  let t = 0
  return {
    newId: () => `id-${String(++n).padStart(4, '0')}`,
    now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}.000Z`,
  }
}

async function newGraph(gw: LocalGateway) {
  const graph = await gw.createGraph({ name: 'G' })
  const diagram = await gw.createDiagram(graph.id, { name: 'Diagram 1' })
  const layout = await gw.createLayout(diagram.id, { name: 'Layout 1' })
  return { graphId: graph.id, diagramId: diagram.id, layoutId: layout.id }
}

describe('Phase 4 — custom palette: duplicate, edit a token, load the diagram under it (§8.4)', () => {
  it('duplicatePalette + updatePalette tokens render through the diagram transform', async () => {
    const gw = await createMemoryGateway(deterministicDeps())
    const { graphId, diagramId, layoutId } = await newGraph(gw)
    const base = await gw.createPalette(graphId, {
      name: 'Default',
      tokens: DEFAULT_PALETTE_TOKENS,
      builtin: true,
    })

    // Duplicate the built-in → a new, editable (non-builtin) palette.
    const fork = await gw.duplicatePalette(base.id, 'My palette')
    expect(fork.builtin).toBe(false)
    expect(fork.name).toBe('My palette')

    // Edit a single token: a hot-pink node surface.
    const customNode = { ...fullTokens(fork.tokens).node, surface: '#ff00aa' }
    await gw.updatePalette(fork.id, {
      tokens: toPaletteTokens({ ...fullTokens(fork.tokens), node: customNode }),
    })

    // Place a (following) node and load the diagram under the custom palette.
    const node = await gw.addNode(diagramId, layoutId, { name: 'N', x: 0, y: 0 })

    const snap = await loadDiagram(gw, { graphId, diagramId, layoutId, paletteId: fork.id })
    const flow = snap.flowNodes.find((n) => n.id === node.node.id)!
    expect(flow.data.style.surface).toBe('#ff00aa') // renders with the custom token
  })

  it('editing a built-in palette clears its builtin flag (seeded library stays pristine)', async () => {
    const gw = await createMemoryGateway()
    const { graphId } = await newGraph(gw)
    const p = await gw.createPalette(graphId, { name: 'Seeded', tokens: {}, builtin: true })
    const updated = await gw.updatePalette(p.id, {
      tokens: toPaletteTokens(DEFAULT_FULL_TOKENS),
    })
    expect(updated.builtin).toBe(false)
  })

  it('deletePalette / updatePalette / duplicatePalette are single undoable commands', async () => {
    const gw = await createMemoryGateway()
    const { graphId } = await newGraph(gw)
    const p = await gw.createPalette(graphId, { name: 'P', tokens: {}, builtin: false })

    await gw.updatePalette(p.id, { name: 'Renamed' })
    expect((await gw.listPalettes(graphId)).find((x) => x.id === p.id)?.name).toBe('Renamed')
    expect(await gw.undo()).toBe(true)
    expect((await gw.listPalettes(graphId)).find((x) => x.id === p.id)?.name).toBe('P')

    const dup = await gw.duplicatePalette(p.id, 'Dup')
    expect((await gw.listPalettes(graphId)).some((x) => x.id === dup.id)).toBe(true)
    expect(await gw.undo()).toBe(true)
    expect((await gw.listPalettes(graphId)).some((x) => x.id === dup.id)).toBe(false)

    await gw.deletePalette(p.id)
    expect((await gw.listPalettes(graphId)).some((x) => x.id === p.id)).toBe(false)
    expect(await gw.undo()).toBe(true)
    expect((await gw.listPalettes(graphId)).some((x) => x.id === p.id)).toBe(true)
  })
})

describe('Phase 4 — pin one node color; it survives a palette swap (§8.3)', () => {
  it('pinning surface via updateNode keeps the color across a palette switch', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId, layoutId } = await newGraph(gw)
    const paletteA = await gw.createPalette(graphId, {
      name: 'A',
      tokens: BUILTIN_PALETTES[0].tokens, // Default — surface #ffffff
      builtin: true,
    })
    const paletteB = await gw.createPalette(graphId, {
      name: 'B',
      tokens: BUILTIN_PALETTES[1].tokens, // Midnight — surface #1f2937
      builtin: true,
    })

    const following = await gw.addNode(diagramId, layoutId, { name: 'follow', x: 0, y: 0 })
    const pinnedNode = await gw.addNode(diagramId, layoutId, { name: 'pin', x: 100, y: 0 })

    // Pin the node's surface to a raw literal via the link/unlink affordance.
    await gw.updateNode(pinnedNode.node.id, { style: { surface: '#abcdef' } })

    let snap = await loadDiagram(gw, { graphId, diagramId, layoutId, paletteId: paletteA.id })
    expect(snap.flowNodes.find((n) => n.id === following.node.id)!.data.style.surface).toBe('#ffffff')
    expect(snap.flowNodes.find((n) => n.id === pinnedNode.node.id)!.data.style.surface).toBe('#abcdef')

    // Swap the palette the diagram is loaded under.
    snap = await loadDiagram(gw, { graphId, diagramId, layoutId, paletteId: paletteB.id })
    expect(snap.flowNodes.find((n) => n.id === following.node.id)!.data.style.surface).toBe('#1f2937')
    expect(snap.flowNodes.find((n) => n.id === pinnedNode.node.id)!.data.style.surface).toBe('#abcdef')
  })

  it('unpinning (removing the key) makes the node follow the palette again', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId, layoutId } = await newGraph(gw)
    const palette = await gw.createPalette(graphId, {
      name: 'A',
      tokens: BUILTIN_PALETTES[1].tokens, // Midnight surface #1f2937
      builtin: true,
    })
    const n = await gw.addNode(diagramId, layoutId, {
      name: 'N',
      x: 0,
      y: 0,
      style: { surface: '#abcdef' },
    })
    // Unlink: write a style without the surface key.
    await gw.updateNode(n.node.id, { style: {} })
    const snap = await loadDiagram(gw, { graphId, diagramId, layoutId, paletteId: palette.id })
    expect(snap.flowNodes.find((x) => x.id === n.node.id)!.data.style.surface).toBe('#1f2937')
  })
})

describe('Phase 4 — edge pin/unlink affordance: updateEdge is one undoable command (§8.3)', () => {
  it('pins an edge style key, survives a palette swap, and unpins as a single undo', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId, layoutId } = await newGraph(gw)
    const paletteA = await gw.createPalette(graphId, {
      name: 'A',
      tokens: BUILTIN_PALETTES[0].tokens, // Default — edge stroke #4361ee
      builtin: true,
    })
    const paletteB = await gw.createPalette(graphId, {
      name: 'B',
      tokens: BUILTIN_PALETTES[1].tokens, // Midnight — edge stroke #60a5fa
      builtin: true,
    })

    const a = await gw.addNode(diagramId, layoutId, { name: 'A', x: 0, y: 0 })
    const b = await gw.addNode(diagramId, layoutId, { name: 'B', x: 100, y: 0 })
    const { edge } = await gw.connectNodes(diagramId, {
      sourceNodeId: a.node.id,
      targetNodeId: b.node.id,
    })

    // Pin the edge's stroke to a raw literal via updateEdge (link/unlink).
    await gw.updateEdge(edge.id, { style: { stroke: '#abcdef' } })
    let snap = await loadDiagram(gw, { graphId, diagramId, layoutId, paletteId: paletteA.id })
    expect(snap.flowEdges.find((e) => e.id === edge.id)!.style.stroke).toBe('#abcdef')

    // Swap the palette — the pinned edge keeps its raw stroke.
    snap = await loadDiagram(gw, { graphId, diagramId, layoutId, paletteId: paletteB.id })
    expect(snap.flowEdges.find((e) => e.id === edge.id)!.style.stroke).toBe('#abcdef')

    // Unlink (write a style without the key) → follows the palette again.
    await gw.updateEdge(edge.id, { style: {} })
    snap = await loadDiagram(gw, { graphId, diagramId, layoutId, paletteId: paletteB.id })
    expect(snap.flowEdges.find((e) => e.id === edge.id)!.style.stroke).toBe('#60a5fa')

    // Each updateEdge was a single undoable command: undo reverts the unlink.
    expect(await gw.undo()).toBe(true)
    snap = await loadDiagram(gw, { graphId, diagramId, layoutId, paletteId: paletteB.id })
    expect(snap.flowEdges.find((e) => e.id === edge.id)!.style.stroke).toBe('#abcdef')
  })
})

describe('Phase 4 — old minimal palettes still load (§8.2)', () => {
  it('a document with a legacy {node,edge} palette imports + round-trips + renders', async () => {
    const gw = await createMemoryGateway(deterministicDeps())
    const { graphId } = await newGraph(gw)
    // A legacy palette: only the minimal Phase-1 token shape.
    const legacyTokens = {
      node: { surface: '#2b2b2b', content: '#fafafa', border: '#888888', shape: 'rect' },
      edge: { stroke: '#888888', strokeWidth: 1 },
    }
    const legacy = await gw.createPalette(graphId, { name: 'Legacy', tokens: legacyTokens })

    // Export → re-import into a fresh DB → the legacy palette survives unchanged.
    const doc = await gw.exportJson(graphId)
    const fresh = await createMemoryGateway()
    const importedGraph = await fresh.importJson(doc)
    const palettes = await fresh.listPalettes(importedGraph.id)
    const round = palettes.find((p) => p.id === legacy.id)!
    expect(round.tokens).toEqual(legacyTokens) // lossless round-trip

    // It still resolves to a complete, total style.
    const full = fullTokens(round.tokens)
    expect(full.node.surface).toBe('#2b2b2b')
    expect(full.node.shape).toBe('rect')
    // Fields the legacy palette never had are filled from defaults.
    expect(full.intent.primary.bg).toBe(DEFAULT_FULL_TOKENS.intent.primary.bg)
    expect(full.elevation.low).toBe(DEFAULT_FULL_TOKENS.elevation.low)
  })
})

describe('Phase 4 — generateLayout: Dagre auto-arrange persists per-layout positions (§8, D8)', () => {
  // Build a parent → two-children diagram and return ids for assertions.
  async function seedTriangle(gw: LocalGateway) {
    const { graphId, diagramId, layoutId } = await newGraph(gw)
    const root = await gw.addNode(diagramId, layoutId, { name: 'root', x: 0, y: 0 })
    const left = await gw.addNode(diagramId, layoutId, { name: 'left', x: 0, y: 0 })
    const right = await gw.addNode(diagramId, layoutId, { name: 'right', x: 0, y: 0 })
    await gw.connectNodes(diagramId, { sourceNodeId: root.node.id, targetNodeId: left.node.id })
    await gw.connectNodes(diagramId, { sourceNodeId: root.node.id, targetNodeId: right.node.id })
    return {
      graphId,
      diagramId,
      layoutId,
      rootId: root.node.id,
      leftId: left.node.id,
      rightId: right.node.id,
    }
  }

  function positionsFor(detail: Awaited<ReturnType<LocalGateway['getDiagram']>>, layoutId: string) {
    const layout = detail.layouts.find((l) => l.id === layoutId)!
    return new Map(layout.positions.map((p) => [p.nodeId, p]))
  }

  it('bulk-upserts positions for the right layout and ranks the parent above children', async () => {
    const gw = await createMemoryGateway()
    const { diagramId, layoutId, rootId, leftId, rightId } = await seedTriangle(gw)

    const result = await gw.generateLayout(diagramId, layoutId)
    expect(result.map((p) => p.nodeId).sort()).toEqual([rootId, leftId, rightId].sort())

    const detail = await gw.getDiagram(diagramId)
    const pos = positionsFor(detail, layoutId)
    expect(pos.size).toBe(3)
    // TB default: root sits above (smaller y than) both children.
    expect(pos.get(rootId)!.y).toBeLessThan(pos.get(leftId)!.y)
    expect(pos.get(rootId)!.y).toBeLessThan(pos.get(rightId)!.y)
    // Children share a rank.
    expect(pos.get(leftId)!.y).toBe(pos.get(rightId)!.y)
  })

  it("marks the layout's algorithm 'dagre'", async () => {
    const gw = await createMemoryGateway()
    const { diagramId, layoutId } = await seedTriangle(gw)
    expect((await gw.getDiagram(diagramId)).layouts.find((l) => l.id === layoutId)!.algorithm).toBe(
      'manual',
    )
    await gw.generateLayout(diagramId, layoutId)
    expect((await gw.getDiagram(diagramId)).layouts.find((l) => l.id === layoutId)!.algorithm).toBe(
      'dagre',
    )
  })

  it('is deterministic — re-running yields identical positions', async () => {
    const gw = await createMemoryGateway()
    const { diagramId, layoutId } = await seedTriangle(gw)
    const first = await gw.generateLayout(diagramId, layoutId)
    const second = await gw.generateLayout(diagramId, layoutId)
    expect(second).toEqual(first)
  })

  it('is one undoable command (positions + algorithm revert together)', async () => {
    const gw = await createMemoryGateway()
    const { diagramId, layoutId, rootId } = await seedTriangle(gw)

    // Hand-place a known position first, so we can see undo restore it.
    await gw.bulkUpsertPositions(layoutId, [{ nodeId: rootId, x: 11, y: 22 }])
    const before = positionsFor(await gw.getDiagram(diagramId), layoutId).get(rootId)!
    expect(before).toMatchObject({ x: 11, y: 22 })

    await gw.generateLayout(diagramId, layoutId)
    const moved = positionsFor(await gw.getDiagram(diagramId), layoutId).get(rootId)!
    expect(moved.x === 11 && moved.y === 22).toBe(false)

    // A single undo reverts both the positions and the algorithm flag.
    expect(await gw.undo()).toBe(true)
    const detail = await gw.getDiagram(diagramId)
    expect(positionsFor(detail, layoutId).get(rootId)).toMatchObject({ x: 11, y: 22 })
    expect(detail.layouts.find((l) => l.id === layoutId)!.algorithm).toBe('manual')
  })

  it('rejects a layout that does not belong to the diagram', async () => {
    const gw = await createMemoryGateway()
    const { diagramId } = await seedTriangle(gw)
    const other = await seedTriangle(gw)
    await expect(gw.generateLayout(diagramId, other.layoutId)).rejects.toThrow()
  })
})
