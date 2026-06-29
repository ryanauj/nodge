/**
 * Prototype library panel (spec §9.1, §12 Phase 2; design §10 / D4).
 *
 * Surfaces the graph's prototypes as **two distinct libraries** — Node
 * prototypes and Edge prototypes (`PROTOTYPE_KINDS = ['node','edge']`) — switched
 * by a WAI-ARIA tablist. Within the active library you can stamp a new placement
 * (node prototypes), duplicate a prototype to fork a type, "Refresh all" (which
 * re-applies a prototype's current style to its placements in the active diagram,
 * scoped to that library's kind), and save the current node/edge selection as a
 * new prototype. Every action goes through the gateway (the single data seam);
 * the parent re-queries on success.
 *
 * Mobile-first (spec §10.2): the tablist implements the full keyboard pattern
 * (Arrow/Home/End move selection AND focus, roving tabindex); every control is a
 * real ≥44px `<button>` with an `aria-label`; `focus-visible` rings come from the
 * palette. No hover-only affordances.
 */

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useGateway } from '../../app/GatewayContext'
import { PROTOTYPE_KINDS, type Prototype, type PrototypeKind } from '../../model'
import type { Uuid } from '../../gateway'

export interface PrototypePanelProps {
  graphId: Uuid
  /**
   * The active diagram. "Refresh all" is diagram-scoped (§7/D1 — the Diagram owns
   * styling), so it only re-skins this diagram's placements of a prototype.
   */
  diagramId: Uuid
  /** The currently-selected node id, if any (enables "save node as prototype"). */
  selectedNodeId: Uuid | null
  /** The currently-selected edge id, if any (enables "save edge as prototype"). */
  selectedEdgeId: Uuid | null
  /** Stamp a new placement of a fresh entity from this prototype onto the board. */
  onStampPrototype: (prototype: Prototype) => void
  /** Called after any mutation so the canvas/queries refresh. */
  onChanged: () => void
}

const KIND_LABEL: Record<PrototypeKind, string> = {
  node: 'Node prototypes',
  edge: 'Edge prototypes',
}

export function PrototypePanel({
  graphId,
  diagramId,
  selectedNodeId,
  selectedEdgeId,
  onStampPrototype,
  onChanged,
}: PrototypePanelProps) {
  const getGateway = useGateway()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<PrototypeKind>('node')

  const baseId = useId()
  const tabRefs = useRef<Record<PrototypeKind, HTMLButtonElement | null>>({
    node: null,
    edge: null,
  })

  const prototypes = useQuery({
    queryKey: ['prototypes', graphId],
    queryFn: async () => (await getGateway()).listPrototypes(graphId),
  })

  // The active library's rows: filtered by kind first (the two libraries are
  // distinct), then by the shared search.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (prototypes.data ?? [])
      .filter((p) => p.kind === kind)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
  }, [prototypes.data, query, kind])

  const afterMutation = async () => {
    await prototypes.refetch()
    onChanged()
  }

  const duplicate = useMutation({
    mutationFn: async (id: Uuid) => (await getGateway()).duplicatePrototype(id),
    onSuccess: afterMutation,
  })

  const refresh = useMutation({
    mutationFn: async (id: Uuid) =>
      (await getGateway()).refreshFromPrototype({ prototypeId: id, all: true, diagramId }),
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

  // WAI-ARIA tabs keyboard pattern: Arrow keys (and Home/End) move between the
  // two libraries, selecting the focused one and moving DOM focus to it (the
  // roving tabindex keeps only the selected tab in the Tab order). Without this
  // the unselected library would be keyboard-unreachable.
  const focusKind = useCallback((next: PrototypeKind) => {
    setKind(next)
    tabRefs.current[next]?.focus()
  }, [])
  const onTabsKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      const i = PROTOTYPE_KINDS.indexOf(kind)
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault()
          focusKind(PROTOTYPE_KINDS[(i + 1) % PROTOTYPE_KINDS.length])
          break
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault()
          focusKind(PROTOTYPE_KINDS[(i - 1 + PROTOTYPE_KINDS.length) % PROTOTYPE_KINDS.length])
          break
        case 'Home':
          e.preventDefault()
          focusKind(PROTOTYPE_KINDS[0])
          break
        case 'End':
          e.preventDefault()
          focusKind(PROTOTYPE_KINDS[PROTOTYPE_KINDS.length - 1])
          break
      }
    },
    [kind, focusKind],
  )

  const panelId = `${baseId}-panel`

  return (
    <section className="panel" aria-label="Prototype library">
      <h2 className="panel-title">Prototypes</h2>

      <div
        className="proto-tabs"
        role="tablist"
        aria-label="Prototype libraries"
        onKeyDown={onTabsKeyDown}
      >
        {PROTOTYPE_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            ref={(el) => {
              tabRefs.current[k] = el
            }}
            id={`${baseId}-tab-${k}`}
            aria-selected={kind === k}
            aria-controls={panelId}
            tabIndex={kind === k ? 0 : -1}
            className={kind === k ? 'proto-tab active' : 'proto-tab'}
            onClick={() => setKind(k)}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <input
        className="panel-input"
        type="search"
        placeholder="Search prototypes"
        aria-label="Search prototypes"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="panel-actions">
        <button type="button" onClick={() => saveNode.mutate()} disabled={!selectedNodeId}>
          Save node as prototype
        </button>
        <button type="button" onClick={() => saveEdge.mutate()} disabled={!selectedEdgeId}>
          Save edge as prototype
        </button>
      </div>

      <div role="tabpanel" id={panelId} aria-labelledby={`${baseId}-tab-${kind}`}>
        <ul className="panel-list" aria-label={KIND_LABEL[kind]}>
          {filtered.map((p) => (
            <li key={p.id} className="panel-list-item">
              <span className="proto-name">{p.name}</span>
              <span className="proto-buttons">
                {p.kind === 'node' && (
                  <button
                    type="button"
                    onClick={() => onStampPrototype(p)}
                    aria-label={`Create from ${p.name}`}
                  >
                    Create
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => duplicate.mutate(p.id)}
                  aria-label={`Duplicate ${p.name}`}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={() => refresh.mutate(p.id)}
                  aria-label={`Refresh all of ${p.name}`}
                >
                  Refresh all
                </button>
              </span>
            </li>
          ))}
          {filtered.length === 0 && <li className="panel-empty">No {KIND_LABEL[kind].toLowerCase()}</li>}
        </ul>
      </div>
    </section>
  )
}
