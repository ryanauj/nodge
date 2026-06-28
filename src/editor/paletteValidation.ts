/**
 * Palette validators (spec §8.2, §10.4) — pure & framework-free so they can be
 * unit-tested without a canvas and surfaced in the palette editor.
 *
 * Two checks:
 *   1. **Shape completeness** — every required token group is present and typed
 *      on the *raw* {@link PaletteTokens} (so a palette author sees what's still
 *      missing, even though resolution itself is tolerant via `fullTokens`).
 *   2. **WCAG AA contrast** — relative-luminance contrast ratio on the
 *      intent (bg vs content) and content-on-surface pairs; pairs below the AA
 *      threshold (4.5:1 for normal text) are flagged.
 */

import type { PaletteTokens } from '../model'
import { INTENTS, fullTokens } from './tokens'

/** WCAG 2.x AA threshold for normal-size text. */
export const WCAG_AA_NORMAL = 4.5
/** WCAG 2.x AA threshold for large text / UI components. */
export const WCAG_AA_LARGE = 3

export interface ContrastIssue {
  pair: string
  foreground: string
  background: string
  ratio: number
  threshold: number
}

export interface PaletteValidation {
  /** Missing/mistyped required token paths (empty = complete). */
  missing: string[]
  /** Intent/content pairs failing WCAG AA (empty = compliant). */
  contrast: ContrastIssue[]
  get ok(): boolean
}

/** Parse a #rgb or #rrggbb hex color into [r,g,b] (0–255), or null if invalid. */
export function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return null
  let hex = m[1]
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
  const n = parseInt(hex, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** WCAG relative luminance of an sRGB color (0 = black, 1 = white). */
export function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two hex colors (1:1 … 21:1). Invalid → 1. */
export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca || !cb) return 1
  const la = relativeLuminance(ca)
  const lb = relativeLuminance(cb)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && !Number.isNaN(v)
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/**
 * Report which required token paths are absent/mistyped on the raw palette.
 * Checks the cascade baseline (`node`/`edge`) plus the richer groups the editor
 * authors. Tolerant resolution still fills these — this is an authoring aid.
 */
export function shapeCompleteness(tokens: PaletteTokens): string[] {
  const missing: string[] = []
  const t = rec(tokens)

  const requireStr = (obj: Record<string, unknown>, key: string, path: string) => {
    if (!isStr(obj[key])) missing.push(path)
  }
  const requireNum = (obj: Record<string, unknown>, key: string, path: string) => {
    if (!isNum(obj[key])) missing.push(path)
  }

  const node = rec(t.node)
  requireStr(node, 'surface', 'node.surface')
  requireStr(node, 'content', 'node.content')
  requireStr(node, 'border', 'node.border')

  const edge = rec(t.edge)
  requireStr(edge, 'stroke', 'edge.stroke')

  const surface = rec(t.surface)
  for (const key of ['canvas', 'base', 'raised', 'sunken']) {
    requireStr(surface, key, `surface.${key}`)
  }
  const content = rec(t.content)
  for (const key of ['primary', 'secondary', 'muted', 'inverse']) {
    requireStr(content, key, `content.${key}`)
  }
  const border = rec(t.border)
  for (const key of ['subtle', 'default', 'strong', 'focus']) {
    requireStr(border, key, `border.${key}`)
  }
  const intent = rec(t.intent)
  for (const name of INTENTS) {
    const tone = rec(intent[name])
    for (const key of ['bg', 'content', 'border']) {
      requireStr(tone, key, `intent.${name}.${key}`)
    }
  }
  const geometry = rec(t.geometry)
  for (const key of ['space', 'radius', 'borderWidth']) {
    requireNum(geometry, key, `geometry.${key}`)
  }
  return missing
}

/**
 * Find intent/content pairs (and content-on-surface) below WCAG AA. Runs on the
 * *resolved* full token set so partial palettes are judged on their effective
 * colors. Large/UI pairs use the AA-large threshold.
 */
export function contrastIssues(tokens: PaletteTokens): ContrastIssue[] {
  const full = fullTokens(tokens)
  const issues: ContrastIssue[] = []

  const check = (
    pair: string,
    foreground: string,
    background: string,
    threshold: number,
  ) => {
    const ratio = contrastRatio(foreground, background)
    if (ratio < threshold) {
      issues.push({ pair, foreground, background, ratio: round(ratio), threshold })
    }
  }

  for (const name of INTENTS) {
    const tone = full.intent[name]
    check(`intent.${name}`, tone.content, tone.bg, WCAG_AA_NORMAL)
  }
  // Primary content must read on the base + raised surfaces.
  check('content.primary/surface.base', full.content.primary, full.surface.base, WCAG_AA_NORMAL)
  check('content.primary/surface.raised', full.content.primary, full.surface.raised, WCAG_AA_NORMAL)
  // Node text on its own surface (the most common on-canvas pair).
  check('node.content/node.surface', full.node.content, full.node.surface, WCAG_AA_NORMAL)
  return issues
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/** Validate a palette's shape completeness + contrast. */
export function validatePalette(tokens: PaletteTokens): PaletteValidation {
  const missing = shapeCompleteness(tokens)
  const contrast = contrastIssues(tokens)
  return {
    missing,
    contrast,
    get ok() {
      return missing.length === 0 && contrast.length === 0
    },
  }
}
