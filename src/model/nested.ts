/**
 * Nested value types stored inside JSON columns, with co-located validators.
 * These are the building blocks the field DSL's `json()` columns reference, so
 * the validator and the TypeScript type for each shape stay defined together.
 */

import {
  expectArray,
  expectNumber,
  expectOneOf,
  expectRecord,
  expectString,
} from './validate'

export const EXTERNAL_LINK_KINDS = [
  'url',
  'file',
  'diagram',
  'entity',
  'record',
  'note',
] as const
export type ExternalLinkKind = (typeof EXTERNAL_LINK_KINDS)[number]

/** A typed link from an entity to the abstract thing it describes (§5.4). */
export interface ExternalLink {
  id: string
  kind: ExternalLinkKind
  target: string
  label: string
}

export function parseExternalLink(value: unknown, path: string): ExternalLink {
  const record = expectRecord(value, path)
  return {
    id: expectString(record.id, `${path}.id`),
    kind: expectOneOf(record.kind, EXTERNAL_LINK_KINDS, `${path}.kind`),
    target: expectString(record.target, `${path}.target`),
    label: expectString(record.label, `${path}.label`),
  }
}

export function parseExternalLinks(value: unknown, path: string): ExternalLink[] {
  return expectArray(value, path).map((item, i) => parseExternalLink(item, `${path}[${i}]`))
}

/**
 * A style delta: a sparse bag of style values (token references or pinned raw
 * literals). The full token contract arrives in Phase 4; for Phase 0 the shape
 * is an open record so it round-trips losslessly.
 */
export type StyleDelta = Record<string, unknown>

export function parseStyleDelta(value: unknown, path: string): StyleDelta {
  return expectRecord(value, path)
}

/** Open metadata bag carried by entities, relationships and prototypes. */
export type Metadata = Record<string, unknown>

export function parseMetadata(value: unknown, path: string): Metadata {
  return expectRecord(value, path)
}

/** Semantic style tokens for a palette (open until the Phase 4 token contract). */
export type PaletteTokens = Record<string, unknown>

export function parsePaletteTokens(value: unknown, path: string): PaletteTokens {
  return expectRecord(value, path)
}

/** Optional filter/focus lens config on a view. */
export type ViewFilter = Record<string, unknown>

export function parseViewFilter(value: unknown, path: string): ViewFilter {
  return expectRecord(value, path)
}

/** Saved pan/zoom for a view. */
export interface Viewport {
  x: number
  y: number
  zoom: number
}

export function parseViewport(value: unknown, path: string): Viewport {
  const record = expectRecord(value, path)
  return {
    x: expectNumber(record.x, `${path}.x`),
    y: expectNumber(record.y, `${path}.y`),
    zoom: expectNumber(record.zoom, `${path}.zoom`),
  }
}

export const PROTOTYPE_KINDS = ['node', 'relationship'] as const
export type PrototypeKind = (typeof PROTOTYPE_KINDS)[number]

export const STYLE_PROFILE_TARGETS = ['node', 'edge'] as const
export type StyleProfileTarget = (typeof STYLE_PROFILE_TARGETS)[number]
