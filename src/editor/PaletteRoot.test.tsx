import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PaletteRoot } from './PaletteRoot'
import { DEFAULT_FULL_TOKENS, toPaletteTokens } from './tokens'
import type { PaletteTokens } from '../model'

describe('PaletteRoot', () => {
  it('projects palette tokens as --nodge-* CSS variables on its element', () => {
    const tokens: PaletteTokens = {
      ...DEFAULT_FULL_TOKENS,
      surface: { ...DEFAULT_FULL_TOKENS.surface, raised: '#123456', canvas: '#abcdef' },
    }
    const { getByTestId } = render(
      <PaletteRoot tokens={tokens} testId="chrome">
        <span>hi</span>
      </PaletteRoot>,
    )
    const el = getByTestId('chrome')
    expect(el.style.getPropertyValue('--nodge-surface-raised')).toBe('#123456')
    expect(el.style.getPropertyValue('--nodge-surface-canvas')).toBe('#abcdef')
    // Back-compat alias the existing chrome CSS reads.
    expect(el.style.getPropertyValue('--nodge-chrome')).toBe('#123456')
  })

  it('carries the engine effect as a data attribute (applied at the boundary)', () => {
    const tokens: PaletteTokens = { ...DEFAULT_FULL_TOKENS, effect: 'glass' }
    const { getByTestId } = render(
      <PaletteRoot tokens={tokens} testId="view">
        <span>hi</span>
      </PaletteRoot>,
    )
    expect(getByTestId('view').getAttribute('data-nodge-effect')).toBe('glass')
  })

  it('fills defaults for a minimal legacy palette (backward compatible)', () => {
    const legacy = toPaletteTokens(DEFAULT_FULL_TOKENS) // exercises fullTokens fill
    const { getByTestId } = render(
      <PaletteRoot tokens={{ node: { surface: '#fff' } } as PaletteTokens} testId="legacy">
        <span>hi</span>
      </PaletteRoot>,
    )
    // A legacy palette with no intent ramp still exposes the default intent var.
    expect(getByTestId('legacy').style.getPropertyValue('--nodge-intent-primary-bg')).toBe(
      DEFAULT_FULL_TOKENS.intent.primary.bg,
    )
    expect(legacy).toBeTruthy()
  })
})
