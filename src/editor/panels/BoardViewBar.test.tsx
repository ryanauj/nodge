/**
 * BoardViewBar component tests (spec §7.1–7.3, Phase 3). Real in-memory gateway,
 * a MemoryRouter for navigation. Proves listing/switching diagrams + layouts and
 * creating new ones (each navigates to the new diagram/layout).
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
  const diagram = await gw.createDiagram(graph.id, { name: 'Diagram 1' })
  const layout = await gw.createLayout(diagram.id, { name: 'Layout 1' })
  return { graphId: graph.id, diagramId: diagram.id, layoutId: layout.id }
}

describe('BoardViewBar', () => {
  it('lists diagrams and layouts and marks the active ones', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId, layoutId } = await seed(gw)
    renderWithGateway(
      <MemoryRouter>
        <BoardViewBar
          graphId={graphId}
          diagramId={diagramId}
          layoutId={layoutId}
          onNavigate={() => {}}
        />
      </MemoryRouter>,
      gw,
    )
    await waitFor(() =>
      expect(screen.getByLabelText('Open diagram Diagram 1')).toBeInTheDocument(),
    )
    expect(screen.getByLabelText('Open layout Layout 1')).toHaveAttribute('aria-current', 'true')
  })

  it('creates a diagram (with a seeded layout) and navigates to it', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId, layoutId } = await seed(gw)
    const onNavigate = vi.fn()
    renderWithGateway(
      <MemoryRouter>
        <BoardViewBar
          graphId={graphId}
          diagramId={diagramId}
          layoutId={layoutId}
          onNavigate={onNavigate}
        />
      </MemoryRouter>,
      gw,
    )
    await waitFor(() =>
      expect(screen.getByLabelText('Open diagram Diagram 1')).toBeInTheDocument(),
    )

    fireEvent.change(screen.getByLabelText('New diagram name'), { target: { value: 'Diagram 2' } })
    fireEvent.click(screen.getByLabelText('Create diagram'))

    await waitFor(() => expect(onNavigate).toHaveBeenCalled())
    const [newDiagramId, newLayoutId] = onNavigate.mock.calls[0]
    expect(newDiagramId).not.toBe(diagramId)
    // The new diagram is navigable: it has a layout to open.
    const detail = await gw.getDiagram(newDiagramId)
    expect(detail.layouts.map((l) => l.id)).toContain(newLayoutId)
  })

  it('creates a layout on the active diagram and navigates to it', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId, layoutId } = await seed(gw)
    const onNavigate = vi.fn()
    renderWithGateway(
      <MemoryRouter>
        <BoardViewBar
          graphId={graphId}
          diagramId={diagramId}
          layoutId={layoutId}
          onNavigate={onNavigate}
        />
      </MemoryRouter>,
      gw,
    )
    await waitFor(() =>
      expect(screen.getByLabelText('Open layout Layout 1')).toBeInTheDocument(),
    )

    fireEvent.change(screen.getByLabelText('New layout name'), { target: { value: 'Layout 2' } })
    fireEvent.click(screen.getByLabelText('Create layout'))

    await waitFor(() => expect(onNavigate).toHaveBeenCalled())
    const [navDiagram, navLayout] = onNavigate.mock.calls[0]
    expect(navDiagram).toBe(diagramId)
    const detail = await gw.getDiagram(diagramId)
    expect(detail.layouts.map((l) => l.id)).toContain(navLayout)
  })
})
