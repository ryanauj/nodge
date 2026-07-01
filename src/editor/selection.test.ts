/**
 * Unit tests for the pure selection geometry + set logic (spec §10.2). These are
 * the "which nodes does a marquee cover" and "double-tap toggles membership"
 * rules, tested without a canvas.
 */

import { describe, it, expect } from 'vitest'
import {
  marqueeRect,
  rectsIntersect,
  nodesInMarquee,
  toggleSelection,
  type NodeBox,
} from './selection'

describe('marqueeRect', () => {
  it('normalizes any drag direction into a positive-size rect', () => {
    // Dragged bottom-right → top-left; the rect is still the same box.
    expect(marqueeRect({ x0: 30, y0: 40, x1: 10, y1: 10 })).toEqual({
      x: 10,
      y: 10,
      width: 20,
      height: 30,
    })
  })
})

describe('rectsIntersect', () => {
  it('detects overlap and rejects disjoint / edge-touching boxes', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 }
    expect(rectsIntersect(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true)
    expect(rectsIntersect(a, { x: 20, y: 20, width: 5, height: 5 })).toBe(false)
    // Sharing only an edge is not an overlap.
    expect(rectsIntersect(a, { x: 10, y: 0, width: 5, height: 10 })).toBe(false)
  })
})

describe('nodesInMarquee', () => {
  const nodes: NodeBox[] = [
    { id: 'a', x: 0, y: 0, width: 100, height: 40 },
    { id: 'b', x: 200, y: 0, width: 100, height: 40 },
    { id: 'c', x: 0, y: 200, width: 100, height: 40 },
  ]

  it('returns only the nodes whose box overlaps the rect', () => {
    // A rect that covers the top row (a + b) but not the lower node c.
    const rect = marqueeRect({ x0: -10, y0: -10, x1: 320, y1: 60 })
    expect(nodesInMarquee(nodes, rect).sort()).toEqual(['a', 'b'])
  })

  it('returns nothing for a zero-size marquee over empty space', () => {
    // A long-press that never drags collapses to a point on the empty pane.
    expect(nodesInMarquee(nodes, marqueeRect({ x0: 500, y0: 500, x1: 500, y1: 500 }))).toEqual([])
  })
})

describe('toggleSelection', () => {
  it('adds an absent id and removes a present one', () => {
    expect(toggleSelection(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleSelection(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('does not mutate the input array', () => {
    const input = ['a']
    toggleSelection(input, 'b')
    expect(input).toEqual(['a'])
  })
})
