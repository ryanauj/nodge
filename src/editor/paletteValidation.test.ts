import { describe, it, expect } from 'vitest'
import {
  contrastIssues,
  contrastRatio,
  parseHex,
  relativeLuminance,
  shapeCompleteness,
  validatePalette,
  WCAG_AA_NORMAL,
} from './paletteValidation'
import { DEFAULT_FULL_TOKENS, toPaletteTokens } from './tokens'
import type { PaletteTokens } from '../model'

const DEFAULT_TOKENS = toPaletteTokens(DEFAULT_FULL_TOKENS)

describe('contrast math', () => {
  it('parses #rgb and #rrggbb', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255])
    expect(parseHex('#000000')).toEqual([0, 0, 0])
    expect(parseHex('not-a-color')).toBeNull()
  })

  it('computes luminance bounds', () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5)
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5)
  })

  it('black on white is the maximum 21:1 contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })

  it('same colors are 1:1 (no contrast)', () => {
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5)
  })
})

describe('shapeCompleteness', () => {
  it('reports nothing missing for the full default tokens', () => {
    expect(shapeCompleteness(DEFAULT_TOKENS)).toEqual([])
  })

  it('flags missing required token paths on a partial palette', () => {
    const partial: PaletteTokens = { node: { surface: '#fff' } }
    const missing = shapeCompleteness(partial)
    expect(missing).toContain('node.content')
    expect(missing).toContain('edge.stroke')
    expect(missing).toContain('intent.primary.bg')
    expect(missing).toContain('geometry.radius')
  })

  it('accepts the legacy minimal {node,edge} shape for its own keys', () => {
    const legacy: PaletteTokens = {
      node: { surface: '#fff', content: '#000', border: '#00f' },
      edge: { stroke: '#00f' },
    }
    const missing = shapeCompleteness(legacy)
    // Its node/edge keys are present; richer groups are still reported.
    expect(missing).not.toContain('node.surface')
    expect(missing).not.toContain('edge.stroke')
    expect(missing).toContain('surface.canvas')
  })
})

describe('WCAG AA contrast validation', () => {
  it('passes a compliant palette (default has readable intent/content pairs)', () => {
    const issues = contrastIssues(DEFAULT_TOKENS)
    expect(issues).toEqual([])
  })

  it('flags a low-contrast intent pair (light grey on white)', () => {
    const bad: PaletteTokens = {
      ...DEFAULT_FULL_TOKENS,
      intent: {
        ...DEFAULT_FULL_TOKENS.intent,
        primary: { bg: '#ffffff', content: '#d8d8d8', border: '#cccccc' },
      },
    }
    const issues = contrastIssues(bad)
    const flagged = issues.find((i) => i.pair === 'intent.primary')
    expect(flagged).toBeDefined()
    expect(flagged!.ratio).toBeLessThan(WCAG_AA_NORMAL)
  })

  it('flags low-contrast node text on its surface', () => {
    const bad: PaletteTokens = {
      node: { surface: '#ffffff', content: '#eeeeee', border: '#dddddd' },
      edge: { stroke: '#000000' },
    }
    const issues = contrastIssues(bad)
    expect(issues.some((i) => i.pair === 'node.content/node.surface')).toBe(true)
  })
})

describe('validatePalette', () => {
  it('a complete, compliant palette is ok', () => {
    const result = validatePalette(DEFAULT_TOKENS)
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.contrast).toEqual([])
  })

  it('a low-contrast palette is not ok', () => {
    const bad: PaletteTokens = {
      ...DEFAULT_FULL_TOKENS,
      node: { surface: '#ffffff', content: '#f0f0f0', border: '#eeeeee' },
    }
    expect(validatePalette(bad).ok).toBe(false)
  })
})
