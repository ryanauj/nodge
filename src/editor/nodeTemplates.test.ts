/**
 * nodeTemplates unit test — the quick-style library is a set of complete,
 * valid node style snapshots. Guards against a template drifting to a partial or
 * out-of-vocabulary style, which would apply a broken look to a node.
 */

import { describe, it, expect } from 'vitest'
import {
  NODE_STYLE_TEMPLATES,
  NODE_TEMPLATE_GROUPS,
  type NodeStyleTemplate,
} from './nodeTemplates'
import {
  BACKGROUND_PATTERNS,
  BORDER_STYLES,
  ELEVATIONS,
  NODE_SHAPES,
} from './tokens'
import { resolveNodeStyle, DEFAULT_PALETTE_TOKENS } from './style'
import type { StyleDelta } from '../model'

const REQUIRED_KEYS: (keyof NodeStyleTemplate['style'])[] = [
  'surface',
  'content',
  'border',
  'borderWidth',
  'shape',
  'borderStyle',
  'pattern',
  'elevation',
]

describe('NODE_STYLE_TEMPLATES', () => {
  it('exposes a non-empty, uniquely-identified library', () => {
    expect(NODE_STYLE_TEMPLATES.length).toBeGreaterThan(0)
    const ids = NODE_STYLE_TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every template is a complete, in-vocabulary style snapshot', () => {
    for (const t of NODE_STYLE_TEMPLATES) {
      for (const key of REQUIRED_KEYS) {
        expect(t.style[key], `${t.id}.${String(key)}`).toBeDefined()
      }
      expect(NODE_SHAPES).toContain(t.style.shape)
      expect(BORDER_STYLES).toContain(t.style.borderStyle)
      expect(BACKGROUND_PATTERNS).toContain(t.style.pattern)
      expect(ELEVATIONS).toContain(t.style.elevation)
      expect(typeof t.style.borderWidth).toBe('number')
      expect(NODE_TEMPLATE_GROUPS).toContain(t.group)
    }
  })

  it('applies as a full override — the snapshot wins over the palette baseline', () => {
    // A template used as a node style layer resolves to exactly the template.
    for (const t of NODE_STYLE_TEMPLATES) {
      const resolved = resolveNodeStyle(DEFAULT_PALETTE_TOKENS, t.style as unknown as StyleDelta)
      expect(resolved).toEqual(t.style)
    }
  })
})
