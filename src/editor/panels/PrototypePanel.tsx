/**
 * Prototype library panel (spec §9.1, §12 Phase 2).
 *
 * Browse the graph's prototypes, stamp a new node/relationship-bearing entity
 * from a chosen prototype, duplicate a prototype to fork a type, refresh all
 * entities of a prototype to its current style/metadata, and save the current
 * selection (a node or edge) as a new prototype. Every action goes through the
 * gateway (the single data seam); the parent re-queries on success.
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useGateway } from '../../app/GatewayContext'
import type { Prototype } from '../../model'
import type { Uuid } from '../../gateway'

export interface PrototypePanelProps {
  graphId: Uuid
  /** The currently-selected node id, if any (enables "save node as prototype"). */
  selectedNodeId: Uuid | null
  /** The currently-selected edge id, if any (enables "save edge as prototype"). */
  selectedEdgeId: Uuid | null
  /** Stamp a new placement of a fresh entity from this prototype onto the board. */
  onStampPrototype: (prototype: Prototype) => void
  /** Called after any mutation so the canvas/queries refresh. */
  onChanged: () => void
}

export function PrototypePanel({
  graphId,
  selectedNodeId,
  selectedEdgeId,
  onStampPrototype,
  onChanged,
}: PrototypePanelProps) {
  const getGateway = useGateway()
  const [query, setQuery] = useState('')

  const prototypes = useQuery({
    queryKey: ['prototypes', graphId],
    queryFn: async () => (await getGateway()).listPrototypes(graphId),
  })

  const filtered = useMemo(() => {
    const list = prototypes.data ?? []
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((p) => p.name.toLowerCase().includes(q))
  }, [prototypes.data, query])

  const afterMutation = async () => {
    await prototypes.refetch()
    onChanged()
  }

  const duplicate = useMutation({
    mutationFn: async (id: Uuid) => (await getGateway()).duplicatePrototype(id),
    onSuccess: afterMutation,
  })

  const refresh = useMutation({
    // TODO(phase 7): refreshFromPrototype({ all }) is now diagram-scoped (§7/D1);
    // pass the active diagramId here once this panel is wired to the editor's
    // current diagram.
    mutationFn: async (id: Uuid) =>
      (await getGateway()).refreshFromPrototype({ prototypeId: id, all: true }),
    onSuccess: afterMutation,
  })

  const saveNode = useMutation({
    mutationFn: async () => {
      if (!selectedNodeId) return
      const name = window.prompt('Name for the new prototype', 'New prototype')
      if (!name) return
      return (await getGateway()).createPrototypeFromNode({ nodeId: selectedNodeId, name })
    },
    onSuccess: afterMutation,
  })

  const saveEdge = useMutation({
    mutationFn: async () => {
      if (!selectedEdgeId) return
      const name = window.prompt('Name for the new relationship prototype', 'New relationship')
      if (!name) return
      return (await getGateway()).createPrototypeFromEdge({ edgeId: selectedEdgeId, name })
    },
    onSuccess: afterMutation,
  })

  return (
    <section className="panel" aria-label="Prototype library">
      <h2 className="panel-title">Prototypes</h2>
      <input
        className="panel-input"
        type="search"
        placeholder="Search prototypes"
        aria-label="Search prototypes"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="panel-actions">
        <button onClick={() => saveNode.mutate()} disabled={!selectedNodeId}>
          Save node as prototype
        </button>
        <button onClick={() => saveEdge.mutate()} disabled={!selectedEdgeId}>
          Save edge as prototype
        </button>
      </div>
      <ul className="panel-list" aria-label="Prototype list">
        {filtered.map((p) => (
          <li key={p.id} className="panel-list-item">
            <span className="proto-name">
              {p.name} <em className="proto-kind">({p.kind})</em>
            </span>
            <span className="proto-buttons">
              {p.kind === 'node' && (
                <button onClick={() => onStampPrototype(p)} aria-label={`Create from ${p.name}`}>
                  Create
                </button>
              )}
              <button onClick={() => duplicate.mutate(p.id)} aria-label={`Duplicate ${p.name}`}>
                Duplicate
              </button>
              <button onClick={() => refresh.mutate(p.id)} aria-label={`Refresh all of ${p.name}`}>
                Refresh all
              </button>
            </span>
          </li>
        ))}
        {filtered.length === 0 && <li className="panel-empty">No prototypes</li>}
      </ul>
    </section>
  )
}
