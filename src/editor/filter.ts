/**
 * Filter / focus lens (spec §7.2, §7.3 "Filtered lens").
 *
 * A view may carry a {@link ViewFilter} that narrows the rendered subgraph
 * *without* changing board membership. This module is a PURE function over a
 * board's placements + the base layer, so it is unit-testable without a canvas;
 * `diagram.ts` applies it before building React Flow nodes/edges.
 *
 * Two complementary lenses, composable in one filter:
 *   1. Prototype / metadata filter — keep nodes whose base entity links one of
 *      the given prototypes and/or whose metadata matches every key/value pair.
 *   2. Focus + N hops — keep only nodes within N relationship-hops of a focus
 *      node, walking the base relationships between the placed entities.
 *
 * Edges survive iff both their endpoints survive, so every rendered edge still
 * traces to a base relationship between two visible base entities.
 */

import type { Edge, Entity, Node, Relationship, ViewFilter } from '../model'
import type { Uuid } from '../gateway'

/** The placements + base layer a lens needs to compute visibility. */
export interface FilterInput {
  nodes: Node[]
  edges: Edge[]
  entities: Map<Uuid, Entity>
  relationships: Map<Uuid, Relationship>
}

export interface FilterResult {
  nodes: Node[]
  edges: Edge[]
}

/** Is a filter effectively empty (renders the whole board)? */
export function isEmptyFilter(filter: ViewFilter | null | undefined): boolean {
  if (!filter) return true
  const hasPrototype = (filter.prototypeIds?.length ?? 0) > 0
  const hasMetadata = filter.metadata !== undefined && Object.keys(filter.metadata).length > 0
  const hasFocus = filter.focusNodeId !== undefined
  return !hasPrototype && !hasMetadata && !hasFocus
}

/** Does an entity match the prototype + metadata predicate (an empty predicate matches all)? */
function matchesPredicate(entity: Entity | undefined, filter: ViewFilter): boolean {
  if (!entity) return false
  const protoIds = filter.prototypeIds
  if (protoIds && protoIds.length > 0) {
    if (!entity.prototypeId || !protoIds.includes(entity.prototypeId)) return false
  }
  const meta = filter.metadata
  if (meta) {
    for (const key of Object.keys(meta)) {
      if (!shallowEqual(entity.metadata[key], meta[key])) return false
    }
  }
  return true
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  // Compare scalars stringified so `1 === '1'`-style tag values still match loosely
  // is intentionally NOT done; only structural primitive equality + JSON for objects.
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

/**
 * Build an adjacency map over the board's node placements, derived from the base
 * relationships their entities participate in. Two nodes are adjacent iff an
 * edge on this board connects them (relationships are undirected for hop-walking
 * so the focus lens reaches neighbors regardless of arrow direction).
 */
function buildAdjacency(edges: Edge[]): Map<Uuid, Set<Uuid>> {
  const adj = new Map<Uuid, Set<Uuid>>()
  const link = (a: Uuid, b: Uuid) => {
    if (!adj.has(a)) adj.set(a, new Set())
    adj.get(a)!.add(b)
  }
  for (const e of edges) {
    link(e.sourceNodeId, e.targetNodeId)
    link(e.targetNodeId, e.sourceNodeId)
  }
  return adj
}

/** Node ids within `hops` relationship-hops of `focusNodeId` (BFS; 0 = focus only). */
export function nodesWithinHops(focusNodeId: Uuid, hops: number, edges: Edge[]): Set<Uuid> {
  const adj = buildAdjacency(edges)
  const visited = new Set<Uuid>([focusNodeId])
  let frontier: Uuid[] = [focusNodeId]
  for (let depth = 0; depth < hops; depth++) {
    const next: Uuid[] = []
    for (const id of frontier) {
      for (const neighbor of adj.get(id) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          next.push(neighbor)
        }
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }
  return visited
}

/**
 * Apply a view's filter lens, returning the visible subset of nodes + edges.
 * An empty/absent filter is the identity (the whole board renders).
 */
export function applyFilter(input: FilterInput, filter: ViewFilter | null | undefined): FilterResult {
  if (isEmptyFilter(filter)) return { nodes: input.nodes, edges: input.edges }
  const f = filter!

  // 1. Prototype / metadata predicate over each placement's base entity.
  let visibleNodes = input.nodes
  if ((f.prototypeIds?.length ?? 0) > 0 || (f.metadata && Object.keys(f.metadata).length > 0)) {
    visibleNodes = visibleNodes.filter((n) => matchesPredicate(input.entities.get(n.entityId), f))
  }

  // 2. Focus + N hops, walked over the board's edges (only across already-visible nodes).
  if (f.focusNodeId !== undefined) {
    const hops = f.hops ?? 0
    const visibleIds = new Set(visibleNodes.map((n) => n.id))
    // Restrict hop-walking to edges whose endpoints both survived the predicate.
    const internalEdges = input.edges.filter(
      (e) => visibleIds.has(e.sourceNodeId) && visibleIds.has(e.targetNodeId),
    )
    // If the focus itself was filtered out by the predicate, nothing is within range.
    const reachable = visibleIds.has(f.focusNodeId)
      ? nodesWithinHops(f.focusNodeId, hops, internalEdges)
      : new Set<Uuid>()
    visibleNodes = visibleNodes.filter((n) => reachable.has(n.id))
  }

  const keptIds = new Set(visibleNodes.map((n) => n.id))
  const visibleEdges = input.edges.filter(
    (e) => keptIds.has(e.sourceNodeId) && keptIds.has(e.targetNodeId),
  )
  return { nodes: visibleNodes, edges: visibleEdges }
}
