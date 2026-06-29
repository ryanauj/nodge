/**
 * Edge style property panel with the link/unlink (token vs pinned) affordance
 * (spec §8.3, §12 Phase 4 — "pin/unlink affordances everywhere"). The node-level
 * mirror of {@link NodeStylePanel}; together they give the link/unlink escape
 * hatch on *both* sides of a connection.
 *
 * Each edge style control shows whether the value *follows the palette* (a token
 * reference — the key is absent from the placement override) or is *pinned* to a
 * raw literal (the key is present). The link/unlink toggle:
 *   - **Pin** writes the current resolved value as a raw literal into the
 *     Edge.style (so a palette swap no longer changes it);
 *   - **Unlink** removes that key so the control follows the palette again.
 * Both go through `updateEdge({ style })` — one undoable command each.
 */

import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useGateway } from '../../app/GatewayContext'
import type { Uuid } from '../../gateway'
import type { StyleDelta } from '../../model'
import { EDGE_PINNABLE_KEYS, isPinned } from '../tokens'
import type { ResolvedEdgeStyle } from '../style'

export interface EdgeStylePanelProps {
  edgeId: Uuid
  /** The edge's current resolved style (effective values), from the snapshot. */
  resolved: ResolvedEdgeStyle
  onChanged: () => void
}

type Control =
  | { key: string; kind: 'color' }
  | { key: string; kind: 'number'; step?: number; min?: number }

/** One control per pinnable edge key — colors for strokes, numbers for widths. */
const CONTROLS: Control[] = EDGE_PINNABLE_KEYS.map((key) =>
  key === 'strokeWidth'
    ? { key, kind: 'number', step: 0.5, min: 0 }
    : { key, kind: 'color' },
)

export function EdgeStylePanel({ edgeId, resolved, onChanged }: EdgeStylePanelProps) {
  const getGateway = useGateway()

  const edge = useQuery({
    queryKey: ['edge-style', edgeId],
    queryFn: async () => {
      const gw = await getGateway()
      const graphs = await gw.listGraphs()
      for (const g of graphs) {
        const detail = await gw.getGraph(g.id)
        for (const diagram of detail.diagrams) {
          const dd = await gw.getDiagram(diagram.id)
          const found = dd.edges.find((e) => e.id === edgeId)
          if (found) return found
        }
      }
      return null
    },
  })

  // The edge's style is the live source of truth for pin state.
  const [override, setOverride] = useState<StyleDelta>({})
  useEffect(() => {
    if (edge.data) setOverride(edge.data.style)
  }, [edge.data])

  const save = useMutation({
    mutationFn: async (next: StyleDelta) =>
      (await getGateway()).updateEdge(edgeId, { style: next }),
    onSuccess: async () => {
      await edge.refetch()
      onChanged()
    },
  })

  const persist = (next: StyleDelta) => {
    setOverride(next)
    save.mutate(next)
  }

  // Pin: copy the current effective value into the override (raw literal).
  const pin = (key: string) => {
    const value = (resolved as unknown as Record<string, unknown>)[key]
    persist({ ...override, [key]: value })
  }
  // Unlink: drop the key so the control follows the palette again.
  const unlink = (key: string) => {
    const next = { ...override }
    delete next[key]
    persist(next)
  }
  const setValue = (key: string, value: unknown) => persist({ ...override, [key]: value })

  if (!edge.data) {
    return (
      <section className="panel" aria-label="Edge style">
        <h2 className="panel-title">Edge style</h2>
        <p className="panel-empty">{edge.isLoading ? 'Loading…' : 'No edge selected'}</p>
      </section>
    )
  }

  const effective = (key: string): unknown =>
    isPinned(override, key)
      ? override[key]
      : (resolved as unknown as Record<string, unknown>)[key]

  return (
    <section className="panel" aria-label="Edge style">
      <h2 className="panel-title">Edge style</h2>
      <p className="panel-meta">Follows the palette unless pinned.</p>
      <ul className="panel-list" aria-label="Edge style controls">
        {CONTROLS.map((control) => {
          const pinned = isPinned(override, control.key)
          const value = effective(control.key)
          return (
            <li key={control.key} className="style-row">
              <span className="style-label">{control.key}</span>
              {control.kind === 'color' && (
                <input
                  type="color"
                  aria-label={`${control.key} value`}
                  value={typeof value === 'string' ? value : '#000000'}
                  disabled={!pinned}
                  onChange={(e) => setValue(control.key, e.target.value)}
                />
              )}
              {control.kind === 'number' && (
                <input
                  type="number"
                  aria-label={`${control.key} value`}
                  step={control.step}
                  min={control.min}
                  value={typeof value === 'number' ? value : 0}
                  disabled={!pinned}
                  onChange={(e) => setValue(control.key, Number(e.target.value))}
                />
              )}
              <button
                className={pinned ? 'pin-toggle pinned' : 'pin-toggle'}
                aria-label={pinned ? `Unlink ${control.key}` : `Pin ${control.key}`}
                aria-pressed={pinned}
                title={pinned ? 'Pinned to a raw value — click to follow the palette' : 'Follows the palette — click to pin'}
                onClick={() => (pinned ? unlink(control.key) : pin(control.key))}
              >
                {pinned ? '🔒' : '🔗'}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
