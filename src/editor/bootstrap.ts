/**
 * Bootstrap / reopen the working diagram (spec §6.4, §7.1–7.2).
 *
 * Phase 1 is one graph → one diagram → one layout. The OPFS-backed SQLite is the
 * durable store; a lightweight localStorage pointer records *which* graph is
 * active so a reload reopens it. On first run (no pointer, or a stale pointer)
 * we seed a default graph with a built-in palette, diagram and layout.
 */

import type { DataGateway, Uuid } from '../gateway'
import { BUILTIN_PROTOTYPES } from './prototypes'
import { BUILTIN_PALETTES } from './style'

/** The handles the canvas needs to read and write the active diagram. */
export interface DiagramIds {
  graphId: Uuid
  diagramId: Uuid
  layoutId: Uuid
  paletteId: Uuid | null
}

/** Minimal storage seam so bootstrap is testable without a real DOM. */
export interface PointerStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const ACTIVE_GRAPH_KEY = 'nodge.activeGraphId'

function defaultStorage(): PointerStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

/**
 * Seed a fresh default graph and return its ids. Seeds the *library* of built-in
 * palettes (spec §8.4) — more than one look — plus the built-in prototypes, one
 * diagram and one layout.
 */
export async function createDefaultDiagram(gw: DataGateway): Promise<DiagramIds> {
  const graph = await gw.createGraph({ name: 'Untitled diagram' })
  let defaultPaletteId: Uuid | null = null
  for (const builtin of BUILTIN_PALETTES) {
    const palette = await gw.createPalette(graph.id, {
      name: builtin.name,
      tokens: builtin.tokens,
      builtin: true,
    })
    defaultPaletteId ??= palette.id
  }
  // Seed the built-in prototype library so the tool is useful on first run (§9.1).
  for (const proto of BUILTIN_PROTOTYPES) await gw.createPrototype(graph.id, proto)
  const diagram = await gw.createDiagram(graph.id, { name: 'Diagram 1' })
  const layout = await gw.createLayout(diagram.id, { name: 'Layout 1' })
  return {
    graphId: graph.id,
    diagramId: diagram.id,
    layoutId: layout.id,
    paletteId: defaultPaletteId,
  }
}

/**
 * Resolve the ids for an existing graph, optionally targeting a specific diagram
 * and/or layout (for routing, §7). Falls back to the first diagram/layout when
 * the requested id is missing, so deep links and already-persisted single-diagram
 * graphs both resolve. Returns null when the graph has no diagram/layout.
 */
export async function reopen(
  gw: DataGateway,
  graphId: Uuid,
  diagramId?: Uuid | null,
  layoutId?: Uuid | null,
): Promise<DiagramIds | null> {
  try {
    const graph = await gw.getGraph(graphId)
    const diagram =
      (diagramId && graph.diagrams.find((d) => d.id === diagramId)) || graph.diagrams[0]
    if (!diagram) return null
    const detail = await gw.getDiagram(diagram.id)
    const layout = (layoutId && detail.layouts.find((l) => l.id === layoutId)) || detail.layouts[0]
    if (!layout) return null
    return {
      graphId: graph.id,
      diagramId: diagram.id,
      layoutId: layout.id,
      paletteId: graph.palettes[0]?.id ?? null,
    }
  } catch {
    return null
  }
}

/**
 * Open the active diagram from the persisted pointer, or seed a default one.
 * The chosen graph id is written back to the pointer so the next reload restores
 * the same diagram.
 */
export async function bootstrapOrOpen(
  gw: DataGateway,
  storage: PointerStorage | null = defaultStorage(),
): Promise<DiagramIds> {
  const pointer = storage?.getItem(ACTIVE_GRAPH_KEY) ?? null
  const ids = (pointer && (await reopen(gw, pointer))) || (await createDefaultDiagram(gw))
  storage?.setItem(ACTIVE_GRAPH_KEY, ids.graphId)
  return ids
}
