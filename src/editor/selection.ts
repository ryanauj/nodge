/**
 * Pure selection geometry + set logic for the mode-less canvas (spec §10.2).
 *
 * Kept free of React / React Flow so the "which nodes does this marquee cover"
 * and "toggle this id in/out of the selection" rules are unit-testable without a
 * canvas. The Editor owns the DOM gestures (long-press detection, pointer
 * capture, double-tap timing) and calls into these to decide the result.
 */

/** An axis-aligned rectangle in flow (canvas) coordinates. */
export interface FlowRect {
  x: number
  y: number
  width: number
  height: number
}

/** A marquee defined by its two dragged corners (flow coordinates, any order). */
export interface MarqueeCorners {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** A node's bounding box in flow coordinates. */
export interface NodeBox {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/** Normalize two dragged corners into a positive-size rectangle. */
export function marqueeRect(m: MarqueeCorners): FlowRect {
  return {
    x: Math.min(m.x0, m.x1),
    y: Math.min(m.y0, m.y1),
    width: Math.abs(m.x1 - m.x0),
    height: Math.abs(m.y1 - m.y0),
  }
}

/** True when two axis-aligned rectangles overlap (touching edges don't count). */
export function rectsIntersect(a: FlowRect, b: FlowRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

/** The ids of every node whose box overlaps the marquee rectangle. */
export function nodesInMarquee(nodes: readonly NodeBox[], rect: FlowRect): string[] {
  return nodes
    .filter((n) => rectsIntersect(rect, { x: n.x, y: n.y, width: n.width, height: n.height }))
    .map((n) => n.id)
}

/** Add `id` to the selection if absent, remove it if present (⌘/ctrl-click parity). */
export function toggleSelection(current: readonly string[], id: string): string[] {
  return current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
}
