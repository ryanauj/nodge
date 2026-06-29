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
  const diagram = await gw.createDiagram(graph.id, { name: 'Diagram 1' })
  const layout = await gw.createLayout(diagram.id, { name: 'Layout 1' })
  return { graphId: graph.id, diagramId: diagram.id, layoutId: layout.id }
}

describe('Phase 2 — identity: one entity behind many placements', () => {
  it('two placements trace to one entity; editing the entity updates both', async () => {
    const gw = await createMemoryGateway(deterministicDeps())
    const { diagramId, layoutId } = await newGraph(gw)

    const added = await gw.addNode(diagramId, layoutId, { name: 'Service', x: 0, y: 0 })
    // Second placement of the SAME entity (createNode references entityId).
    const node2 = await gw.createNode(diagramId, { entityId: added.entity.id, label: 'second' })

    const diagram = await gw.getDiagram(diagramId)
    const placingEntity = diagram.nodes.filter((n) => n.entityId === added.entity.id)
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

describe('Phase 2 — node↔prototype snapshot + refresh (§9.2)', () => {
  it('snapshots the prototype style onto the node on create', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId, layoutId } = await newGraph(gw)
    const proto = await gw.createPrototype(graphId, {
      kind: 'node',
      name: 'Service',
      style: { surface: '#eef', shape: 'pill' },
      metadata: { tier: 'backend' },
    })
    const added = await gw.addNode(diagramId, layoutId, {
      name: 'svc',
      x: 0,
      y: 0,
      nodePrototypeId: proto.id,
    })
    expect(added.node.style).toMatchObject({ surface: '#eef', shape: 'pill' })
    const entity = (await gw.getGraph(graphId)).entities.find((e) => e.id === added.entity.id)
    expect(entity?.metadata).toEqual({ tier: 'backend' })
  })

  it('batch refresh re-applies the prototype current style onto nodes; un-refreshed untouched', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId, layoutId } = await newGraph(gw)
    const proto = await gw.createPrototype(graphId, {
      kind: 'node',
      name: 'Service',
      style: { surface: '#aaa' },
      metadata: { v: 1 },
    })
    const e1 = await gw.addNode(diagramId, layoutId, { name: 'a', x: 0, y: 0, nodePrototypeId: proto.id })
    const e2 = await gw.addNode(diagramId, layoutId, { name: 'b', x: 1, y: 1, nodePrototypeId: proto.id })
    const e3 = await gw.addNode(diagramId, layoutId, { name: 'c', x: 2, y: 2, nodePrototypeId: proto.id })
    // A node NOT linked to this prototype — must stay untouched.
    const other = await gw.addNode(diagramId, layoutId, { name: 'other', x: 3, y: 3 })
    await gw.updateNode(other.node.id, { style: { surface: '#orig' } })

    // Edit the prototype after snapshotting — no auto-propagation; refresh is opt-in.
    await gw.updatePrototype(proto.id, { style: { surface: '#fff', extra: 'x' }, metadata: { v: 2 } })

    const result = await gw.refreshFromPrototype({ prototypeId: proto.id, all: true, diagramId })
    // refreshFromPrototype now returns the refreshed NODE ids.
    expect(result.refreshed.sort()).toEqual([e1.node.id, e2.node.id, e3.node.id].sort())

    const detail = await gw.getDiagram(diagramId)
    for (const id of [e1.node.id, e2.node.id, e3.node.id]) {
      const n = detail.nodes.find((x) => x.id === id)
      expect(n?.style).toEqual({ surface: '#fff', extra: 'x' })
    }
    const untouched = detail.nodes.find((x) => x.id === other.node.id)
    expect(untouched?.style).toEqual({ surface: '#orig' })
  })

  it('refresh by explicit ids only touches the named nodes (and returns them)', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId, layoutId } = await newGraph(gw)
    const proto = await gw.createPrototype(graphId, {
      kind: 'node',
      name: 'Service',
      style: { surface: '#aaa' },
    })
    const e1 = await gw.addNode(diagramId, layoutId, { name: 'a', x: 0, y: 0, nodePrototypeId: proto.id })
    const e2 = await gw.addNode(diagramId, layoutId, { name: 'b', x: 1, y: 1, nodePrototypeId: proto.id })
    await gw.updatePrototype(proto.id, { style: { surface: '#fff' } })

    const result = await gw.refreshFromPrototype({ prototypeId: proto.id, ids: [e1.node.id] })
    expect(result.refreshed).toEqual([e1.node.id])

    const detail = await gw.getDiagram(diagramId)
    expect(detail.nodes.find((n) => n.id === e1.node.id)?.style).toEqual({ surface: '#fff' })
    // e2 is linked but was not named — left on its snapshot.
    expect(detail.nodes.find((n) => n.id === e2.node.id)?.style).toEqual({ surface: '#aaa' })
  })

  it('refresh works for an edge prototype (all + ids), diagram membership traced, one undo', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId, layoutId } = await newGraph(gw)
    const edgeProto = await gw.createPrototype(graphId, {
      kind: 'edge',
      name: 'Calls',
      style: { stroke: '#111' },
    })
    const a = await gw.addNode(diagramId, layoutId, { name: 'a', x: 0, y: 0 })
    const b = await gw.addNode(diagramId, layoutId, { name: 'b', x: 1, y: 1 })
    const c = await gw.addNode(diagramId, layoutId, { name: 'c', x: 2, y: 2 })
    const e1 = await gw.connectNodes(diagramId, {
      sourceNodeId: a.node.id,
      targetNodeId: b.node.id,
      edgePrototypeId: edgeProto.id,
    })
    const e2 = await gw.connectNodes(diagramId, {
      sourceNodeId: b.node.id,
      targetNodeId: c.node.id,
      edgePrototypeId: edgeProto.id,
    })
    expect(e1.edge.style).toMatchObject({ stroke: '#111' }) // edge snapshot-on-create

    await gw.updatePrototype(edgeProto.id, { style: { stroke: '#999' } })

    // Selective: only e1.
    const sel = await gw.refreshFromPrototype({ prototypeId: edgeProto.id, ids: [e1.edge.id] })
    expect(sel.refreshed).toEqual([e1.edge.id])
    let detail = await gw.getDiagram(diagramId)
    expect(detail.edges.find((e) => e.id === e1.edge.id)?.style).toEqual({ stroke: '#999' })
    expect(detail.edges.find((e) => e.id === e2.edge.id)?.style).toEqual({ stroke: '#111' })

    // All: both edges of the prototype in this diagram, as one undoable command.
    const all = await gw.refreshFromPrototype({ prototypeId: edgeProto.id, all: true, diagramId })
    expect(all.refreshed.sort()).toEqual([e1.edge.id, e2.edge.id].sort())
    detail = await gw.getDiagram(diagramId)
    expect(detail.edges.find((e) => e.id === e2.edge.id)?.style).toEqual({ stroke: '#999' })

    expect(await gw.undo()).toBe(true)
    detail = await gw.getDiagram(diagramId)
    expect(detail.edges.find((e) => e.id === e2.edge.id)?.style).toEqual({ stroke: '#111' })
  })

  it('createPrototypeFromNode / FromEdge do not relink the source (D9)', async () => {
    const gw = await createMemoryGateway()
    const { diagramId, layoutId } = await newGraph(gw)
    const node = await gw.addNode(diagramId, layoutId, {
      name: 'N',
      x: 0,
      y: 0,
      style: { surface: '#abc' },
    })
    const a = await gw.addNode(diagramId, layoutId, { name: 'A', x: 5, y: 5 })
    const conn = await gw.connectNodes(diagramId, {
      sourceNodeId: node.node.id,
      targetNodeId: a.node.id,
    })

    const nodeProto = await gw.createPrototypeFromNode({ nodeId: node.node.id, name: 'P' })
    const edgeProto = await gw.createPrototypeFromEdge({ edgeId: conn.edge.id, name: 'E' })

    const graph = await gw.getGraph(node.entity.graphId)
    const entity = graph.entities.find((e) => e.id === node.entity.id)
    const rel = graph.relationships.find((r) => r.id === conn.relationship.id)
    // The new prototypes captured the look but the source links are unchanged (null).
    expect(nodeProto.style).toMatchObject({ surface: '#abc' })
    expect(entity?.nodePrototypeId).toBeNull()
    expect(rel?.edgePrototypeId).toBeNull()
    expect(edgeProto.kind).toBe('edge')
  })

  it('refresh {all} is diagram-scoped: a refresh in diagram A never touches the same entity in diagram B (§7/D1)', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId: diagramA, layoutId: layoutA } = await newGraph(gw)
    const nodeProto = await gw.createPrototype(graphId, {
      kind: 'node',
      name: 'Service',
      style: { surface: '#aaa' },
    })
    const edgeProto = await gw.createPrototype(graphId, {
      kind: 'edge',
      name: 'Calls',
      style: { stroke: '#111' },
    })

    // Diagram A: two prototype-linked nodes joined by a prototype-linked edge.
    const a1 = await gw.addNode(diagramA, layoutA, {
      name: 'A1',
      x: 0,
      y: 0,
      nodePrototypeId: nodeProto.id,
    })
    const a2 = await gw.connectToNewEntity(diagramA, layoutA, {
      sourceNodeId: a1.node.id,
      name: 'A2',
      x: 10,
      y: 0,
      nodePrototypeId: nodeProto.id,
      edgePrototypeId: edgeProto.id,
    })

    // Diagram B places the SAME entities (and an edge for the same relationship).
    const diagramB = await gw.createDiagram(graphId, { name: 'Diagram B' })
    const layoutB = await gw.createLayout(diagramB.id, { name: 'Layout B' })
    const b1 = await gw.placeEntity(diagramB.id, layoutB.id, { entityId: a1.entity.id, x: 0, y: 0 })
    const b2 = await gw.placeEntity(diagramB.id, layoutB.id, { entityId: a2.entity.id, x: 10, y: 0 })
    const bEdge = await gw.createEdge(diagramB.id, {
      relationshipId: a2.relationship.id,
      sourceNodeId: b1.node.id,
      targetNodeId: b2.node.id,
      style: { stroke: '#111' },
    })

    // Both diagrams currently show the original snapshot (placeEntity seeded B's
    // nodes from the linked prototype; B's edge style was set explicitly).
    expect(b1.node.style).toMatchObject({ surface: '#aaa' })
    expect(bEdge.style).toMatchObject({ stroke: '#111' })

    // Edit the prototypes, then refresh ONLY diagram A.
    await gw.updatePrototype(nodeProto.id, { style: { surface: '#fff' } })
    await gw.updatePrototype(edgeProto.id, { style: { stroke: '#999' } })
    const nodeRefresh = await gw.refreshFromPrototype({
      prototypeId: nodeProto.id,
      all: true,
      diagramId: diagramA,
    })
    const edgeRefresh = await gw.refreshFromPrototype({
      prototypeId: edgeProto.id,
      all: true,
      diagramId: diagramA,
    })
    // Only A's placements are reported/refreshed.
    expect(nodeRefresh.refreshed.sort()).toEqual([a1.node.id, a2.node.id].sort())
    expect(edgeRefresh.refreshed).toEqual([a2.edge.id])

    const detailA = await gw.getDiagram(diagramA)
    const detailB = await gw.getDiagram(diagramB.id)
    // A re-skinned to the new prototype styles.
    expect(detailA.nodes.find((n) => n.id === a1.node.id)?.style).toEqual({ surface: '#fff' })
    expect(detailA.edges.find((e) => e.id === a2.edge.id)?.style).toEqual({ stroke: '#999' })
    // B — the SAME entities/relationship — is untouched: still on the old snapshot.
    expect(detailB.nodes.find((n) => n.id === b1.node.id)?.style).toEqual({ surface: '#aaa' })
    expect(detailB.edges.find((e) => e.id === bEdge.id)?.style).toEqual({ stroke: '#111' })
  })

  it('refresh {all} requires a diagramId', async () => {
    const gw = await createMemoryGateway()
    const { graphId } = await newGraph(gw)
    const proto = await gw.createPrototype(graphId, { kind: 'node', name: 'P', style: {} })
    await expect(gw.refreshFromPrototype({ prototypeId: proto.id, all: true })).rejects.toThrow(
      /requires a diagramId/,
    )
  })
})

describe('Phase 2 — cross-reference index (§7.4)', () => {
  it('lists all placements, edges, relationships and backlinks', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId, layoutId } = await newGraph(gw)
    const a = await gw.addNode(diagramId, layoutId, { name: 'A', x: 0, y: 0 })
    const a2 = await gw.createNode(diagramId, { entityId: a.entity.id, label: 'A2' })
    const b = await gw.addNode(diagramId, layoutId, { name: 'B', x: 1, y: 1 })
    const conn = await gw.connectNodes(diagramId, {
      sourceNodeId: a.node.id,
      targetNodeId: b.node.id,
      label: 'calls',
    })
    // A second diagram placing the same entity A.
    const diagram2 = await gw.createDiagram(graphId, { name: 'Diagram 2' })
    const a3 = await gw.createNode(diagram2.id, { entityId: a.entity.id, label: 'A on D2' })
    // A backlink: entity B links to A via kind:'entity'.
    await gw.updateEntity(b.entity.id, {
      links: [{ id: 'bl', kind: 'entity', target: a.entity.id, label: 'see A' }],
    })

    const usage = await gw.getEntityUsages(a.entity.id)
    expect(usage.placements.map((p) => p.nodeId).sort()).toEqual(
      [a.node.id, a2.id, a3.id].sort(),
    )
    expect(usage.placements.some((p) => p.diagramName === 'Diagram 2')).toBe(true)
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
    const { diagramId, layoutId } = await newGraph(gw)
    const src = await gw.addNode(diagramId, layoutId, { name: 'src', x: 0, y: 0 })
    const existing = await gw.addNode(diagramId, layoutId, { name: 'existing', x: 5, y: 5 })

    const result = await gw.connectToExistingEntity(diagramId, layoutId, {
      sourceNodeId: src.node.id,
      entityId: existing.entity.id,
      x: 100,
      y: 100,
      label: 'uses',
    })
    expect(result.node.entityId).toBe(existing.entity.id) // same entity, new placement
    expect(result.relationship.sourceEntityId).toBe(src.entity.id)
    expect(result.relationship.targetEntityId).toBe(existing.entity.id)

    let diagram = await gw.getDiagram(diagramId)
    expect(diagram.nodes).toHaveLength(3)
    expect(diagram.edges).toHaveLength(1)

    // One undo reverts the whole gesture (node + position + relationship + edge).
    expect(await gw.undo()).toBe(true)
    diagram = await gw.getDiagram(diagramId)
    expect(diagram.nodes).toHaveLength(2)
    expect(diagram.edges).toHaveLength(0)
  })

  it('path b: create a new entity from a prototype, one undoable command', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId, layoutId } = await newGraph(gw)
    const proto = await gw.createPrototype(graphId, {
      kind: 'node',
      name: 'Service',
      style: { surface: '#eef' },
      metadata: { tier: 'x' },
    })
    const src = await gw.addNode(diagramId, layoutId, { name: 'src', x: 0, y: 0 })

    const result = await gw.connectToNewEntity(diagramId, layoutId, {
      sourceNodeId: src.node.id,
      name: 'new thing',
      x: 200,
      y: 200,
      nodePrototypeId: proto.id,
      label: 'depends on',
    })
    expect(result.entity.nodePrototypeId).toBe(proto.id)
    expect(result.node.style).toMatchObject({ surface: '#eef' })
    expect(result.entity.metadata).toEqual({ tier: 'x' })

    let entities = (await gw.getGraph(graphId)).entities
    expect(entities.some((e) => e.id === result.entity.id)).toBe(true)
    let diagram = await gw.getDiagram(diagramId)
    expect(diagram.nodes).toHaveLength(2)
    expect(diagram.edges).toHaveLength(1)

    expect(await gw.undo()).toBe(true)
    entities = (await gw.getGraph(graphId)).entities
    expect(entities.some((e) => e.id === result.entity.id)).toBe(false)
    diagram = await gw.getDiagram(diagramId)
    expect(diagram.nodes).toHaveLength(1)
    expect(diagram.edges).toHaveLength(0)
  })
})

describe('Phase 2 — save as prototype / duplicate (§9.1)', () => {
  it('save-as-prototype from a node snapshots style/shape/label/metadata', async () => {
    const gw = await createMemoryGateway()
    const { diagramId, layoutId } = await newGraph(gw)
    const added = await gw.addNode(diagramId, layoutId, {
      name: 'My Node',
      x: 0,
      y: 0,
      style: { surface: '#123', shape: 'diamond' },
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

  it('save-as-prototype from an edge snapshots the edge style/label', async () => {
    const gw = await createMemoryGateway()
    const { diagramId, layoutId } = await newGraph(gw)
    const a = await gw.addNode(diagramId, layoutId, { name: 'a', x: 0, y: 0 })
    const b = await gw.addNode(diagramId, layoutId, { name: 'b', x: 1, y: 1 })
    const conn = await gw.connectNodes(diagramId, {
      sourceNodeId: a.node.id,
      targetNodeId: b.node.id,
      label: 'calls',
    })
    await gw.updateEdge(conn.edge.id, { style: { stroke: '#f00' } })

    const proto = await gw.createPrototypeFromEdge({ edgeId: conn.edge.id, name: 'Calls' })
    expect(proto.kind).toBe('edge')
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
    const { diagramId, layoutId } = await newGraph(gw)
    const a = await gw.addNode(diagramId, layoutId, { name: 'a', x: 0, y: 0 })
    const b = await gw.addNode(diagramId, layoutId, { name: 'b', x: 100, y: 0 })
    const conn = await gw.connectNodes(diagramId, {
      sourceNodeId: a.node.id,
      targetNodeId: b.node.id,
      label: 'calls',
    })

    const diagram = await gw.getDiagram(diagramId)
    const positions = new Map([
      [a.node.id, { x: 0, y: 0 }],
      [b.node.id, { x: 100, y: 0 }],
    ])
    const clipboard = buildClipboard(diagram, [a.node.id, b.node.id], positions)
    expect(clipboard.nodes).toHaveLength(2)
    expect(clipboard.edges).toHaveLength(1)

    // Round-trip the JSON (cross-document paste).
    const roundtrip = parseClipboard(serializeClipboard(clipboard))!
    expect(roundtrip).toEqual(clipboard)

    const result = await gw.pasteClipboard(diagramId, layoutId, {
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

    let after = await gw.getDiagram(diagramId)
    expect(after.nodes).toHaveLength(4)
    expect(after.edges).toHaveLength(2)

    expect(await gw.undo()).toBe(true)
    after = await gw.getDiagram(diagramId)
    expect(after.nodes).toHaveLength(2)
    expect(after.edges).toHaveLength(1)
  })
})
