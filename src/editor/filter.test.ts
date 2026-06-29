/**
 * Pure filter/focus lens (spec §7.2). These tests exercise the lens directly,
 * without a canvas, asserting both lenses (prototype/metadata and focus+N hops)
 * and that surviving edges always connect two surviving nodes.
 */

import { describe, it, expect } from 'vitest'
import type { Edge, Entity, Node, Relationship, ViewFilter } from '../model'
import { applyFilter, isEmptyFilter, nodesWithinHops } from './filter'

let seq = 0
function entity(id: string, patch: Partial<Entity> = {}): Entity {
  return {
    id,
    graphId: 'g',
    name: id,
    nodePrototypeId: null,
    links: [],
    metadata: {},
    createdAt: 't',
    updatedAt: 't',
    version: 1,
    ...patch,
  }
}
function node(id: string, entityId: string): Node {
  return {
    id,
    diagramId: 'b',
    entityId,
    label: id,
    style: {},
    createdAt: 't',
    updatedAt: 't',
    version: 1,
  }
}
function edge(source: string, target: string): Edge {
  return {
    id: `e-${seq++}`,
    diagramId: 'b',
    relationshipId: `r-${source}-${target}`,
    sourceNodeId: source,
    targetNodeId: target,
    sourceHandle: null,
    targetHandle: null,
    label: '',
    style: {},
    createdAt: 't',
    updatedAt: 't',
    version: 1,
  }
}
function rel(id: string, source: string, target: string): Relationship {
  return {
    id,
    graphId: 'g',
    sourceEntityId: source,
    targetEntityId: target,
    edgePrototypeId: null,
    directed: true,
    label: '',
    metadata: {},
    createdAt: 't',
    updatedAt: 't',
    version: 1,
  }
}

/**
 * Build a small chain X — A — B — C (each node placing its own entity), so a
 * focus-and-hops lens around X has predictable reach.
 */
function chain() {
  const entities = new Map<string, Entity>([
    ['eX', entity('eX', { nodePrototypeId: 'pBox' })],
    ['eA', entity('eA', { nodePrototypeId: 'pBox', metadata: { tier: 'backend' } })],
    ['eB', entity('eB', { metadata: { tier: 'frontend' } })],
    ['eC', entity('eC')],
  ])
  const nodes = [node('X', 'eX'), node('A', 'eA'), node('B', 'eB'), node('C', 'eC')]
  const edges = [edge('X', 'A'), edge('A', 'B'), edge('B', 'C')]
  const relationships = new Map<string, Relationship>([
    ['r-X-A', rel('r-X-A', 'eX', 'eA')],
    ['r-A-B', rel('r-A-B', 'eA', 'eB')],
    ['r-B-C', rel('r-B-C', 'eB', 'eC')],
  ])
  return { nodes, edges, entities, relationships }
}

describe('isEmptyFilter', () => {
  it('treats null / {} / zeroed fields as empty (whole board)', () => {
    expect(isEmptyFilter(null)).toBe(true)
    expect(isEmptyFilter({})).toBe(true)
    expect(isEmptyFilter({ prototypeIds: [], metadata: {} })).toBe(true)
    expect(isEmptyFilter({ focusNodeId: 'X' })).toBe(false)
    expect(isEmptyFilter({ prototypeIds: ['p'] })).toBe(false)
  })
})

describe('applyFilter — identity', () => {
  it('returns the whole board for an empty filter', () => {
    const src = chain()
    const out = applyFilter(src, null)
    expect(out.nodes).toHaveLength(4)
    expect(out.edges).toHaveLength(3)
  })
})

describe('applyFilter — focus + N hops (§7.2)', () => {
  it('hops=1 keeps the focus and its immediate neighbors only', () => {
    const src = chain()
    const filter: ViewFilter = { focusNodeId: 'A', hops: 1 }
    const out = applyFilter(src, filter)
    expect(out.nodes.map((n) => n.id).sort()).toEqual(['A', 'B', 'X'])
    // Every surviving edge connects two surviving nodes (cross-ref integrity).
    const kept = new Set(out.nodes.map((n) => n.id))
    for (const e of out.edges) {
      expect(kept.has(e.sourceNodeId)).toBe(true)
      expect(kept.has(e.targetNodeId)).toBe(true)
    }
    expect(out.edges.map((e) => e.relationshipId).sort()).toEqual(['r-A-B', 'r-X-A'])
  })

  it('hops=0 keeps only the focus node', () => {
    const out = applyFilter(chain(), { focusNodeId: 'X', hops: 0 })
    expect(out.nodes.map((n) => n.id)).toEqual(['X'])
    expect(out.edges).toEqual([])
  })

  it('hops=2 reaches two hops out', () => {
    const out = applyFilter(chain(), { focusNodeId: 'X', hops: 2 })
    expect(out.nodes.map((n) => n.id).sort()).toEqual(['A', 'B', 'X'])
  })
})

describe('applyFilter — prototype / metadata filter (§7.2)', () => {
  it('keeps only nodes whose entity links one of the prototypes', () => {
    const out = applyFilter(chain(), { prototypeIds: ['pBox'] })
    expect(out.nodes.map((n) => n.id).sort()).toEqual(['A', 'X'])
    // The X—A edge survives (both endpoints kept); A—B does not.
    expect(out.edges.map((e) => e.relationshipId)).toEqual(['r-X-A'])
  })

  it('keeps only nodes whose entity metadata matches every key/value', () => {
    const out = applyFilter(chain(), { metadata: { tier: 'backend' } })
    expect(out.nodes.map((n) => n.id)).toEqual(['A'])
    expect(out.edges).toEqual([])
  })
})

describe('applyFilter — composed lenses', () => {
  it('intersects prototype filter with focus+hops', () => {
    // prototypeIds keeps {X, A}; focus A hops 1 over that subset keeps {X, A}.
    const out = applyFilter(chain(), { prototypeIds: ['pBox'], focusNodeId: 'A', hops: 1 })
    expect(out.nodes.map((n) => n.id).sort()).toEqual(['A', 'X'])
  })

  it('yields nothing when the focus node is filtered out by the predicate', () => {
    const out = applyFilter(chain(), { metadata: { tier: 'backend' }, focusNodeId: 'X', hops: 5 })
    // X has no tier:backend, so it is removed and nothing is reachable from it.
    expect(out.nodes).toEqual([])
  })
})

describe('nodesWithinHops', () => {
  it('does a breadth-first walk over board edges', () => {
    const { edges } = chain()
    expect([...nodesWithinHops('X', 1, edges)].sort()).toEqual(['A', 'X'])
    expect([...nodesWithinHops('X', 3, edges)].sort()).toEqual(['A', 'B', 'C', 'X'])
  })
})
