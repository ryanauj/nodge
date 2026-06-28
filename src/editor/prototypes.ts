/**
 * Built-in prototype library (spec §9.1: "A few built-in prototypes are seeded
 * so the tool is useful on first run"). These are plain {@link PrototypeInput}s
 * seeded at graph creation; the user can browse them in the prototype panel,
 * stamp entities from them, duplicate them, or save new ones from a node/edge.
 *
 * Kept framework-free so bootstrap can seed them and tests can assert them.
 */

import type { PrototypeInput } from '../gateway'

/** Default node prototypes: a small, generally-useful starter set. */
export const BUILTIN_NODE_PROTOTYPES: PrototypeInput[] = [
  {
    kind: 'node',
    name: 'Service',
    shape: 'rounded',
    defaultLabel: 'Service',
    style: { surface: '#e7f0ff', content: '#0b2e66', border: '#4361ee', shape: 'rounded' },
    metadata: { category: 'service' },
  },
  {
    kind: 'node',
    name: 'Data store',
    shape: 'pill',
    defaultLabel: 'Data store',
    style: { surface: '#eafaf1', content: '#0f5132', border: '#2e9e5b', shape: 'pill' },
    metadata: { category: 'data' },
  },
  {
    kind: 'node',
    name: 'External',
    shape: 'rect',
    defaultLabel: 'External',
    style: { surface: '#fff4e5', content: '#7a4100', border: '#f08c00', shape: 'rect' },
    metadata: { category: 'external' },
  },
]

/** Default relationship prototypes: common edge types. */
export const BUILTIN_RELATIONSHIP_PROTOTYPES: PrototypeInput[] = [
  {
    kind: 'relationship',
    name: 'Calls',
    defaultLabel: 'calls',
    style: { stroke: '#4361ee', strokeWidth: 1.5 },
    metadata: { category: 'call' },
  },
  {
    kind: 'relationship',
    name: 'Depends on',
    defaultLabel: 'depends on',
    style: { stroke: '#d6336c', strokeWidth: 1.5 },
    metadata: { category: 'dependency' },
  },
]

export const BUILTIN_PROTOTYPES: PrototypeInput[] = [
  ...BUILTIN_NODE_PROTOTYPES,
  ...BUILTIN_RELATIONSHIP_PROTOTYPES,
]
