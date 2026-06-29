/**
 * Relationships browser panel (design §10 / D7).
 *
 * Relationships are first-class and **browsable** (D7): this panel mirrors the
 * entity surface — a navigable list of the GRAPH's relationships, each row
 * showing source→target entity names, the linked edge prototype, the label, and
 * a metadata count. Selecting a row drills DOWN to the backing entities (and, on
 * the active diagram, the backing edge): expanding a row reveals its source and
 * target entities with "Go to" controls that navigate to a diagram/layout where
 * each entity is placed (the same `onNavigate('entity', …)` seam EntityPanel
 * uses), plus a "Reveal edge" control when the active diagram contains the edge
 * that places this relationship — selecting it on the canvas.
 *
 * Data is read with ONE keyed `useQuery` over `getGraph(graphId)` (relationships
 * + entities + prototypes all arrive together); names/prototypes are resolved by
 * in-memory lookup maps, so there is no per-row fetch (no N+1). The backing edge
 * lookup reads the active diagram once, also keyed.
 *
 * Mobile-first (spec §10.2): a proper `<ul>/<li>` list with an `aria-label`;
 * every row is a real ≥44px `<button>` (keyboard-operable, `focus-visible` ring
 * from `--nodge-border-focus`); the drill-down controls are real ≥44px buttons
 * too. No hover-only affordances; rows wrap rather than overflow a 320px panel.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useGateway } from '../../app/GatewayContext'
import type { Uuid } from '../../gateway'

export interface RelationshipsPanelProps {
  graphId: Uuid
  /** The active diagram — used to reveal the backing edge of a relationship. */
  diagramId: Uuid
  /**
   * Drill-down to a backing entity: navigates to a diagram/layout where the
   * entity is placed (wired through the router by the parent, mirroring
   * EntityPanel's `onNavigate('entity', …)`).
   */
  onNavigateEntity?: (entityId: Uuid) => void
  /** Reveal/select the backing edge on the canvas (when on the active diagram). */
  onRevealEdge?: (edgeId: Uuid) => void
}

export function RelationshipsPanel({
  graphId,
  diagramId,
  onNavigateEntity,
  onRevealEdge,
}: RelationshipsPanelProps) {
  const getGateway = useGateway()
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<Uuid | null>(null)

  // One keyed read of the whole graph (relationships + entities + prototypes).
  const graph = useQuery({
    queryKey: ['graph', graphId],
    queryFn: async () => (await getGateway()).getGraph(graphId),
  })

  // One keyed read of the active diagram so a relationship can reveal the edge
  // that places it here (edges are diagram-scoped; a relationship may not have a
  // placement on this diagram).
  const diagram = useQuery({
    queryKey: ['diagram-detail', diagramId],
    queryFn: async () => (await getGateway()).getDiagram(diagramId),
  })

  // In-memory lookup maps so each row resolves names/prototypes/edges in O(1) —
  // no per-row gateway call.
  const entityName = useMemo(() => {
    const m = new Map<Uuid, string>()
    for (const e of graph.data?.entities ?? []) m.set(e.id, e.name)
    return m
  }, [graph.data])

  const prototypeName = useMemo(() => {
    const m = new Map<Uuid, string>()
    for (const p of graph.data?.prototypes ?? []) m.set(p.id, p.name)
    return m
  }, [graph.data])

  const edgeByRelationship = useMemo(() => {
    const m = new Map<Uuid, Uuid>()
    for (const edge of diagram.data?.edges ?? []) m.set(edge.relationshipId, edge.id)
    return m
  }, [diagram.data])

  const relationships = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = graph.data?.relationships ?? []
    if (!q) return all
    return all.filter((r) => {
      const src = entityName.get(r.sourceEntityId) ?? ''
      const tgt = entityName.get(r.targetEntityId) ?? ''
      return (
        r.label.toLowerCase().includes(q) ||
        src.toLowerCase().includes(q) ||
        tgt.toLowerCase().includes(q)
      )
    })
  }, [graph.data, query, entityName])

  if (!graph.data) {
    return (
      <section className="panel" aria-label="Relationships">
        <h2 className="panel-title">Relationships</h2>
        <p className="panel-empty">{graph.isLoading ? 'Loading…' : 'No graph'}</p>
      </section>
    )
  }

  return (
    <section className="panel" aria-label="Relationships">
      <h2 className="panel-title">Relationships</h2>

      <input
        className="panel-input"
        type="search"
        placeholder="Search relationships"
        aria-label="Search relationships"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <ul className="panel-list rel-list" aria-label="Relationship list">
        {relationships.map((r) => {
          const src = entityName.get(r.sourceEntityId) ?? '(unknown)'
          const tgt = entityName.get(r.targetEntityId) ?? '(unknown)'
          const proto = r.edgePrototypeId ? prototypeName.get(r.edgePrototypeId) : null
          const metaCount = Object.keys(r.metadata ?? {}).length
          const arrow = r.directed ? '→' : '↔'
          const expanded = expandedId === r.id
          const edgeId = edgeByRelationship.get(r.id) ?? null
          return (
            <li key={r.id} className="panel-list-item rel-item">
              <button
                type="button"
                className="rel-row"
                aria-expanded={expanded}
                aria-label={`Relationship ${src} ${arrow} ${tgt}${
                  r.label ? `, ${r.label}` : ''
                }`}
                onClick={() => setExpandedId(expanded ? null : r.id)}
              >
                <span className="rel-endpoints">
                  {src} <span aria-hidden="true">{arrow}</span> {tgt}
                </span>
                <span className="rel-meta">
                  {proto && <span className="rel-proto">{proto}</span>}
                  {r.label && <span className="rel-label">“{r.label}”</span>}
                  {metaCount > 0 && (
                    <span className="rel-metacount">
                      {metaCount} field{metaCount === 1 ? '' : 's'}
                    </span>
                  )}
                </span>
              </button>

              {expanded && (
                <div className="rel-drill" aria-label={`Drill-down for ${src} ${arrow} ${tgt}`}>
                  <button
                    type="button"
                    className="rel-drill-btn"
                    aria-label={`Go to source entity ${src}`}
                    disabled={!onNavigateEntity}
                    onClick={() => onNavigateEntity?.(r.sourceEntityId)}
                  >
                    Source: {src}
                  </button>
                  <button
                    type="button"
                    className="rel-drill-btn"
                    aria-label={`Go to target entity ${tgt}`}
                    disabled={!onNavigateEntity}
                    onClick={() => onNavigateEntity?.(r.targetEntityId)}
                  >
                    Target: {tgt}
                  </button>
                  {edgeId && (
                    <button
                      type="button"
                      className="rel-drill-btn"
                      aria-label={`Reveal edge for ${src} ${arrow} ${tgt}`}
                      disabled={!onRevealEdge}
                      onClick={() => onRevealEdge?.(edgeId)}
                    >
                      Reveal edge
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
        {relationships.length === 0 && (
          <li className="panel-empty">No relationships</li>
        )}
      </ul>
    </section>
  )
}
