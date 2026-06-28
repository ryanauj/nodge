/**
 * Token-referenced style cascade (spec §8.3), Phase 1 minimal slice.
 *
 * A resolved style is computed by layering, later-wins:
 *
 *   Palette tokens  →  Prototype style  →  base override  →  placement override
 *
 * For nodes the base override is the Entity's `styleOverride` and the placement
 * override is the Node's; for edges it is the Relationship's then the Edge's.
 * Because the palette supplies the base, a node that pins nothing simply
 * *follows the palette* — swapping the palette re-skins it. A layer may pin a
 * raw value for any key as the escape hatch. Phase 1 covers color/border/shape
 * only; the full token contract arrives in Phase 4.
 */

import type { PaletteTokens, StyleDelta } from '../model'

export type NodeShape = 'rect' | 'rounded' | 'pill' | 'ellipse'

export interface ResolvedNodeStyle {
  surface: string
  content: string
  border: string
  borderWidth: number
  shape: NodeShape
}

export interface ResolvedEdgeStyle {
  stroke: string
  strokeWidth: number
}

/** The keys each resolved style understands; only these are picked from layers. */
const NODE_STYLE_KEYS = ['surface', 'content', 'border', 'borderWidth', 'shape'] as const
const EDGE_STYLE_KEYS = ['stroke', 'strokeWidth'] as const

/** Hard fallbacks used when a palette omits a token (keeps resolution total). */
const NODE_FALLBACK: ResolvedNodeStyle = {
  surface: '#ffffff',
  content: '#1a1a2e',
  border: '#4361ee',
  borderWidth: 1,
  shape: 'rounded',
}

const EDGE_FALLBACK: ResolvedEdgeStyle = {
  stroke: '#4361ee',
  strokeWidth: 1.5,
}

/**
 * The seeded default palette's tokens (spec §8.4 — built-ins at first run).
 * Values are concrete here; nodes reference them by leaving their overrides
 * empty, so a later palette swap re-skins everything not pinned.
 */
export const DEFAULT_PALETTE_TOKENS: PaletteTokens = {
  node: { ...NODE_FALLBACK },
  edge: { ...EDGE_FALLBACK },
}

export const DEFAULT_PALETTE_NAME = 'Default'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function pick<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown> | undefined,
  keys: readonly (keyof T)[],
): void {
  if (!source) return
  for (const key of keys) {
    const value = source[key as string]
    if (value !== undefined) target[key] = value as T[keyof T]
  }
}

/**
 * Resolve a node's visual style by layering the cascade. `layers` are the
 * prototype style, the entity override and the node override, in that order.
 */
export function resolveNodeStyle(
  palette: PaletteTokens,
  ...layers: (StyleDelta | undefined)[]
): ResolvedNodeStyle {
  const resolved: ResolvedNodeStyle = { ...NODE_FALLBACK }
  pick(resolved, asRecord(palette.node), NODE_STYLE_KEYS)
  for (const layer of layers) pick(resolved, layer, NODE_STYLE_KEYS)
  return resolved
}

/**
 * Resolve an edge's visual style. `layers` are the relationship prototype
 * style, the relationship override and the edge override, in that order.
 */
export function resolveEdgeStyle(
  palette: PaletteTokens,
  ...layers: (StyleDelta | undefined)[]
): ResolvedEdgeStyle {
  const resolved: ResolvedEdgeStyle = { ...EDGE_FALLBACK }
  pick(resolved, asRecord(palette.edge), EDGE_STYLE_KEYS)
  for (const layer of layers) pick(resolved, layer, EDGE_STYLE_KEYS)
  return resolved
}

/** Map a node shape token to a CSS border-radius (px), used by the renderer. */
export function shapeRadius(shape: NodeShape): number {
  switch (shape) {
    case 'rect':
      return 0
    case 'pill':
      return 999
    case 'ellipse':
      return 999
    case 'rounded':
    default:
      return 8
  }
}
