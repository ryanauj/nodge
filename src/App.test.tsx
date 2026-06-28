import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
        <App />
      </GatewayProvider>
    </QueryClientProvider>,
  )
  return gw
}

async function activeBoardId(gw: LocalGateway): Promise<string> {
  const graphs = await gw.listGraphs()
  const graph = await gw.getGraph(graphs[0].id)
  return graph.boards[0].id
}

describe('App (Phase 1 editor)', () => {
  it('renders the canvas toolbar', async () => {
    await renderApp()
    expect(await screen.findByRole('toolbar', { name: 'Editor toolbar' })).toBeInTheDocument()
  })

  it('bootstraps a default diagram and adds a node through the gateway', async () => {
    const gw = await renderApp()

    // Bootstrap finishes → the Add node button enables.
    const addButtons = await screen.findAllByRole('button', { name: 'Add node' })
    await waitFor(() => expect(addButtons[0]).toBeEnabled())

    fireEvent.click(addButtons[0])

    await waitFor(async () => {
      const board = await gw.getBoard(await activeBoardId(gw))
      expect(board.nodes).toHaveLength(1)
    })
  })
})
