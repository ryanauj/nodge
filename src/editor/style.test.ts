import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PALETTE_TOKENS,
  resolveEdgeStyle,
  resolveNodeStyle,
  shapeRadius,
} from './style'
import type { PaletteTokens } from '../model'

describe('style cascade — nodes', () => {
  it('follows the palette when nothing is pinned', () => {
    const s = resolveNodeStyle(DEFAULT_PALETTE_TOKENS)
    expect(s.surface).toBe('#ffffff')
    expect(s.border).toBe('#4361ee')
    expect(s.shape).toBe('rounded')
  })

  it('lets later layers win (palette → prototype → entity → node)', () => {
    const s = resolveNodeStyle(
      DEFAULT_PALETTE_TOKENS,
      { surface: '#proto', border: '#proto' }, // prototype
      { border: '#entity' }, // entity override
      { border: '#node' }, // node override (wins)
    )
    expect(s.surface).toBe('#proto') // only the prototype set it
    expect(s.border).toBe('#node') // node override wins over all
  })

  it('re-skins unpinned values when the palette changes', () => {
    const altPalette: PaletteTokens = { node: { surface: '#000000' } }
    const pinned = resolveNodeStyle(altPalette, undefined, undefined, { surface: '#ff0000' })
    const followsPalette = resolveNodeStyle(altPalette)
    expect(pinned.surface).toBe('#ff0000') // pinned survives the swap
    expect(followsPalette.surface).toBe('#000000') // unpinned follows new palette
  })

  it('falls back when the palette omits a token', () => {
    const s = resolveNodeStyle({})
    expect(s.surface).toBe('#ffffff')
    expect(s.shape).toBe('rounded')
  })
})

describe('style cascade — edges', () => {
  it('resolves stroke from the palette and lets the edge override win', () => {
    const base = resolveEdgeStyle(DEFAULT_PALETTE_TOKENS)
    expect(base.stroke).toBe('#4361ee')
    const overridden = resolveEdgeStyle(DEFAULT_PALETTE_TOKENS, undefined, undefined, {
      stroke: '#abcdef',
      strokeWidth: 4,
    })
    expect(overridden.stroke).toBe('#abcdef')
    expect(overridden.strokeWidth).toBe(4)
  })
})

describe('shapeRadius', () => {
  it('maps shapes to a border radius', () => {
    expect(shapeRadius('rect')).toBe(0)
    expect(shapeRadius('rounded')).toBe(8)
    expect(shapeRadius('pill')).toBe(999)
  })
})
