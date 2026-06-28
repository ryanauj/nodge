/**
 * Node style property panel with the link/unlink (token vs pinned) affordance
 * (spec §8.3, §10.3, §12 Phase 4).
 *
 * Each style control shows whether the value *follows the palette* (a token
 * reference — the key is absent from the placement override) or is *pinned* to a
 * raw literal (the key is present). The link/unlink toggle:
 *   - **Pin** writes the current resolved value as a raw literal into the
 *     Node.styleOverride (so a palette swap no longer changes it);
 *   - **Unlink** removes that key so the control follows the palette again.
 * Both go through `updateNode({ styleOverride })` — one undoable command each.
 *
 * The panel resolves the current effective value from the live diagram snapshot
 * so a pinned control shows its pinned value and a following control shows the
 * palette's value.
 */

import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useGateway } from '../../app/GatewayContext'
import type { Uuid } from '../../gateway'
import type { StyleDelta } from '../../model'
import {
  BACKGROUND_PATTERNS,
  BORDER_STYLES,
  ELEVATIONS,
  NODE_SHAPES,
  isPinned,
} from '../tokens'
import type { ResolvedNodeStyle } from '../style'

export interface NodeStylePanelProps {
  nodeId: Uuid
  /** The node's current resolved style (effective values), from the snapshot. */
  resolved: ResolvedNodeStyle
  onChanged: () => void
}

type Control =
  | { key: string; kind: 'color' }
  | { key: string; kind: 'number'; step?: number; min?: number }
  | { key: string; kind: 'enum'; options: readonly string[] }

const CONTROLS: Control[] = [
  { key: 'surface', kind: 'color' },
  { key: 'content', kind: 'color' },
  { key: 'border', kind: 'color' },
  { key: 'borderWidth', kind: 'number', step: 0.5, min: 0 },
  { key: 'shape', kind: 'enum', options: NODE_SHAPES },
  { key: 'borderStyle', kind: 'enum', options: BORDER_STYLES },
  { key: 'pattern', kind: 'enum', options: BACKGROUND_PATTERNS },
  { key: 'elevation', kind: 'enum', options: ELEVATIONS },
]

export function NodeStylePanel({ nodeId, resolved, onChanged }: NodeStylePanelProps) {
  const getGateway = useGateway()

  const node = useQuery({
    queryKey: ['node-style', nodeId],
    queryFn: async () => {
      const gw = await getGateway()
      const graphs = await gw.listGraphs()
      for (const g of graphs) {
        const detail = await gw.getGraph(g.id)
        for (const board of detail.boards) {
          const bd = await gw.getBoard(board.id)
          const found = bd.nodes.find((n) => n.id === nodeId)
          if (found) return found
        }
      }
      return null
    },
  })

  // The placement override is the live source of truth for pin state.
  const [override, setOverride] = useState<StyleDelta>({})
  useEffect(() => {
    if (node.data) setOverride(node.data.styleOverride)
  }, [node.data])

  const save = useMutation({
    mutationFn: async (next: StyleDelta) =>
      (await getGateway()).updateNode(nodeId, { styleOverride: next }),
    onSuccess: async () => {
      await node.refetch()
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

  if (!node.data) {
    return (
      <section className="panel" aria-label="Node style">
        <h2 className="panel-title">Node style</h2>
        <p className="panel-empty">{node.isLoading ? 'Loading…' : 'No node selected'}</p>
      </section>
    )
  }

  const effective = (key: string): unknown =>
    isPinned(override, key)
      ? override[key]
      : (resolved as unknown as Record<string, unknown>)[key]

  return (
    <section className="panel" aria-label="Node style">
      <h2 className="panel-title">Node style</h2>
      <p className="panel-meta">Follows the palette unless pinned.</p>
      <ul className="panel-list" aria-label="Style controls">
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
              {control.kind === 'enum' && (
                <select
                  aria-label={`${control.key} value`}
                  value={typeof value === 'string' ? value : control.options[0]}
                  disabled={!pinned}
                  onChange={(e) => setValue(control.key, e.target.value)}
                >
                  {control.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
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
