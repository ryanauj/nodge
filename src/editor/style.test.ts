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

  it('lets a later layer win (palette fallback → node.style snapshot)', () => {
    // §D3: the only layer above the palette fallback is the row's `style`
    // snapshot. `resolveNodeStyle` is variadic so a snapshot can still be split
    // across layers, but each later layer wins for the keys it sets.
    const s = resolveNodeStyle(
      DEFAULT_PALETTE_TOKENS,
      { surface: '#snap', border: '#snap' },
      { border: '#later' }, // a later snapshot layer wins for `border`
    )
    expect(s.surface).toBe('#snap') // only the first layer set surface
    expect(s.border).toBe('#later') // later layer wins over earlier
  })

  it('renders the concrete snapshot and a palette swap does NOT change it (§D10)', () => {
    // A row whose snapshot pins `surface` keeps that surface even when the
    // palette baseline differs — concrete snapshots, not live re-skin.
    const snapshot = { surface: '#ff0000' }
    const onDefault = resolveNodeStyle(DEFAULT_PALETTE_TOKENS, snapshot)
    const altPalette: PaletteTokens = { node: { surface: '#000000' } }
    const onAlt = resolveNodeStyle(altPalette, snapshot)
    expect(onDefault.surface).toBe('#ff0000')
    expect(onAlt.surface).toBe('#ff0000') // identical across palettes
  })

  it('falls back to the palette for any key the snapshot omits (totality)', () => {
    // The snapshot pins only `surface`; every other key resolves from the
    // palette fallback so resolution stays total.
    const altPalette: PaletteTokens = { node: { border: '#00ff00' } }
    const s = resolveNodeStyle(altPalette, { surface: '#ff0000' })
    expect(s.surface).toBe('#ff0000') // from the snapshot
    expect(s.border).toBe('#00ff00') // omitted → palette fallback
    expect(s.shape).toBe('rounded') // omitted by both → hard fallback
  })

  it('falls back when the palette omits a token (tolerant baseline)', () => {
    const s = resolveNodeStyle({})
    expect(s.surface).toBe('#ffffff')
    expect(s.shape).toBe('rounded')
  })
})

describe('style cascade — edges', () => {
  it('resolves stroke from the palette and lets the edge snapshot win', () => {
    const base = resolveEdgeStyle(DEFAULT_PALETTE_TOKENS)
    expect(base.stroke).toBe('#4361ee')
    const overridden = resolveEdgeStyle(DEFAULT_PALETTE_TOKENS, {
      stroke: '#abcdef',
      strokeWidth: 4,
    })
    expect(overridden.stroke).toBe('#abcdef')
    expect(overridden.strokeWidth).toBe(4)
  })

  it('keeps the edge snapshot across a palette swap and falls back per-key (§D10)', () => {
    const snapshot = { stroke: '#abcdef' } // strokeWidth omitted
    const altPalette: PaletteTokens = { edge: { stroke: '#000000', strokeWidth: 7 } }
    const onDefault = resolveEdgeStyle(DEFAULT_PALETTE_TOKENS, snapshot)
    const onAlt = resolveEdgeStyle(altPalette, snapshot)
    expect(onDefault.stroke).toBe('#abcdef')
    expect(onAlt.stroke).toBe('#abcdef') // snapshot survives the swap
    expect(onAlt.strokeWidth).toBe(7) // omitted key falls back to the palette
  })
})

describe('shapeRadius', () => {
  it('maps shapes to a border radius', () => {
    expect(shapeRadius('rect')).toBe(0)
    expect(shapeRadius('rounded')).toBe(8)
    expect(shapeRadius('pill')).toBe(999)
  })
})
