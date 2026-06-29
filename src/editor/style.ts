/**
 * Style cascade (design §6 / §D3). The resolved style spans the full token
 * contract: surface/content/border colors, border width, shape (incl. diamond),
 * border style, background pattern and elevation.
 *
 * A resolved style is computed by layering, later-wins:
 *
 *   Palette fallback  →  row.style (the full snapshot)
 *
 * For nodes the row layer is `node.style`; for edges it is `edge.style` (§D3).
 * The style is a full snapshot seeded from the row's NodePrototype/EdgePrototype
 * and only changes via an explicit Refresh; the prototype is **not** consulted
 * at render time, and there are no StyleProfile layers (§D5, removed entirely).
 * The palette supplies a tolerant fallback so any key the snapshot omits still
 * resolves — keeping resolution **total**. Because the row carries a concrete
 * snapshot, swapping the palette no longer live-reskins pinned keys (§D10).
 *
 * Resolution also stays **backward compatible**: the palette baseline is read
 * tolerantly off `PaletteTokens`, so even a minimal `{ node, edge }` palette
 * still resolves and renders.
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
 * The full token contract is concrete here; it serves as the render-time
 * fallback and as a preset/seed source for new prototypes (§D10). It is no
 * longer a live re-skin source: rows carry concrete snapshots.
 */
export const DEFAULT_PALETTE_TOKENS: PaletteTokens = toPaletteTokens(DEFAULT_FULL_TOKENS)

export const DEFAULT_PALETTE_NAME = 'Default'

/**
 * Built-in palette library (spec §8.4 — "built-ins seeded at first run"). Each
 * entry is a distinct full-token look. Under §D10 palettes are demoted to
 * app-chrome theme plus a preset/seed source for prototypes; they no longer
 * live-reskin a canvas, because rows carry concrete style snapshots. At render
 * time `diagram.ts` uses the palette only as a tolerant fallback.
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
 * is read tolerantly (the full token contract fills any gaps); `layers` is the
 * node's full `style` snapshot (§D3).
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
 * Resolve an edge's visual style. `layers` is the edge's full `style`
 * snapshot (§D3).
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
