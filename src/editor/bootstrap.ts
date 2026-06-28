/**
 * Bootstrap / reopen the working diagram (spec §6.4, §7.1–7.2).
 *
 * Phase 1 is one graph → one board → one view. The OPFS-backed SQLite is the
 * durable store; a lightweight localStorage pointer records *which* graph is
 * active so a reload reopens it. On first run (no pointer, or a stale pointer)
 * we seed a default graph with a built-in palette, board and view.
 */

import type { DataGateway, Uuid } from '../gateway'
import { BUILTIN_PROTOTYPES } from './prototypes'
import { DEFAULT_PALETTE_NAME, DEFAULT_PALETTE_TOKENS } from './style'

/** The handles the canvas needs to read and write the active diagram. */
export interface DiagramIds {
  graphId: Uuid
  boardId: Uuid
  viewId: Uuid
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

/** Seed a fresh default graph + palette + board + view and return its ids. */
export async function createDefaultDiagram(gw: DataGateway): Promise<DiagramIds> {
  const graph = await gw.createGraph({ name: 'Untitled diagram' })
  const palette = await gw.createPalette(graph.id, {
    name: DEFAULT_PALETTE_NAME,
    tokens: DEFAULT_PALETTE_TOKENS,
    builtin: true,
  })
  // Seed the built-in prototype library so the tool is useful on first run (§9.1).
  for (const proto of BUILTIN_PROTOTYPES) await gw.createPrototype(graph.id, proto)
  const board = await gw.createBoard(graph.id, { name: 'Board 1' })
  const view = await gw.createView(board.id, { name: 'View 1', paletteId: palette.id })
  return { graphId: graph.id, boardId: board.id, viewId: view.id, paletteId: palette.id }
}

/** Resolve the ids for an existing graph (its first board + view), or null. */
async function reopen(gw: DataGateway, graphId: Uuid): Promise<DiagramIds | null> {
  try {
    const graph = await gw.getGraph(graphId)
    const board = graph.boards[0]
    if (!board) return null
    const detail = await gw.getBoard(board.id)
    const view = detail.views[0]
    if (!view) return null
    return {
      graphId: graph.id,
      boardId: board.id,
      viewId: view.id,
      paletteId: view.paletteId ?? graph.palettes[0]?.id ?? null,
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
