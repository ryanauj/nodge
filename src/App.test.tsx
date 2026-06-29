import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import App from './App'
import { GatewayProvider } from './app/GatewayContext'
import { createMemoryGateway } from './gateway'
import type { LocalGateway } from './gateway/LocalGateway'

async function renderApp() {
  const gw = await createMemoryGateway()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <GatewayProvider value={() => Promise.resolve(gw)}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="*" element={<App />} />
          </Routes>
        </MemoryRouter>
      </GatewayProvider>
    </QueryClientProvider>,
  )
  return gw
}

async function activeDiagramId(gw: LocalGateway): Promise<string> {
  const graphs = await gw.listGraphs()
  const graph = await gw.getGraph(graphs[0].id)
  return graph.diagrams[0].id
}

describe('App (Phase 1 editor)', () => {
  it('renders the canvas toolbar', async () => {
    await renderApp()
    expect(await screen.findByRole('toolbar', { name: 'Canvas tools' })).toBeInTheDocument()
  })

  it('the Add node button opens the entity picker (no anonymous Node N)', async () => {
    const gw = await renderApp()

    // Bootstrap finishes → the Add node button enables.
    const addButtons = await screen.findAllByRole('button', { name: 'Add node' })
    await waitFor(() => expect(addButtons[0]).toBeEnabled())

    fireEvent.click(addButtons[0])

    // The picker opens — no node is created yet (§9 / D6: no anonymous `Node N`).
    await screen.findByRole('dialog', { name: 'Add node' })
    const diagram = await gw.getDiagram(await activeDiagramId(gw))
    expect(diagram.nodes).toHaveLength(0)
  })

  it('picker → create new → adds a node with the typed name via the gateway', async () => {
    const gw = await renderApp()

    const addButtons = await screen.findAllByRole('button', { name: 'Add node' })
    await waitFor(() => expect(addButtons[0]).toBeEnabled())
    fireEvent.click(addButtons[0])

    await screen.findByRole('dialog', { name: 'Add node' })
    fireEvent.click(screen.getByRole('tab', { name: 'Create new' }))
    fireEvent.change(screen.getByLabelText('New entity name'), { target: { value: 'Worker' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create node' }))

    await waitFor(async () => {
      const diagram = await gw.getDiagram(await activeDiagramId(gw))
      expect(diagram.nodes).toHaveLength(1)
    })
    const graph = await gw.getGraph((await gw.listGraphs())[0].id)
    expect(graph.entities.some((e) => e.name === 'Worker')).toBe(true)
  })

  it('picker → use existing → places another node of that entity (placeEntity)', async () => {
    const gw = await renderApp()

    // Seed one node via the picker's create-new path.
    const addButtons = await screen.findAllByRole('button', { name: 'Add node' })
    await waitFor(() => expect(addButtons[0]).toBeEnabled())
    fireEvent.click(addButtons[0])
    await screen.findByRole('dialog', { name: 'Add node' })
    fireEvent.click(screen.getByRole('tab', { name: 'Create new' }))
    fireEvent.change(screen.getByLabelText('New entity name'), { target: { value: 'Shared' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create node' }))
    await waitFor(async () => {
      const diagram = await gw.getDiagram(await activeDiagramId(gw))
      expect(diagram.nodes).toHaveLength(1)
    })

    // Re-open the picker and place the existing entity as a second node. Scope
    // the lookup to the picker's existing-entities list (the canvas node also
    // renders the "Shared" label).
    fireEvent.click((await screen.findAllByRole('button', { name: 'Add node' }))[0])
    const dialog = await screen.findByRole('dialog', { name: 'Add node' })
    const list = within(dialog).getByRole('list', { name: 'Existing entities' })
    fireEvent.click(within(list).getByRole('button', { name: 'Shared' }))

    await waitFor(async () => {
      const diagram = await gw.getDiagram(await activeDiagramId(gw))
      expect(diagram.nodes).toHaveLength(2)
    })
    // Both placements trace back to the one entity (§7.1).
    const diagram = await gw.getDiagram(await activeDiagramId(gw))
    const entityIds = new Set(diagram.nodes.map((n) => n.entityId))
    expect(entityIds.size).toBe(1)
  })
})
