/**
 * Phase 3 — Multi-view / subgraphs (spec §12) gateway integration tests.
 *
 * Real in-memory SQLite through the gateway + command bus. Proves the Phase 3
 * acceptance criteria: the same entity on two boards (via placeEntity), a
 * filtered view rendering a hops-from-focus subgraph, per-view palette swap
 * re-skinning (with a pinned value surviving), per-view viewport/positions
 * persisting, and all connections still resolving to base entities. Compound
 * gestures (placeEntity, deleteBoard, deleteView) revert as one undo each.
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
  const board = await gw.createBoard(graph.id, { name: 'Board 1' })
  const view = await gw.createView(board.id, { name: 'View 1' })
  return { graphId: graph.id, boardId: board.id, viewId: view.id }
}

describe('Phase 3 — the same entity appears on two boards (§7.1)', () => {
  it('placeEntity places one entity on board A and board B; usages list both', async () => {
    const gw = await createMemoryGateway(deterministicDeps())
    const { graphId, boardId: boardA, viewId: viewA } = await newGraph(gw)
    const boardB = await gw.createBoard(graphId, { name: 'Board B' })
    const viewB = await gw.createView(boardB.id, { name: 'View B' })

    // Create the entity by adding a node on A; then PLACE the same entity on B.
    const added = await gw.addNode(boardA, viewA, { name: 'Shared', x: 0, y: 0 })
    const placed = await gw.placeEntity(boardB.id, viewB.id, {
      entityId: added.entity.id,
      x: 50,
      y: 60,
    })
    expect(placed.node.entityId).toBe(added.entity.id) // same entity, new placement

    const detailA = await gw.getBoard(boardA)
    const detailB = await gw.getBoard(boardB.id)
    expect(detailA.nodes.some((n) => n.entityId === added.entity.id)).toBe(true)
    expect(detailB.nodes.some((n) => n.entityId === added.entity.id)).toBe(true)

    const usage = await gw.getEntityUsages(added.entity.id)
    expect(usage.placements.map((p) => p.nodeId).sort()).toEqual(
      [added.node.id, placed.node.id].sort(),
    )
    expect(usage.placements.map((p) => p.boardName).sort()).toEqual(['Board 1', 'Board B'])

    // Editing the entity reflects on both boards (one canonical thing).
    await gw.updateEntity(added.entity.id, { name: 'Renamed' })
    const entity = (await gw.getGraph(graphId)).entities.find((e) => e.id === added.entity.id)
    expect(entity?.name).toBe('Renamed')

    // The placement on B carried its own per-view position.
    const posB = detailB.views[0].positions.find((p) => p.nodeId === placed.node.id)
    expect(posB).toMatchObject({ x: 50, y: 60 })
  })

  it('placeEntity is one undoable command (node + position revert together)', async () => {
    const gw = await createMemoryGateway()
    const { graphId, boardId, viewId } = await newGraph(gw)
    const added = await gw.addNode(boardId, viewId, { name: 'E', x: 0, y: 0 })
    const board2 = await gw.createBoard(graphId, { name: 'B2' })
    const view2 = await gw.createView(board2.id, { name: 'V2' })

    await gw.placeEntity(board2.id, view2.id, { entityId: added.entity.id, x: 1, y: 1 })
    let detail = await gw.getBoard(board2.id)
    expect(detail.nodes).toHaveLength(1)
    expect(detail.views[0].positions).toHaveLength(1)

    expect(await gw.undo()).toBe(true)
    detail = await gw.getBoard(board2.id)
    expect(detail.nodes).toHaveLength(0)
    expect(detail.views[0].positions).toHaveLength(0)
    // The base entity survives the undo (we only removed the placement).
    expect((await gw.getGraph(graphId)).entities.some((e) => e.id === added.entity.id)).toBe(true)
  })
})

describe('Phase 3 — filtered view renders a hops-from-focus subgraph (§7.2)', () => {
  it('focus=X hops=1 renders only X and its 1-hop neighbors via the diagram transform', async () => {
    const gw = await createMemoryGateway()
    const { graphId, boardId, viewId } = await newGraph(gw)
    // Chain X — A — B
    const x = await gw.addNode(boardId, viewId, { name: 'X', x: 0, y: 0 })
    const a = await gw.addNode(boardId, viewId, { name: 'A', x: 100, y: 0 })
    const b = await gw.addNode(boardId, viewId, { name: 'B', x: 200, y: 0 })
    await gw.connectNodes(boardId, { sourceNodeId: x.node.id, targetNodeId: a.node.id })
    await gw.connectNodes(boardId, { sourceNodeId: a.node.id, targetNodeId: b.node.id })

    // Unfiltered: all three render.
    const all = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: null })
    expect(all.flowNodes).toHaveLength(3)

    // Set the view's focus+hops lens, then re-load: only X and A survive.
    await gw.updateView(viewId, { filter: { focusNodeId: x.node.id, hops: 1 } })
    const focused = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: null })
    expect(focused.flowNodes.map((n) => n.id).sort()).toEqual([x.node.id, a.node.id].sort())
    // The surviving edge still traces to a base relationship between base entities.
    expect(focused.flowEdges).toHaveLength(1)
    expect(focused.flowEdges[0].source).toBe(x.node.id)
    expect(focused.flowEdges[0].target).toBe(a.node.id)
  })

  it('prototype filter renders only nodes of that prototype', async () => {
    const gw = await createMemoryGateway()
    const { graphId, boardId, viewId } = await newGraph(gw)
    const proto = await gw.createPrototype(graphId, { kind: 'node', name: 'Box' })
    const boxed = await gw.addNode(boardId, viewId, { name: 'P', x: 0, y: 0, prototypeId: proto.id })
    await gw.addNode(boardId, viewId, { name: 'Q', x: 100, y: 0 })

    await gw.updateView(viewId, { filter: { prototypeIds: [proto.id] } })
    const snap = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: null })
    expect(snap.flowNodes.map((n) => n.id)).toEqual([boxed.node.id])
  })
})

describe('Phase 3 — per-view palette selection re-skins the view (§8.3, §8.4)', () => {
  it('switching paletteId re-skins a following node; a pinned value is unchanged', async () => {
    const gw = await createMemoryGateway()
    const { graphId, boardId, viewId } = await newGraph(gw)
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
    await gw.updateView(viewId, { paletteId: paletteA.id })

    // A following node (no pins) + a node pinning its surface.
    const following = await gw.addNode(boardId, viewId, { name: 'follow', x: 0, y: 0 })
    const pinned = await gw.addNode(boardId, viewId, {
      name: 'pinned',
      x: 100,
      y: 0,
      styleOverride: { surface: '#abcdef' },
    })

    const underA = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: paletteA.id })
    const fA = underA.flowNodes.find((n) => n.id === following.node.id)!
    const pA = underA.flowNodes.find((n) => n.id === pinned.node.id)!
    expect(fA.data.style.surface).toBe('#ffffff') // Default palette A
    expect(pA.data.style.surface).toBe('#abcdef') // pinned

    // Swap the view's palette (palette-switch is just updateView).
    await gw.updateView(viewId, { paletteId: paletteB.id })
    const underB = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: paletteB.id })
    const fB = underB.flowNodes.find((n) => n.id === following.node.id)!
    const pB = underB.flowNodes.find((n) => n.id === pinned.node.id)!
    expect(fB.data.style.surface).toBe('#1f2937') // re-skinned to Midnight
    expect(pB.data.style.surface).toBe('#abcdef') // pin survives the swap
  })
})

describe('Phase 3 — per-view viewport + positions persist (§7.2)', () => {
  it('updateView persists viewport; positions are per view', async () => {
    const gw = await createMemoryGateway()
    const { boardId, viewId } = await newGraph(gw)
    const view2 = await gw.createView(boardId, { name: 'View 2' })
    const n = await gw.addNode(boardId, viewId, { name: 'N', x: 10, y: 20 })
    // The same node sits differently in view 2 (per-view positions).
    await gw.bulkUpsertPositions(view2.id, [{ nodeId: n.node.id, x: 999, y: 888 }])

    await gw.updateView(viewId, { viewport: { x: 5, y: 6, zoom: 1.5 } })

    const detail = await gw.getBoard(boardId)
    const v1 = detail.views.find((v) => v.id === viewId)!
    const v2 = detail.views.find((v) => v.id === view2.id)!
    expect(v1.viewport).toEqual({ x: 5, y: 6, zoom: 1.5 })
    expect(v1.positions.find((p) => p.nodeId === n.node.id)).toMatchObject({ x: 10, y: 20 })
    expect(v2.positions.find((p) => p.nodeId === n.node.id)).toMatchObject({ x: 999, y: 888 })
  })
})

describe('Phase 3 — all connections still resolve to base entities (§7.4)', () => {
  it('after multi-board placement + filtering, every rendered edge traces to a base relationship', async () => {
    const gw = await createMemoryGateway()
    const { graphId, boardId, viewId } = await newGraph(gw)
    const a = await gw.addNode(boardId, viewId, { name: 'A', x: 0, y: 0 })
    const b = await gw.addNode(boardId, viewId, { name: 'B', x: 100, y: 0 })
    const conn = await gw.connectNodes(boardId, { sourceNodeId: a.node.id, targetNodeId: b.node.id })
    // Place A on a second board too.
    const board2 = await gw.createBoard(graphId, { name: 'B2' })
    const view2 = await gw.createView(board2.id, { name: 'V2' })
    await gw.placeEntity(board2.id, view2.id, { entityId: a.entity.id, x: 0, y: 0 })

    const snap = await loadDiagram(gw, { graphId, boardId, viewId, paletteId: null })
    const graph = await gw.getGraph(graphId)
    const rels = new Map(graph.relationships.map((r) => [r.id, r]))
    const detail = await gw.getBoard(boardId)
    const nodeEntity = new Map(detail.nodes.map((n) => [n.id, n.entityId]))
    for (const fe of snap.flowEdges) {
      // The rendered edge id maps to a board edge → a base relationship → base entities.
      const boardEdge = detail.edges.find((e) => e.id === fe.id)!
      const rel = rels.get(boardEdge.relationshipId)!
      expect(rel.sourceEntityId).toBe(nodeEntity.get(fe.source))
      expect(rel.targetEntityId).toBe(nodeEntity.get(fe.target))
    }
    expect(snap.flowEdges[0].id).toBe(conn.edge.id)
  })
})

describe('Phase 3 — delete board / view are single undoable commands (§7.1)', () => {
  it('deleteBoard removes nodes/edges/views/positions but not base entities, one undo', async () => {
    const gw = await createMemoryGateway()
    const { graphId, boardId, viewId } = await newGraph(gw)
    const a = await gw.addNode(boardId, viewId, { name: 'A', x: 0, y: 0 })
    const b = await gw.addNode(boardId, viewId, { name: 'B', x: 1, y: 1 })
    await gw.connectNodes(boardId, { sourceNodeId: a.node.id, targetNodeId: b.node.id })

    await gw.deleteBoard(boardId)
    expect((await gw.getGraph(graphId)).boards.some((bd) => bd.id === boardId)).toBe(false)
    // Base entities survive a board deletion.
    expect((await gw.getGraph(graphId)).entities).toHaveLength(2)

    expect(await gw.undo()).toBe(true)
    const restored = await gw.getBoard(boardId)
    expect(restored.nodes).toHaveLength(2)
    expect(restored.edges).toHaveLength(1)
    expect(restored.views[0].positions).toHaveLength(2)
  })

  it('deleteView removes the view + its positions, one undo', async () => {
    const gw = await createMemoryGateway()
    const { boardId, viewId } = await newGraph(gw)
    const view2 = await gw.createView(boardId, { name: 'View 2' })
    const n = await gw.addNode(boardId, viewId, { name: 'N', x: 0, y: 0 })
    await gw.bulkUpsertPositions(view2.id, [{ nodeId: n.node.id, x: 5, y: 5 }])

    await gw.deleteView(view2.id)
    let detail = await gw.getBoard(boardId)
    expect(detail.views.some((v) => v.id === view2.id)).toBe(false)

    expect(await gw.undo()).toBe(true)
    detail = await gw.getBoard(boardId)
    const restored = detail.views.find((v) => v.id === view2.id)
    expect(restored?.positions).toHaveLength(1)
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
