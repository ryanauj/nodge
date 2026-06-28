/**
 * The full nodge token contract (spec §8.2), Phase 4.
 *
 * A palette is a set of *semantic* style tokens that go beyond color: surfaces,
 * content, borders, an intent ramp and an accent ramp; geometry (space/radius/
 * borderWidth); stroke styles + background patterns + node shapes; typography;
 * elevation; and a curated set of engine-level effects applied at the
 * `PaletteRoot` boundary.
 *
 * Two hard requirements shape this file:
 *   1. **Backward compatibility.** The Phase-1/3 palettes are the minimal
 *      `{ node, edge }` shape. The richer contract keeps `node`/`edge` as the
 *      cascade baseline so old palettes/documents still load and render, and
 *      {@link parsePaletteTokens} fills every missing field with a default
 *      (resolution stays total) while preserving the legacy keys.
 *   2. **Purity.** Everything here is framework-free so it can be unit-tested
 *      without a canvas and reused by the validators and the `PaletteRoot`.
 */

import type { PaletteTokens, StyleDelta } from '../model'

// ── Enumerations (the closed vocabularies the contract constrains) ──────────

export const NODE_SHAPES = ['rect', 'rounded', 'pill', 'ellipse', 'diamond'] as const
export type NodeShape = (typeof NODE_SHAPES)[number]

export const BORDER_STYLES = ['solid', 'dashed', 'dotted', 'double'] as const
export type BorderStyle = (typeof BORDER_STYLES)[number]

export const BACKGROUND_PATTERNS = ['none', 'dots', 'grid', 'hatch', 'diagonal'] as const
export type BackgroundPattern = (typeof BACKGROUND_PATTERNS)[number]

export const ELEVATIONS = ['flat', 'low', 'medium', 'high', 'overlay'] as const
export type Elevation = (typeof ELEVATIONS)[number]

export const EFFECTS = ['none', 'sketch', 'glass', 'pixel', 'crt'] as const
export type Effect = (typeof EFFECTS)[number]

export const INTENTS = [
  'primary',
  'neutral',
  'success',
  'warning',
  'danger',
  'info',
] as const
export type Intent = (typeof INTENTS)[number]

export const TYPOGRAPHY_ROLES = [
  'display',
  'title',
  'heading',
  'body',
  'label',
  'caption',
  'code',
] as const
export type TypographyRole = (typeof TYPOGRAPHY_ROLES)[number]

// ── Token group shapes ──────────────────────────────────────────────────────

export interface SurfaceTokens {
  canvas: string
  base: string
  raised: string
  sunken: string
}

export interface ContentTokens {
  primary: string
  secondary: string
  muted: string
  inverse: string
}

export interface BorderTokens {
  subtle: string
  default: string
  strong: string
  focus: string
}

/** One rung of the intent ramp: a background, its content, and a border. */
export interface IntentTone {
  bg: string
  content: string
  border: string
}

export type IntentRamp = Record<Intent, IntentTone>

export interface GeometryTokens {
  space: number
  radius: number
  borderWidth: number
}

export interface StrokeTokens {
  borderStyle: BorderStyle
  pattern: BackgroundPattern
  shape: NodeShape
}

export interface TypographyTokens {
  family: string
  scale: Record<TypographyRole, number>
}

/** Box-shadow per elevation level (CSS shadow strings; '' = no shadow). */
export type ElevationTokens = Record<Elevation, string>

/** The node-level baseline a palette supplies (the cascade's first layer). */
export interface NodeTokens {
  surface: string
  content: string
  border: string
  borderWidth: number
  shape: NodeShape
  borderStyle: BorderStyle
  pattern: BackgroundPattern
  elevation: Elevation
}

/** The edge-level baseline a palette supplies. */
export interface EdgeTokens {
  stroke: string
  strokeWidth: number
}

/**
 * The full, validated palette token contract. `node`/`edge` are the cascade
 * baseline (kept for backward compatibility with the minimal Phase-1/3 shape);
 * the remaining groups carry the richer iux-grade contract and are exposed as
 * CSS variables by the `PaletteRoot`. `effect` applies at the root boundary.
 */
export interface FullPaletteTokens {
  surface: SurfaceTokens
  content: ContentTokens
  border: BorderTokens
  intent: IntentRamp
  accent: string[]
  geometry: GeometryTokens
  stroke: StrokeTokens
  typography: TypographyTokens
  elevation: ElevationTokens
  effect: Effect
  node: NodeTokens
  edge: EdgeTokens
}

// ── Defaults (keep resolution total; seed authoring) ────────────────────────

export const DEFAULT_NODE_TOKENS: NodeTokens = {
  surface: '#ffffff',
  content: '#1a1a2e',
  border: '#4361ee',
  borderWidth: 1,
  shape: 'rounded',
  borderStyle: 'solid',
  pattern: 'none',
  elevation: 'low',
}

export const DEFAULT_EDGE_TOKENS: EdgeTokens = {
  stroke: '#4361ee',
  strokeWidth: 1.5,
}

export const DEFAULT_SURFACE: SurfaceTokens = {
  canvas: '#f7f8fc',
  base: '#ffffff',
  raised: '#ffffff',
  sunken: '#eef1f8',
}

export const DEFAULT_CONTENT: ContentTokens = {
  primary: '#1a1a2e',
  secondary: '#414558',
  muted: '#6b7280',
  inverse: '#ffffff',
}

export const DEFAULT_BORDER: BorderTokens = {
  subtle: '#e5e7eb',
  default: '#cbd2e0',
  strong: '#9aa3b5',
  focus: '#4361ee',
}

export const DEFAULT_INTENT: IntentRamp = {
  primary: { bg: '#4361ee', content: '#ffffff', border: '#324bc8' },
  neutral: { bg: '#e5e7eb', content: '#1a1a2e', border: '#cbd2e0' },
  success: { bg: '#157347', content: '#ffffff', border: '#0f5132' },
  warning: { bg: '#f0a500', content: '#3a2a00', border: '#c98a00' },
  danger: { bg: '#dc3545', content: '#ffffff', border: '#b02a37' },
  info: { bg: '#176083', content: '#ffffff', border: '#0f4860' },
}

export const DEFAULT_ACCENT: string[] = [
  '#4361ee',
  '#2e9e5b',
  '#f0a500',
  '#dc3545',
  '#7048e8',
  '#3aa6d0',
]

export const DEFAULT_GEOMETRY: GeometryTokens = {
  space: 8,
  radius: 8,
  borderWidth: 1,
}

export const DEFAULT_STROKE: StrokeTokens = {
  borderStyle: 'solid',
  pattern: 'none',
  shape: 'rounded',
}

export const DEFAULT_TYPOGRAPHY: TypographyTokens = {
  family: 'system-ui, sans-serif',
  scale: {
    display: 32,
    title: 24,
    heading: 18,
    body: 14,
    label: 13,
    caption: 11,
    code: 13,
  },
}

export const DEFAULT_ELEVATION: ElevationTokens = {
  flat: 'none',
  low: '0 1px 2px rgba(0,0,0,0.12)',
  medium: '0 2px 6px rgba(0,0,0,0.16)',
  high: '0 6px 16px rgba(0,0,0,0.22)',
  overlay: '0 12px 32px rgba(0,0,0,0.30)',
}

/**
 * Widen a typed token object to the stored {@link PaletteTokens} shape (an open
 * record). Pure structural projection — the JSON is identical, only the static
 * type widens so it can be persisted/passed through the gateway.
 */
export function toPaletteTokens(full: FullPaletteTokens): PaletteTokens {
  return full as unknown as PaletteTokens
}

/** The full default palette — every group present, resolution total. */
export const DEFAULT_FULL_TOKENS: FullPaletteTokens = {
  surface: DEFAULT_SURFACE,
  content: DEFAULT_CONTENT,
  border: DEFAULT_BORDER,
  intent: DEFAULT_INTENT,
  accent: DEFAULT_ACCENT,
  geometry: DEFAULT_GEOMETRY,
  stroke: DEFAULT_STROKE,
  typography: DEFAULT_TYPOGRAPHY,
  elevation: DEFAULT_ELEVATION,
  effect: 'none',
  node: DEFAULT_NODE_TOKENS,
  edge: DEFAULT_EDGE_TOKENS,
}

// ── Tolerant access helpers (read richer fields off a loose PaletteTokens) ──

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/**
 * Read a complete {@link FullPaletteTokens} out of a (possibly minimal or
 * partial) {@link PaletteTokens}, filling every absent field from the defaults.
 * This is what makes the richer contract backward compatible: an old `{ node,
 * edge }` palette resolves to a full token set without migration.
 */
export function fullTokens(tokens: PaletteTokens): FullPaletteTokens {
  const t = rec(tokens)
  const node = rec(t.node)
  const edge = rec(t.edge)
  const surface = rec(t.surface)
  const content = rec(t.content)
  const border = rec(t.border)
  const intentRec = rec(t.intent)
  const geometry = rec(t.geometry)
  const stroke = rec(t.stroke)
  const typography = rec(t.typography)
  const elevation = rec(t.elevation)

  const intent = {} as IntentRamp
  for (const key of INTENTS) {
    const tone = rec(intentRec[key])
    const d = DEFAULT_INTENT[key]
    intent[key] = {
      bg: str(tone.bg, d.bg),
      content: str(tone.content, d.content),
      border: str(tone.border, d.border),
    }
  }

  const scaleRec = rec(typography.scale)
  const scale = {} as Record<TypographyRole, number>
  for (const role of TYPOGRAPHY_ROLES) {
    scale[role] = num(scaleRec[role], DEFAULT_TYPOGRAPHY.scale[role])
  }

  const elev = {} as ElevationTokens
  for (const level of ELEVATIONS) {
    elev[level] = str(elevation[level], DEFAULT_ELEVATION[level])
  }

  const accent = Array.isArray(t.accent)
    ? t.accent.filter((c): c is string => typeof c === 'string')
    : DEFAULT_ACCENT

  return {
    surface: {
      canvas: str(surface.canvas, DEFAULT_SURFACE.canvas),
      base: str(surface.base, DEFAULT_SURFACE.base),
      raised: str(surface.raised, DEFAULT_SURFACE.raised),
      sunken: str(surface.sunken, DEFAULT_SURFACE.sunken),
    },
    content: {
      primary: str(content.primary, DEFAULT_CONTENT.primary),
      secondary: str(content.secondary, DEFAULT_CONTENT.secondary),
      muted: str(content.muted, DEFAULT_CONTENT.muted),
      inverse: str(content.inverse, DEFAULT_CONTENT.inverse),
    },
    border: {
      subtle: str(border.subtle, DEFAULT_BORDER.subtle),
      default: str(border.default, DEFAULT_BORDER.default),
      strong: str(border.strong, DEFAULT_BORDER.strong),
      focus: str(border.focus, DEFAULT_BORDER.focus),
    },
    intent,
    accent: accent.length > 0 ? accent : DEFAULT_ACCENT,
    geometry: {
      space: num(geometry.space, DEFAULT_GEOMETRY.space),
      radius: num(geometry.radius, DEFAULT_GEOMETRY.radius),
      borderWidth: num(geometry.borderWidth, DEFAULT_GEOMETRY.borderWidth),
    },
    stroke: {
      borderStyle: oneOf(stroke.borderStyle, BORDER_STYLES, DEFAULT_STROKE.borderStyle),
      pattern: oneOf(stroke.pattern, BACKGROUND_PATTERNS, DEFAULT_STROKE.pattern),
      shape: oneOf(stroke.shape, NODE_SHAPES, DEFAULT_STROKE.shape),
    },
    typography: { family: str(typography.family, DEFAULT_TYPOGRAPHY.family), scale },
    elevation: elev,
    effect: oneOf(t.effect, EFFECTS, 'none'),
    node: {
      surface: str(node.surface, DEFAULT_NODE_TOKENS.surface),
      content: str(node.content, DEFAULT_NODE_TOKENS.content),
      border: str(node.border, DEFAULT_NODE_TOKENS.border),
      borderWidth: num(node.borderWidth, DEFAULT_NODE_TOKENS.borderWidth),
      shape: oneOf(node.shape, NODE_SHAPES, DEFAULT_NODE_TOKENS.shape),
      borderStyle: oneOf(node.borderStyle, BORDER_STYLES, DEFAULT_NODE_TOKENS.borderStyle),
      pattern: oneOf(node.pattern, BACKGROUND_PATTERNS, DEFAULT_NODE_TOKENS.pattern),
      elevation: oneOf(node.elevation, ELEVATIONS, DEFAULT_NODE_TOKENS.elevation),
    },
    edge: {
      stroke: str(edge.stroke, DEFAULT_EDGE_TOKENS.stroke),
      strokeWidth: num(edge.strokeWidth, DEFAULT_EDGE_TOKENS.strokeWidth),
    },
  }
}

/**
 * Project a full token set into the flat set of CSS custom properties the
 * `PaletteRoot` writes (spec §8.1: "CSS-variable application via a PaletteRoot
 * boundary"). Names are stable so chrome CSS can read `--nodge-*` variables.
 */
export function tokensToCssVars(full: FullPaletteTokens): Record<string, string> {
  const vars: Record<string, string> = {
    '--nodge-surface-canvas': full.surface.canvas,
    '--nodge-surface-base': full.surface.base,
    '--nodge-surface-raised': full.surface.raised,
    '--nodge-surface-sunken': full.surface.sunken,
    '--nodge-content-primary': full.content.primary,
    '--nodge-content-secondary': full.content.secondary,
    '--nodge-content-muted': full.content.muted,
    '--nodge-content-inverse': full.content.inverse,
    '--nodge-border-subtle': full.border.subtle,
    '--nodge-border-default': full.border.default,
    '--nodge-border-strong': full.border.strong,
    '--nodge-border-focus': full.border.focus,
    '--nodge-space': `${full.geometry.space}px`,
    '--nodge-radius': `${full.geometry.radius}px`,
    '--nodge-border-width': `${full.geometry.borderWidth}px`,
    '--nodge-font-family': full.typography.family,
    '--nodge-elevation-flat': full.elevation.flat,
    '--nodge-elevation-low': full.elevation.low,
    '--nodge-elevation-medium': full.elevation.medium,
    '--nodge-elevation-high': full.elevation.high,
    '--nodge-elevation-overlay': full.elevation.overlay,
    // Back-compat alias used by the existing chrome CSS.
    '--nodge-chrome': full.surface.raised,
  }
  for (const intent of INTENTS) {
    vars[`--nodge-intent-${intent}-bg`] = full.intent[intent].bg
    vars[`--nodge-intent-${intent}-content`] = full.intent[intent].content
    vars[`--nodge-intent-${intent}-border`] = full.intent[intent].border
  }
  for (const role of TYPOGRAPHY_ROLES) {
    vars[`--nodge-font-${role}`] = `${full.typography.scale[role]}px`
  }
  full.accent.forEach((color, i) => {
    vars[`--nodge-accent-${i}`] = color
  })
  return vars
}

/** Map a CSS dash array / style keyword for a border style token. */
export function borderStyleCss(style: BorderStyle): string {
  return style
}

/** Map a node shape token to a CSS border-radius (px). `diamond` rotates 45°. */
export function shapeRadius(shape: NodeShape): number {
  switch (shape) {
    case 'rect':
    case 'diamond':
      return 0
    case 'pill':
    case 'ellipse':
      return 999
    case 'rounded':
    default:
      return 8
  }
}

/** Map an elevation token to a CSS box-shadow using the palette's elevation set. */
export function elevationShadow(elevation: ElevationTokens, level: Elevation): string {
  return elevation[level] ?? 'none'
}

/**
 * Build a CSS `background-image` for a node background pattern, tinted by the
 * border color so it reads on any surface. `none` returns undefined (no image).
 */
export function patternBackground(
  pattern: BackgroundPattern,
  tint: string,
): string | undefined {
  switch (pattern) {
    case 'dots':
      return `radial-gradient(${tint} 1px, transparent 1px)`
    case 'grid':
      return `linear-gradient(${tint} 1px, transparent 1px), linear-gradient(90deg, ${tint} 1px, transparent 1px)`
    case 'hatch':
      return `repeating-linear-gradient(45deg, ${tint} 0, ${tint} 1px, transparent 1px, transparent 6px)`
    case 'diagonal':
      return `repeating-linear-gradient(-45deg, ${tint} 0, ${tint} 2px, transparent 2px, transparent 8px)`
    case 'none':
    default:
      return undefined
  }
}

/**
 * The handful of `StyleDelta` keys node controls can pin/unlink in the property
 * panel. Each maps a control to the resolved-style field it overrides.
 */
export const NODE_PINNABLE_KEYS = [
  'surface',
  'content',
  'border',
  'borderWidth',
  'shape',
  'borderStyle',
  'pattern',
  'elevation',
] as const
export type NodePinnableKey = (typeof NODE_PINNABLE_KEYS)[number]

export const EDGE_PINNABLE_KEYS = ['stroke', 'strokeWidth'] as const
export type EdgePinnableKey = (typeof EDGE_PINNABLE_KEYS)[number]

/** Is a key pinned (present) in a style delta? Drives the link/unlink toggle. */
export function isPinned(delta: StyleDelta | undefined, key: string): boolean {
  return !!delta && Object.prototype.hasOwnProperty.call(delta, key)
}
