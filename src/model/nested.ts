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
 * A style delta: a sparse bag of style values — each either a token reference
 * (omitted ⇒ "follows the palette") or a pinned raw literal (the link/unlink
 * escape hatch, §8.3). The concrete, validated key set is the resolved-style
 * contract in `editor/tokens.ts` (`NODE_PINNABLE_KEYS`/`EDGE_PINNABLE_KEYS`).
 *
 * Stored as an open record on purpose: the cascade reads keys tolerantly and
 * fills any gap with a default, so a delta is sparse and round-trips losslessly
 * — old documents (which only ever pinned a couple of keys) load unchanged.
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

/**
 * Semantic style tokens for a palette. The full nodge token contract (§8.2) —
 * surface/content/border/intent/accent colors, geometry, stroke+pattern+shape,
 * typography, elevation and engine effects — is defined concretely in
 * `editor/tokens.ts` (`FullPaletteTokens` + `fullTokens()`), which resolves any
 * partial/legacy palette to a complete token set by filling defaults.
 *
 * Stored as an open record so resolution is **tolerant** (fills gaps) and
 * **backward compatible**: the minimal Phase-1/3 `{ node, edge }` palettes and
 * any persisted documents load and render without migration. The JSON column
 * round-trips losslessly, preserving unknown keys.
 */
export type PaletteTokens = Record<string, unknown>

export function parsePaletteTokens(value: unknown, path: string): PaletteTokens {
  return expectRecord(value, path)
}

/**
 * Optional filter/focus lens config (spec §7.2). A filter narrows the rendered
 * subgraph *without* changing diagram membership. Retained as a predicate for
 * later querying (§D12); no longer wired to a layout. All fields
 * are optional and compose (an empty filter shows everything):
 *
 *   - `prototypeIds`  — show only nodes whose entity links one of these prototypes.
 *   - `metadata`      — show only nodes whose entity metadata matches every
 *                       key/value pair (tag/metadata filter).
 *   - `focusNodeId`   — anchor for a focus-and-hops lens.
 *   - `hops`          — show only nodes within N relationship-hops of the focus
 *                       node (requires `focusNodeId`; 0 = focus only).
 */
export interface ViewFilter {
  prototypeIds?: string[]
  metadata?: Record<string, unknown>
  focusNodeId?: string
  hops?: number
}

function expectStringArray(value: unknown, path: string): string[] {
  return expectArray(value, path).map((item, i) => expectString(item, `${path}[${i}]`))
}

export function parseViewFilter(value: unknown, path: string): ViewFilter {
  const record = expectRecord(value, path)
  const filter: ViewFilter = {}
  if (record.prototypeIds !== undefined) {
    filter.prototypeIds = expectStringArray(record.prototypeIds, `${path}.prototypeIds`)
  }
  if (record.metadata !== undefined) {
    filter.metadata = expectRecord(record.metadata, `${path}.metadata`)
  }
  if (record.focusNodeId !== undefined) {
    filter.focusNodeId = expectString(record.focusNodeId, `${path}.focusNodeId`)
  }
  if (record.hops !== undefined) {
    filter.hops = expectNumber(record.hops, `${path}.hops`)
  }
  return filter
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

export const PROTOTYPE_KINDS = ['node', 'edge'] as const
export type PrototypeKind = (typeof PROTOTYPE_KINDS)[number]

/** Positioning algorithms a layout can use (§D8). `manual` = hand-placed. */
export const LAYOUT_ALGORITHMS = ['manual', 'dagre'] as const
export type LayoutAlgorithm = (typeof LAYOUT_ALGORITHMS)[number]

/** Oplog operation kinds (spec §6.3 / §6.6). */
export const OPLOG_OPS = ['upsert', 'delete'] as const
export type OplogOp = (typeof OPLOG_OPS)[number]

/**
 * The `snapshot` JSON column of an oplog entry: the full mutated row for an
 * `upsert`, or `null` for a `delete` tombstone. Stored as an open record so any
 * domain row shape round-trips losslessly through the journal.
 */
export type OplogSnapshot = Record<string, unknown>

export function parseOplogSnapshot(value: unknown, path: string): OplogSnapshot {
  return expectRecord(value, path)
}
