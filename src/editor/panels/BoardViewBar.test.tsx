/**
 * BoardViewBar component tests (spec §7.1–7.3, Phase 3). Real in-memory gateway,
 * a MemoryRouter for navigation. Proves listing/switching boards + views and
 * creating new ones (each navigates to the new board/view).
 */

import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createMemoryGateway } from '../../gateway'
import type { LocalGateway } from '../../gateway/LocalGateway'
import { renderWithGateway } from './panelTestUtils'
import { BoardViewBar } from './BoardViewBar'

async function seed(gw: LocalGateway) {
  const graph = await gw.createGraph({ name: 'G' })
  const board = await gw.createBoard(graph.id, { name: 'Board 1' })
  const view = await gw.createView(board.id, { name: 'View 1' })
  return { graphId: graph.id, boardId: board.id, viewId: view.id }
}

describe('BoardViewBar', () => {
  it('lists boards and views and marks the active ones', async () => {
    const gw = await createMemoryGateway()
    const { graphId, boardId, viewId } = await seed(gw)
    renderWithGateway(
      <MemoryRouter>
        <BoardViewBar graphId={graphId} boardId={boardId} viewId={viewId} onNavigate={() => {}} />
      </MemoryRouter>,
      gw,
    )
    await waitFor(() => expect(screen.getByLabelText('Open board Board 1')).toBeInTheDocument())
    expect(screen.getByLabelText('Open view View 1')).toHaveAttribute('aria-current', 'true')
  })

  it('creates a board (with a seeded view) and navigates to it', async () => {
    const gw = await createMemoryGateway()
    const { graphId, boardId, viewId } = await seed(gw)
    const onNavigate = vi.fn()
    renderWithGateway(
      <MemoryRouter>
        <BoardViewBar graphId={graphId} boardId={boardId} viewId={viewId} onNavigate={onNavigate} />
      </MemoryRouter>,
      gw,
    )
    await waitFor(() => expect(screen.getByLabelText('Open board Board 1')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('New board name'), { target: { value: 'Board 2' } })
    fireEvent.click(screen.getByLabelText('Create board'))

    await waitFor(() => expect(onNavigate).toHaveBeenCalled())
    const [newBoardId, newViewId] = onNavigate.mock.calls[0]
    expect(newBoardId).not.toBe(boardId)
    // The new board is navigable: it has a view to open.
    const detail = await gw.getBoard(newBoardId)
    expect(detail.views.map((v) => v.id)).toContain(newViewId)
  })

  it('creates a view on the active board and navigates to it', async () => {
    const gw = await createMemoryGateway()
    const { graphId, boardId, viewId } = await seed(gw)
    const onNavigate = vi.fn()
    renderWithGateway(
      <MemoryRouter>
        <BoardViewBar graphId={graphId} boardId={boardId} viewId={viewId} onNavigate={onNavigate} />
      </MemoryRouter>,
      gw,
    )
    await waitFor(() => expect(screen.getByLabelText('Open view View 1')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('New view name'), { target: { value: 'View 2' } })
    fireEvent.click(screen.getByLabelText('Create view'))

    await waitFor(() => expect(onNavigate).toHaveBeenCalled())
    const [navBoard, navView] = onNavigate.mock.calls[0]
    expect(navBoard).toBe(boardId)
    const detail = await gw.getBoard(boardId)
    expect(detail.views.map((v) => v.id)).toContain(navView)
  })
})
