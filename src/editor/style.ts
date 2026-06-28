/**
 * Token-referenced style cascade (spec §8.3). Phase 4 widens the resolved style
 * to the full token contract (§8.2): shape (incl. diamond), border style,
 * background pattern and elevation, on top of the Phase-1 color/border/shape.
 *
 * A resolved style is computed by layering, later-wins:
 *
 *   Palette tokens  →  Prototype style  →  StyleProfile  →  base override  →  placement override
 *
 * For nodes the base override is the Entity's `styleOverride` and the placement
 * override is the Node's; for edges it is the Relationship's then the Edge's.
 * A referenced {@link StyleProfile} (§8.3 — a named shared "look") layers in
 * just above the palette/prototype baseline but below the explicit entity/node
 * pins, so a profile re-skins everything it covers while a pinned key still wins.
 * Because the palette supplies the base, a node that pins nothing simply
 * *follows the palette* — swapping the palette re-skins it. A layer may pin a
 * raw value for any key as the escape hatch (the link/unlink affordance).
 *
 * Resolution stays **total** (every field has a fallback) and **backward
 * compatible**: the palette baseline is read tolerantly off `PaletteTokens`, so
 * the minimal Phase-1/3 `{ node, edge }` palettes still resolve and render.
 */

import type { PaletteTokens, StyleDelta } from '../model'
import {
  DEFAULT_EDGE_TOKENS,
  DEFAULT_FULL_TOKENS,
  DEFAULT_NODE_TOKENS,
  fullTokens,
  toPaletteTokens,
} from './tokens'
import type {
  BackgroundPattern,
  BorderStyle,
  Effect,
  Elevation,
  NodeShape,
} from './tokens'

export { shapeRadius, patternBackground, elevationShadow } from './tokens'
export type {
  NodeShape,
  BorderStyle,
  BackgroundPattern,
  Elevation,
  Effect,
} from './tokens'

export interface ResolvedNodeStyle {
  surface: string
  content: string
  border: string
  borderWidth: number
  shape: NodeShape
  borderStyle: BorderStyle
  pattern: BackgroundPattern
  elevation: Elevation
}

export interface ResolvedEdgeStyle {
  stroke: string
  strokeWidth: number
}

/** The keys each resolved style understands; only these are picked from layers. */
const NODE_STYLE_KEYS = [
  'surface',
  'content',
  'border',
  'borderWidth',
  'shape',
  'borderStyle',
  'pattern',
  'elevation',
] as const
const EDGE_STYLE_KEYS = ['stroke', 'strokeWidth'] as const

/** Hard fallbacks used when a palette omits a token (keeps resolution total). */
const NODE_FALLBACK: ResolvedNodeStyle = { ...DEFAULT_NODE_TOKENS }
const EDGE_FALLBACK: ResolvedEdgeStyle = { ...DEFAULT_EDGE_TOKENS }

/**
 * The seeded default palette's tokens (spec §8.4 — built-ins at first run).
 * The full token contract is concrete here; nodes reference these by leaving
 * their overrides empty, so a later palette swap re-skins everything not pinned.
 */
export const DEFAULT_PALETTE_TOKENS: PaletteTokens = toPaletteTokens(DEFAULT_FULL_TOKENS)

export const DEFAULT_PALETTE_NAME = 'Default'

/**
 * Built-in palette library (spec §8.4 — "built-ins seeded at first run"). Each
 * entry is a distinct full-token look; because `diagram.ts` resolves a view's
 * tokens from its palette and styles are token-referenced, assigning a palette
 * to a view re-skins everything not pinned. The token-level editor is Phase 4.
 */
export interface BuiltinPalette {
  name: string
  tokens: PaletteTokens
}

/** Derive a full-token palette from a small set of look-defining overrides. */
function look(over: {
  surface: string
  content: string
  border: string
  borderWidth?: number
  shape?: NodeShape
  pattern?: BackgroundPattern
  elevation?: Elevation
  effect?: Effect
  stroke: string
  strokeWidth?: number
  canvas?: string
}): PaletteTokens {
  return toPaletteTokens({
    ...DEFAULT_FULL_TOKENS,
    surface: { ...DEFAULT_FULL_TOKENS.surface, canvas: over.canvas ?? DEFAULT_FULL_TOKENS.surface.canvas, base: over.surface, raised: over.surface },
    content: { ...DEFAULT_FULL_TOKENS.content, primary: over.content, inverse: over.surface },
    border: { ...DEFAULT_FULL_TOKENS.border, default: over.border, focus: over.border },
    effect: over.effect ?? 'none',
    node: {
      ...DEFAULT_NODE_TOKENS,
      surface: over.surface,
      content: over.content,
      border: over.border,
      borderWidth: over.borderWidth ?? DEFAULT_NODE_TOKENS.borderWidth,
      shape: over.shape ?? DEFAULT_NODE_TOKENS.shape,
      pattern: over.pattern ?? DEFAULT_NODE_TOKENS.pattern,
      elevation: over.elevation ?? DEFAULT_NODE_TOKENS.elevation,
    },
    edge: { stroke: over.stroke, strokeWidth: over.strokeWidth ?? DEFAULT_EDGE_TOKENS.strokeWidth },
  })
}

export const BUILTIN_PALETTES: BuiltinPalette[] = [
  { name: DEFAULT_PALETTE_NAME, tokens: DEFAULT_PALETTE_TOKENS },
  {
    name: 'Midnight',
    tokens: look({
      surface: '#1f2937',
      content: '#f9fafb',
      border: '#60a5fa',
      shape: 'rounded',
      elevation: 'medium',
      stroke: '#60a5fa',
      canvas: '#111827',
    }),
  },
  {
    name: 'Sunset',
    tokens: look({
      surface: '#fff7ed',
      content: '#7c2d12',
      border: '#fb923c',
      borderWidth: 2,
      shape: 'pill',
      stroke: '#ea580c',
      strokeWidth: 2,
      canvas: '#fff1e0',
    }),
  },
  {
    name: 'Forest',
    tokens: look({
      surface: '#ecfdf5',
      content: '#064e3b',
      border: '#10b981',
      shape: 'rect',
      pattern: 'dots',
      stroke: '#059669',
      canvas: '#e3f7ee',
    }),
  },
]

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function pick<T>(
  target: T,
  source: Record<string, unknown> | undefined,
  keys: readonly (keyof T)[],
): void {
  if (!source) return
  const sink = target as Record<string, unknown>
  for (const key of keys) {
    const value = source[key as string]
    if (value !== undefined) sink[key as string] = value
  }
}

/**
 * Resolve a node's visual style by layering the cascade. The palette baseline
 * is read tolerantly (the full token contract fills any gaps); `layers` are the
 * prototype style, the entity override and the node override, in that order.
 */
export function resolveNodeStyle(
  palette: PaletteTokens,
  ...layers: (StyleDelta | undefined)[]
): ResolvedNodeStyle {
  const base = fullTokens(palette).node
  const resolved: ResolvedNodeStyle = { ...NODE_FALLBACK }
  pick(resolved, base as unknown as Record<string, unknown>, NODE_STYLE_KEYS)
  // Honor any extra raw fields a legacy palette pinned directly on `node`.
  pick(resolved, asRecord((palette as Record<string, unknown>).node), NODE_STYLE_KEYS)
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
  const base = fullTokens(palette).edge
  const resolved: ResolvedEdgeStyle = { ...EDGE_FALLBACK }
  pick(resolved, base as unknown as Record<string, unknown>, EDGE_STYLE_KEYS)
  pick(resolved, asRecord((palette as Record<string, unknown>).edge), EDGE_STYLE_KEYS)
  for (const layer of layers) pick(resolved, layer, EDGE_STYLE_KEYS)
  return resolved
}
