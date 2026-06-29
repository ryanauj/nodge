/**
 * Build a {@link Clipboard} payload from a selection of nodes on a diagram
 * (spec §9.3, Decision 10). Copy/paste is *placement*: the clipboard records the
 * selected nodes referencing their **same** entities and the edges internal to
 * the selection referencing their **same** relationships. Pasting (see
 * `LocalGateway.pasteClipboard`) re-places those entities/relationships — it
 * never forks identity. Positions are stored relative to the selection's
 * top-left anchor so a paste drops the cluster intact at a new origin.
 *
 * Pure and framework-free so the editor and tests can build a clipboard without
 * touching the DOM clipboard; serializing to JSON enables cross-document paste.
 */

import type { DiagramDetail } from './types'
import type { Clipboard, ClipboardEdge, ClipboardNode, Uuid } from './types'

/**
 * Capture the selected nodes + the edges whose endpoints are both selected.
 * `positions` provides each node's absolute position (from the active layout);
 * the clipboard stores positions relative to the selection's top-left.
 */
export function buildClipboard(
  diagram: DiagramDetail,
  selectedNodeIds: Uuid[],
  positions: Map<Uuid, { x: number; y: number }>,
): Clipboard {
  const selected = new Set(selectedNodeIds)
  const nodes = diagram.nodes.filter((n) => selected.has(n.id))

  // Anchor = top-left of the selection so the paste origin places the cluster.
  let minX = Infinity
  let minY = Infinity
  for (const n of nodes) {
    const p = positions.get(n.id) ?? { x: 0, y: 0 }
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
  }
  if (!Number.isFinite(minX)) minX = 0
  if (!Number.isFinite(minY)) minY = 0

  const clipNodes: ClipboardNode[] = nodes.map((n) => {
    const p = positions.get(n.id) ?? { x: 0, y: 0 }
    return {
      refId: n.id,
      entityId: n.entityId,
      label: n.label,
      style: { ...n.style },
      dx: p.x - minX,
      dy: p.y - minY,
    }
  })

  const clipEdges: ClipboardEdge[] = diagram.edges
    .filter((e) => selected.has(e.sourceNodeId) && selected.has(e.targetNodeId))
    .map((e) => ({
      relationshipId: e.relationshipId,
      sourceRefId: e.sourceNodeId,
      targetRefId: e.targetNodeId,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      label: e.label,
      style: { ...e.style },
    }))

  return { kind: 'nodge/clipboard', version: 1, nodes: clipNodes, edges: clipEdges }
}

/** Parse + validate a JSON string as a {@link Clipboard}, or return null. */
export function parseClipboard(text: string): Clipboard | null {
  try {
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    if (record.kind !== 'nodge/clipboard' || record.version !== 1) return null
    if (!Array.isArray(record.nodes) || !Array.isArray(record.edges)) return null
    return value as Clipboard
  } catch {
    return null
  }
}

/** Serialize a clipboard to its JSON string form for the system clipboard. */
export function serializeClipboard(clipboard: Clipboard): string {
  return JSON.stringify(clipboard)
}
