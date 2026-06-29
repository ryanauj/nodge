/**
 * Phase 3 — Multi-layout / subgraphs (spec §12) gateway integration tests.
 *
 * Real in-memory SQLite through the gateway + command bus. Proves the Phase 3
 * acceptance criteria: the same entity on two diagrams (via placeEntity), a
 * per-layout palette swap re-skinning (with a pinned value surviving), per-layout
 * viewport/positions persisting, and all connections still resolving to base
 * entities. Compound gestures (placeEntity, deleteDiagram, deleteLayout) revert
 * as one undo each.
 */

import { describe, it, expect } from 'vitest'
import { createMemoryGateway, type GatewayDeps } from './index'
import type { LocalGateway } from './LocalGateway'
import { loadDiagram } from '../editor/diagram'
import { BUILTIN_PALETTES, DEFAULT_PALETTE_TOKENS } from '../editor/style'

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

describe('Phase 3 — the same entity appears on two diagrams (§7.1)', () => {
  it('placeEntity places one entity on diagram A and diagram B; usages list both', async () => {
    const gw = await createMemoryGateway(deterministicDeps())
    const { graphId, diagramId: diagramA, layoutId: layoutA } = await newGraph(gw)
    const diagramB = await gw.createDiagram(graphId, { name: 'Diagram B' })
    const layoutB = await gw.createLayout(diagramB.id, { name: 'Layout B' })

    // Create the entity by adding a node on A; then PLACE the same entity on B.
    const added = await gw.addNode(diagramA, layoutA, { name: 'Shared', x: 0, y: 0 })
    const placed = await gw.placeEntity(diagramB.id, layoutB.id, {
      entityId: added.entity.id,
      x: 50,
      y: 60,
    })
    expect(placed.node.entityId).toBe(added.entity.id) // same entity, new placement

    const detailA = await gw.getDiagram(diagramA)
    const detailB = await gw.getDiagram(diagramB.id)
    expect(detailA.nodes.some((n) => n.entityId === added.entity.id)).toBe(true)
    expect(detailB.nodes.some((n) => n.entityId === added.entity.id)).toBe(true)

    const usage = await gw.getEntityUsages(added.entity.id)
    expect(usage.placements.map((p) => p.nodeId).sort()).toEqual(
      [added.node.id, placed.node.id].sort(),
    )
    expect(usage.placements.map((p) => p.diagramName).sort()).toEqual(['Diagram 1', 'Diagram B'])

    // Editing the entity reflects on both diagrams (one canonical thing).
    await gw.updateEntity(added.entity.id, { name: 'Renamed' })
    const entity = (await gw.getGraph(graphId)).entities.find((e) => e.id === added.entity.id)
    expect(entity?.name).toBe('Renamed')

    // The placement on B carried its own per-layout position.
    const posB = detailB.layouts[0].positions.find((p) => p.nodeId === placed.node.id)
    expect(posB).toMatchObject({ x: 50, y: 60 })
  })

  it('placeEntity snapshots the entity NodePrototype style onto the new node (§D3)', async () => {
    const gw = await createMemoryGateway(deterministicDeps())
    const { graphId, diagramId, layoutId } = await newGraph(gw)
    const proto = await gw.createPrototype(graphId, {
      kind: 'node',
      name: 'Service',
      style: { surface: '#eef', shape: 'pill' },
    })
    const added = await gw.addNode(diagramId, layoutId, {
      name: 'Shared',
      x: 0,
      y: 0,
      nodePrototypeId: proto.id,
    })
    const diagram2 = await gw.createDiagram(graphId, { name: 'D2' })
    const layout2 = await gw.createLayout(diagram2.id, { name: 'L2' })

    const placed = await gw.placeEntity(diagram2.id, layout2.id, {
      entityId: added.entity.id,
      x: 10,
      y: 10,
    })
    // The new placement copies the linked prototype's style snapshot.
    expect(placed.node.style).toMatchObject({ surface: '#eef', shape: 'pill' })

    // An explicit input.style overrides individual snapshot keys.
    const placedPinned = await gw.placeEntity(diagram2.id, layout2.id, {
      entityId: added.entity.id,
      x: 20,
      y: 20,
      style: { surface: '#000' },
    })
    expect(placedPinned.node.style).toMatchObject({ surface: '#000', shape: 'pill' })
  })

  it('placeEntity is one undoable command (node + position revert together)', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId, layoutId } = await newGraph(gw)
    const added = await gw.addNode(diagramId, layoutId, { name: 'E', x: 0, y: 0 })
    const diagram2 = await gw.createDiagram(graphId, { name: 'D2' })
    const layout2 = await gw.createLayout(diagram2.id, { name: 'L2' })

    await gw.placeEntity(diagram2.id, layout2.id, { entityId: added.entity.id, x: 1, y: 1 })
    let detail = await gw.getDiagram(diagram2.id)
    expect(detail.nodes).toHaveLength(1)
    expect(detail.layouts[0].positions).toHaveLength(1)

    expect(await gw.undo()).toBe(true)
    detail = await gw.getDiagram(diagram2.id)
    expect(detail.nodes).toHaveLength(0)
    expect(detail.layouts[0].positions).toHaveLength(0)
    // The base entity survives the undo (we only removed the placement).
    expect((await gw.getGraph(graphId)).entities.some((e) => e.id === added.entity.id)).toBe(true)
  })
})

describe('Phase 3 — per-palette selection re-skins the diagram (§8.3, §8.4)', () => {
  it('switching paletteId re-skins a following node; a pinned value is unchanged', async () => {
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

    // A following node (no pins) + a node pinning its surface.
    const following = await gw.addNode(diagramId, layoutId, { name: 'follow', x: 0, y: 0 })
    const pinned = await gw.addNode(diagramId, layoutId, {
      name: 'pinned',
      x: 100,
      y: 0,
      style: { surface: '#abcdef' },
    })

    const underA = await loadDiagram(gw, { graphId, diagramId, layoutId, paletteId: paletteA.id })
    const fA = underA.flowNodes.find((n) => n.id === following.node.id)!
    const pA = underA.flowNodes.find((n) => n.id === pinned.node.id)!
    expect(fA.data.style.surface).toBe('#ffffff') // Default palette A
    expect(pA.data.style.surface).toBe('#abcdef') // pinned

    // Swap the palette the diagram is loaded under.
    const underB = await loadDiagram(gw, { graphId, diagramId, layoutId, paletteId: paletteB.id })
    const fB = underB.flowNodes.find((n) => n.id === following.node.id)!
    const pB = underB.flowNodes.find((n) => n.id === pinned.node.id)!
    expect(fB.data.style.surface).toBe('#1f2937') // re-skinned to Midnight
    expect(pB.data.style.surface).toBe('#abcdef') // pin survives the swap
  })
})

describe('Phase 3 — per-layout viewport + positions persist (§7.2)', () => {
  it('updateLayout persists viewport; positions are per layout', async () => {
    const gw = await createMemoryGateway()
    const { diagramId, layoutId } = await newGraph(gw)
    const layout2 = await gw.createLayout(diagramId, { name: 'Layout 2' })
    const n = await gw.addNode(diagramId, layoutId, { name: 'N', x: 10, y: 20 })
    // The same node sits differently in layout 2 (per-layout positions).
    await gw.bulkUpsertPositions(layout2.id, [{ nodeId: n.node.id, x: 999, y: 888 }])

    await gw.updateLayout(layoutId, { viewport: { x: 5, y: 6, zoom: 1.5 } })

    const detail = await gw.getDiagram(diagramId)
    const l1 = detail.layouts.find((l) => l.id === layoutId)!
    const l2 = detail.layouts.find((l) => l.id === layout2.id)!
    expect(l1.viewport).toEqual({ x: 5, y: 6, zoom: 1.5 })
    expect(l1.positions.find((p) => p.nodeId === n.node.id)).toMatchObject({ x: 10, y: 20 })
    expect(l2.positions.find((p) => p.nodeId === n.node.id)).toMatchObject({ x: 999, y: 888 })
  })
})

describe('Phase 3 — all connections still resolve to base entities (§7.4)', () => {
  it('after multi-diagram placement, every rendered edge traces to a base relationship', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId, layoutId } = await newGraph(gw)
    const a = await gw.addNode(diagramId, layoutId, { name: 'A', x: 0, y: 0 })
    const b = await gw.addNode(diagramId, layoutId, { name: 'B', x: 100, y: 0 })
    const conn = await gw.connectNodes(diagramId, { sourceNodeId: a.node.id, targetNodeId: b.node.id })
    // Place A on a second diagram too.
    const diagram2 = await gw.createDiagram(graphId, { name: 'D2' })
    const layout2 = await gw.createLayout(diagram2.id, { name: 'L2' })
    await gw.placeEntity(diagram2.id, layout2.id, { entityId: a.entity.id, x: 0, y: 0 })

    const snap = await loadDiagram(gw, { graphId, diagramId, layoutId, paletteId: null })
    const graph = await gw.getGraph(graphId)
    const rels = new Map(graph.relationships.map((r) => [r.id, r]))
    const detail = await gw.getDiagram(diagramId)
    const nodeEntity = new Map(detail.nodes.map((n) => [n.id, n.entityId]))
    for (const fe of snap.flowEdges) {
      // The rendered edge id maps to a diagram edge → a base relationship → base entities.
      const diagramEdge = detail.edges.find((e) => e.id === fe.id)!
      const rel = rels.get(diagramEdge.relationshipId)!
      expect(rel.sourceEntityId).toBe(nodeEntity.get(fe.source))
      expect(rel.targetEntityId).toBe(nodeEntity.get(fe.target))
    }
    expect(snap.flowEdges[0].id).toBe(conn.edge.id)
  })
})

describe('Phase 3 — delete diagram / layout are single undoable commands (§7.1)', () => {
  it('deleteDiagram removes nodes/edges/layouts/positions but not base entities, one undo', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId, layoutId } = await newGraph(gw)
    const a = await gw.addNode(diagramId, layoutId, { name: 'A', x: 0, y: 0 })
    const b = await gw.addNode(diagramId, layoutId, { name: 'B', x: 1, y: 1 })
    await gw.connectNodes(diagramId, { sourceNodeId: a.node.id, targetNodeId: b.node.id })

    await gw.deleteDiagram(diagramId)
    expect((await gw.getGraph(graphId)).diagrams.some((d) => d.id === diagramId)).toBe(false)
    // Base entities survive a diagram deletion.
    expect((await gw.getGraph(graphId)).entities).toHaveLength(2)

    expect(await gw.undo()).toBe(true)
    const restored = await gw.getDiagram(diagramId)
    expect(restored.nodes).toHaveLength(2)
    expect(restored.edges).toHaveLength(1)
    expect(restored.layouts[0].positions).toHaveLength(2)
  })

  it('deleteLayout removes the layout + its positions, one undo', async () => {
    const gw = await createMemoryGateway()
    const { diagramId, layoutId } = await newGraph(gw)
    const layout2 = await gw.createLayout(diagramId, { name: 'Layout 2' })
    const n = await gw.addNode(diagramId, layoutId, { name: 'N', x: 0, y: 0 })
    await gw.bulkUpsertPositions(layout2.id, [{ nodeId: n.node.id, x: 5, y: 5 }])

    await gw.deleteLayout(layout2.id)
    let detail = await gw.getDiagram(diagramId)
    expect(detail.layouts.some((l) => l.id === layout2.id)).toBe(false)

    expect(await gw.undo()).toBe(true)
    detail = await gw.getDiagram(diagramId)
    const restored = detail.layouts.find((l) => l.id === layout2.id)
    expect(restored?.positions).toHaveLength(1)
  })

  it('cannot delete the last layout of a diagram (§D2: a diagram keeps ≥1 layout)', async () => {
    const gw = await createMemoryGateway()
    const { diagramId, layoutId } = await newGraph(gw)
    // Only one layout exists → deletion is rejected.
    await expect(gw.deleteLayout(layoutId)).rejects.toThrow(/last layout/)

    // Add a second → now deleting one is allowed, leaving exactly one behind.
    const layout2 = await gw.createLayout(diagramId, { name: 'Layout 2' })
    await gw.deleteLayout(layout2.id)
    const detail = await gw.getDiagram(diagramId)
    expect(detail.layouts).toHaveLength(1)
    expect(detail.layouts[0].id).toBe(layoutId)

    // The remaining sole layout still cannot be removed.
    await expect(gw.deleteLayout(layoutId)).rejects.toThrow(/last layout/)
  })

  it('layout CRUD: create / update (rename, algorithm, viewport) round-trips', async () => {
    const gw = await createMemoryGateway()
    const { diagramId } = await newGraph(gw)
    const layout = await gw.createLayout(diagramId, { name: 'Auto', algorithm: 'dagre' })
    expect(layout.algorithm).toBe('dagre')

    const renamed = await gw.updateLayout(layout.id, {
      name: 'Renamed',
      algorithm: 'manual',
      viewport: { x: 1, y: 2, zoom: 3 },
    })
    expect(renamed.name).toBe('Renamed')
    expect(renamed.algorithm).toBe('manual')
    expect(renamed.viewport).toEqual({ x: 1, y: 2, zoom: 3 })

    // updateLayout is a single undoable command.
    expect(await gw.undo()).toBe(true)
    const after = (await gw.getDiagram(diagramId)).layouts.find((l) => l.id === layout.id)
    expect(after?.name).toBe('Auto')
    expect(after?.viewport).toBeNull()
  })
})

describe('Phase 3 — built-in palette library is seeded (§8.4)', () => {
  it('the default tokens still resolve and the library has distinct looks', () => {
    expect(BUILTIN_PALETTES.length).toBeGreaterThanOrEqual(3)
    expect(BUILTIN_PALETTES[0].tokens).toBe(DEFAULT_PALETTE_TOKENS)
    const surfaces = BUILTIN_PALETTES.map(
      (p) => (p.tokens.node as Record<string, unknown>).surface,
    )
    expect(new Set(surfaces).size).toBe(BUILTIN_PALETTES.length) // all distinct
  })
})
