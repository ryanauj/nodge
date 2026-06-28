/**
 * Boards / views switcher (spec §7.1–7.3, §12 Phase 3).
 *
 * Lists the graph's boards and the active board's views, lets the user switch
 * between them (navigation is wired through React Router by the parent via
 * `onNavigate`), and create new boards/views. Every mutation goes through the
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
  boardId: Uuid
  viewId: Uuid
  /** Switch the active board+view (navigates the URL). */
  onNavigate: (boardId: Uuid, viewId: Uuid) => void
  /** Called after a create so the parent can refresh caches. */
  onChanged?: () => void
}

export function BoardViewBar({ graphId, boardId, viewId, onNavigate, onChanged }: BoardViewBarProps) {
  const getGateway = useGateway()
  const [newBoardName, setNewBoardName] = useState('')
  const [newViewName, setNewViewName] = useState('')

  const graph = useQuery({
    queryKey: ['graph', graphId],
    queryFn: async () => (await getGateway()).getGraph(graphId),
  })

  const board = useQuery({
    queryKey: ['board', boardId],
    queryFn: async () => (await getGateway()).getBoard(boardId),
  })

  const boards = useMemo(() => graph.data?.boards ?? [], [graph.data])
  const views = useMemo(() => board.data?.views ?? [], [board.data])

  const afterChange = async () => {
    await graph.refetch()
    await board.refetch()
    onChanged?.()
  }

  const createBoard = useMutation({
    mutationFn: async (name: string) => {
      const gw = await getGateway()
      const created = await gw.createBoard(graphId, { name })
      // A board needs at least one view to be navigable; seed one, inheriting
      // the current view's palette so the new board has a consistent look.
      const paletteId = views.find((v) => v.id === viewId)?.paletteId ?? null
      const view = await gw.createView(created.id, { name: 'View 1', paletteId })
      return { boardId: created.id, viewId: view.id }
    },
    onSuccess: async ({ boardId: b, viewId: v }) => {
      setNewBoardName('')
      await afterChange()
      onNavigate(b, v)
    },
  })

  const createView = useMutation({
    mutationFn: async (name: string) => {
      const gw = await getGateway()
      const palette = views.find((v) => v.id === viewId)?.paletteId ?? null
      return gw.createView(boardId, { name, paletteId: palette })
    },
    onSuccess: async (view) => {
      setNewViewName('')
      await afterChange()
      onNavigate(boardId, view.id)
    },
  })

  return (
    <section className="panel" aria-label="Boards and views">
      <h2 className="panel-title">Boards</h2>
      <ul className="panel-list" aria-label="Board list">
        {boards.map((b) => (
          <li key={b.id} className="panel-list-item">
            <button
              aria-label={`Open board ${b.name}`}
              aria-current={b.id === boardId ? 'true' : undefined}
              className={b.id === boardId ? 'switch-active' : undefined}
              onClick={() => {
                if (b.id !== boardId) {
                  // Resolve to the board's first view on switch (parent re-reads).
                  void (async () => {
                    const detail = await (await getGateway()).getBoard(b.id)
                    const first = detail.views[0]
                    if (first) onNavigate(b.id, first.id)
                  })()
                }
              }}
            >
              {b.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="panel-actions">
        <input
          aria-label="New board name"
          placeholder="New board"
          value={newBoardName}
          onChange={(e) => setNewBoardName(e.target.value)}
        />
        <button
          aria-label="Create board"
          disabled={!newBoardName.trim()}
          onClick={() => createBoard.mutate(newBoardName.trim())}
        >
          Add board
        </button>
      </div>

      <h3 className="panel-subtitle">Views</h3>
      <ul className="panel-list" aria-label="View list">
        {views.map((v) => (
          <li key={v.id} className="panel-list-item">
            <button
              aria-label={`Open view ${v.name}`}
              aria-current={v.id === viewId ? 'true' : undefined}
              className={v.id === viewId ? 'switch-active' : undefined}
              onClick={() => v.id !== viewId && onNavigate(boardId, v.id)}
            >
              {v.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="panel-actions">
        <input
          aria-label="New view name"
          placeholder="New view"
          value={newViewName}
          onChange={(e) => setNewViewName(e.target.value)}
        />
        <button
          aria-label="Create view"
          disabled={!newViewName.trim()}
          onClick={() => createView.mutate(newViewName.trim())}
        >
          Add view
        </button>
      </div>
    </section>
  )
}
