/**
 * Large-graph performance guards (spec §12 Phase 5). Two anti-regressions:
 *
 *  1. The diagram transform (`toFlowNodes`/`toFlowEdges`) is **pure**: it does
 *     not mutate its inputs and produces deep-equal output for equal input, so
 *     it stays safe to memoize and re-running it on a big graph never rebuilds
 *     unrelated state. (A pure transform is what `useMemo` relies on upstream.)
 *  2. The canvas opts into **visible-only rendering** (`onlyRenderVisibleElements`)
 *     so a large board only mounts the nodes/edges inside the viewport — the
 *     measurable knob that keeps interaction smooth on a phone.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  toFlowNodes,
  toFlowEdges,
  type DiagramSource,
} from './diagram'
import { DEFAULT_PALETTE_TOKENS } from './style'
import type { Edge, Entity, Node, Relationship } from '../model'

const here = dirname(fileURLToPath(import.meta.url))

function bigSource(n: number): DiagramSource {
  const entities = new Map<string, Entity>()
  const nodes: Node[] = []
  const positions = new Map<string, { x: number; y: number }>()
  for (let i = 0; i < n; i++) {
    const eid = `e${i}`
    const nid = `n${i}`
    entities.set(eid, {
      id: eid,
      graphId: 'g',
      name: `E${i}`,
      nodePrototypeId: null,
      links: [],
      metadata: {},
      createdAt: '',
      updatedAt: '',
      version: 1,
    } as Entity)
    nodes.push({
      id: nid,
      diagramId: 'b',
      entityId: eid,
      label: `N${i}`,
      style: {},
      createdAt: '',
      updatedAt: '',
      version: 1,
    } as Node)
    positions.set(nid, { x: i * 10, y: i * 5 })
  }
  const relationships = new Map<string, Relationship>()
  const edges: Edge[] = []
  for (let i = 1; i < n; i++) {
    const rid = `r${i}`
    relationships.set(rid, {
      id: rid,
      graphId: 'g',
      sourceEntityId: `e${i - 1}`,
      targetEntityId: `e${i}`,
      edgePrototypeId: null,
      directed: true,
      label: '',
      metadata: {},
      createdAt: '',
      updatedAt: '',
      version: 1,
    } as Relationship)
    edges.push({
      id: `ed${i}`,
      diagramId: 'b',
      relationshipId: rid,
      sourceNodeId: `n${i - 1}`,
      targetNodeId: `n${i}`,
      sourceHandle: null,
      targetHandle: null,
      label: '',
      style: {},
      createdAt: '',
      updatedAt: '',
      version: 1,
    } as Edge)
  }
  return {
    nodes,
    edges,
    positions,
    entities,
    relationships,
    paletteTokens: DEFAULT_PALETTE_TOKENS,
  }
}

describe('diagram transform purity (memoization guard)', () => {
  it('produces deep-equal output for equal input and does not mutate inputs', () => {
    const src = bigSource(500)
    const nodesBefore = JSON.parse(JSON.stringify(src.nodes))
    const edgesBefore = JSON.parse(JSON.stringify(src.edges))

    const a = toFlowNodes(src)
    const b = toFlowNodes(src)
    const ea = toFlowEdges(src)
    const eb = toFlowEdges(src)

    expect(a).toHaveLength(500)
    expect(ea).toHaveLength(499)
    // Equal input → deep-equal output (safe to memoize / no needless rebuild).
    expect(a).toEqual(b)
    expect(ea).toEqual(eb)
    // The transform never mutated its source rows.
    expect(src.nodes).toEqual(nodesBefore)
    expect(src.edges).toEqual(edgesBefore)
  })
})

describe('visible-only rendering (large-graph perf knob)', () => {
  it('the canvas enables onlyRenderVisibleElements', () => {
    const editor = readFileSync(join(here, 'Editor.tsx'), 'utf8')
    expect(editor).toMatch(/onlyRenderVisibleElements/)
  })
})
