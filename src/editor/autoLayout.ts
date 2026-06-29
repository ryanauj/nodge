/**
 * Dagre auto-layout engine (design doc §8, D8).
 *
 * A pure, framework-free module: given a diagram's nodes + edges (with optional
 * per-node size hints) it runs Dagre's layered layout and returns absolute
 * `{ nodeId, x, y }` positions. No React / React Flow imports — the gateway's
 * `generateLayout` calls this and persists the result via `bulkUpsertPositions`.
 *
 * **Code-splitting (Pavel's hard line):** Dagre is loaded lazily via a dynamic
 * `import('@dagrejs/dagre')` *inside* {@link autoLayout}, so the bundler emits it
 * as its own chunk that is fetched only when auto-arrange runs — mirroring how the
 * SQLite worker is kept off first paint. Never add a top-level `import` of dagre.
 */

/** A node to lay out. `width`/`height` are optional size hints in canvas units. */
export interface LayoutNode {
  id: string
  width?: number
  height?: number
}

/** A directed edge between two node ids. */
export interface LayoutEdge {
  sourceNodeId: string
  targetNodeId: string
}

/** A computed absolute position for one node (Dagre reports node centers). */
export interface LayoutPosition {
  nodeId: string
  x: number
  y: number
}

/** Layout direction: top→bottom (default), bottom→top, left→right, right→left. */
export type LayoutDirection = 'TB' | 'BT' | 'LR' | 'RL'

export interface AutoLayoutOptions {
  /** Rank direction. Defaults to `'TB'` (parents above children). */
  direction?: LayoutDirection
  /** Horizontal separation between adjacent nodes in the same rank (px). */
  nodeSep?: number
  /** Separation between adjacent ranks (px). */
  rankSep?: number
  /** Separation between two edges in the same rank (px). */
  edgeSep?: number
}

/** Sensible defaults for typical node sizes. */
const DEFAULT_DIRECTION: LayoutDirection = 'TB'
const DEFAULT_NODE_WIDTH = 172
const DEFAULT_NODE_HEIGHT = 64
const DEFAULT_NODE_SEP = 60
const DEFAULT_RANK_SEP = 80
const DEFAULT_EDGE_SEP = 20

/**
 * Compute Dagre positions for a graph. Deterministic: the same input (same node
 * order, same edges, same options) always yields the same output. Returns node
 * *centers*, which callers persist as positions.
 *
 * Loads Dagre lazily so it never lands in the first-paint bundle.
 */
export async function autoLayout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: AutoLayoutOptions = {},
): Promise<LayoutPosition[]> {
  if (nodes.length === 0) return []

  // Dynamic import → dedicated chunk, fetched only when auto-arrange runs.
  const dagre = (await import('@dagrejs/dagre')).default

  const g = new dagre.graphlib.Graph({ directed: true, multigraph: false })
  g.setGraph({
    rankdir: options.direction ?? DEFAULT_DIRECTION,
    nodesep: options.nodeSep ?? DEFAULT_NODE_SEP,
    ranksep: options.rankSep ?? DEFAULT_RANK_SEP,
    edgesep: options.edgeSep ?? DEFAULT_EDGE_SEP,
  })
  // Edges carry no label data.
  g.setDefaultEdgeLabel(() => ({}))

  for (const node of nodes) {
    g.setNode(node.id, {
      width: node.width ?? DEFAULT_NODE_WIDTH,
      height: node.height ?? DEFAULT_NODE_HEIGHT,
    })
  }

  // Only wire edges whose endpoints are both present, so a stale edge can never
  // crash layout (Dagre would otherwise auto-create the missing endpoint nodes).
  const known = new Set(nodes.map((n) => n.id))
  for (const edge of edges) {
    if (known.has(edge.sourceNodeId) && known.has(edge.targetNodeId)) {
      g.setEdge(edge.sourceNodeId, edge.targetNodeId)
    }
  }

  dagre.layout(g)

  return nodes.map((node) => {
    const laid = g.node(node.id)
    return { nodeId: node.id, x: laid.x, y: laid.y }
  })
}
