/**
 * Node style templates — one-click "quick styles" for a node (spec §8.3 quick
 * styling; design §D3 snapshot-on-apply).
 *
 * A template is a **complete** node style snapshot (every {@link ResolvedNodeStyle}
 * key) that the property panel writes onto a node in a single undoable command,
 * exactly like pinning each control by hand. It is purely visual — no entity,
 * prototype, or semantic type is created — so it is the fastest way to reskin a
 * node while sketching a prototype or laying out a diagram.
 *
 * The looks borrow their palettes from the `iux` aesthetic library (Flat,
 * Material, Neubrutalism, Glass, Editorial, …) so the presets read as a coherent
 * design system rather than arbitrary colors. Kept framework-free so the panel,
 * tests, and any future "seed a prototype from a template" path can all reuse it.
 */

import type { ResolvedNodeStyle } from './style'

/** The sections the templates are grouped under in the panel, in display order. */
export const NODE_TEMPLATE_GROUPS = [
  'Neutrals',
  'Intents',
  'Aesthetics',
  'Shapes',
] as const
export type NodeTemplateGroup = (typeof NODE_TEMPLATE_GROUPS)[number]

/** One quick-style preset: a stable id, a label, its group, and a full snapshot. */
export interface NodeStyleTemplate {
  /** Stable id (used as the React key and in tests). */
  id: string
  /** Human label shown on the swatch. */
  name: string
  /** One-line description of the look (tooltip). */
  description: string
  /** Which section the swatch appears under. */
  group: NodeTemplateGroup
  /** The complete node style snapshot applied on click. */
  style: ResolvedNodeStyle
}

/**
 * The curated quick-style library. Every entry is a full snapshot so applying it
 * fully defines the node's look regardless of the current palette. Values are
 * lifted from the `iux` palettes named in each description.
 */
export const NODE_STYLE_TEMPLATES: NodeStyleTemplate[] = [
  // ── Neutrals — the everyday, low-chrome looks ──────────────────────────────
  {
    id: 'flat',
    name: 'Flat',
    description: 'iux Flat/Classic — clean white card, hairline border.',
    group: 'Neutrals',
    style: {
      surface: '#ffffff',
      content: '#0f172a',
      border: '#cbd5e1',
      borderWidth: 1,
      shape: 'rounded',
      borderStyle: 'solid',
      pattern: 'none',
      elevation: 'low',
    },
  },
  {
    id: 'material',
    name: 'Material',
    description: 'iux Material — paper surface lifted on a soft elevation shadow.',
    group: 'Neutrals',
    style: {
      surface: '#ffffff',
      content: '#212121',
      border: '#e0e0e0',
      borderWidth: 1,
      shape: 'rounded',
      borderStyle: 'solid',
      pattern: 'none',
      elevation: 'high',
    },
  },
  {
    id: 'ghost',
    name: 'Ghost',
    description: 'Minimal outline — muted text, dashed hairline, no fill weight.',
    group: 'Neutrals',
    style: {
      surface: '#ffffff',
      content: '#475569',
      border: '#94a3b8',
      borderWidth: 1,
      shape: 'rounded',
      borderStyle: 'dashed',
      pattern: 'none',
      elevation: 'flat',
    },
  },
  {
    id: 'sticky',
    name: 'Sticky',
    description: 'Sticky-note yellow — the fast prototyping placeholder.',
    group: 'Neutrals',
    style: {
      surface: '#fff9b1',
      content: '#4a3a00',
      border: '#f2e27a',
      borderWidth: 1,
      shape: 'rect',
      borderStyle: 'solid',
      pattern: 'none',
      elevation: 'low',
    },
  },

  // ── Intents — filled semantic colors ───────────────────────────────────────
  {
    id: 'primary',
    name: 'Primary',
    description: 'Filled brand blue for the focal node.',
    group: 'Intents',
    style: {
      surface: '#4361ee',
      content: '#ffffff',
      border: '#324bc8',
      borderWidth: 1,
      shape: 'rounded',
      borderStyle: 'solid',
      pattern: 'none',
      elevation: 'low',
    },
  },
  {
    id: 'success',
    name: 'Success',
    description: 'Filled green — a healthy / completed state.',
    group: 'Intents',
    style: {
      surface: '#157347',
      content: '#ffffff',
      border: '#0f5132',
      borderWidth: 1,
      shape: 'rounded',
      borderStyle: 'solid',
      pattern: 'none',
      elevation: 'low',
    },
  },
  {
    id: 'warning',
    name: 'Warning',
    description: 'Filled amber — needs attention.',
    group: 'Intents',
    style: {
      surface: '#f0a500',
      content: '#3a2a00',
      border: '#c98a00',
      borderWidth: 1,
      shape: 'rounded',
      borderStyle: 'solid',
      pattern: 'none',
      elevation: 'low',
    },
  },
  {
    id: 'danger',
    name: 'Danger',
    description: 'Filled red — an error / blocking state.',
    group: 'Intents',
    style: {
      surface: '#dc3545',
      content: '#ffffff',
      border: '#b02a37',
      borderWidth: 1,
      shape: 'rounded',
      borderStyle: 'solid',
      pattern: 'none',
      elevation: 'low',
    },
  },

  // ── Aesthetics — borrowed iux engine looks ─────────────────────────────────
  {
    id: 'neubrutalist',
    name: 'Neubrutalist',
    description: 'iux Neubrutalism — thick black border, zero radius, flat fill.',
    group: 'Aesthetics',
    style: {
      surface: '#ffd84d',
      content: '#0a0a0a',
      border: '#0a0a0a',
      borderWidth: 3,
      shape: 'rect',
      borderStyle: 'solid',
      pattern: 'none',
      elevation: 'flat',
    },
  },
  {
    id: 'glass',
    name: 'Glass',
    description: 'iux Glassmorphism — frosted lavender pill on a soft shadow.',
    group: 'Aesthetics',
    style: {
      surface: '#eef1ff',
      content: '#1e2140',
      border: '#c7ccf2',
      borderWidth: 1,
      shape: 'pill',
      borderStyle: 'solid',
      pattern: 'none',
      elevation: 'medium',
    },
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'iux Editorial — warm paper, ink text, rust accent border.',
    group: 'Aesthetics',
    style: {
      surface: '#f7f1e3',
      content: '#1e170d',
      border: '#a13b1a',
      borderWidth: 1,
      shape: 'rect',
      borderStyle: 'solid',
      pattern: 'none',
      elevation: 'flat',
    },
  },
  {
    id: 'neon',
    name: 'Neon',
    description: 'iux Vaporwave/Neon — near-black field, dual-neon accents.',
    group: 'Aesthetics',
    style: {
      surface: '#1a1035',
      content: '#7af7ff',
      border: '#ff77e9',
      borderWidth: 2,
      shape: 'rounded',
      borderStyle: 'solid',
      pattern: 'none',
      elevation: 'high',
    },
  },

  // ── Shapes — presets that lead with a distinctive geometry ─────────────────
  {
    id: 'decision',
    name: 'Decision',
    description: 'Amber diamond — a branch / decision node.',
    group: 'Shapes',
    style: {
      surface: '#fff4e5',
      content: '#7a4100',
      border: '#f08c00',
      borderWidth: 2,
      shape: 'diamond',
      borderStyle: 'solid',
      pattern: 'none',
      elevation: 'low',
    },
  },
  {
    id: 'datastore',
    name: 'Data store',
    description: 'Green dotted pill — a store / dataset node.',
    group: 'Shapes',
    style: {
      surface: '#eafaf1',
      content: '#0f5132',
      border: '#2e9e5b',
      borderWidth: 1,
      shape: 'pill',
      borderStyle: 'solid',
      pattern: 'dots',
      elevation: 'low',
    },
  },
]
