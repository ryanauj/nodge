/**
 * Integration tests for the canvas gestures (spec §12 Phase 1 acceptance):
 * adding/connecting/moving on the canvas produces the expected base + visual
 * rows through the real gateway + command bus, and undo/redo round-trips a
 * small edit session. These exercise real SQLite-WASM, the real gateway and the
 * real command layer — only ids/clock are made deterministic.
 */

import { describe, it, expect } from 'vitest'
import { createMemoryGateway, type GatewayDeps } from '../gateway'
import type { LocalGateway } from '../gateway/LocalGateway'
import { createDefaultDiagram } from './bootstrap'

function deterministicDeps(): GatewayDeps {
  let n = 0
  let t = 0
  return {
    newId: () => `id-${String(++n).padStart(4, '0')}`,
    now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}.000Z`,
  }
}

async function freshDiagram(gw: LocalGateway) {
  return createDefaultDiagram(gw)
}

describe('addNode gesture', () => {
  it('creates an entity + node placement + position in one undoable command', async () => {
    const gw = await createMemoryGateway(deterministicDeps())
    const ids = await freshDiagram(gw)

    const { entity, node, position } = await gw.addNode(ids.diagramId, ids.layoutId, {
      name: 'Alpha',
      x: 100,
      y: 50,
    })

    expect(entity.name).toBe('Alpha')
    expect(node.entityId).toBe(entity.id)
    expect(position).toEqual({ nodeId: node.id, x: 100, y: 50 })

    const board = await gw.getDiagram(ids.diagramId)
    expect(board.nodes).toHaveLength(1)
    expect(board.layouts[0].positions).toContainEqual({ nodeId: node.id, x: 100, y: 50 })
    expect((await gw.getGraph(ids.graphId)).entities).toHaveLength(1)

    // One gesture = one undo step: entity, node and position all disappear.
    expect(await gw.commands.undo()).toBe(true)
    expect((await gw.getDiagram(ids.diagramId)).nodes).toHaveLength(0)
    expect((await gw.getGraph(ids.graphId)).entities).toHaveLength(0)

    expect(await gw.commands.redo()).toBe(true)
    expect((await gw.getDiagram(ids.diagramId)).nodes).toHaveLength(1)
  })
})

describe('connectNodes gesture', () => {
  it('creates a relationship + edge tracing back to the placed entities', async () => {
    const gw = await createMemoryGateway(deterministicDeps())
    const ids = await freshDiagram(gw)
    const a = await gw.addNode(ids.diagramId, ids.layoutId, { name: 'A', x: 0, y: 0 })
    const b = await gw.addNode(ids.diagramId, ids.layoutId, { name: 'B', x: 200, y: 0 })

    const { relationship, edge } = await gw.connectNodes(ids.diagramId, {
      sourceNodeId: a.node.id,
      targetNodeId: b.node.id,
      label: 'calls',
    })

    expect(relationship.sourceEntityId).toBe(a.entity.id)
    expect(relationship.targetEntityId).toBe(b.entity.id)
    expect(edge.relationshipId).toBe(relationship.id)
    expect(edge.sourceNodeId).toBe(a.node.id)
    expect(edge.targetNodeId).toBe(b.node.id)

    const board = await gw.getDiagram(ids.diagramId)
    expect(board.edges).toHaveLength(1)
    expect((await gw.getGraph(ids.graphId)).relationships).toHaveLength(1)

    expect(await gw.commands.undo()).toBe(true)
    expect((await gw.getDiagram(ids.diagramId)).edges).toHaveLength(0)
    expect((await gw.getGraph(ids.graphId)).relationships).toHaveLength(0)
  })
})

describe('move gesture', () => {
  it('persists per-view positions; one drag end is one undoable command', async () => {
    const gw = await createMemoryGateway(deterministicDeps())
    const ids = await freshDiagram(gw)
    const a = await gw.addNode(ids.diagramId, ids.layoutId, { name: 'A', x: 0, y: 0 })
    const b = await gw.addNode(ids.diagramId, ids.layoutId, { name: 'B', x: 10, y: 10 })

    await gw.bulkUpsertPositions(ids.layoutId, [
      { nodeId: a.node.id, x: 300, y: 120 },
      { nodeId: b.node.id, x: 320, y: 140 },
    ])

    const positions = (await gw.getDiagram(ids.diagramId)).layouts[0].positions
    expect(positions).toContainEqual({ nodeId: a.node.id, x: 300, y: 120 })
    expect(positions).toContainEqual({ nodeId: b.node.id, x: 320, y: 140 })

    // The whole move (both nodes) reverts in a single undo.
    expect(await gw.commands.undo()).toBe(true)
    const reverted = (await gw.getDiagram(ids.diagramId)).layouts[0].positions
    expect(reverted).toContainEqual({ nodeId: a.node.id, x: 0, y: 0 })
    expect(reverted).toContainEqual({ nodeId: b.node.id, x: 10, y: 10 })
  })
})

describe('edit session round-trip', () => {
  it('undo/redo walks a small session back and forward', async () => {
    const gw = await createMemoryGateway(deterministicDeps())
    const ids = await freshDiagram(gw)

    const a = await gw.addNode(ids.diagramId, ids.layoutId, { name: 'A', x: 0, y: 0 })
    const b = await gw.addNode(ids.diagramId, ids.layoutId, { name: 'B', x: 100, y: 0 })
    await gw.connectNodes(ids.diagramId, { sourceNodeId: a.node.id, targetNodeId: b.node.id })

    const full = await gw.getDiagram(ids.diagramId)
    expect(full.nodes).toHaveLength(2)
    expect(full.edges).toHaveLength(1)

    // Walk all the way back.
    await gw.commands.undo() // edge/relationship
    await gw.commands.undo() // node B
    await gw.commands.undo() // node A
    const empty = await gw.getDiagram(ids.diagramId)
    expect(empty.nodes).toHaveLength(0)
    expect(empty.edges).toHaveLength(0)
    expect((await gw.getGraph(ids.graphId)).entities).toHaveLength(0)
    expect((await gw.getGraph(ids.graphId)).relationships).toHaveLength(0)

    // And all the way forward.
    await gw.commands.redo()
    await gw.commands.redo()
    await gw.commands.redo()
    const restored = await gw.getDiagram(ids.diagramId)
    expect(restored.nodes).toHaveLength(2)
    expect(restored.edges).toHaveLength(1)
  })
})
