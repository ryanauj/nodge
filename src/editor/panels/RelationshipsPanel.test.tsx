/**
 * RelationshipsPanel component tests (design §10 / D7). Real in-memory gateway.
 * Proves the panel lists the graph's relationships (source→target / prototype /
 * label), that drill-down selects/reveals the backing entities + edge, and that
 * the list is keyboard-operable.
 */

import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { createMemoryGateway } from '../../gateway'
import type { LocalGateway } from '../../gateway/LocalGateway'
import { renderWithGateway } from './panelTestUtils'
import { RelationshipsPanel } from './RelationshipsPanel'

async function seed(gw: LocalGateway) {
  const graph = await gw.createGraph({ name: 'G' })
  const diagram = await gw.createDiagram(graph.id, { name: 'D' })
  const layout = await gw.createLayout(diagram.id, { name: 'L' })
  const a = await gw.addNode(diagram.id, layout.id, { name: 'Alpha', x: 0, y: 0 })
  const b = await gw.addNode(diagram.id, layout.id, { name: 'Beta', x: 100, y: 0 })
  const { relationship, edge } = await gw.connectNodes(diagram.id, {
    sourceNodeId: a.node.id,
    targetNodeId: b.node.id,
    label: 'calls',
    directed: true,
  })
  return {
    graphId: graph.id,
    diagramId: diagram.id,
    relationship,
    edge,
    sourceEntityId: a.entity.id,
    targetEntityId: b.entity.id,
  }
}

describe('RelationshipsPanel', () => {
  it('lists the graph relationships with source→target and label', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId } = await seed(gw)
    renderWithGateway(
      <RelationshipsPanel graphId={graphId} diagramId={diagramId} />,
      gw,
    )
    await waitFor(() => expect(screen.getByLabelText('Relationship list')).toBeInTheDocument())
    // The row's accessible name carries the endpoints + label.
    expect(
      screen.getByRole('button', { name: /Relationship Alpha → Beta, calls/ }),
    ).toBeInTheDocument()
    expect(screen.getByText('“calls”')).toBeInTheDocument()
  })

  it('drills down to the backing source/target entities and edge', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId, sourceEntityId, targetEntityId, edge } = await seed(gw)
    const onNavigateEntity = vi.fn()
    const onRevealEdge = vi.fn()
    renderWithGateway(
      <RelationshipsPanel
        graphId={graphId}
        diagramId={diagramId}
        onNavigateEntity={onNavigateEntity}
        onRevealEdge={onRevealEdge}
      />,
      gw,
    )
    const row = await screen.findByRole('button', { name: /Relationship Alpha → Beta/ })
    // Drill-down controls are hidden until the row is expanded.
    expect(screen.queryByLabelText('Go to source entity Alpha')).not.toBeInTheDocument()
    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(await screen.findByLabelText('Go to source entity Alpha'))
    expect(onNavigateEntity).toHaveBeenCalledWith(sourceEntityId)

    fireEvent.click(screen.getByLabelText('Go to target entity Beta'))
    expect(onNavigateEntity).toHaveBeenCalledWith(targetEntityId)

    fireEvent.click(screen.getByLabelText(/Reveal edge for Alpha → Beta/))
    expect(onRevealEdge).toHaveBeenCalledWith(edge.id)
  })

  it('renders rows as keyboard-operable buttons in a labelled list', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId } = await seed(gw)
    renderWithGateway(
      <RelationshipsPanel graphId={graphId} diagramId={diagramId} />,
      gw,
    )
    const list = await screen.findByRole('list', { name: 'Relationship list' })
    const row = screen.getByRole('button', { name: /Relationship Alpha → Beta/ })
    expect(list).toContainElement(row)
    // A real <button> is focusable and Enter/Space-operable by the platform.
    row.focus()
    expect(row).toHaveFocus()
    fireEvent.click(row) // Enter/Space on a button dispatches a click.
    expect(row).toHaveAttribute('aria-expanded', 'true')
  })

  it('filters relationships by the search box', async () => {
    const gw = await createMemoryGateway()
    const { graphId, diagramId } = await seed(gw)
    renderWithGateway(
      <RelationshipsPanel graphId={graphId} diagramId={diagramId} />,
      gw,
    )
    await screen.findByRole('button', { name: /Relationship Alpha → Beta/ })
    fireEvent.change(screen.getByLabelText('Search relationships'), {
      target: { value: 'zzz-no-match' },
    })
    await waitFor(() => expect(screen.getByText('No relationships')).toBeInTheDocument())
  })
})
