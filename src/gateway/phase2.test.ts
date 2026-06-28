/**
 * Phase 2 — Identity & reuse (spec §12) gateway integration tests.
 *
 * Real in-memory SQLite through the gateway + command bus. Proves the Phase 2
 * acceptance criteria: one entity behind two placements, batch refresh from a
 * prototype, the cross-reference index, drag-to-create (both paths, one undo),
 * save-as-prototype / duplicate, and copy/paste = placement.
 */

import { describe, it, expect } from 'vitest'
import { createMemoryGateway, type GatewayDeps } from './index'
import { buildClipboard, serializeClipboard, parseClipboard } from './clipboard'
import type { LocalGateway } from './LocalGateway'

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

describe('Phase 2 — identity: one entity behind many placements', () => {
  it('two placements trace to one entity; editing the entity updates both', async () => {
    const gw = await createMemoryGateway(deterministicDeps())
    const { boardId, viewId } = await newGraph(gw)

    const added = await gw.addNode(boardId, viewId, { name: 'Service', x: 0, y: 0 })
    // Second placement of the SAME entity (createNode references entityId).
    const node2 = await gw.createNode(boardId, { entityId: added.entity.id, label: 'second' })

    const board = await gw.getBoard(boardId)
    const placingEntity = board.nodes.filter((n) => n.entityId === added.entity.id)
    expect(placingEntity).toHaveLength(2)

    await gw.updateEntity(added.entity.id, {
      name: 'Renamed',
      links: [{ id: 'l1', kind: 'url', target: 'https://x', label: 'docs' }],
      metadata: { tier: 'backend' },
    })

    const usage = await gw.getEntityUsages(added.entity.id)
    expect(usage.placements.map((p) => p.nodeId).sort()).toEqual(
      [added.node.id, node2.id].sort(),
    )

    const entity = (await gw.getGraph(added.entity.graphId)).entities.find(
      (e) => e.id === added.entity.id,
    )
    expect(entity?.name).toBe('Renamed')
    expect(entity?.links).toHaveLength(1)
    expect(entity?.metadata).toEqual({ tier: 'backend' })
    // Both placements still resolve to the single updated entity.
    expect(new Set(placingEntity.map((n) => n.entityId))).toEqual(new Set([added.entity.id]))
  })
})

describe('Phase 2 — entity↔prototype seed + refresh (§9.2)', () => {
  it('seeds entity style + metadata from the prototype on create', async () => {
    const gw = await createMemoryGateway()
    const { graphId, boardId, viewId } = await newGraph(gw)
    const proto = await gw.createPrototype(graphId, {
      kind: 'node',
      name: 'Service',
      style: { surface: '#eef', shape: 'pill' },
      metadata: { tier: 'backend' },
    })
    const added = await gw.addNode(boardId, viewId, {
      name: 'svc',
      x: 0,
      y: 0,
      prototypeId: proto.id,
    })
    const entity = (await gw.getGraph(graphId)).entities.find((e) => e.id === added.entity.id)
    expect(entity?.styleOverride).toMatchObject({ surface: '#eef', shape: 'pill' })
    expect(entity?.metadata).toEqual({ tier: 'backend' })
  })

  it('batch refresh re-applies the prototype current style+metadata; un-refreshed untouched', async () => {
    const gw = await createMemoryGateway()
    const { graphId, boardId, viewId } = await newGraph(gw)
    const proto = await gw.createPrototype(graphId, {
      kind: 'node',
      name: 'Service',
      style: { surface: '#aaa' },
      metadata: { v: 1 },
    })
    const e1 = await gw.addNode(boardId, viewId, { name: 'a', x: 0, y: 0, prototypeId: proto.id })
    const e2 = await gw.addNode(boardId, viewId, { name: 'b', x: 1, y: 1, prototypeId: proto.id })
    const e3 = await gw.addNode(boardId, viewId, { name: 'c', x: 2, y: 2, prototypeId: proto.id })
    // An entity NOT linked to this prototype — must stay untouched.
    const other = await gw.addNode(boardId, viewId, { name: 'other', x: 3, y: 3 })
    await gw.updateEntity(other.entity.id, { styleOverride: { surface: '#orig' } })

    // Edit the prototype after seeding — no auto-propagation; refresh is opt-in.
    await gw.updatePrototype(proto.id, { style: { surface: '#fff', extra: 'x' }, metadata: { v: 2 } })

    const result = await gw.refreshFromPrototype({ prototypeId: proto.id, all: true })
    expect(result.refreshed.sort()).toEqual([e1.entity.id, e2.entity.id, e3.entity.id].sort())

    const entities = (await gw.getGraph(graphId)).entities
    for (const id of [e1.entity.id, e2.entity.id, e3.entity.id]) {
      const e = entities.find((x) => x.id === id)
      expect(e?.styleOverride).toEqual({ surface: '#fff', extra: 'x' })
      expect(e?.metadata).toEqual({ v: 2 })
    }
    const untouched = entities.find((x) => x.id === other.entity.id)
    expect(untouched?.styleOverride).toEqual({ surface: '#orig' })
  })
})

describe('Phase 2 — cross-reference index (§7.4)', () => {
  it('lists all placements, edges, relationships and backlinks', async () => {
    const gw = await createMemoryGateway()
    const { graphId, boardId, viewId } = await newGraph(gw)
    const a = await gw.addNode(boardId, viewId, { name: 'A', x: 0, y: 0 })
    const a2 = await gw.createNode(boardId, { entityId: a.entity.id, label: 'A2' })
    const b = await gw.addNode(boardId, viewId, { name: 'B', x: 1, y: 1 })
    const conn = await gw.connectNodes(boardId, {
      sourceNodeId: a.node.id,
      targetNodeId: b.node.id,
      label: 'calls',
    })
    // A second board placing the same entity A.
    const board2 = await gw.createBoard(graphId, { name: 'Board 2' })
    const a3 = await gw.createNode(board2.id, { entityId: a.entity.id, label: 'A on B2' })
    // A backlink: entity B links to A via kind:'entity'.
    await gw.updateEntity(b.entity.id, {
      links: [{ id: 'bl', kind: 'entity', target: a.entity.id, label: 'see A' }],
    })

    const usage = await gw.getEntityUsages(a.entity.id)
    expect(usage.placements.map((p) => p.nodeId).sort()).toEqual(
      [a.node.id, a2.id, a3.id].sort(),
    )
    expect(usage.placements.some((p) => p.boardName === 'Board 2')).toBe(true)
    expect(usage.edgePlacements.map((e) => e.edgeId)).toContain(conn.edge.id)
    expect(usage.relationships).toHaveLength(1)
    expect(usage.relationships[0].relationshipId).toBe(conn.relationship.id)
    expect(usage.relationships[0].role).toBe('source')
    expect(usage.backlinks.map((b) => b.fromEntityId)).toContain(b.entity.id)
  })
})

describe('Phase 2 — drag-to-create (§9.4)', () => {
  it('path a: connect to an existing entity, one undoable command', async () => {
    const gw = await createMemoryGateway()
    const { boardId, viewId } = await newGraph(gw)
    const src = await gw.addNode(boardId, viewId, { name: 'src', x: 0, y: 0 })
    const existing = await gw.addNode(boardId, viewId, { name: 'existing', x: 5, y: 5 })

    const result = await gw.connectToExistingEntity(boardId, viewId, {
      sourceNodeId: src.node.id,
      entityId: existing.entity.id,
      x: 100,
      y: 100,
      label: 'uses',
    })
    expect(result.node.entityId).toBe(existing.entity.id) // same entity, new placement
    expect(result.relationship.sourceEntityId).toBe(src.entity.id)
    expect(result.relationship.targetEntityId).toBe(existing.entity.id)

    let board = await gw.getBoard(boardId)
    expect(board.nodes).toHaveLength(3)
    expect(board.edges).toHaveLength(1)

    // One undo reverts the whole gesture (node + position + relationship + edge).
    expect(await gw.undo()).toBe(true)
    board = await gw.getBoard(boardId)
    expect(board.nodes).toHaveLength(2)
    expect(board.edges).toHaveLength(0)
  })

  it('path b: create a new entity from a prototype, one undoable command', async () => {
    const gw = await createMemoryGateway()
    const { graphId, boardId, viewId } = await newGraph(gw)
    const proto = await gw.createPrototype(graphId, {
      kind: 'node',
      name: 'Service',
      style: { surface: '#eef' },
      metadata: { tier: 'x' },
    })
    const src = await gw.addNode(boardId, viewId, { name: 'src', x: 0, y: 0 })

    const result = await gw.connectToNewEntity(boardId, viewId, {
      sourceNodeId: src.node.id,
      name: 'new thing',
      x: 200,
      y: 200,
      prototypeId: proto.id,
      label: 'depends on',
    })
    expect(result.entity.prototypeId).toBe(proto.id)
    expect(result.entity.styleOverride).toMatchObject({ surface: '#eef' })
    expect(result.entity.metadata).toEqual({ tier: 'x' })

    let entities = (await gw.getGraph(graphId)).entities
    expect(entities.some((e) => e.id === result.entity.id)).toBe(true)
    let board = await gw.getBoard(boardId)
    expect(board.nodes).toHaveLength(2)
    expect(board.edges).toHaveLength(1)

    expect(await gw.undo()).toBe(true)
    entities = (await gw.getGraph(graphId)).entities
    expect(entities.some((e) => e.id === result.entity.id)).toBe(false)
    board = await gw.getBoard(boardId)
    expect(board.nodes).toHaveLength(1)
    expect(board.edges).toHaveLength(0)
  })
})

describe('Phase 2 — save as prototype / duplicate (§9.1)', () => {
  it('save-as-prototype from a node snapshots style/shape/label/metadata', async () => {
    const gw = await createMemoryGateway()
    const { boardId, viewId } = await newGraph(gw)
    const added = await gw.addNode(boardId, viewId, {
      name: 'My Node',
      x: 0,
      y: 0,
      styleOverride: { surface: '#123', shape: 'diamond' },
    })
    await gw.updateEntity(added.entity.id, {
      links: [{ id: 'l', kind: 'url', target: 'https://x', label: 'docs' }],
      metadata: { k: 'v' },
    })

    const proto = await gw.createPrototypeFromNode({ nodeId: added.node.id, name: 'Saved' })
    expect(proto.kind).toBe('node')
    expect(proto.name).toBe('Saved')
    expect(proto.style).toMatchObject({ surface: '#123', shape: 'diamond' })
    expect(proto.shape).toBe('diamond')
    expect(proto.defaultLabel).toBe('My Node')
    expect(proto.metadata).toEqual({ k: 'v' })
    expect(proto.linkScaffold).toHaveLength(1)
  })

  it('save-as-prototype from an edge snapshots the relationship style/label', async () => {
    const gw = await createMemoryGateway()
    const { boardId, viewId } = await newGraph(gw)
    const a = await gw.addNode(boardId, viewId, { name: 'a', x: 0, y: 0 })
    const b = await gw.addNode(boardId, viewId, { name: 'b', x: 1, y: 1 })
    const conn = await gw.connectNodes(boardId, {
      sourceNodeId: a.node.id,
      targetNodeId: b.node.id,
      label: 'calls',
    })
    await gw.updateRelationship(conn.relationship.id, { styleOverride: { stroke: '#f00' } })

    const proto = await gw.createPrototypeFromEdge({ edgeId: conn.edge.id, name: 'Calls' })
    expect(proto.kind).toBe('relationship')
    expect(proto.style).toMatchObject({ stroke: '#f00' })
    expect(proto.defaultLabel).toBe('calls')
  })

  it('duplicate prototype forks a new row with matching style/metadata', async () => {
    const gw = await createMemoryGateway()
    const graph = await newGraph(gw)
    const proto = await gw.createPrototype(graph.graphId, {
      kind: 'node',
      name: 'Base',
      shape: 'pill',
      style: { surface: '#abc' },
      metadata: { a: 1 },
      linkScaffold: [{ id: 'l', kind: 'url', target: 'x', label: 'y' }],
    })
    const dup = await gw.duplicatePrototype(proto.id)
    expect(dup.id).not.toBe(proto.id)
    expect(dup.name).toBe('Base copy')
    expect(dup.shape).toBe('pill')
    expect(dup.style).toEqual(proto.style)
    expect(dup.metadata).toEqual(proto.metadata)
    expect(dup.linkScaffold).toEqual(proto.linkScaffold)
  })
})

describe('Phase 2 — copy/paste = placement (§9.3)', () => {
  it('pasting recreates placements of the same entities + internal edges, one undo', async () => {
    const gw = await createMemoryGateway()
    const { boardId, viewId } = await newGraph(gw)
    const a = await gw.addNode(boardId, viewId, { name: 'a', x: 0, y: 0 })
    const b = await gw.addNode(boardId, viewId, { name: 'b', x: 100, y: 0 })
    const conn = await gw.connectNodes(boardId, {
      sourceNodeId: a.node.id,
      targetNodeId: b.node.id,
      label: 'calls',
    })

    const board = await gw.getBoard(boardId)
    const positions = new Map([
      [a.node.id, { x: 0, y: 0 }],
      [b.node.id, { x: 100, y: 0 }],
    ])
    const clipboard = buildClipboard(board, [a.node.id, b.node.id], positions)
    expect(clipboard.nodes).toHaveLength(2)
    expect(clipboard.edges).toHaveLength(1)

    // Round-trip the JSON (cross-document paste).
    const roundtrip = parseClipboard(serializeClipboard(clipboard))!
    expect(roundtrip).toEqual(clipboard)

    const result = await gw.pasteClipboard(boardId, viewId, {
      clipboard: roundtrip,
      x: 500,
      y: 500,
    })
    expect(result.nodes).toHaveLength(2)
    expect(result.edges).toHaveLength(1)
    // Pasted nodes reference the SAME entities (no identity fork).
    expect(result.nodes.map((n) => n.entityId).sort()).toEqual(
      [a.entity.id, b.entity.id].sort(),
    )
    // Pasted edge references the SAME relationship.
    expect(result.edges[0].relationshipId).toBe(conn.relationship.id)
    // Positions placed relative to the drop anchor.
    expect(result.positions.find((p) => p.nodeId === result.nodes[0].id)).toBeTruthy()

    let after = await gw.getBoard(boardId)
    expect(after.nodes).toHaveLength(4)
    expect(after.edges).toHaveLength(2)

    expect(await gw.undo()).toBe(true)
    after = await gw.getBoard(boardId)
    expect(after.nodes).toHaveLength(2)
    expect(after.edges).toHaveLength(1)
  })
})
