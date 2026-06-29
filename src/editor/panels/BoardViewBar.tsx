/**
 * Diagrams / layouts switcher (spec §7.1–7.3, §12 Phase 3).
 *
 * Lists the graph's diagrams and the active diagram's layouts, lets the user
 * switch between them (navigation is wired through React Router by the parent via
 * `onNavigate`), and create new diagrams/layouts. Every mutation goes through the
 * gateway (the single data seam); creation is one undoable command each.
 *
 * Kept presentational + gateway-driven so it is component-testable with a real
 * in-memory gateway and a `MemoryRouter`.
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useGateway } from '../../app/GatewayContext'
import type { Uuid } from '../../gateway'

export interface BoardViewBarProps {
  graphId: Uuid
  diagramId: Uuid
  layoutId: Uuid
  /** Switch the active diagram+layout (navigates the URL). */
  onNavigate: (diagramId: Uuid, layoutId: Uuid) => void
  /** Called after a create so the parent can refresh caches. */
  onChanged?: () => void
  /**
   * Called after "Auto-arrange" recomputes the active layout's positions (§8) so
   * the parent can refresh the canvas and re-fit the view. The parent is
   * responsible for respecting `prefers-reduced-motion` when it animates fitView.
   */
  onLayoutGenerated?: () => void
}

export function BoardViewBar({
  graphId,
  diagramId,
  layoutId,
  onNavigate,
  onChanged,
  onLayoutGenerated,
}: BoardViewBarProps) {
  const getGateway = useGateway()
  const [newDiagramName, setNewDiagramName] = useState('')
  const [newLayoutName, setNewLayoutName] = useState('')

  const graph = useQuery({
    queryKey: ['graph', graphId],
    queryFn: async () => (await getGateway()).getGraph(graphId),
  })

  const diagram = useQuery({
    queryKey: ['diagram-detail', diagramId],
    queryFn: async () => (await getGateway()).getDiagram(diagramId),
  })

  const diagrams = useMemo(() => graph.data?.diagrams ?? [], [graph.data])
  const layouts = useMemo(() => diagram.data?.layouts ?? [], [diagram.data])

  const afterChange = async () => {
    await graph.refetch()
    await diagram.refetch()
    onChanged?.()
  }

  const createDiagram = useMutation({
    mutationFn: async (name: string) => {
      const gw = await getGateway()
      const created = await gw.createDiagram(graphId, { name })
      // A diagram needs at least one layout to be navigable; seed one.
      const layout = await gw.createLayout(created.id, { name: 'Layout 1' })
      return { diagramId: created.id, layoutId: layout.id }
    },
    onSuccess: async ({ diagramId: d, layoutId: l }) => {
      setNewDiagramName('')
      await afterChange()
      onNavigate(d, l)
    },
  })

  const createLayout = useMutation({
    mutationFn: async (name: string) => {
      const gw = await getGateway()
      return gw.createLayout(diagramId, { name })
    },
    onSuccess: async (layout) => {
      setNewLayoutName('')
      await afterChange()
      onNavigate(diagramId, layout.id)
    },
  })

  // Auto-arrange (§8 / D8): recompute the ACTIVE layout's positions with Dagre
  // (default TB) and let the parent re-render React Flow from them. One undoable
  // command; the button shows a busy/disabled state while it runs.
  const autoArrange = useMutation({
    mutationFn: async () => {
      const gw = await getGateway()
      return gw.generateLayout(diagramId, layoutId)
    },
    onSuccess: async () => {
      await afterChange()
      onLayoutGenerated?.()
    },
  })

  return (
    <section className="panel" aria-label="Diagrams and layouts">
      <h2 className="panel-title">Diagrams</h2>
      <ul className="panel-list" aria-label="Diagram list">
        {diagrams.map((d) => (
          <li key={d.id} className="panel-list-item">
            <button
              aria-label={`Open diagram ${d.name}`}
              aria-current={d.id === diagramId ? 'true' : undefined}
              className={d.id === diagramId ? 'switch-active' : undefined}
              onClick={() => {
                if (d.id !== diagramId) {
                  // Resolve to the diagram's first layout on switch (parent re-reads).
                  void (async () => {
                    const detail = await (await getGateway()).getDiagram(d.id)
                    const first = detail.layouts[0]
                    if (first) onNavigate(d.id, first.id)
                  })()
                }
              }}
            >
              {d.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="panel-actions">
        <input
          aria-label="New diagram name"
          placeholder="New diagram"
          value={newDiagramName}
          onChange={(e) => setNewDiagramName(e.target.value)}
        />
        <button
          aria-label="Create diagram"
          disabled={!newDiagramName.trim()}
          onClick={() => createDiagram.mutate(newDiagramName.trim())}
        >
          Add diagram
        </button>
      </div>

      <h3 className="panel-subtitle">Layouts</h3>
      <ul className="panel-list" aria-label="Layout list">
        {layouts.map((l) => (
          <li key={l.id} className="panel-list-item">
            <button
              aria-label={`Open layout ${l.name}`}
              aria-current={l.id === layoutId ? 'true' : undefined}
              className={l.id === layoutId ? 'switch-active' : undefined}
              onClick={() => l.id !== layoutId && onNavigate(diagramId, l.id)}
            >
              {l.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="panel-actions">
        <input
          aria-label="New layout name"
          placeholder="New layout"
          value={newLayoutName}
          onChange={(e) => setNewLayoutName(e.target.value)}
        />
        <button
          aria-label="Create layout"
          disabled={!newLayoutName.trim()}
          onClick={() => createLayout.mutate(newLayoutName.trim())}
        >
          Add layout
        </button>
      </div>
      <div className="panel-actions">
        <button
          className="auto-arrange-btn"
          aria-label="Auto-arrange layout"
          aria-busy={autoArrange.isPending}
          disabled={autoArrange.isPending}
          onClick={() => autoArrange.mutate()}
        >
          {autoArrange.isPending ? 'Arranging…' : 'Auto-arrange'}
        </button>
      </div>
    </section>
  )
}
